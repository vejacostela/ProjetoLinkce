import copy
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
import main


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.action = db, table, [], None

    def select(self, *args, **kwargs): return self
    def limit(self, *args): return self
    def eq(self, key, value): self.filters.append(lambda row: row.get(key) == value); return self
    def is_(self, key, value): self.filters.append(lambda row: row.get(key) is None if value == "null" else row.get(key) == value); return self
    def insert(self, data): self.action = ("insert", data); return self
    def update(self, data): self.action = ("update", data); return self
    def upsert(self, data, **kwargs): self.action = ("upsert", data); return self
    def delete(self): self.action = ("delete", None); return self

    def execute(self):
        rows = self.db.rows.setdefault(self.table, [])
        matches = [row for row in rows if all(check(row) for check in self.filters)]
        if self.action:
            action, data = self.action
            if action == "insert": rows.append(copy.deepcopy(data)); matches = [data]
            elif action == "update":
                for row in matches: row.update(copy.deepcopy(data))
            elif action == "delete":
                for row in list(matches): rows.remove(row)
            elif action == "upsert":
                old = next((row for row in rows if row.get("chave_hash") == data.get("chave_hash")), None)
                if old: old.update(copy.deepcopy(data)); matches = [old]
                else: rows.append(copy.deepcopy(data)); matches = [data]
        return SimpleNamespace(data=copy.deepcopy(matches))


class Database:
    def __init__(self): self.rows = {"login_tentativas": [], "sessoes_ativas": []}
    def table(self, name): return Query(self, name)


class AuthenticationSecurityTests(unittest.TestCase):
    def setUp(self):
        self.db = Database()
        self.flags = patch.multiple(main, supabase_client=self.db, AUTH_SECURITY_AVAILABLE=True)
        self.flags.start(); self.addCleanup(self.flags.stop)

    def test_fifth_failed_login_is_locked_for_fifteen_minutes(self):
        key = "a" * 64
        for attempt in range(5):
            blocked = main.registrar_falha_login(key, main._login_state(key))
            self.assertEqual(blocked, attempt == 4)
        row = self.db.rows["login_tentativas"][0]
        until = datetime.fromisoformat(row["bloqueado_ate"])
        self.assertGreaterEqual(until, datetime.now(timezone.utc) + timedelta(minutes=14, seconds=50))

    def test_revoked_session_is_rejected(self):
        now = datetime.now(timezone.utc)
        self.db.rows["sessoes_ativas"].append({
            "sessao_id": "session-1", "usuario_id": "user-1",
            "ultima_atividade_em": now.isoformat(),
            "expira_em": (now + timedelta(hours=1)).isoformat(),
            "revogada_em": now.isoformat(),
        })
        request = SimpleNamespace(state=SimpleNamespace(empresa_id=main.DEFAULT_EMPRESA_ID), headers={})
        with patch.object(main, "_jwt_session_id", return_value="session-1"):
            with self.assertRaises(HTTPException) as caught:
                main.validar_sessao_servidor(request, {"id": "user-1"})
        self.assertEqual(caught.exception.status_code, 401)

    def test_session_expires_after_inactivity(self):
        now = datetime.now(timezone.utc)
        self.db.rows["sessoes_ativas"].append({
            "sessao_id": "session-2", "usuario_id": "user-1",
            "ultima_atividade_em": (now - timedelta(minutes=31)).isoformat(),
            "expira_em": (now + timedelta(hours=1)).isoformat(), "revogada_em": None,
        })
        request = SimpleNamespace(state=SimpleNamespace(empresa_id=main.DEFAULT_EMPRESA_ID), headers={})
        with patch.object(main, "_jwt_session_id", return_value="session-2"):
            with self.assertRaises(HTTPException) as caught:
                main.validar_sessao_servidor(request, {"id": "user-1"})
        self.assertEqual(caught.exception.status_code, 401)

    def test_new_valid_session_is_registered(self):
        request = SimpleNamespace(state=SimpleNamespace(empresa_id=main.DEFAULT_EMPRESA_ID), headers={})
        with patch.object(main, "_jwt_session_id", return_value="session-3"):
            main.validar_sessao_servidor(request, {"id": "user-1"})
        self.assertEqual(self.db.rows["sessoes_ativas"][0]["sessao_id"], "session-3")


if __name__ == "__main__":
    unittest.main()
