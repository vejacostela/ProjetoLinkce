import os
import re
import json
import logging
from datetime import date, time, datetime, timedelta, timezone
from fastapi import FastAPI, Request, HTTPException, BackgroundTasks, Query
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import httpx
import uvicorn
if __package__:
    from .validation import validate_report, authenticate, role_of
else:
    from validation import validate_report, authenticate, role_of

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in os.getenv("ALLOWED_ORIGINS", "").split(",") if x.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def enforce_access(request, call_next):
    path = request.url.path
    if path.startswith("/api/debug/") or path == "/api/materiais/recarregar":
        return JSONResponse({"detail": "Recurso indisponível."}, status_code=404)
    protected = path.startswith("/api/") and path not in ("/api/config", "/api/materiais")
    if protected or path == "/gerar_relatorio":
        try:
            user = await authenticate(request)
            role = role_of(user)
            if path == "/api/criar-usuario" or path.startswith("/api/banco/"):
                if role != "gestor":
                    raise HTTPException(403, "Acesso exclusivo do gestor.")
            elif path.startswith("/api/relatorios") and role not in ("gestor", "apoio"):
                raise HTTPException(403, "Acesso não autorizado.")
            request.state.user = user
        except HTTPException as exc:
            return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    response = await call_next(request)
    if protected or path == "/gerar_relatorio":
        response.headers["Cache-Control"] = "no-store"
    return response

# === WHATSAPP ===
WHATSAPP_SERVICE_URL = os.environ.get("WHATSAPP_SERVICE_URL", "")
WHATSAPP_SECRET      = os.environ.get("WHATSAPP_SECRET", "")

async def notificar_whatsapp(tecnico: str, resumo: str):
    if not WHATSAPP_SERVICE_URL or not WHATSAPP_SECRET:
        return
    try:
        async with httpx.AsyncClient(timeout=5.0) as cli:
            await cli.post(
                f"{WHATSAPP_SERVICE_URL}/notificar-relatorio",
                json={"tecnico": tecnico, "resumo": resumo},
                headers={"x-secret": WHATSAPP_SECRET},
            )
    except Exception as e:
        logger.warning(f"⚠️ WhatsApp notificação falhou: {e}")

BRASIL_OFFSET = timedelta(hours=-3)

def get_data_brasil():
    agora_utc = datetime.now(timezone.utc)
    agora_brasil = agora_utc.astimezone(timezone(BRASIL_OFFSET))
    return agora_brasil.strftime("%d/%m/%Y %H:%M")

static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

# === SUPABASE ===
SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY         = os.environ.get("SUPABASE_KEY", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
supabase_client = None

def init_supabase():
    global supabase_client
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        logger.warning("⚠️ Supabase não configurado")
        return
    try:
        from supabase import create_client
        supabase_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        logger.info("✅ Supabase conectado")
    except Exception as e:
        logger.error(f"❌ Erro ao conectar ao Supabase: {e}")

COLUNAS_EXTRAS = {"latitude", "longitude", "user_id", "endereco"}

def salvar_relatorio(dados: dict):
    if not supabase_client:
        raise HTTPException(503, "Banco indisponível. Preserve o rascunho e tente novamente.")
    try:
        result = supabase_client.table("relatorios").upsert(
            dados, on_conflict="id", ignore_duplicates=True).execute()
        if result.data:
            return True
        existing = supabase_client.table("relatorios").select("id,user_id").eq("id", dados["id"]).execute()
        if not existing.data or existing.data[0].get("user_id") != dados["user_id"]:
            raise HTTPException(409, "Identificador de envio já utilizado.")
        return False
    except HTTPException:
        raise
    except Exception:
        logger.exception("Falha ao persistir relatório")
        raise HTTPException(503, "Relatório não salvo. Preserve o rascunho e tente novamente.")

# === MATERIAIS ===
def carregar_materiais():
    materiais = []
    try:
        caminho = os.path.join(os.path.dirname(__file__), "materiais.txt")
        if not os.path.exists(caminho):
            return [{"nome": "CONECTOR APC", "categoria": "Conectores"}]
        with open(caminho, "r", encoding="utf-8") as f:
            for linha in f:
                linha = linha.strip()
                if not linha or linha.startswith('#'):
                    continue
                partes = linha.split('|')
                if len(partes) >= 2:
                    materiais.append({"nome": partes[0].strip(), "categoria": partes[1].strip()})
        logger.info(f"✅ {len(materiais)} materiais carregados")
        return materiais
    except Exception as e:
        logger.error(f"❌ Erro ao carregar materiais: {e}")
        return [{"nome": "CONECTOR APC", "categoria": "Conectores"}]

MATERIAIS_CACHE = None

@app.on_event("startup")
async def startup_event():
    global MATERIAIS_CACHE
    MATERIAIS_CACHE = carregar_materiais()
    init_supabase()
    logger.info(f"🚀 Servidor iniciado - {len(MATERIAIS_CACHE)} materiais")

# === ROTAS UTILITÁRIAS ===
@app.get("/.well-known/appspecific/com.chrome.devtools.json", include_in_schema=False)
async def devtools_config():
    return JSONResponse(content={})

@app.get("/sw.js", include_in_schema=False)
async def service_worker():
    """Serve o Service Worker na raiz para que o scope cubra todo o app."""
    caminho = os.path.join(os.path.dirname(__file__), "static", "sw.js")
    return FileResponse(
        caminho,
        media_type="application/javascript",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Service-Worker-Allowed": "/tecnico",
        },
    )

@app.get("/api/config")
async def get_config():
    """Retorna configurações públicas para o cliente JS."""
    if (not SUPABASE_URL or not SUPABASE_KEY or
            SUPABASE_KEY == SUPABASE_SERVICE_KEY or SUPABASE_KEY.startswith("sb_secret_")):
        raise HTTPException(503, detail="Configuração pública de autenticação indisponível")
    # Reject a legacy service-role JWT accidentally assigned to the public variable.
    if SUPABASE_KEY.count(".") == 2:
        import base64
        try:
            payload = SUPABASE_KEY.split(".")[1]
            claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
            if claims.get("role") == "service_role":
                raise HTTPException(503, detail="Configuração pública inválida")
        except (ValueError, TypeError):
            raise HTTPException(503, detail="Configuração pública inválida")
    return JSONResponse(content={
        "supabase_url": SUPABASE_URL,
        "supabase_key": SUPABASE_KEY,
    })

# === PÁGINAS ===
@app.get("/recuperar-senha", response_class=HTMLResponse)
@app.get("/nova-senha", response_class=HTMLResponse)
async def account_page():
    caminho = os.path.join(os.path.dirname(__file__), "account.html")
    with open(caminho, encoding="utf-8") as stream:
        return HTMLResponse(stream.read(), headers={
            "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
        })

@app.get("/tecnico", response_class=HTMLResponse)
async def index():
    try:
        caminho = os.path.join(os.path.dirname(__file__), "index.html")
        with open(caminho, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    except Exception as e:
        return HTMLResponse(content=f"<h1>Erro: {e}</h1>", status_code=500)

@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard():
    return RedirectResponse("/", status_code=302,
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})

# === API MATERIAIS ===
@app.get("/api/materiais")
async def get_materiais():
    return JSONResponse(content={"materiais": MATERIAIS_CACHE, "total": len(MATERIAIS_CACHE)})

@app.post("/api/materiais/recarregar")
async def recarregar_materiais():
    global MATERIAIS_CACHE
    MATERIAIS_CACHE = carregar_materiais()
    return JSONResponse(content={"mensagem": f"{len(MATERIAIS_CACHE)} materiais recarregados", "total": len(MATERIAIS_CACHE)})

@app.get("/api/debug/materiais")
async def debug_materiais():
    caminho = os.path.join(os.path.dirname(__file__), "materiais.txt")
    existe = os.path.exists(caminho)
    conteudo = ""
    if existe:
        with open(caminho, "r", encoding="utf-8") as f:
            conteudo = f.read()
    return JSONResponse(content={
        "caminho": caminho,
        "existe": existe,
        "conteudo": conteudo[:500] + "..." if len(conteudo) > 500 else conteudo,
        "materiais_no_cache": len(MATERIAIS_CACHE) if MATERIAIS_CACHE else 0
    })

# === GERAR RELATÓRIO ===
@app.post("/gerar_relatorio")
async def gerar_relatorio(request: Request, background_tasks: BackgroundTasks):
    try:
        body = await request.body()
        data = json.loads(body)
        if not isinstance(data, dict):
            raise HTTPException(422, "O relatório deve ser um objeto.")
        user = request.state.user
        data["tecnico"] = (user.get("user_metadata") or {}).get("nome") or user.get("email", "")
        data["user_id"] = user["id"]
        data = validate_report(data, require_id=True)

        tecnico              = data.get("tecnico", "").strip()
        relatorio_texto      = data.get("relatorio_texto", "").strip()
        problema_tecnico     = data.get("problema_tecnico", "").strip()
        equipamento_status   = data.get("equipamento_status", "").strip()
        equipamento_obs      = data.get("equipamento_obs", "").strip()
        maior_sinal          = data.get("maior_sinal", "").strip()
        materiais_utilizados = data.get("materiais_utilizados", "").strip()
        materiais_recolhidos = data.get("materiais_recolhidos", "").strip()
        checklist_fotos      = data.get("checklist_fotos", "").strip()
        obs_fotos            = data.get("obs_fotos", "").strip()
        latitude             = data.get("latitude")
        longitude            = data.get("longitude")
        user_id              = data.get("user_id", "")

        data_atual = get_data_brasil()

        relatorio = f"""
-------------------------------------
Relatório Técnico - {data_atual}
-------------------------------------
{f'''
> Técnico: {tecnico}''' if tecnico else ''}

Situação encontrado:
{relatorio_texto}

Resolução do Problema:
{problema_tecnico}

Cabeou o(s) Equipamento(s): {equipamento_status}
OBS: {equipamento_obs}

Maior sinal de RSSI: {maior_sinal}

Materiais Utilizados:
{materiais_utilizados if materiais_utilizados else "Nenhum"}

Materiais Recolhidos:
{materiais_recolhidos if materiais_recolhidos else "Nenhum"}
{f'''
{checklist_fotos}''' if checklist_fotos else ''}
-------------------------------------
""".strip()

        created = salvar_relatorio({
            "id": data["request_id"],
            "tecnico":              tecnico,
            "situacao_encontrada":  relatorio_texto,
            "resolucao_problema":   problema_tecnico,
            "equipamento_status":   equipamento_status,
            "equipamento_obs":      equipamento_obs,
            "maior_sinal":          maior_sinal,
            "materiais_utilizados": materiais_utilizados,
            "materiais_recolhidos": materiais_recolhidos,
            "obs_fotos":            obs_fotos,
            "check_sinal_fibra":    data.get("check_sinal_fibra") == "sim",
            "check_serial":         data.get("check_serial") == "sim",
            "check_cto":            data.get("check_cto") == "sim",
            "check_panoramica":     data.get("check_panoramica") == "sim",
            "check_sobra":          data.get("check_sobra") == "sim",
            "check_metragem":       data.get("check_metragem") == "sim",
            "check_velocidade":     data.get("check_velocidade") == "sim",
            "check_local_ont":      data.get("check_local_ont") == "sim",
            "check_frente":         data.get("check_frente") == "sim",
            "relatorio_completo":   relatorio,
            "latitude":             latitude,
            "longitude":            longitude,
            "user_id":              user_id,
        })

        logger.info("Relatório persistido")
        resumo = relatorio[:400] + "..." if len(relatorio) > 400 else relatorio
        if created:
            background_tasks.add_task(notificar_whatsapp, tecnico, resumo)
        return JSONResponse(content={"relatorio": relatorio, "salvo": True, "id": data["request_id"]})

    except HTTPException:
        raise
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Formato inválido: {str(e)}")
    except Exception as e:
        logger.error(f"❌ Erro interno: {e}")
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")

# === API RELATÓRIOS ===
@app.get("/api/relatorios")
async def listar_relatorios(
    limite: int = Query(100, ge=1, le=200),
    tecnico: str = Query(None, max_length=200),
    dias: int = Query(None, ge=1, le=3660),
    offset: int = Query(0, ge=0, le=1000000),
    inicio: date = None,
    fim: date = None,
):
    if inicio and fim and inicio > fim:
        raise HTTPException(422, "A data inicial deve ser anterior ou igual à final.")
    if dias and (inicio or fim):
        raise HTTPException(422, "Use dias ou datas, não os dois filtros juntos.")
    if fim == date.max:
        raise HTTPException(422, "Data final inválida.")
    if not supabase_client:
        raise HTTPException(503, "Banco de dados não configurado.")
    try:
        query = supabase_client.table("relatorios").select(
            "id, criado_em, tecnico, equipamento_status, maior_sinal, "
            "check_sinal_fibra, check_serial, check_cto, check_panoramica, "
            "check_sobra, check_metragem, check_velocidade, check_local_ont, check_frente, "
            "latitude, longitude, user_id", count="exact"
        )
        if tecnico:
            query = query.eq("tecnico", tecnico.strip())
        brasil = timezone(BRASIL_OFFSET)
        if inicio:
            query = query.gte("criado_em", datetime.combine(inicio, time.min, tzinfo=brasil).isoformat())
        if fim:
            query = query.lt("criado_em", datetime.combine(fim + timedelta(days=1), time.min, tzinfo=brasil).isoformat())
        if dias:
            query = query.gte("criado_em", (datetime.now(timezone.utc) - timedelta(days=dias)).isoformat())
        result = query.order("criado_em", desc=True).order("id", desc=True).range(offset, offset + limite - 1).execute()
        total = result.count if result.count is not None else offset + len(result.data)
        return JSONResponse(content={
            "relatorios": result.data, "total": total, "offset": offset,
            "limite": limite, "has_more": offset + len(result.data) < total,
        })
    except HTTPException:
        raise
    except Exception:
        logger.exception("Falha ao consultar relatórios")
        raise HTTPException(503, "Não foi possível consultar os relatórios. Tente novamente.")

@app.post("/api/criar-usuario")
async def criar_usuario(request: Request):
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise HTTPException(status_code=503, detail="SUPABASE_SERVICE_KEY não configurada no servidor")
    try:
        data  = await request.json()
        if not isinstance(data, dict):
            raise HTTPException(status_code=422, detail="Dados de cadastro inválidos")
        for field in ("nome", "email", "senha", "cargo"):
            if not isinstance(data.get(field), str):
                raise HTTPException(status_code=422, detail=f"Campo inválido: {field}")
        nome  = data.get("nome", "").strip()
        email = data.get("email", "").strip()
        senha = data.get("senha", "")
        cargo = data.get("cargo", "tecnico").strip()
        if len(nome) > 120 or len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise HTTPException(status_code=422, detail="Nome ou email inválido")
        if not 12 <= len(senha) <= 128:
            raise HTTPException(status_code=422, detail="A senha deve conter de 12 a 128 caracteres")
        if not nome or not email or not senha:
            raise HTTPException(status_code=400, detail="nome, email e senha são obrigatórios")
        if cargo not in ("gestor", "tecnico", "apoio"):
            raise HTTPException(status_code=400, detail="cargo deve ser gestor, tecnico ou apoio")
        from supabase import create_client
        admin = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        result = admin.auth.admin.create_user({
            "email": email,
            "password": senha,
            "user_metadata": {"nome": nome},
            "app_metadata": {"role": cargo},
            "email_confirm": True,
        })
        logger.info("Usuário criado pelo gestor")
        return JSONResponse(content={"mensagem": f"Usuário '{nome}' criado como {cargo}", "id": result.user.id})
    except HTTPException:
        raise
    except Exception as e:
        code = getattr(e, "code", "")
        if code in ("email_exists", "user_already_exists"):
            raise HTTPException(409, "Email já cadastrado. Use a recuperação de senha.")
        if code == "weak_password":
            raise HTTPException(422, "A senha não atende às regras de segurança do provedor.")
        logger.error("Falha no cadastro: %s", type(e).__name__)
        raise HTTPException(status_code=503, detail="Cadastro não confirmado. Confira a lista de usuários antes de tentar novamente.")

@app.get("/api/relatorios/{relatorio_id}")
async def get_relatorio(relatorio_id: str):
    if not supabase_client:
        raise HTTPException(status_code=503, detail="Banco de dados não configurado")
    try:
        result = supabase_client.table("relatorios").select("*").eq("id", relatorio_id).single().execute()
        return JSONResponse(content=result.data)
    except Exception as e:
        raise HTTPException(status_code=404, detail="Relatório não encontrado")

# === API BANCO ===
@app.get("/api/banco/previa")
async def previa_limpeza(manter_dias: int = Query(30, ge=1, le=36500)):
    if not supabase_client:
        raise HTTPException(503, "Banco indisponível.")
    limite = (datetime.now(timezone.utc) - timedelta(days=manter_dias)).isoformat()
    try:
        total = supabase_client.table("relatorios").select("id", count="exact", head=True).execute()
        antigos = supabase_client.table("relatorios").select("id", count="exact", head=True).lt("criado_em", limite).execute()
        if total.count is None or antigos.count is None:
            raise ValueError("Contagem ausente")
        return {"total": total.count, "candidatos": antigos.count, "limite": limite}
    except Exception:
        logger.exception("Falha na prévia de limpeza")
        raise HTTPException(503, "Não foi possível calcular a limpeza. Nada foi excluído por esta consulta.")

@app.post("/api/banco/limpeza")
async def executar_limpeza(request: Request):
    # enforce_access requires gestor for every /api/banco/* route.
    try:
        dados = await request.json()
        if not isinstance(dados, dict) or dados.get("confirmacao") != "EXCLUIR":
            raise ValueError("Confirmação ausente")
        limite = datetime.fromisoformat(dados["limite"])
        if limite.tzinfo is None or limite > datetime.now(timezone.utc) - timedelta(days=1):
            raise ValueError("Preserve ao menos as últimas 24 horas")
    except (ValueError, KeyError, TypeError):
        raise HTTPException(422, "Informe uma data de corte válida e confirme a exclusão.")
    if not supabase_client:
        raise HTTPException(503, "Banco indisponível.")
    try:
        resultado = supabase_client.table("relatorios").delete(count="exact", returning="minimal").lt("criado_em", limite.isoformat()).execute()
        logger.info("Limpeza concluída pelo gestor %s; corte %s", request.state.user["id"], limite.isoformat())
        return {"concluido": True, "deletados": resultado.count, "limite": limite.isoformat()}
    except Exception:
        logger.exception("Falha na limpeza de relatórios")
        raise HTTPException(503, "Não foi possível confirmar a exclusão. Atualize a prévia antes de tentar novamente.")

@app.get("/api/banco/stats")
async def banco_stats():
    if not supabase_client:
        raise HTTPException(status_code=503, detail="Banco de dados não configurado")
    resultado: dict = {
        "total_rows": 0, "oldest_date": None, "newest_date": None,
        "size_bytes": 0, "por_dia": [], "rpc_ok": False,
    }
    try:
        raw = supabase_client.rpc("get_relatorios_stats").execute()
        d = raw.data
        if isinstance(d, list):
            d = d[0] if d else {}
        if isinstance(d, dict):
            resultado.update({
                "total_rows": int(d.get("total_rows") or 0),
                "oldest_date": d.get("oldest_date"),
                "newest_date": d.get("newest_date"),
                "size_bytes": int(d.get("size_bytes") or 0),
                "rpc_ok": True,
            })
        por_dia = supabase_client.rpc("get_relatorios_por_dia").execute()
        resultado["por_dia"] = por_dia.data or []
    except Exception as e:
        logger.warning(f"⚠️ RPC banco stats indisponível, usando fallback: {e}")
        try:
            rows_res = supabase_client.table("relatorios").select("id, criado_em").order("criado_em").execute()
            rows = rows_res.data or []
            resultado["total_rows"] = len(rows)
            if rows:
                resultado["oldest_date"] = rows[0]["criado_em"][:10]
                resultado["newest_date"] = rows[-1]["criado_em"][:10]
            dias_map: dict = {}
            for r in rows:
                dt_utc = datetime.fromisoformat(r["criado_em"].replace("Z", "+00:00"))
                dt_br = dt_utc.astimezone(timezone(BRASIL_OFFSET))
                dia = dt_br.strftime("%Y-%m-%d")
                dias_map[dia] = dias_map.get(dia, 0) + 1
            resultado["por_dia"] = [{"dia": d, "total": t} for d, t in sorted(dias_map.items())]
            resultado["size_bytes"] = resultado["total_rows"] * 3072  # ~3 KB/registro
        except Exception as e2:
            logger.error(f"❌ Erro no fallback banco stats: {e2}")
            raise HTTPException(status_code=500, detail=str(e2))
    return JSONResponse(content=resultado)


@app.delete("/api/banco/deletar")
async def banco_deletar(request: Request):
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise HTTPException(status_code=503, detail="SUPABASE_SERVICE_KEY não configurada no servidor")
    try:
        data = await request.json()
        modo = data.get("modo")
        from supabase import create_client as _sc
        admin = _sc(SUPABASE_URL, SUPABASE_SERVICE_KEY)

        if modo == "manual":
            datas = data.get("datas", [])
            if not datas:
                raise HTTPException(status_code=400, detail="Nenhuma data fornecida")
            total_deletados = 0
            for dt_str in datas:
                try:
                    dt = datetime.strptime(dt_str, "%Y-%m-%d")
                    # Brasil UTC-3: início do dia = dt+3h UTC, fim = dt+27h UTC
                    inicio = (dt + timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
                    fim    = (dt + timedelta(hours=27)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
                    res = admin.table("relatorios").delete().gte("criado_em", inicio).lt("criado_em", fim).execute()
                    total_deletados += len(res.data) if res.data else 0
                except Exception as ex:
                    logger.warning(f"⚠️ Erro ao deletar {dt_str}: {ex}")
            logger.info(f"🗑️ Manual: {total_deletados} registro(s) em {len(datas)} dia(s)")
            return JSONResponse(content={"deletados": total_deletados, "datas": datas})

        elif modo == "automatico":
            manter_dias = int(data.get("manter_dias", 7))
            if manter_dias < 1:
                raise HTTPException(status_code=400, detail="manter_dias deve ser >= 1")
            limite = (datetime.now(timezone.utc) - timedelta(days=manter_dias)).isoformat()
            res = admin.table("relatorios").delete().lt("criado_em", limite).execute()
            deletados = len(res.data) if res.data else 0
            logger.info(f"🗑️ Auto: {deletados} registro(s) (mantendo últimos {manter_dias} dias)")
            return JSONResponse(content={"deletados": deletados, "manter_dias": manter_dias})

        else:
            raise HTTPException(status_code=400, detail="modo deve ser 'manual' ou 'automatico'")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Erro ao deletar registros: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "timezone": "America/Sao_Paulo (UTC-3)",
        "data_brasil": get_data_brasil(),
        "data_utc": datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M"),
        "materiais_carregados": len(MATERIAIS_CACHE) if MATERIAIS_CACHE else 0,
        "supabase": "conectado" if supabase_client else "não configurado",
    }

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)

