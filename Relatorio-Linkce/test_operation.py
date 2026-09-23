import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
import main

class OperationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    @staticmethod
    def gestor(request):
        async def identity(_request):
            return {"id": "gestor", "email": "gestor@test.invalid", "app_metadata": {"role": "gestor"}}
        return identity

    def test_operation_requires_management_role(self):
        async def tecnico(_request):
            return {"id": "tec", "app_metadata": {"role": "tecnico"}}
        with patch.object(main, "authenticate", tecnico):
            self.assertEqual(self.client.get("/api/operacao/resumo").status_code, 403)

    def test_health_never_exposes_secrets(self):
        with patch.object(main, "SUPABASE_URL", "https://example.invalid"), patch.object(main, "SUPABASE_SERVICE_KEY", "secret"):
            response = self.client.get("/health")
        self.assertNotIn("secret", response.text)
        self.assertIn("checks", response.json())

    def test_operation_summary_counts_quality_and_delivery_by_technician(self):
        rows = [
            {"id": "r1", "criado_em": "2026-09-23T12:00:00Z", "tecnico": "Ana",
             "equipamento_status": "Cabeado", "maior_sinal": "-18", "latitude": -3.7,
             "longitude": -38.5, "status_envio": "sincronizado"},
            {"id": "r2", "criado_em": "2026-09-23T13:00:00Z", "tecnico": "Ana",
             "equipamento_status": "Cabeado", "maior_sinal": "-20", "latitude": None,
             "longitude": None, "status_envio": "erro", "tentativas_envio": 3,
             "erro_envio": "Falha temporária"},
            {"id": "r3", "criado_em": "2026-09-24T10:00:00Z", "tecnico": "Bruno",
             "equipamento_status": "Não Cabeado", "maior_sinal": "-22", "latitude": -4.0,
             "longitude": -39.0, "status_envio": "pendente_fotos"},
        ]
        summary = main.calcular_resumo_operacional(rows, {"r1": 2, "r3": 1})
        self.assertEqual(summary["total"], 3)
        self.assertEqual(summary["tecnicos"], 2)
        self.assertEqual(summary["com_fotos"], 2)
        self.assertEqual(summary["com_localizacao"], 2)
        self.assertEqual(summary["pendentes"], 1)
        self.assertEqual(summary["falhas"], 1)
        self.assertEqual(summary["pendentes_envio"], 1)
        self.assertEqual(summary["taxa_completude"], 66.7)
        self.assertEqual(summary["por_tecnico"][0]["tecnico"], "Ana")
        self.assertEqual(summary["por_tecnico"][0]["falhas"], 1)
        self.assertEqual(summary["falhas_recentes"][0]["id"], "r2")
        self.assertEqual({item["codigo"] for item in summary["alertas"]}, {"falhas_envio", "fila_envio"})

    def test_operation_summary_warns_when_optional_indicators_are_unavailable(self):
        summary = main.calcular_resumo_operacional(
            [], {}, status_disponivel=False, imagens_disponiveis=False
        )
        self.assertEqual(summary["total"], 0)
        self.assertEqual(
            {item["codigo"] for item in summary["alertas"]},
            {"status_indisponivel", "imagens_indisponiveis"},
        )

if __name__ == "__main__":
    unittest.main()
