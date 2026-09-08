import unittest
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
from unittest.mock import patch
from fastapi.testclient import TestClient
import main

class FakeBank:
    def __init__(self): self.calls=[]
    def __getattr__(self, name):
        def call(*args, **kwargs):
            self.calls.append((name,args,kwargs))
            return SimpleNamespace(count=5,data=[]) if name=='execute' else self
        return call

class BankTests(unittest.TestCase):
    def setUp(self): self.client=TestClient(main.app)
    def identity(self, role):
        async def user(request): return {'id':'test-manager','app_metadata':{'role':role}}
        return user
    def test_redirect_without_tokens(self):
        r=self.client.get('/dashboard?token=do-not-forward',follow_redirects=False)
        self.assertEqual(r.status_code,302)
        self.assertEqual(r.headers['location'],'https://projeto-linkce.vercel.app/')
        self.assertEqual(r.headers['cache-control'],'no-store')
    def test_only_gestor_can_manage(self):
        for role in ('tecnico','apoio'):
            bank=FakeBank()
            with patch.object(main,'authenticate',self.identity(role)),patch.object(main,'supabase_client',bank):
                self.assertEqual(self.client.get('/api/banco/previa').status_code,403)
                self.assertEqual(self.client.post('/api/banco/limpeza',json={}).status_code,403)
            self.assertEqual(bank.calls,[])
    def test_preview_never_deletes(self):
        bank=FakeBank()
        with patch.object(main,'authenticate',self.identity('gestor')),patch.object(main,'supabase_client',bank):
            r=self.client.get('/api/banco/previa?manter_dias=30')
            self.assertEqual(r.status_code,200)
            self.assertEqual(r.json()['candidatos'],5)
            self.assertEqual(self.client.get('/api/banco/previa?manter_dias=0').status_code,422)
        self.assertNotIn('delete',[c[0] for c in bank.calls])
    def test_invalid_delete_never_touches_bank(self):
        bank=FakeBank()
        with patch.object(main,'authenticate',self.identity('gestor')),patch.object(main,'supabase_client',bank):
            for body in ({},[],{'confirmacao':'EXCLUIR','limite':'bad'}, {'confirmacao':'EXCLUIR','limite':datetime.now(timezone.utc).isoformat()}, {'confirmacao':'EXCLUIR','limite':'2020-01-01T00:00:00'}):
                self.assertEqual(self.client.post('/api/banco/limpeza',json=body).status_code,422)
        self.assertEqual(bank.calls,[])
    def test_confirmed_delete_uses_exact_cutoff(self):
        bank=FakeBank();cutoff=(datetime.now(timezone.utc)-timedelta(days=30)).isoformat()
        with patch.object(main,'authenticate',self.identity('gestor')),patch.object(main,'supabase_client',bank):
            r=self.client.post('/api/banco/limpeza',json={'confirmacao':'EXCLUIR','limite':cutoff})
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.json()['deletados'],5)
        self.assertIn(('lt',('criado_em',cutoff),{}),bank.calls)
        self.assertIn(('delete',(),{'count':'exact','returning':'minimal'}),bank.calls)

if __name__=='__main__':unittest.main()
