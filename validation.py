from uuid import UUID
from fastapi import HTTPException
import os

def validate_report(data, require_id=False):
    if not isinstance(data, dict):
        raise HTTPException(422, "O relatório deve ser um objeto.")
    fields = ("tecnico", "relatorio_texto", "problema_tecnico", "equipamento_status",
              "equipamento_obs", "maior_sinal", "materiais_utilizados",
              "materiais_recolhidos", "checklist_fotos", "obs_fotos")
    for field in fields:
        value = data.get(field, "")
        if not isinstance(value, str) or len(value) > 20000:
            raise HTTPException(422, f"Campo inválido: {field}")
        data[field] = value.strip()
    for field in ("tecnico", "relatorio_texto", "problema_tecnico", "equipamento_status", "maior_sinal"):
        if not data[field]:
            raise HTTPException(422, f"Campo obrigatório: {field}")
    if data["equipamento_status"] not in ("Cabeado", "Não Cabeado", "Rejeitado"):
        raise HTTPException(422, "Situação de cabeamento inválida.")
    for key, bound in (("latitude", 90), ("longitude", 180)):
        value = data.get(key)
        if value is not None and (type(value) not in (int, float) or not -bound <= value <= bound):
            raise HTTPException(422, f"Coordenada inválida: {key}")
    if require_id:
        try:
            data["request_id"] = str(UUID(data["request_id"]))
        except (KeyError, ValueError, TypeError, AttributeError):
            raise HTTPException(422, "Identificador de envio inválido.")
    return data

async def authenticate(request):
    import httpx
    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer ") or not header[7:].strip():
        raise HTTPException(401, "Entre novamente para continuar.")
    url, key = os.getenv("SUPABASE_URL", ""), os.getenv("SUPABASE_KEY", "")
    if not url or not key:
        raise HTTPException(503, "Autenticação não configurada.")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(url.rstrip("/") + "/auth/v1/user",
                headers={"apikey": key, "Authorization": header})
    except httpx.HTTPError:
        raise HTTPException(503, "Autenticação temporariamente indisponível.")
    if response.status_code in (401, 403):
        raise HTTPException(401, "Sessão expirada. Entre novamente.")
    if response.status_code != 200:
        raise HTTPException(503, "Autenticação temporariamente indisponível.")
    user = response.json()
    if not user.get("id"):
        raise HTTPException(401, "Sessão inválida.")
    return user

def role_of(user):
    # Only administrator-controlled metadata can authorize privileged operations.
    return (user.get("app_metadata") or {}).get("role", "tecnico")

