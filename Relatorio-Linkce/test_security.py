import unittest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi.testclient import TestClient
import main

PAYLOAD = dict(tecnico="Ignorado", relatorio_texto="Teste", problema_tecnico="Resolvido",
    equipamento_status="Cabeado", maior_sinal="-45", request_id="11111111-1111-4111-8111-111111111111")
USER = dict(id="22222222-2222-4222-8222-222222222222", email="teste@example.invalid",
            user_metadata={"nome": "Teste", "role": "gestor"}, app_metadata={})

class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    def test_anonymous_denied(self):
        for method, url in [("post", "/gerar_relatorio"), ("get", "/api/relatorios"),
                ("post", "/api/criar-usuario"), ("delete", "/api/banco/deletar")]:
            self.assertEqual(getattr(self.client, method)(url).status_code, 401)

    def test_user_metadata_cannot_grant_admin(self):
        async def identity(request): return USER
        with patch.object(main, "authenticate", identity):
            self.assertEqual(self.client.post("/api/criar-usuario", json={}).status_code, 403)
            self.assertEqual(self.client.request("DELETE", "/api/banco/deletar", json={}).status_code, 403)
            self.assertEqual(self.client.get("/api/relatorios").status_code, 403)

    def test_validation(self):
        async def identity(request): return USER
        with patch.object(main, "authenticate", identity):
            for data in [[], {}, {**PAYLOAD, "relatorio_texto": None},
                         {**PAYLOAD, "latitude": 100}, {**PAYLOAD, "request_id": "bad"}]:
                self.assertEqual(self.client.post("/gerar_relatorio", json=data).status_code, 422)

    def test_database_failure_not_success(self):
        async def identity(request): return USER
        with patch.object(main, "authenticate", identity), patch.object(main, "supabase_client", None):
            response = self.client.post("/gerar_relatorio", json=PAYLOAD)
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("relatorio", response.json())

    def test_identity_from_verified_session(self):
        async def identity(request): return USER
        with patch.object(main, "authenticate", identity), patch.object(main, "salvar_relatorio", return_value=True) as save:
            response = self.client.post("/gerar_relatorio", json={**PAYLOAD, "user_id": "forged"})
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["salvo"])
            self.assertEqual(save.call_args.args[0]["user_id"], USER["id"])
            self.assertEqual(save.call_args.args[0]["tecnico"], "Teste")
            self.assertEqual(response.headers["cache-control"], "no-store")

    def test_duplicate_never_overwrites(self):
        class Database:
            def __init__(self): self.rows = {}; self.row = None; self.query_id = None
            def table(self, name): return self
            def upsert(self, row, **options):
                assert options == dict(on_conflict="id", ignore_duplicates=True)
                self.row = row; return self
            def select(self, fields): self.row = None; return self
            def eq(self, key, value): self.query_id = value; return self
            def execute(self):
                if self.row:
                    if self.row["id"] in self.rows: return SimpleNamespace(data=[])
                    self.rows[self.row["id"]] = self.row.copy()
                    return SimpleNamespace(data=[self.row])
                return SimpleNamespace(data=[self.rows[self.query_id]])
        db = Database()
        row = dict(id=PAYLOAD["request_id"], user_id=USER["id"], texto="original")
        with patch.object(main, "supabase_client", db):
            self.assertTrue(main.salvar_relatorio(row))
            self.assertFalse(main.salvar_relatorio({**row, "texto": "alterado"}))
            self.assertEqual(db.rows[row["id"]]["texto"], "original")

    def test_debug_disabled(self):
        self.assertEqual(self.client.get("/api/debug/materiais").status_code, 404)

if __name__ == "__main__":
    unittest.main()
