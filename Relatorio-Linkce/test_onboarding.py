import copy
import unittest
from types import SimpleNamespace
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from fastapi import HTTPException
import main

class OnboardingTests(unittest.TestCase):
    def setUp(self):
        self.user = {'id': 'test-invited', 'app_metadata': {
            'role': 'gestor', 'empresa_id': main.DEFAULT_EMPRESA_ID,
            'onboarding_required': True}}
        async def identity(request): return copy.deepcopy(self.user)
        self.admin = MagicMock()
        self.admin.auth.admin.update_user_by_id.side_effect = self.update
        self.patches = [
            patch.object(main, 'authenticate', identity),
            patch.object(main, 'empresa_id_do_usuario', return_value=main.DEFAULT_EMPRESA_ID),
            patch.object(main, '_admin_client', return_value=self.admin),
            patch.object(main, 'registrar_auditoria'),
            patch.object(main, 'onboarding_config', return_value=('https://example.com','https://example.com/privacy','v1')),
        ]
        for p in self.patches: p.start(); self.addCleanup(p.stop)
        self.client = TestClient(main.app)

    def update(self, uid, values):
        self.assertEqual(uid, self.user['id'])
        self.user['app_metadata'] = values['app_metadata']

    def test_pending_cannot_access_operations(self):
        for method, route in [('get','/api/relatorios'),('post','/gerar_relatorio'),
                              ('post','/api/criar-usuario'),('get','/api/empresas')]:
            self.assertEqual(getattr(self.client, method)(route).status_code, 428)

    def test_cannot_skip_password_or_accept_old_notice(self):
        r = self.client.post('/api/primeiro-acesso/privacidade', json={'ciencia':True,'versao':'v1'})
        self.assertEqual(r.status_code,409)
        self.user['app_metadata']['onboarding_password_at']='2026-09-15'
        r = self.client.post('/api/primeiro-acesso/privacidade', json={'ciencia':True,'versao':'v0'})
        self.assertEqual(r.status_code,422)
        self.admin.auth.admin.update_user_by_id.assert_not_called()

    def test_complete_flow_and_reload(self):
        r=self.client.post('/api/primeiro-acesso/senha',json={'senha':'A-long-test-password!'})
        self.assertEqual(r.status_code,200)
        self.assertTrue(self.client.get('/api/primeiro-acesso').json()['senha_definida'])
        self.assertEqual(self.client.get('/api/permissoes').status_code,428)
        r=self.client.post('/api/primeiro-acesso/privacidade',json={'ciencia':True,'versao':'v1'})
        self.assertEqual(r.status_code,200)
        self.assertEqual(self.user['app_metadata']['privacy_notice_version'],'v1')
        self.assertIn('privacy_acknowledged_at',self.user['app_metadata'])
        self.assertEqual(self.client.get('/api/permissoes').status_code,200)

    def test_password_rejected_does_not_advance(self):
        self.admin.auth.admin.update_user_by_id.side_effect=RuntimeError('provider refused')
        self.assertEqual(self.client.post('/api/primeiro-acesso/senha',json={'senha':'A-long-test-password!'}).status_code,503)
        self.assertFalse(self.client.get('/api/primeiro-acesso').json()['senha_definida'])

    def test_mutable_metadata_cannot_bypass(self):
        self.user['user_metadata']={'onboarding_required':False}
        self.assertEqual(self.client.get('/api/relatorios').status_code,428)

    def test_client_cannot_invite(self):
        self.user['app_metadata']['onboarding_required']=False
        self.assertEqual(self.client.post('/api/empresas/'+main.DEFAULT_EMPRESA_ID+'/convite',json={}).status_code,403)

    def test_existing_other_company_is_not_promoted(self):
        self.admin.auth.admin.list_users.return_value=[SimpleNamespace(
            email='owner@example.com',app_metadata={'empresa_id':'other'},id='other')]
        with self.assertRaises(HTTPException) as caught:
            main.convidar_gestor(main.DEFAULT_EMPRESA_ID,'owner@example.com','Owner')
        self.assertEqual(caught.exception.status_code,409)
        self.admin.auth.admin.invite_user_by_email.assert_not_called()
        self.admin.auth.admin.update_user_by_id.assert_not_called()

    def test_invite_metadata_is_set_before_membership(self):
        self.admin.auth.admin.list_users.return_value=[]
        self.admin.auth.admin.invite_user_by_email.return_value=SimpleNamespace(user=SimpleNamespace(id=self.user['id']))
        db=MagicMock()
        def insert(data):
            self.assertTrue(self.user['app_metadata']['onboarding_required'])
            self.assertEqual(data['empresa_id'],main.DEFAULT_EMPRESA_ID)
            return MagicMock()
        db.table.return_value.insert.side_effect=insert
        with patch.object(main,'supabase_client',db):
            main.convidar_gestor(main.DEFAULT_EMPRESA_ID,'new@example.com','New')
        db.table.return_value.insert.assert_called_once()
