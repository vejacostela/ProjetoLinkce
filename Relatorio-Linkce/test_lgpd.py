import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

import main


class LgpdOperationalTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    @staticmethod
    async def gestor(request):
        return {'id': 'gestor-lgpd', 'email': 'gestor@example.test',
                'app_metadata': {'role': 'gestor', 'empresa_id': main.DEFAULT_EMPRESA_ID}}

    @staticmethod
    async def tecnico(request):
        return {'id': 'tecnico-lgpd', 'email': 'tecnico@example.test',
                'app_metadata': {'role': 'tecnico', 'empresa_id': main.DEFAULT_EMPRESA_ID}}

    def test_lgpd_is_server_protected_by_role(self):
        with patch.object(main, 'authenticate', self.tecnico), \
                patch.object(main, 'empresa_id_do_usuario', return_value=main.DEFAULT_EMPRESA_ID):
            self.assertEqual(self.client.get('/api/lgpd').status_code, 403)
            self.assertEqual(self.client.post('/api/lgpd/solicitacoes', json={}).status_code, 403)

    def test_lgpd_requires_migration_without_exposing_internal_error(self):
        with patch.object(main, 'authenticate', self.gestor), \
                patch.object(main, 'empresa_id_do_usuario', return_value=main.DEFAULT_EMPRESA_ID), \
                patch.object(main, 'LGPD_AVAILABLE', False):
            response = self.client.get('/api/lgpd')
        self.assertEqual(response.status_code, 503)
        self.assertIn('migração 015', response.json()['detail'])

    def test_audit_classifies_lgpd_without_request_content(self):
        request = SimpleNamespace(method='POST', url=SimpleNamespace(path='/api/lgpd/incidentes'),
                                  headers={}, state=SimpleNamespace())
        result = main.classificar_auditoria(request)
        self.assertEqual(result['categoria'], 'lgpd')
        self.assertEqual(result['entidade_tipo'], 'incidente_privacidade')
        self.assertEqual(result['acao'], 'registrar_incidente_privacidade')
        self.assertNotIn('resumo', result)

    def test_migration_is_tenant_scoped_and_acceptance_is_immutable(self):
        sql = (Path(__file__).parents[1] / 'database' / 'migrations' / '015_lgpd_operacional.sql').read_text(encoding='utf-8')
        for table in ('lgpd_configuracao', 'lgpd_aceites', 'lgpd_solicitacoes', 'lgpd_incidentes'):
            self.assertIn(f'public.{table}', sql)
        self.assertGreaterEqual(sql.count('empresa_id uuid'), 4)
        self.assertIn('lgpd_aceites_imutavel', sql)
        self.assertIn('REVOKE ALL ON public.lgpd_configuracao', sql)
        self.assertNotIn('GRANT UPDATE, DELETE ON public.lgpd_aceites', sql)

    def test_first_access_records_versioned_acceptance(self):
        user = {'id': 'invited-lgpd', 'email': 'owner@example.test', 'app_metadata': {
            'role': 'gestor', 'empresa_id': main.DEFAULT_EMPRESA_ID,
            'onboarding_required': True, 'onboarding_password_at': '2026-09-24T10:00:00Z'}}

        async def identity(request):
            return user

        admin = MagicMock()
        db = MagicMock()
        db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = SimpleNamespace(data=[])
        db.table.return_value.insert.return_value.execute.return_value = SimpleNamespace(data=[{'id': 'accept-1'}])
        with patch.object(main, 'authenticate', identity), \
                patch.object(main, 'empresa_id_do_usuario', return_value=main.DEFAULT_EMPRESA_ID), \
                patch.object(main, '_admin_client', return_value=admin), \
                patch.object(main, 'onboarding_config', return_value=('https://example.test','https://example.test/privacy','v2')), \
                patch.object(main, 'supabase_client', db), patch.object(main, 'LGPD_AVAILABLE', True), \
                patch.object(main, 'registrar_auditoria'), patch.object(main, 'revogar_sessoes_usuario'):
            response = self.client.post('/api/primeiro-acesso/privacidade', json={
                'ciencia': True, 'versao': 'v2', 'termos_ciencia': True, 'termos_versao': 'v2'})
        self.assertEqual(response.status_code, 200)
        payload = db.table.return_value.insert.call_args.args[0]
        self.assertEqual(payload['empresa_id'], main.DEFAULT_EMPRESA_ID)
        self.assertEqual(payload['politica_versao'], 'v2')
        self.assertEqual(payload['usuario_email'], 'owner@example.test')


if __name__ == '__main__':
    unittest.main()
