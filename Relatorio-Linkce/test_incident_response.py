import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

import main


class IncidentQuery:
    def __init__(self, rows):
        self.rows = rows
        self.data = None
        self.count = len(rows)

    def select(self, *args, **kwargs): return self
    def eq(self, *args, **kwargs): return self
    def limit(self, *args, **kwargs): return self
    def execute(self):
        return SimpleNamespace(data=self.rows, count=len(self.rows))


class IncidentDB:
    def __init__(self, incident): self.incident = incident
    def table(self, name): return IncidentQuery([self.incident] if name == 'lgpd_incidentes' else [])


class IncidentResponseTests(unittest.TestCase):
    def setUp(self): self.client = TestClient(main.app)

    @staticmethod
    async def gestor(request):
        return {'id':'manager-1','email':'manager@example.test',
                'app_metadata':{'role':'gestor','empresa_id':main.DEFAULT_EMPRESA_ID}}

    @staticmethod
    async def apoio(request):
        return {'id':'support-1','email':'support@example.test',
                'app_metadata':{'role':'apoio','empresa_id':main.DEFAULT_EMPRESA_ID}}

    def test_support_cannot_execute_containment_actions(self):
        incident_id = '11111111-1111-4111-8111-111111111111'
        with patch.object(main,'authenticate',self.apoio), \
                patch.object(main,'empresa_id_do_usuario',return_value=main.DEFAULT_EMPRESA_ID):
            response=self.client.post(f'/api/incidentes/{incident_id}/acao',json={'acao':'preservar_logs'})
        self.assertEqual(response.status_code,403)

    def test_feature_requires_migration(self):
        with patch.object(main,'authenticate',self.gestor), \
                patch.object(main,'empresa_id_do_usuario',return_value=main.DEFAULT_EMPRESA_ID), \
                patch.object(main,'INCIDENT_RESPONSE_AVAILABLE',False):
            response=self.client.get('/api/incidentes')
        self.assertEqual(response.status_code,503)
        self.assertIn('migração 016',response.json()['detail'])

    def test_incident_cannot_close_before_mandatory_steps(self):
        incident_id='11111111-1111-4111-8111-111111111111'
        incident={'id':incident_id,'empresa_id':main.DEFAULT_EMPRESA_ID,'logs_preservados':False,
                  'causa_raiz':'','correcao':'','avaliacao_risco':'nao_avaliado'}
        with patch.object(main,'authenticate',self.gestor), \
                patch.object(main,'empresa_id_do_usuario',return_value=main.DEFAULT_EMPRESA_ID), \
                patch.object(main,'INCIDENT_RESPONSE_AVAILABLE',True), \
                patch.object(main,'supabase_client',IncidentDB(incident)), \
                patch.object(main,'registrar_auditoria'):
            response=self.client.post(f'/api/incidentes/{incident_id}/acao',json={'acao':'encerrar'})
        self.assertEqual(response.status_code,409)
        self.assertIn('Preserve os logs',response.json()['detail'])

    def test_audit_classifies_incident_response(self):
        request=SimpleNamespace(method='POST',url=SimpleNamespace(
            path='/api/incidentes/11111111-1111-4111-8111-111111111111/acao'),headers={},state=SimpleNamespace())
        result=main.classificar_auditoria(request)
        self.assertEqual(result['categoria'],'seguranca')
        self.assertEqual(result['acao'],'responder_incidente')
        self.assertEqual(result['entidade_id'],'11111111-1111-4111-8111-111111111111')

    def test_migration_preserves_timeline_and_never_stores_keys(self):
        sql=(Path(__file__).parents[1]/'database'/'migrations'/'016_resposta_incidentes.sql').read_text(encoding='utf-8')
        self.assertIn('incidente_eventos_imutavel',sql)
        self.assertIn('empresa_id uuid NOT NULL',sql)
        self.assertIn('logs_referencia',sql)
        self.assertIn('chaves_rotacionadas_em',sql)
        self.assertNotIn('chave_secreta',sql)
        self.assertNotIn('service_role_key',sql)


if __name__ == '__main__': unittest.main()
