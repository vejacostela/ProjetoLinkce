import unittest
from fastapi.testclient import TestClient
import main

class ValidationTests(unittest.TestCase):
    def test_invalid_reports(self):
        client = TestClient(main.app)
        for data in ({}, [], {"tecnico": None}):
            self.assertEqual(client.post("/gerar_relatorio", json=data).status_code, 422)

    def test_valid_report(self):
        client = TestClient(main.app)
        response = client.post("/gerar_relatorio", json=dict(tecnico="Teste",
            relatorio_texto="Teste", problema_tecnico="Resolvido",
            equipamento_status="Cabeado", maior_sinal="-45"))
        self.assertEqual(response.status_code, 200)
        self.assertIn("Resolvido", response.json()["relatorio"])

    def test_debug_removed(self):
        client = TestClient(main.app)
        self.assertEqual(client.get("/api/debug/materiais").status_code, 404)

if __name__ == "__main__":
    unittest.main()
