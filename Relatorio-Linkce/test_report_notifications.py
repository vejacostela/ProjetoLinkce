"""Notification read flow: real endpoint and access middleware without external services."""
import unittest
from types import SimpleNamespace
from unittest.mock import patch, AsyncMock
from starlette.requests import Request
from fastapi import HTTPException
import main

A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

class Query:
    def __init__(self, rows): self.rows=rows; self.filters=[]; self.maximum=None; self.orders=[]
    def select(self, fields): self.fields=fields; return self
    def eq(self, name, value): self.filters.append((name,value)); return self
    def order(self, name, desc=False): self.orders.append((name,desc)); return self
    def limit(self, count): self.maximum=count; return self
    def execute(self):
        rows=[row for row in self.rows if all(row.get(k)==v for k,v in self.filters)]
        for name,desc in reversed(self.orders): rows=sorted(rows,key=lambda row:row[name],reverse=desc)
        return SimpleNamespace(data=rows[:self.maximum])

class Database:
    def __init__(self,rows): self.query=Query(rows)
    def table(self,name):
        assert name=='relatorios'
        return self.query

def request(role='gestor'):
    req=Request({'type':'http','method':'GET','path':'/api/operacao/notificacoes','headers':[]})
    req.state.empresa_id=A
    req.state.user={'id':'u1','app_metadata':{'role':role}}
    return req

class NotificationTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_saved_reports_from_current_company_and_stable_ids(self):
        db=Database([{'id':'r1','empresa_id':A,'tecnico':'Ana','criado_em':'2026-10-05T20:00:00Z','status_envio':'sincronizado'},
                     {'id':'r2','empresa_id':B,'tecnico':'Outro provedor','criado_em':'2026-10-05T21:00:00Z','status_envio':'sincronizado'},
                     {'id':'r3','empresa_id':A,'tecnico':'Pendente','criado_em':'2026-10-05T21:00:00Z','status_envio':'pendente'}])
        with patch.multiple(main,supabase_client=db,TENANT_COLUMN_AVAILABLE=True,REPORT_STATUS_AVAILABLE=True):
            first=await main.notificacoes_relatorios(request(),100)
            second=await main.notificacoes_relatorios(request(),100)
        self.assertEqual(first,second)
        self.assertEqual([row['id'] for row in first['notificacoes']],['r1'])
        self.assertEqual(first['empresa_id'],A)
        self.assertEqual(db.query.fields,'id,tecnico,criado_em')

    async def test_limit_and_empty_company(self):
        db=Database([{'id':f'r{i}','empresa_id':A,'tecnico':'Ana','criado_em':f'2026-10-05T20:00:{i:02d}Z'} for i in range(4)])
        with patch.multiple(main,supabase_client=db,TENANT_COLUMN_AVAILABLE=True,REPORT_STATUS_AVAILABLE=False):
            data=await main.notificacoes_relatorios(request('apoio'),2)
        self.assertEqual(len(data['notificacoes']),2);self.assertTrue(data['has_more'])
        self.assertEqual(data['notificacoes'][0]['id'],'r3')

    async def test_incomplete_tenant_schema_fails_closed(self):
        with patch.multiple(main,supabase_client=Database([]),TENANT_COLUMN_AVAILABLE=False,EMPRESA_TABLE_AVAILABLE=True):
            with self.assertRaises(HTTPException) as caught: await main.notificacoes_relatorios(request(),100)
        self.assertEqual(caught.exception.status_code,503)

    async def test_technician_cannot_read_the_endpoint(self):
        with self.assertRaises(HTTPException) as caught: await main.notificacoes_relatorios(request('tecnico'),100)
        self.assertEqual(caught.exception.status_code,403)

    async def test_middleware_requires_authentication_and_enforces_company_block(self):
        next_handler=AsyncMock()
        with patch.object(main,'authenticate',AsyncMock(side_effect=HTTPException(401,'Sem sessão'))):
            response=await main.enforce_access(request(),next_handler)
        self.assertEqual(response.status_code,401);next_handler.assert_not_awaited()
        with patch.object(main,'authenticate',AsyncMock(return_value=request().state.user)), \
             patch.object(main,'empresa_id_do_usuario',side_effect=HTTPException(423,'Empresa bloqueada')):
            response=await main.enforce_access(request(),next_handler)
        self.assertEqual(response.status_code,423);next_handler.assert_not_awaited()

    async def test_database_failure_does_not_return_a_false_empty_list(self):
        db=Database([])
        with patch.multiple(main,supabase_client=db,TENANT_COLUMN_AVAILABLE=True), \
             patch.object(db.query,'execute',side_effect=RuntimeError('connection failed')), \
             patch.object(main.logger,'exception'):
            with self.assertRaises(HTTPException) as caught: await main.notificacoes_relatorios(request(),100)
        self.assertEqual(caught.exception.status_code,503)
