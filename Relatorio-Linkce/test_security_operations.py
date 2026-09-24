import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import main


class AuditQuery:
    def __init__(self):
        self.payload = None

    def insert(self, payload):
        self.payload = payload
        return self

    def execute(self):
        return SimpleNamespace(data=[self.payload])


class AuditDB:
    def __init__(self):
        self.query = AuditQuery()

    def table(self, name):
        assert name == 'auditoria_gestao'
        return self.query


class SecurityOperationsTests(unittest.TestCase):
    def test_audit_stores_hashes_and_request_status(self):
        db = AuditDB()
        request = SimpleNamespace(
            method='POST',
            url=SimpleNamespace(path='/api/avisos'),
            headers={'user-agent': 'Browser Teste', 'x-forwarded-for': '203.0.113.7'},
            client=SimpleNamespace(host='127.0.0.1'),
            state=SimpleNamespace(
                request_id='12345678abcdef',
                empresa_id=main.DEFAULT_EMPRESA_ID,
                user={'id': 'user-1', 'email': 'gestor@example.test'},
            ),
        )
        with patch.object(main, 'supabase_client', db), patch.object(main, 'AUDIT_SECURITY_AVAILABLE', True):
            main.registrar_auditoria(request, 'publicar aviso', 'negado', 403)
        payload = db.query.payload
        self.assertEqual(payload['status_code'], 403)
        self.assertEqual(payload['request_id'], '12345678abcdef')
        self.assertEqual(len(payload['ip_hash']), 64)
        self.assertNotIn('203.0.113.7', str(payload))
        self.assertNotIn('Browser Teste', str(payload))

    def test_audit_classifies_action_and_entity_without_sensitive_content(self):
        db = AuditDB()
        request = SimpleNamespace(
            method='DELETE',
            url=SimpleNamespace(path='/api/relatorios/11111111-1111-1111-1111-111111111111/imagens/22222222-2222-2222-2222-222222222222'),
            headers={'user-agent': 'Browser Teste'},
            client=SimpleNamespace(host='127.0.0.1'),
            state=SimpleNamespace(
                request_id='audit-detail-1',
                empresa_id=main.DEFAULT_EMPRESA_ID,
                user={'id': 'user-1', 'email': 'apoio@example.test'},
            ),
        )
        with patch.object(main, 'supabase_client', db), \
                patch.object(main, 'AUDIT_SECURITY_AVAILABLE', True), \
                patch.object(main, 'AUDIT_DETAIL_AVAILABLE', True), \
                patch.object(main, 'AUDIT_TENANT_AVAILABLE', True):
            main.registrar_auditoria(request, None, 'sucesso', 204)
        payload = db.query.payload
        self.assertEqual(payload['acao'], 'excluir_imagem')
        self.assertEqual(payload['categoria'], 'relatorios')
        self.assertEqual(payload['entidade_tipo'], 'imagem')
        self.assertEqual(payload['entidade_id'], '22222222-2222-2222-2222-222222222222')
        self.assertEqual(payload['empresa_id'], main.DEFAULT_EMPRESA_ID)
        self.assertNotIn('conteudo', payload)

    def test_audit_migration_adds_searchable_fields_and_keeps_table_protected(self):
        migration = (Path(__file__).parents[1] / 'database' / 'migrations' / '014_auditoria_detalhada.sql').read_text(encoding='utf-8')
        for field in ('categoria', 'entidade_tipo', 'entidade_id', 'descricao'):
            self.assertIn(field, migration)
        self.assertIn('REVOKE ALL ON public.auditoria_gestao', migration)
        self.assertIn('GRANT SELECT, INSERT ON public.auditoria_gestao TO service_role', migration)

    def test_offline_access_never_uses_saved_user_as_session(self):
        html = Path(__file__).with_name('index.html').read_text(encoding='utf-8')
        self.assertNotIn("JSON.parse(localStorage.getItem('linkce_user')", html)
        self.assertIn('sessaoLocalValida(session)', html)
        self.assertIn("localStorage.removeItem('linkce_user')", html)


if __name__ == '__main__':
    unittest.main()
