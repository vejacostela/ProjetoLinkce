"""Diagnóstico somente leitura do host para a instalação em servidor próprio."""
import json
import os
import shutil
import socket
import ssl
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

OUTPUT = Path(os.getenv("SERVER_SECURITY_REPORT", "/var/lib/sistema-campo/security/status.json"))
DOMAIN = os.getenv("LINKCE_DOMAIN", "").strip()

def run(*command):
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=8, check=False)
        return result.returncode, (result.stdout + result.stderr).strip()[:2000]
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 127, str(exc)

def firewall():
    if shutil.which("ufw"):
        code, output = run("ufw", "status")
        return code == 0 and "Status: active" in output, "ufw"
    if shutil.which("firewall-cmd"):
        code, output = run("firewall-cmd", "--state")
        return code == 0 and output.strip() == "running", "firewalld"
    return False, "não detectado"

def https_certificate():
    if not DOMAIN:
        return False, None
    host = urlsplit(DOMAIN).hostname if "://" in DOMAIN else DOMAIN.split(":", 1)[0]
    try:
        context = ssl.create_default_context()
        with socket.create_connection((host, 443), timeout=8) as raw:
            with context.wrap_socket(raw, server_hostname=host) as secured:
                cert = secured.getpeercert()
        return True, cert.get("notAfter")
    except (OSError, ssl.SSLError, ValueError):
        return False, None

def listening_database():
    code, output = run("ss", "-lnt")
    if code:
        return None
    exposed = any((":5432 " in line or ":5432\n" in line) and not any(local in line for local in ("127.0.0.1:5432", "[::1]:5432")) for line in output.splitlines())
    return not exposed

def main():
    firewall_ok, firewall_provider = firewall()
    https_ok, certificate_expiry = https_certificate()
    database_private = listening_database()
    payload = {
        "schema": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "hostname": socket.gethostname(),
        "firewall_active": firewall_ok,
        "firewall_provider": firewall_provider,
        "https_valid": https_ok,
        "certificate_expires_at": certificate_expiry,
        "database_not_public": database_private,
        "effective_uid": os.geteuid() if hasattr(os, "geteuid") else None,
        "non_root_user": not hasattr(os, "geteuid") or os.geteuid() != 0,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix="status-", suffix=".json", dir=OUTPUT.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        os.chmod(temporary, 0o600)
        os.replace(temporary, OUTPUT)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(json.dumps(payload, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
