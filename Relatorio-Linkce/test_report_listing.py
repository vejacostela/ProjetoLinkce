import unittest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi.testclient import TestClient
import main

class Query:
    def __init__(self): self.calls=[]
    def __getattr__(self, name):
        def call(*args, **kwargs):
            self.calls.append((name,args,kwargs))
            if name=='execute':
                return SimpleNamespace(data=[{'id':'1','latitude':0,'longitude':0}], count=75)
            return self
        return call

class ListingTests(unittest.TestCase):
    def setUp(self): self.client=TestClient(main.app)

    def identity(self, role):
        async def user(request):
            return {'id':'user','app_metadata':{'role':role},'user_metadata':{'role':'gestor'}}
        return user

    def test_role_matrix_including_detail(self):
        for role in ('tecnico','apoio','gestor'):
            with patch.object(main,'authenticate',self.identity(role)), patch.object(main,'supabase_client',Query()):
                response=self.client.get('/api/relatorios')
                self.assertEqual(response.status_code,403 if role=='tecnico' else 200)
                if role=='tecnico':
                    self.assertEqual(self.client.get('/api/relatorios/1').status_code,403)

    def test_dates_paging_and_zero_coordinates(self):
        query=Query()
        with patch.object(main,'authenticate',self.identity('gestor')), patch.object(main,'supabase_client',query):
            response=self.client.get('/api/relatorios?inicio=2026-09-01&fim=2026-09-08&limite=50&offset=50&tecnico=Trop')
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.headers['cache-control'],'no-store')
        self.assertEqual(response.json()['total'],75)
        self.assertTrue(response.json()['has_more'])
        self.assertEqual(response.json()['relatorios'][0]['latitude'],0)
        self.assertIn(('gte',('criado_em','2026-09-01T00:00:00-03:00'),{}),query.calls)
        self.assertIn(('lt',('criado_em','2026-09-09T00:00:00-03:00'),{}),query.calls)
        self.assertIn(('range',(50,99),{}),query.calls)
        self.assertIn(('eq',('tecnico','Trop'),{}),query.calls)

    def test_invalid_filters_never_query_database(self):
        query=Query()
        with patch.object(main,'authenticate',self.identity('apoio')), patch.object(main,'supabase_client',query):
            for params in ['limite=10000','offset=-1','inicio=2026-09-08&fim=2026-09-01','inicio=bad','dias=2&inicio=2026-09-01']:
                self.assertEqual(self.client.get('/api/relatorios?'+params).status_code,422)
        self.assertEqual(query.calls,[])

    def test_database_failure_is_explicit(self):
        with patch.object(main,'authenticate',self.identity('apoio')), patch.object(main,'supabase_client',None):
            self.assertEqual(self.client.get('/api/relatorios').status_code,503)

if __name__=='__main__': unittest.main()
