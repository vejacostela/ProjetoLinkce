import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch, Mock
from fastapi.testclient import TestClient
import main

class AccountsTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.payload = dict(nome="Trop", email="test@example.invalid",
                            senha="A-valid-password-123", cargo="tecnico")

    def test_recovery_routes_public_no_cache(self):
        for path in ("/recuperar-senha", "/nova-senha"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertIn('id="passwordForm" hidden', response.text)

    def test_public_config_cannot_expose_secret(self):
        with (patch.object(main, "SUPABASE_URL", "https://example.invalid"),
              patch.object(main, "SUPABASE_KEY", "sb_secret_TEST"),
              patch.object(main, "SUPABASE_SERVICE_KEY", "other")):
            response = self.client.get("/api/config")
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("sb_secret_TEST", response.text)

    def test_roles_and_password_preserved(self):
        async def gestor(request): return {"id": "admin", "app_metadata": {"role": "gestor"}}
        create = Mock(return_value=SimpleNamespace(user=SimpleNamespace(id="new-user")))
        fake = SimpleNamespace(create_client=Mock(return_value=SimpleNamespace(
            auth=SimpleNamespace(admin=SimpleNamespace(create_user=create)))))
        with (patch.object(main, "authenticate", gestor),
              patch.object(main, "SUPABASE_URL", "https://example.invalid"),
              patch.object(main, "SUPABASE_SERVICE_KEY", "test"),
              patch.dict(sys.modules, {"supabase": fake})):
            for role in ("tecnico", "apoio", "gestor"):
                payload = {**self.payload, "cargo": role, "senha": "  Strong-password-123  "}
                response = self.client.post("/api/criar-usuario", json=payload)
                self.assertEqual(response.status_code, 200)
                sent = create.call_args.args[0]
                self.assertEqual(sent["app_metadata"]["role"], role)
                self.assertNotIn("role", sent["user_metadata"])
                self.assertEqual(sent["password"], payload["senha"])
            create.reset_mock()
            for payload in ({}, [], {**self.payload, "cargo": "admin"},
                    {**self.payload, "email": "bad"}, {**self.payload, "senha": "short"}):
                self.assertIn(self.client.post("/api/criar-usuario", json=payload).status_code, (400, 422))
            create.assert_not_called()

    def test_apoio_cannot_create(self):
        async def apoio(request): return {"id": "support", "app_metadata": {"role": "apoio"}}
        with patch.object(main, "authenticate", apoio):
            self.assertEqual(self.client.post("/api/criar-usuario", json=self.payload).status_code, 403)

if __name__ == "__main__":
    unittest.main()
