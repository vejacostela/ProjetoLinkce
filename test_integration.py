import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
import main

class UnifiedTests(unittest.TestCase):
    def setUp(self): self.client=TestClient(main.app)
    def test_pages_and_assets_share_application(self):
        for path, text in [('/', 'Atendimentos em campo'),('/tecnico','Gerador de Relatório Técnico'),('/recuperar-senha','Recuperar acesso'),('/nova-senha','passwordForm')]:
            r=self.client.get(path)
            self.assertEqual(r.status_code,200,path)
            self.assertIn(text,r.text)
        for path in ['/panel-assets/panel.js','/panel-assets/panel.css','/static/auth-ui.js','/static/account.js']:
            self.assertEqual(self.client.get(path).status_code,200)
        self.assertEqual(self.client.get('/dashboard',follow_redirects=False).headers['location'],'/')
    def test_private_routes_require_authentication(self):
        for method,path in [('get','/api/relatorios'),('get','/api/banco/previa'),('post','/api/criar-usuario'),('post','/gerar_relatorio')]:
            self.assertEqual(getattr(self.client,method)(path).status_code,401)
    def test_config_served_locally_without_external_collector(self):
        with patch.object(main.collector,'SUPABASE_URL','https://test.supabase.co'),patch.object(main.collector,'SUPABASE_KEY','public-test'),patch.object(main.collector,'SUPABASE_SERVICE_KEY','private-test'):
            r=self.client.get('/api/config')
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.json()['supabase_key'],'public-test')
        self.assertNotIn('private-test',r.text)
    def test_technical_worker_does_not_cache_management_page(self):
        r=self.client.get('/sw.js')
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.headers['service-worker-allowed'],'/tecnico')
        self.assertIn("const SHELL = ['/tecnico'",r.text)
        self.assertNotIn("url.pathname === '/'",r.text)

if __name__=='__main__':unittest.main()
