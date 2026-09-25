import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import main


class ServerSecurityTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    @staticmethod
    async def apoio(_request):
        return {'id':'support-1','email':'support@example.test',
                'app_metadata':{'role':'apoio','empresa_id':main.DEFAULT_EMPRESA_ID}}

    def test_support_can_read_but_cannot_change_server_controls(self):
        with patch.object(main,'authenticate',self.apoio), \
                patch.object(main,'empresa_id_do_usuario',return_value=main.DEFAULT_EMPRESA_ID):
            response=self.client.put('/api/servidor/seguranca',json={})
        self.assertEqual(response.status_code,403)

    def test_feature_requires_migration_017(self):
        async def gestor(_request):
            return {'id':'manager-1','email':'manager@example.test',
                    'app_metadata':{'role':'gestor','empresa_id':main.DEFAULT_EMPRESA_ID}}
        with patch.object(main,'authenticate',gestor), \
                patch.object(main,'empresa_id_do_usuario',return_value=main.DEFAULT_EMPRESA_ID), \
                patch.object(main,'SERVER_SECURITY_AVAILABLE',False):
            response=self.client.get('/api/servidor/seguranca')
        self.assertEqual(response.status_code,503)
        self.assertIn('migração 017',response.json()['detail'])

    def test_host_report_is_allowlisted_and_marks_stale(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'status.json'
            path.write_text(json.dumps({'schema':1,'generated_at':'2026-01-01T00:00:00+00:00',
                'hostname':'server','firewall_active':True,'secret':'must-not-leak'}),encoding='utf-8')
            with patch.dict('os.environ',{'SERVER_SECURITY_REPORT':str(path)}):
                report=main._server_host_report()
        self.assertTrue(report['disponivel'])
        self.assertFalse(report['atualizado'])
        self.assertNotIn('secret',report)

    def test_migration_protects_tenant_data_and_immutable_backup_history(self):
        root=Path(__file__).parents[1]
        sql=(root/'database'/'migrations'/'017_seguranca_servidor_proprio.sql').read_text(encoding='utf-8')
        self.assertIn('empresa_id uuid PRIMARY KEY',sql)
        self.assertIn('ENABLE ROW LEVEL SECURITY',sql)
        self.assertIn('servidor_backup_imutavel',sql)
        self.assertIn('REVOKE ALL',sql)
        self.assertNotIn('database_url',sql.lower())

    def test_deployment_package_has_non_root_runtime_diagnostics_and_full_backup(self):
        root=Path(__file__).parents[1]
        docker=(root/'deploy'/'Dockerfile').read_text(encoding='utf-8')
        compose=(root/'deploy'/'compose.yml').read_text(encoding='utf-8')
        backup=(root/'deploy'/'backup_database.sh').read_text(encoding='utf-8')
        self.assertIn('USER linkce',docker)
        self.assertIn('read_only: true',compose)
        self.assertIn('no-new-privileges:true',compose)
        self.assertIn('pg_dump',backup)
        self.assertIn('sha256sum',backup)
        self.assertIn('rclone copyto',backup)
        self.assertNotIn('BACKUP_DATABASE_URL',backup)

    def test_panel_exposes_server_security_without_secret_fields(self):
        root=Path(__file__).parents[1]
        html=(root/'index.html').read_text(encoding='utf-8')
        js=(root/'static'/'panel.js').read_text(encoding='utf-8')
        self.assertIn('data-management-target="server"',html)
        self.assertIn('restauracao_testada',html)
        self.assertIn("'/api/servidor/seguranca'",js)
        self.assertNotIn('BACKUP_DATABASE_URL',html)


if __name__ == '__main__':
    unittest.main()
