#!/usr/bin/env python3
"""Smoke test for the public Linkce deployment.

Usage:
  LINKCE_BASE_URL=https://projeto-linkce.vercel.app python scripts/smoke_production.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from urllib.parse import urljoin

BASE = os.environ.get("LINKCE_BASE_URL", "").strip().rstrip("/")
if not BASE:
    raise SystemExit("Defina LINKCE_BASE_URL com a URL de produção.")

def get(path: str):
    url = urljoin(BASE + "/", path.lstrip("/"))
    request = urllib.request.Request(url, headers={"User-Agent": "Linkce-Smoke/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()

checks = [
    ("/", b"Atendimentos em campo"),
    ("/tecnico", b"Gerador de Relat"),
    ("/health", b'"status"'),
]
errors = []
for path, marker in checks:
    status, body = get(path)
    if status != 200:
        errors.append(f"{path}: HTTP {status}")
    elif marker not in body:
        errors.append(f"{path}: conteúdo esperado ausente")

status, body = get("/api/config")
if status != 200:
    errors.append(f"/api/config: HTTP {status}")
else:
    try:
        config = json.loads(body)
        if not config.get("supabase_url") or not config.get("supabase_key"):
            errors.append("/api/config: variáveis públicas incompletas")
    except (ValueError, TypeError):
        errors.append("/api/config: resposta não é JSON")

if errors:
    for error in errors:
        print("FAIL", error)
    raise SystemExit(1)
print(f"OK Linkce disponível em {BASE}")
