import io
import json
import struct
import zlib
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from starlette.requests import Request
from starlette.datastructures import UploadFile
from fastapi import HTTPException
import branding
import main

A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
def png(size):
    def chunk(tag,data): return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+b'\xff'*(size*3))*size))+chunk(b'IEND',b'')
class Bucket:
    def __init__(self):self.files={};self.fail=None
    def download(self,path):
        if path not in self.files:raise Exception({'statusCode':404,'error':'Not found'})
        return self.files[path]
    def upload(self,path,content,file_options):
        if self.fail and self.fail in path:raise RuntimeError('Upload failed')
        self.files[path]=content
class Storage:
    def __init__(self):self.bucket=Bucket();self.exists=False;self.options=None
    def from_(self,bucket):assert bucket==branding.BUCKET;return self.bucket
    def get_bucket(self,bucket):
        if not self.exists:raise Exception({'statusCode':404})
        return {}
    def create_bucket(self,bucket,options):self.exists=True;self.options=options
class CompanyQuery:
    def select(self,*args):return self
    def eq(self,*args):return self
    def limit(self,*args):return self
    def execute(self):return SimpleNamespace(data=[{'nome':'Empresa A'}])
class BrandTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):self.db=SimpleNamespace(storage=Storage(),table=lambda name:CompanyQuery())
    def assets(self):return [('icon192',png(192),'image/png'),('icon512',png(512),'image/png')]
    def req(self,role='gestor'):
        req=Request({'type':'http','method':'POST','path':'/api/identidade-visual','headers':[]})
        req.state.empresa_id=A;req.state.user={'id':'u1','app_metadata':{'role':role}};return req
    def test_persistence_company_isolation_and_private_bucket(self):
        result=branding.save_config(self.db,A,'Empresa A',self.assets())
        self.assertFalse(self.db.storage.options['public'])
        self.assertEqual(branding.load_config(self.db,B),{})
        self.assertIn(A,result['icon512']);self.assertNotIn(B,result['icon512'])
        again=branding.presentation(branding.load_config(self.db,A),A)
        self.assertEqual(result,again)
    def test_failed_upload_never_publishes_partial_configuration(self):
        branding.save_config(self.db,A,'Empresa A',self.assets())
        original=self.db.storage.bucket.files[f'{A}/config.json']
        self.db.storage.bucket.fail='icon512.png'
        with self.assertRaises(HTTPException):branding.save_config(self.db,A,'Empresa A',self.assets())
        self.assertEqual(self.db.storage.bucket.files[f'{A}/config.json'],original)
    def test_restore_defaults_and_manifest_has_correct_install_identity(self):
        branding.save_config(self.db,A,'Empresa A',self.assets())
        result=branding.save_config(self.db,A,'Empresa A',[],True)
        self.assertNotIn('banner',result);self.assertIsNone(result['icon192'])
        manifest=branding.manifest(branding.load_config(self.db,A),A)
        self.assertEqual(manifest['start_url'],f'/tecnico?empresa={A}')
        self.assertEqual(manifest['icons'][0]['src'],'/static/icon-192.png')
    def test_legacy_banner_is_hidden_and_retired_on_next_save(self):
        self.db.storage.bucket.files[f'{A}/config.json']=json.dumps({'banner':{'path':f'{A}/old.png','mime':'image/png'}}).encode()
        self.assertNotIn('banner',branding.presentation(branding.load_config(self.db,A),A))
        branding.save_config(self.db,A,'Empresa A',self.assets())
        self.assertNotIn('banner',branding.load_config(self.db,A))
    def test_rejects_wrong_dimensions_and_cross_company_storage_paths(self):
        branding.validate_icon(png(512),512)
        with self.assertRaises(HTTPException):branding.validate_icon(png(192),512)
        with self.assertRaises(HTTPException):branding.validate_icon(b'<svg></svg>',512)
        with self.assertRaises(HTTPException):branding.safe_asset({'banner':{'path':f'{B}/x.png','mime':'image/png'}},A,'banner')
    async def test_technician_cannot_change_company_brand(self):
        with self.assertRaises(HTTPException) as caught:
            await main.salvar_identidade_visual(self.req('tecnico'),None,None,False)
        self.assertEqual(caught.exception.status_code,403)
    async def test_actual_endpoint_publishes_normalized_icon_pair(self):
        with patch.multiple(main,supabase_client=self.db,EMPRESA_TABLE_AVAILABLE=True):
            result=await main.salvar_identidade_visual(self.req(),UploadFile(io.BytesIO(png(512))),UploadFile(io.BytesIO(png(192))),False)
            loaded=await main.identidade_visual(self.req())
        self.assertEqual(result['icon192'],loaded['icon192']);self.assertEqual(result['nome'],'Empresa A')
    async def test_public_image_route_never_serves_config_or_arbitrary_files(self):
        from uuid import UUID
        branding.save_config(self.db,A,'Empresa A',self.assets())
        with patch.object(main,'supabase_client',self.db):
            response=await main.imagem_marca_empresa(UUID(A),'icon512')
            self.assertEqual(response.media_type,'image/png')
            with self.assertRaises(HTTPException):await main.imagem_marca_empresa(UUID(A),'config.json')
            with self.assertRaises(HTTPException):await main.imagem_marca_empresa(UUID(A),'banner')
