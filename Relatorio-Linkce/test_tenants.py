import copy
import io
import unittest
import zipfile
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import HTTPException
from fastapi.testclient import TestClient
import main

A = main.DEFAULT_EMPRESA_ID
B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
USER = {'id': '11111111-1111-4111-8111-111111111111', 'email': 'test@example.invalid',
        'app_metadata': {'role': 'gestor', 'empresa_id': A}, 'user_metadata': {}}

class Query:
    def __init__(self, db, name):
        self.db, self.name, self.filters, self.action = db, name, [], None
    def select(self, *args, **kwargs): return self
    def eq(self, key, value): self.filters.append(lambda row: row.get(key) == value); return self
    def in_(self, key, values): self.filters.append(lambda row: row.get(key) in values); return self
    def lt(self, key, value): self.filters.append(lambda row: row.get(key, '') < value); return self
    def order(self, *args, **kwargs): return self
    def limit(self, *args): return self
    def update(self, data): self.action = ('update', data); return self
    def insert(self, data): self.action = ('insert', data); return self
    def delete(self, **kwargs): self.action = ('delete', None); return self
    def execute(self):
        rows = self.db.rows.setdefault(self.name, [])
        matches = [row for row in rows if all(f(row) for f in self.filters)]
        if self.action:
            action, data = self.action
            if action == 'insert': rows.append(copy.deepcopy(data)); matches = [data]
            if action == 'update':
                for row in matches: row.update(data)
            if action == 'delete':
                for row in matches: rows.remove(row)
        return SimpleNamespace(data=copy.deepcopy(matches), count=len(matches))

class Database:
    def __init__(self):
        self.rows = {
            'empresas': [{'id': A, 'ativo': True}, {'id': B, 'ativo': True}],
            'usuarios_empresas': [{'usuario_id': USER['id'], 'empresa_id': A, 'papel': 'gestor', 'ativo': True}],
            'avisos_modelos': [{'id': 1, 'empresa_id': A, 'titulo': 'A', 'mensagem': 'Texto A'},
                              {'id': 2, 'empresa_id': B, 'titulo': 'B', 'mensagem': 'Texto B'}],
            'relatorios': [{'id': 'ra', 'empresa_id': A, 'criado_em': '2000-01-01T00:00:00+00:00'},
                           {'id': 'rb', 'empresa_id': B, 'criado_em': '2000-01-01T00:00:00+00:00'}],
        }
    def table(self, name): return Query(self, name)

class TenantTests(unittest.TestCase):
    def setUp(self):
        self.db = Database()
        self.user = copy.deepcopy(USER)
        async def identity(request): return copy.deepcopy(self.user)
        self.flags = patch.multiple(main, supabase_client=self.db, EMPRESA_TABLE_AVAILABLE=True,
            TENANT_COLUMN_AVAILABLE=True, NOTICE_TENANT_AVAILABLE=True, AUDIT_TENANT_AVAILABLE=True,
            authenticate=identity)
        self.flags.start()
        self.addCleanup(self.flags.stop)
        self.client = TestClient(main.app)

    def test_editable_metadata_cannot_select_company(self):
        self.user['user_metadata']['empresa_id'] = B
        self.assertEqual(main.empresa_id_do_usuario(self.user), A)
        self.assertEqual(self.client.get('/api/permissoes', headers={'X-Empresa-ID': B}).status_code, 403)

    def test_disabled_membership_is_rejected(self):
        self.db.rows['usuarios_empresas'][0]['ativo'] = False
        self.assertEqual(self.client.get('/api/permissoes').status_code, 403)

    def test_role_is_per_company(self):
        self.db.rows['usuarios_empresas'].append({'usuario_id': USER['id'], 'empresa_id': B, 'papel': 'tecnico', 'ativo': True})
        response = self.client.post('/api/criar-usuario', json={}, headers={'X-Empresa-ID': B})
        self.assertEqual(response.status_code, 403)

    def test_incomplete_schema_fails_closed(self):
        with patch.object(main, 'TENANT_COLUMN_AVAILABLE', False):
            self.assertEqual(self.client.get('/api/permissoes').status_code, 503)

    def test_list_companies_only_returns_memberships(self):
        response = self.client.get('/api/empresas', headers={'X-Empresa-ID': B})
        self.assertEqual([row['id'] for row in response.json()['empresas']], [A])

    def test_cannot_delete_other_company_notice(self):
        self.assertEqual(self.client.delete('/api/avisos/modelos/2').status_code, 404)
        self.assertEqual(len(self.db.rows['avisos_modelos']), 2)
        self.assertEqual(self.client.delete('/api/avisos/modelos/1').status_code, 200)
        self.assertEqual(self.db.rows['avisos_modelos'][0]['empresa_id'], B)

    def test_cannot_overwrite_other_company_notice(self):
        response = self.client.post('/api/avisos/modelos', json={'id': 2, 'titulo': 'Mudado', 'mensagem': 'Mudado'})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.db.rows['avisos_modelos'][1]['mensagem'], 'Texto B')

    def test_bank_deletes_only_active_company(self):
        response = self.client.post('/api/banco/limpeza', json={'confirmacao': 'EXCLUIR', 'limite': '2001-01-01T00:00:00+00:00'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['id'] for row in self.db.rows['relatorios']], ['rb'])

    def test_password_reset_cannot_affect_shared_identity(self):
        self.db.rows['usuarios_empresas'].append({'usuario_id': USER['id'], 'empresa_id': B, 'ativo': True, 'papel': 'gestor'})
        with self.assertRaises(HTTPException) as caught:
            main.exigir_usuario_da_empresa(USER['id'], SimpleNamespace(state=SimpleNamespace(empresa_id=A)))
        self.assertEqual(caught.exception.status_code, 403)

    def test_installation_zip_has_sql_and_no_credentials(self):
        response = self.client.get('/api/empresas/pacote-instalacao')
        self.assertEqual(response.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            self.assertIn('database/install/install_cloud.sql', archive.namelist())
            self.assertIn('deploy/compose.yml', archive.namelist())
            self.assertNotIn('deploy/.env', archive.namelist())

if __name__ == '__main__':
    unittest.main()
