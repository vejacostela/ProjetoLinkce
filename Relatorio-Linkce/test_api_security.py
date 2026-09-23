import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

import main


class FakeResult:
    def __init__(self, data):
        self.data = data


class FakeRPC:
    def __init__(self, data):
        self.data = data

    def execute(self):
        return FakeResult(self.data)


class FakeSupabase:
    def __init__(self, data):
        self.data = data
        self.last_rpc = None

    def rpc(self, name, params):
        self.last_rpc = (name, params)
        return FakeRPC(self.data)


def request_for(path="/api/relatorios", method="GET", headers=None):
    return SimpleNamespace(
        method=method,
        headers=headers or {},
        url=SimpleNamespace(path=path, scheme="https"),
        client=SimpleNamespace(host="203.0.113.10"),
        state=SimpleNamespace(),
    )


class APISecurityTests(unittest.TestCase):
    def test_rejects_foreign_write_origin(self):
        request = request_for(
            method="POST",
            headers={"origin": "https://malicioso.example", "host": "app.example"},
        )
        with patch.object(main, "CORS_ORIGINS", ["https://app.example"]), patch.dict(os.environ, {}, clear=False):
            self.assertFalse(main.origem_de_escrita_permitida(request))

    def test_accepts_same_origin_write(self):
        request = request_for(
            method="POST",
            headers={"origin": "https://app.example", "host": "app.example"},
        )
        with patch.object(main, "CORS_ORIGINS", []):
            self.assertTrue(main.origem_de_escrita_permitida(request))

    def test_rate_limit_sets_response_metadata(self):
        fake = FakeSupabase([{
            "permitido": True,
            "restante": 12,
            "reinicia_em": "2099-01-01T00:00:00+00:00",
        }])
        request = request_for()
        with patch.object(main, "API_SECURITY_AVAILABLE", True), patch.object(main, "supabase_client", fake):
            main.aplicar_limite_api(request, {"id": "user-1"}, "empresa-1")
        self.assertEqual(request.state.rate_limit_remaining, 12)
        self.assertEqual(fake.last_rpc[0], "linkce_consumir_limite")
        self.assertNotIn("user-1", fake.last_rpc[1]["p_chave_hash"])

    def test_rate_limit_returns_429(self):
        fake = FakeSupabase([{
            "permitido": False,
            "restante": 0,
            "reinicia_em": "2099-01-01T00:00:00+00:00",
        }])
        request = request_for(path="/api/auth/login", method="POST")
        with patch.object(main, "API_SECURITY_AVAILABLE", True), patch.object(main, "supabase_client", fake):
            with self.assertRaises(HTTPException) as raised:
                main.aplicar_limite_api(request)
        self.assertEqual(raised.exception.status_code, 429)
        self.assertIn("Retry-After", raised.exception.headers)


if __name__ == "__main__":
    unittest.main()
