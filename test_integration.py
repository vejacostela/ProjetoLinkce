import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
import httpx
import main

class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    def test_no_token_never_reaches_upstream(self):
        with patch.object(main.httpx, 'AsyncClient') as upstream:
            for method, path in [('get','/api/relatorios'), ('post','/api/criar-usuario')]:
                response = getattr(self.client, method)(path)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.headers['cache-control'], 'no-store')
            upstream.assert_not_called()

    def test_forward_preserves_authorization_and_denial(self):
        actual = httpx.AsyncClient
        seen = []
        def handler(request):
            seen.append(request)
            return httpx.Response(403,json={'detail':'Acesso não autorizado.'})
        with patch.object(main.httpx, 'AsyncClient', side_effect=lambda **kw: actual(transport=httpx.MockTransport(handler),**kw)):
            response = self.client.get('/api/relatorios?limite=50&offset=50',headers={'Authorization':'Bearer test-token'})
            self.assertEqual(response.status_code,403)
            self.assertEqual(seen[0].headers['authorization'],'Bearer test-token')
            self.assertEqual(seen[0].url.params['offset'],'50')
            self.assertEqual(str(seen[0].url).split('/api/')[0], main.COLLECTOR)

    def test_upstream_failure_is_not_empty_success_or_secret(self):
        actual = httpx.AsyncClient
        with patch.object(main.httpx, 'AsyncClient', side_effect=lambda **kw: actual(transport=httpx.MockTransport(lambda r:httpx.Response(500,json={'detail':'private-database-error'})),**kw)):
            response=self.client.get('/api/relatorios',headers={'Authorization':'Bearer test'})
            self.assertEqual(response.status_code,503)
            self.assertNotIn('private-database-error',response.text)

    def test_no_arbitrary_proxy_or_legacy_write(self):
        self.assertEqual(self.client.get('/api/banco/stats').status_code,404)
        self.assertEqual(self.client.post('/gerar_relatorio',json={}).status_code,404)
        self.assertEqual(self.client.get('/api/relatorios/not-a-uuid').status_code,422)
        self.assertEqual(self.client.get('/').status_code,200)

if __name__ == '__main__': unittest.main()
