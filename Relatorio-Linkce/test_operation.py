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

if __name__ == "__main__":
    unittest.main()
