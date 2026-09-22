import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import main


class ResetLinkTests(unittest.TestCase):
    def test_platform_admin_can_create_link_for_verified_company_manager(self):
        company_id = "22222222-2222-4222-8222-222222222222"
        actor = {"id": "platform", "email": "admin@example.com", "app_metadata": {
            "role": "gestor", "platform_admin": True}}
        request = SimpleNamespace(
            json=lambda: None,
            state=SimpleNamespace(user=actor, empresa_id=main.DEFAULT_EMPRESA_ID),
            base_url="https://app.example.com/",
        )

        async def json_body():
            return {"email": "cliente@example.com", "empresa_id": company_id, "motivo": "Acesso perdido"}
        request.json = json_body

        class Query:
            def __init__(self, name):
                self.name = name
                self.data = []
                self.payload = None
            def select(self, *_args, **_kwargs): return self
            def update(self, payload): self.payload = payload; return self
            def insert(self, payload): self.payload = payload; inserted.append(payload); return self
            def eq(self, *_args): return self
            def is_(self, *_args): return self
            def gt(self, *_args): return self
            def order(self, *_args): return self
            def limit(self, *_args): return self
            def execute(self):
                if self.name == "usuarios_empresas":
                    return SimpleNamespace(data=[{"papel": "gestor"}])
                if self.name == "empresas":
                    return SimpleNamespace(data=[{"id": company_id}])
                return SimpleNamespace(data=self.data)

        inserted = []
        db = MagicMock()
        db.table.side_effect = lambda name: Query(name)
        admin = MagicMock()
        admin.auth.admin.list_users.return_value = SimpleNamespace(users=[
            SimpleNamespace(id="client-manager", email="cliente@example.com")])

        with patch.object(main, "supabase_client", db), \
             patch.object(main, "EMPRESA_TABLE_AVAILABLE", True), \
             patch.object(main, "_admin_client", return_value=admin), \
             patch.object(main, "_reset_origin", return_value="https://app.example.com"):
            result = asyncio.run(main.gerar_link_redefinicao(request))

        self.assertIn("/nova-senha?token=", result["link"])
        self.assertEqual(inserted[0]["usuario_id"], "client-manager")
        self.assertEqual(inserted[0]["empresa_id"], company_id)
        self.assertEqual(request.state.empresa_id, company_id)


if __name__ == "__main__":
    unittest.main()
