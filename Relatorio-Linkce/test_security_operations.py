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

    def test_offline_access_never_uses_saved_user_as_session(self):
        html = Path(__file__).with_name('index.html').read_text(encoding='utf-8')
        self.assertNotIn("JSON.parse(localStorage.getItem('linkce_user')", html)
        self.assertIn('sessaoLocalValida(session)', html)
        self.assertIn("localStorage.removeItem('linkce_user')", html)


if __name__ == '__main__':
    unittest.main()
