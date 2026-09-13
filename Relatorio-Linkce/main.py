import os
import re
import json
import csv
import io
import zipfile
import logging
from datetime import date, time, datetime, timedelta, timezone
from uuid import UUID, uuid4
from fastapi import FastAPI, Request, HTTPException, BackgroundTasks, Query, UploadFile, File
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, RedirectResponse, StreamingResponse
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
APP_VERSION = os.getenv("APP_VERSION", "2026.09.13")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in os.getenv("ALLOWED_ORIGINS", "").split(",") if x.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def enforce_access(request, call_next):
    request_id = request.headers.get("X-Request-ID") or uuid4().hex
    request.state.request_id = request_id
    path = request.url.path
    if path.startswith("/api/debug/") or path == "/api/materiais/recarregar":
        return JSONResponse({"detail": "Recurso indisponível."}, status_code=404)
    protected = path.startswith("/api/") and path not in ("/api/config", "/api/materiais")
    if protected or path == "/gerar_relatorio":
        try:
            user = await authenticate(request)
            role = role_of(user)
            request.state.empresa_id = empresa_id_do_usuario(user, request.headers.get("X-Empresa-ID"))
            if path.startswith('/api/avisos') and request.method != 'GET' and role not in ('gestor', 'apoio'):
                raise HTTPException(403, 'Acesso exclusivo da gestão e apoio.')
            if path == '/api/avisos/historico' and role not in ('gestor', 'apoio'):
                raise HTTPException(403, 'Acesso exclusivo da gestão e apoio.')
            if (path == '/gerar_relatorio' or (path.endswith('/imagens') and request.method == 'POST')) and supabase_client:
                if estado_aviso(request).get('bloqueado'):
                    raise HTTPException(423, 'Área técnica bloqueada. Consulte o aviso importante.')
            if path.startswith("/api/operacao/") and role not in ("gestor", "apoio"):
                raise HTTPException(403, "Acesso exclusivo da gestão e apoio.")
            if path == "/api/saude" and role not in ("gestor", "apoio"):
                raise HTTPException(403, "Acesso exclusivo da gestão e apoio.")
            if path.startswith("/api/empresas") and request.method != "GET" and role != "gestor":
                raise HTTPException(403, "Acesso exclusivo do gestor.")
            if path.startswith("/api/backup") and role != "gestor":
                raise HTTPException(403, "Acesso exclusivo do gestor.")
            if path == "/api/seguranca/auditoria" and request.method == "GET":
                if role not in ("gestor", "apoio"):
                    raise HTTPException(403, "Acesso exclusivo da gestão e apoio.")
            elif path == "/api/criar-usuario" or path.startswith("/api/banco/") or path.startswith("/api/seguranca/"):
                if role != "gestor":
                    raise HTTPException(403, "Acesso exclusivo do gestor.")
            elif (path.startswith("/api/relatorios") and not (path.endswith("/imagens") and request.method == "POST")
                  and role not in ("gestor", "apoio")):
                raise HTTPException(403, "Acesso não autorizado.")
            request.state.user = user
        except HTTPException as exc:
            response = JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
            response.headers["X-Request-ID"] = request_id
            response.headers["Cache-Control"] = "no-store"
            return response
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    if protected or path == "/gerar_relatorio":
        response.headers["Cache-Control"] = "no-store"
    if response.status_code < 400 and path != '/api/seguranca/redefinir-senha' and (
        path.startswith(('/api/criar-usuario','/api/avisos','/api/banco','/api/seguranca','/api/empresas','/api/backup')) or
        (path.startswith('/api/relatorios/') and path.endswith('/imagens') and request.method in ('POST','PUT','DELETE'))
    ) and hasattr(request.state, 'user'):
        registrar_auditoria(request, f'{request.method} {path}', 'sucesso')
    return response

# === WHATSAPP ===
def estado_aviso(request: Request = None):
    if not supabase_client:
        raise HTTPException(503, 'Não foi possível verificar os avisos. Tente novamente.')
    try:
        query = supabase_client.table('avisos_operacao').select('*')
        if NOTICE_TENANT_AVAILABLE:
            query = query.eq('empresa_id', getattr(getattr(request, 'state', None), 'empresa_id', DEFAULT_EMPRESA_ID))
        else:
            query = query.eq('id', 1)
        result = query.order('atualizado_em', desc=True).limit(1).execute()
        return result.data[0] if result.data else {'mensagem': '', 'bloqueado': False}
    except Exception as exc:
        if getattr(exc, 'code', '') in ('PGRST205', '42P01'):
            return {'mensagem': '', 'bloqueado': False, 'configurado': False}
        raise HTTPException(503, 'Central de avisos indisponível. Verifique a migração no Supabase.')

AVISOS_PADRAO = [
    {'titulo': 'Bom dia de trabalho', 'mensagem': 'Bom dia de trabalho! A equipe está disponível para apoiar as rotas de hoje.'},
    {'titulo': 'Atenção às evidências', 'mensagem': 'Atenção: siga o checklist, registre as evidências e confira os materiais antes de finalizar.'},
    {'titulo': 'Manutenção do sistema', 'mensagem': 'Aviso: o sistema estará em manutenção. Aguarde a liberação antes de enviar relatórios.'},
]

def registrar_historico_aviso(request: Request, acao: str, *, modelo_id=None,
                              titulo='', mensagem='', bloqueado=False):
    """Registra ações sem impedir a operação caso a tabela ainda não exista."""
    if not supabase_client:
        return
    user = getattr(request.state, 'user', {}) or {}
    try:
        payload = {
            'acao': acao,
            'modelo_id': modelo_id,
            'titulo': titulo[:120] if isinstance(titulo, str) else '',
            'mensagem': mensagem[:3000] if isinstance(mensagem, str) else '',
            'bloqueado': bool(bloqueado),
            'usuario_id': user.get('id'),
            'usuario_email': user.get('email', ''),
        }
        if NOTICE_TENANT_AVAILABLE:
            payload['empresa_id'] = getattr(request.state, 'empresa_id', DEFAULT_EMPRESA_ID)
        try:
            supabase_client.table('avisos_historico').insert(payload).execute()
        except Exception:
            if 'empresa_id' not in payload:
                raise
            payload.pop('empresa_id', None)
            supabase_client.table('avisos_historico').insert(payload).execute()
    except Exception as exc:
        logger.warning('Histórico de avisos indisponível: %s', exc)


def registrar_auditoria(request: Request, acao: str, resultado: str = 'sucesso'):
    if not supabase_client:
        return
    user = getattr(request.state, 'user', {}) or {}
    try:
        payload = {
            'acao': acao[:120], 'metodo': request.method, 'rota': request.url.path[:300],
            'resultado': resultado[:40], 'usuario_id': user.get('id'),
            'usuario_email': user.get('email', '')[:254],
        }
        if AUDIT_TENANT_AVAILABLE:
            payload['empresa_id'] = getattr(request.state, 'empresa_id', DEFAULT_EMPRESA_ID)
        try:
            supabase_client.table('auditoria_gestao').insert(payload).execute()
        except Exception:
            if 'empresa_id' not in payload:
                raise
            payload.pop('empresa_id', None)
            supabase_client.table('auditoria_gestao').insert(payload).execute()
    except Exception as exc:
        logger.warning('Auditoria indisponível: %s', exc)

@app.get('/api/avisos')
async def obter_aviso(request: Request):
    return estado_aviso(request)

@app.get('/api/avisos/modelos')
async def listar_modelos_aviso(request: Request):
    if not supabase_client:
        return {'modelos': AVISOS_PADRAO}
    try:
        query = supabase_client.table('avisos_modelos').select('id,titulo,mensagem')
        query = aplicar_empresa_aviso(query, request)
        result = query.order('criado_em').execute()
        return {'modelos': result.data or AVISOS_PADRAO}
    except Exception:
        return {'modelos': AVISOS_PADRAO}

@app.get('/api/avisos/historico')
async def listar_historico_avisos(request: Request, limite: int = Query(30, ge=1, le=100)):
    if not supabase_client:
        return {'historico': []}
    try:
        query = (supabase_client.table('avisos_historico')
                  .select('id,acao,modelo_id,titulo,mensagem,bloqueado,usuario_email,criado_em'))
        query = aplicar_empresa_aviso(query, request)
        result = query.order('criado_em', desc=True).limit(limite).execute()
        return {'historico': result.data or []}
    except Exception:
        return {'historico': []}

@app.post('/api/avisos/modelos')
async def salvar_modelo_aviso(request: Request):
    try:
        data = await request.json(); titulo = data.get('titulo', '').strip(); mensagem = data.get('mensagem', '').strip()
        if not titulo or not mensagem or len(titulo) > 120 or len(mensagem) > 3000: raise ValueError()
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(422, 'Informe título e mensagem válidos.')
    try:
        payload = {'titulo': titulo, 'mensagem': mensagem, 'atualizado_por': request.state.user['id']}
        if NOTICE_TENANT_AVAILABLE:
            payload['empresa_id'] = getattr(request.state, 'empresa_id', DEFAULT_EMPRESA_ID)
        modelo_id = int(data['id']) if data.get('id') else None
        if modelo_id:
            payload['id'] = modelo_id
        existentes = supabase_client.table('avisos_modelos').select('id,titulo').execute().data or []
        if any(str(item.get('titulo', '')).casefold() == titulo.casefold()
               and str(item.get('id')) != str(modelo_id) for item in existentes):
            raise HTTPException(409, 'Já existe uma mensagem com este nome. Escolha outro nome.')
        try:
            supabase_client.table('avisos_modelos').upsert(payload).execute()
        except Exception:
            if 'empresa_id' not in payload:
                raise
            payload.pop('empresa_id', None)
            supabase_client.table('avisos_modelos').upsert(payload).execute()
        registrar_historico_aviso(request, 'mensagem_atualizada' if modelo_id else 'mensagem_criada',
                                  modelo_id=modelo_id, titulo=titulo, mensagem=mensagem)
        return {'mensagem': 'Mensagem salva.'}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, 'Não foi possível salvar a mensagem. Execute a migração de avisos.')

@app.delete('/api/avisos/modelos/{modelo_id}')
async def excluir_modelo_aviso(modelo_id: int, request: Request):
    try:
        existente = (supabase_client.table('avisos_modelos').select('id,titulo,mensagem')
                     .eq('id', modelo_id).maybe_single().execute().data or {})
        supabase_client.table('avisos_modelos').delete().eq('id', modelo_id).execute()
        registrar_historico_aviso(request, 'mensagem_excluida', modelo_id=modelo_id,
                                  titulo=existente.get('titulo', ''), mensagem=existente.get('mensagem', ''))
        return {'mensagem': 'Mensagem excluída.'}
    except Exception:
        raise HTTPException(503, 'Não foi possível excluir a mensagem.')

@app.put('/api/avisos')
async def salvar_aviso(request: Request):
    try:
        data = await request.json()
        mensagem = data.get('mensagem', '')
        bloqueado = data.get('bloqueado')
        acao = data.get('acao') or ('bloqueado' if bloqueado else 'publicado')
        if not isinstance(mensagem, str) or len(mensagem) > 3000 or type(bloqueado) is not bool:
            raise ValueError()
        if acao not in ('publicado', 'bloqueado', 'liberado'):
            raise ValueError()
        if bloqueado and not mensagem.strip():
            raise ValueError()
    except (ValueError, AttributeError):
        raise HTTPException(422, 'Informe uma mensagem de até 3000 caracteres. Bloqueios exigem uma mensagem.')
    if not supabase_client:
        raise HTTPException(503, 'Banco indisponível.')
    try:
        payload = {'mensagem': mensagem.strip(),
            'bloqueado': bloqueado, 'atualizado_por': request.state.user['id'],
            'atualizado_em': datetime.now(timezone.utc).isoformat()}
        if NOTICE_TENANT_AVAILABLE:
            payload['empresa_id'] = getattr(request.state, 'empresa_id', DEFAULT_EMPRESA_ID)
            existente = (supabase_client.table('avisos_operacao').select('id')
                          .eq('empresa_id', payload['empresa_id']).order('atualizado_em', desc=True)
                          .limit(1).execute().data or [])
            if existente:
                payload['id'] = existente[0].get('id')
        else:
            payload['id'] = 1
        try:
            supabase_client.table('avisos_operacao').upsert(payload).execute()
        except Exception:
            if 'empresa_id' not in payload:
                raise
            payload.pop('empresa_id', None)
            payload['id'] = 1
            supabase_client.table('avisos_operacao').upsert(payload).execute()
        registrar_historico_aviso(request, acao, mensagem=mensagem.strip(), bloqueado=bloqueado)
        return {'mensagem': 'Aviso atualizado.'}
    except Exception:
        raise HTTPException(503, 'Não foi possível salvar o aviso.')

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

DEFAULT_EMPRESA_ID = os.getenv("DEFAULT_EMPRESA_ID", "00000000-0000-0000-0000-000000000001").strip()
TENANT_COLUMN_AVAILABLE = False
REPORT_STATUS_AVAILABLE = False
NOTICE_TENANT_AVAILABLE = False
AUDIT_TENANT_AVAILABLE = False
EMPRESA_TABLE_AVAILABLE = False

PERMISSIONS = {
    "gestor": {
        "consultar_relatorios": True, "enviar_relatorios": True,
        "gerenciar_usuarios": True, "gerenciar_avisos": True,
        "gerenciar_banco": True, "consultar_auditoria": True,
        "gerenciar_empresas": True, "baixar_backup": True,
    },
    "apoio": {
        "consultar_relatorios": True, "enviar_relatorios": True,
        "gerenciar_usuarios": False, "gerenciar_avisos": True,
        "gerenciar_banco": False, "consultar_auditoria": True,
        "gerenciar_empresas": False, "baixar_backup": False,
    },
    "tecnico": {
        "consultar_relatorios": False, "enviar_relatorios": True,
        "gerenciar_usuarios": False, "gerenciar_avisos": False,
        "gerenciar_banco": False, "consultar_auditoria": False,
        "gerenciar_empresas": False, "baixar_backup": False,
    },
}

def permissoes_para(role: str):
    return {"role": role, **PERMISSIONS.get(role, PERMISSIONS["tecnico"])}

def _metadata_usuario(user: dict):
    metadata = {}
    metadata.update(user.get("user_metadata") or {})
    metadata.update(user.get("app_metadata") or {})
    return metadata

def empresa_id_do_usuario(user: dict, requested: str = None):
    metadata = _metadata_usuario(user or {})
    claimed = metadata.get("empresa_id") or metadata.get("tenant_id") or DEFAULT_EMPRESA_ID
    try:
        claimed = str(UUID(str(claimed)))
    except (ValueError, TypeError, AttributeError):
        claimed = DEFAULT_EMPRESA_ID
    try:
        requested_id = str(UUID(str(requested))) if requested else None
    except (ValueError, TypeError, AttributeError):
        requested_id = None
    if not requested_id or requested_id == claimed:
        return claimed
    if not (supabase_client and EMPRESA_TABLE_AVAILABLE and (user or {}).get("id")):
        return claimed
    try:
        membership = (supabase_client.table("usuarios_empresas")
                      .select("empresa_id")
                      .eq("usuario_id", user["id"])
                      .eq("empresa_id", requested_id)
                      .eq("ativo", True).limit(1).execute())
        if membership.data:
            return requested_id
    except Exception:
        logger.info("Validação de empresa indisponível; mantendo empresa padrão.")
    return claimed

def aplicar_empresa(query, empresa_id):
    return query.eq("empresa_id", empresa_id) if TENANT_COLUMN_AVAILABLE and empresa_id else query

def aplicar_empresa_aviso(query, request=None):
    if NOTICE_TENANT_AVAILABLE:
        return query.eq("empresa_id", getattr(getattr(request, "state", None), "empresa_id", DEFAULT_EMPRESA_ID))
    return query

def aplicar_empresa_auditoria(query, request=None):
    if AUDIT_TENANT_AVAILABLE:
        return query.eq("empresa_id", getattr(getattr(request, "state", None), "empresa_id", DEFAULT_EMPRESA_ID))
    return query

def init_supabase():
    global supabase_client, TENANT_COLUMN_AVAILABLE, REPORT_STATUS_AVAILABLE
    global NOTICE_TENANT_AVAILABLE, AUDIT_TENANT_AVAILABLE, EMPRESA_TABLE_AVAILABLE
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        logger.warning("⚠️ Supabase não configurado")
        return
    try:
        from supabase import create_client
        supabase_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        probes = (
            ("relatorios", "empresa_id", "TENANT_COLUMN_AVAILABLE"),
            ("relatorios", "status_envio,tentativas_envio,ultima_tentativa_em,sincronizado_em,erro_envio,origem_envio", "REPORT_STATUS_AVAILABLE"),
            ("avisos_operacao", "empresa_id", "NOTICE_TENANT_AVAILABLE"),
            ("auditoria_gestao", "empresa_id", "AUDIT_TENANT_AVAILABLE"),
            ("empresas", "id", "EMPRESA_TABLE_AVAILABLE"),
        )
        for table_name, fields, flag_name in probes:
            try:
                supabase_client.table(table_name).select(fields).limit(1).execute()
                globals()[flag_name] = True
            except Exception:
                logger.info("Recurso opcional indisponível: %s.%s", table_name, fields)
        logger.info("✅ Supabase conectado")
    except Exception as e:
        logger.error(f"❌ Erro ao conectar ao Supabase: {e}")

COLUNAS_EXTRAS = {"latitude", "longitude", "user_id", "endereco"}
EVIDENCIAS_BUCKET = "relatorio-evidencias"
MAX_IMAGENS_POR_ENVIO = 10
MAX_IMAGENS_POR_RELATORIO = 30
MAX_TAMANHO_IMAGEM = 8 * 1024 * 1024
MAX_TAMANHO_TOTAL_IMAGENS = 50 * 1024 * 1024
TIPOS_IMAGEM = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/avif": ".avif"
}

def detectar_possivel_duplicado(dados: dict) -> bool:
    """Sinaliza possíveis reenvios recentes sem bloquear o técnico."""
    if not supabase_client:
        return False
    try:
        corte = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
        result = (supabase_client.table("relatorios").select("id")
                  .eq("user_id", dados.get("user_id"))
                  .eq("situacao_encontrada", dados.get("situacao_encontrada", ""))
                  .eq("resolucao_problema", dados.get("resolucao_problema", ""))
                  .gte("criado_em", corte).limit(1).execute())
        return bool(result.data)
    except Exception:
        logger.info("Detecção de duplicidade indisponível; envio mantido.")
        return False

def salvar_relatorio(dados: dict):
    if not supabase_client:
        raise HTTPException(503, "Banco indisponível. Preserve o rascunho e tente novamente.")
    payload = dict(dados)
    # Mantém compatibilidade com instalações que ainda não aplicaram a migração de operação.
    if not TENANT_COLUMN_AVAILABLE:
        payload.pop("empresa_id", None)
    if not REPORT_STATUS_AVAILABLE:
        for key in ("status_envio", "tentativas_envio", "ultima_tentativa_em",
                    "sincronizado_em", "erro_envio", "origem_envio"):
            payload.pop(key, None)
    opcionais = ("empresa_id", "status_envio", "tentativas_envio", "ultima_tentativa_em",
                 "sincronizado_em", "erro_envio", "origem_envio")
    try:
        result = supabase_client.table("relatorios").upsert(
            payload, on_conflict="id", ignore_duplicates=True).execute()
        if result.data:
            return True
        existing = (supabase_client.table("relatorios").select("id,user_id")
                    .eq("id", payload["id"]).execute())
        if not existing.data or existing.data[0].get("user_id") != payload["user_id"]:
            raise HTTPException(409, "Identificador de envio já utilizado.")
        return False
    except HTTPException:
        raise
    except Exception as exc:
        optional_present = [key for key in opcionais if key in payload]
        if optional_present and any(key in str(exc).lower() for key in optional_present):
            for key in optional_present:
                payload.pop(key, None)
            try:
                result = supabase_client.table("relatorios").upsert(
                    payload, on_conflict="id", ignore_duplicates=True).execute()
                if result.data:
                    return True
                existing = (supabase_client.table("relatorios").select("id,user_id")
                            .eq("id", payload["id"]).execute())
                if not existing.data or existing.data[0].get("user_id") != payload["user_id"]:
                    raise HTTPException(409, "Identificador de envio já utilizado.")
                return False
            except HTTPException:
                raise
            except Exception:
                pass
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

@app.get("/devel", response_class=HTMLResponse)
async def devel_redirect():
    return RedirectResponse("/tecnico", status_code=307,
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})

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

        possivel_duplicado = detectar_possivel_duplicado({
            "user_id": user_id, "situacao_encontrada": relatorio_texto,
            "resolucao_problema": problema_tecnico,
        })
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
            "empresa_id":           getattr(request.state, "empresa_id", DEFAULT_EMPRESA_ID),
            "status_envio":         "sincronizado",
            "tentativas_envio":     1,
            "ultima_tentativa_em":  datetime.now(timezone.utc).isoformat(),
            "sincronizado_em":      datetime.now(timezone.utc).isoformat(),
            "erro_envio":           None,
            "origem_envio":         "online",
        })

        logger.info("Relatório persistido")
        resumo = relatorio[:400] + "..." if len(relatorio) > 400 else relatorio
        if created:
            background_tasks.add_task(notificar_whatsapp, tecnico, resumo)
        return JSONResponse(content={"relatorio": relatorio, "salvo": True, "id": data["request_id"], "possivel_duplicado": possivel_duplicado})

    except HTTPException:
        raise
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Formato inválido: {str(e)}")
    except Exception:
        logger.exception("Falha ao salvar relatório no Supabase")
        raise HTTPException(status_code=503, detail="Não foi possível salvar no Supabase. Verifique a conexão; o formulário permanece preservado para tentar novamente.")

# === API RELATÓRIOS ===

@app.get("/api/operacao/resumo")
async def resumo_operacao(request: Request, inicio: date = None, fim: date = None,
                          tecnico: str = Query(None, max_length=200)):
    if inicio and fim and inicio > fim:
        raise HTTPException(422, "A data inicial deve ser anterior ou igual à final.")
    if not supabase_client:
        raise HTTPException(503, "Banco de dados não configurado.")
    brasil = timezone(BRASIL_OFFSET)
    try:
        fields = "id,criado_em,tecnico,equipamento_status,maior_sinal,latitude,longitude"
        if REPORT_STATUS_AVAILABLE:
            fields += ",status_envio,erro_envio,tentativas_envio,ultima_tentativa_em"
        rows = []
        start = 0
        while True:
            query = aplicar_empresa(supabase_client.table("relatorios").select(fields),
                                    getattr(request.state, "empresa_id", DEFAULT_EMPRESA_ID))
            if tecnico:
                query = query.eq("tecnico", tecnico.strip())
            if inicio:
                query = query.gte("criado_em", datetime.combine(inicio, time.min, tzinfo=brasil).isoformat())
            if fim:
                query = query.lt("criado_em", datetime.combine(fim + timedelta(days=1), time.min, tzinfo=brasil).isoformat())
            batch = (query.order("criado_em", desc=True).order("id", desc=True)
                     .range(start, start + 999).execute().data or [])
            rows.extend(batch)
            if len(batch) < 1000:
                break
            start += 1000
        image_counts = {}
        for pos in range(0, len(rows), 500):
            ids = [row.get("id") for row in rows[pos:pos + 500] if row.get("id")]
            if not ids:
                continue
            image_rows = (supabase_client.table("relatorio_imagens")
                          .select("relatorio_id").in_("relatorio_id", ids).execute().data or [])
            for image in image_rows:
                rid = image.get("relatorio_id")
                image_counts[rid] = image_counts.get(rid, 0) + 1
        por_tecnico, por_dia = {}, {}
        com_fotos = com_localizacao = pendentes = falhas = pendentes_envio = sincronizados = 0
        for row in rows:
            rid = row.get("id")
            fotos = image_counts.get(rid, 0)
            localizado = (isinstance(row.get("latitude"), (int, float))
                          and isinstance(row.get("longitude"), (int, float))
                          and -90 <= row.get("latitude") <= 90 and -180 <= row.get("longitude") <= 180)
            completo = bool(row.get("equipamento_status") and row.get("maior_sinal") and localizado and fotos > 0)
            status_envio = str(row.get("status_envio") or "sincronizado").lower()
            falhas += int(status_envio == "erro")
            pendentes_envio += int(status_envio in ("pendente", "pendente_fotos", "processando"))
            sincronizados += int(status_envio == "sincronizado")
            criado = row.get("criado_em")
            if criado:
                try:
                    dia = datetime.fromisoformat(str(criado).replace("Z", "+00:00")).astimezone(brasil).date().isoformat()
                    por_dia[dia] = por_dia.get(dia, 0) + 1
                except (TypeError, ValueError):
                    pass
            nome = (row.get("tecnico") or "Não informado").strip() or "Não informado"
            item = por_tecnico.setdefault(nome, {"tecnico": nome, "total": 0, "completos": 0, "pendentes": 0})
            item["total"] += 1
            item["completos"] += int(completo)
            item["pendentes"] += int(not completo)
            com_fotos += int(fotos > 0)
            com_localizacao += int(localizado)
            pendentes += int(not completo)
        return {
            "total": len(rows), "com_fotos": com_fotos, "com_localizacao": com_localizacao,
            "pendentes": pendentes, "falhas": falhas, "pendentes_envio": pendentes_envio,
            "sincronizados": sincronizados, "status_disponivel": REPORT_STATUS_AVAILABLE,
            "por_tecnico": sorted(por_tecnico.values(), key=lambda item: (-item["total"], item["tecnico"].casefold())),
            "por_dia": [{"dia": dia, "total": total} for dia, total in sorted(por_dia.items())]
        }
    except HTTPException:
        raise
    except Exception:
        logger.exception("Falha ao calcular resumo operacional")
        raise HTTPException(503, "Resumo operacional indisponível. Verifique a conexão com o Supabase.")

@app.get("/api/relatorios")
async def listar_relatorios(
    request: Request,
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
        fields = (
            "id,criado_em,tecnico,equipamento_status,maior_sinal,"
            "check_sinal_fibra,check_serial,check_cto,check_panoramica,"
            "check_sobra,check_metragem,check_velocidade,check_local_ont,check_frente,"
            "latitude,longitude,user_id"
        )
        if REPORT_STATUS_AVAILABLE:
            fields += ",status_envio,erro_envio,tentativas_envio,ultima_tentativa_em,sincronizado_em,origem_envio"
        query = aplicar_empresa(supabase_client.table("relatorios").select(fields, count="exact"),
                                getattr(request.state, "empresa_id", DEFAULT_EMPRESA_ID))
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
        rows = result.data or []
        image_counts = {}
        try:
            ids = [row.get("id") for row in rows if row.get("id")]
            if ids:
                image_rows = (supabase_client.table("relatorio_imagens")
                              .select("relatorio_id").in_("relatorio_id", ids).execute().data or [])
                for image in image_rows:
                    image_counts[image.get("relatorio_id")] = image_counts.get(image.get("relatorio_id"), 0) + 1
        except Exception:
            logger.info("Contagem de imagens indisponível; mantendo relatórios sem esse indicador.")
        for row in rows:
            row["imagens_count"] = image_counts.get(row.get("id"), 0)
            row.setdefault("status_envio", "sincronizado")
            row.setdefault("tentativas_envio", 0)
        total = result.count if result.count is not None else offset + len(rows)
        return JSONResponse(content={
            "relatorios": rows, "total": total, "offset": offset,
            "limite": limite, "has_more": offset + len(rows) < total,
            "status_disponivel": REPORT_STATUS_AVAILABLE,
        })
    except HTTPException:
        raise
    except Exception:
        logger.exception("Falha ao consultar relatórios")
        raise HTTPException(503, "Não foi possível consultar os relatórios. Tente novamente.")

@app.get("/api/permissoes")
async def obter_permissoes(request: Request):
    user = getattr(request.state, "user", {}) or {}
    return permissoes_para(role_of(user))

@app.post("/api/relatorios/{relatorio_id}/reprocessar")
async def reprocessar_relatorio(relatorio_id: UUID, request: Request):
    if not supabase_client:
        raise HTTPException(503, "Banco de dados não configurado.")
    if not REPORT_STATUS_AVAILABLE:
        return JSONResponse(content={
            "reprocessado": False,
            "status": "indisponivel",
            "mensagem": "Execute a migração de operação no Supabase para habilitar a fila de reprocessamento."
        }, status_code=409)
    try:
        query = aplicar_empresa(
            supabase_client.table("relatorios").update({
                "status_envio": "pendente",
                "tentativas_envio": 0,
                "ultima_tentativa_em": datetime.now(timezone.utc).isoformat(),
                "erro_envio": None,
                "origem_envio": "reprocessamento",
            }).eq("id", str(relatorio_id)),
            getattr(request.state, "empresa_id", DEFAULT_EMPRESA_ID)
        )
        result = query.execute()
        if not result.data:
            raise HTTPException(404, "Relatório não encontrado nesta empresa.")
        return {"reprocessado": True, "status": "pendente", "id": str(relatorio_id)}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Falha ao reprocessar relatório")
        raise HTTPException(503, "Não foi possível colocar o relatório na fila novamente.")

@app.get("/api/empresas")
async def listar_empresas(request: Request):
    if not supabase_client or not EMPRESA_TABLE_AVAILABLE:
        return {"empresas": [{"id": DEFAULT_EMPRESA_ID, "nome": "Empresa principal", "slug": "principal", "ativo": True}]}
    try:
        query = supabase_client.table("empresas").select("id,nome,slug,ativo,criado_em")
        if role_of(getattr(request.state, "user", {}) or {}) != "gestor":
            query = query.eq("id", getattr(request.state, "empresa_id", DEFAULT_EMPRESA_ID))
        result = query.eq("ativo", True).order("nome").execute()
        return {"empresas": result.data or []}
    except Exception:
        logger.exception("Falha ao consultar empresas")
        raise HTTPException(503, "Empresas indisponíveis. Execute a migração de operação.")

@app.post("/api/empresas")
async def criar_empresa(request: Request):
    if not supabase_client or not EMPRESA_TABLE_AVAILABLE:
        raise HTTPException(409, "Execute a migração de operação no Supabase antes de criar empresas.")
    try:
        data = await request.json()
        nome = data.get("nome", "").strip() if isinstance(data, dict) else ""
        slug = data.get("slug", "").strip().lower() if isinstance(data, dict) else ""
        if not nome or len(nome) > 120:
            raise ValueError()
        slug = re.sub(r"[^a-z0-9]+", "-", slug or nome.lower()).strip("-")[:80]
        if len(slug) < 2:
            raise ValueError()
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(422, "Informe um nome e um identificador válidos.")
    try:
        actor = request.state.user
        result = supabase_client.table("empresas").insert({
            "nome": nome, "slug": slug, "ativo": True,
            "criado_por": actor.get("id"),
        }).execute()
        empresa = (result.data or [{}])[0]
        if empresa.get("id") and actor.get("id"):
            try:
                supabase_client.table("usuarios_empresas").upsert({
                    "usuario_id": actor["id"], "empresa_id": empresa["id"], "papel": "gestor", "ativo": True,
                }).execute()
            except Exception:
                logger.info("Vínculo inicial de empresa indisponível.")
        return JSONResponse(content={"empresa": empresa}, status_code=201)
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(409, "Já existe uma empresa com esse identificador.")
        logger.exception("Falha ao criar empresa")
        raise HTTPException(503, "Não foi possível criar a empresa.")

@app.get("/api/backup")
async def gerar_backup(request: Request, formato: str = Query("json", pattern="^(json|csv|zip)$"),
                       incluir_imagens: bool = Query(False)):
    if not supabase_client:
        raise HTTPException(503, "Banco de dados não configurado.")
    empresa_id = getattr(request.state, "empresa_id", DEFAULT_EMPRESA_ID)
    try:
        query = aplicar_empresa(supabase_client.table("relatorios").select("*"), empresa_id)
        relatorios = query.order("criado_em", desc=True).limit(5000).execute().data or []
        ids = [item.get("id") for item in relatorios if item.get("id")]
        imagens = []
        if ids:
            imagens = (supabase_client.table("relatorio_imagens")
                       .select("id,relatorio_id,criado_em,nome_original,tipo,tamanho_bytes,caminho")
                       .in_("relatorio_id", ids).order("criado_em").execute().data or [])
        criado = datetime.now(timezone.utc).isoformat()
        nome_base = f"linkce-backup-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
        if formato == "json":
            return JSONResponse(content={"gerado_em": criado, "empresa_id": empresa_id,
                                         "relatorios": relatorios, "imagens": imagens})
        campos = ["id", "criado_em", "tecnico", "equipamento_status", "maior_sinal",
                  "latitude", "longitude", "status_envio", "erro_envio", "tentativas_envio"]
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=campos, extrasaction="ignore")
        writer.writeheader()
        for row in relatorios:
            writer.writerow({key: row.get(key, "") for key in campos})
        if formato == "csv":
            return StreamingResponse(iter([output.getvalue()]), media_type="text/csv; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="{nome_base}.csv"'})
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as arquivo_zip:
            arquivo_zip.writestr("relatorios.csv", output.getvalue())
            arquivo_zip.writestr("relatorios.json", json.dumps(relatorios, ensure_ascii=False, default=str, indent=2))
            arquivo_zip.writestr("imagens.json", json.dumps(imagens, ensure_ascii=False, default=str, indent=2))
            if incluir_imagens:
                baixadas = 0
                for imagem in imagens[:100]:
                    caminho = imagem.get("caminho")
                    if not caminho:
                        continue
                    try:
                        conteudo = supabase_client.storage.from_(EVIDENCIAS_BUCKET).download(caminho)
                        if conteudo:
                            seguro = os.path.basename(str(imagem.get("nome_original") or caminho))
                            arquivo_zip.writestr(f"imagens/{imagem.get('relatorio_id')}/{seguro}", conteudo)
                            baixadas += 1
                    except Exception:
                        logger.info("Imagem %s não entrou no backup.", imagem.get("id"))
                arquivo_zip.writestr("imagens-status.txt", f"{baixadas} imagens incluídas; limite de 100 por backup.")
        buffer.seek(0)
        return StreamingResponse(iter([buffer.getvalue()]), media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{nome_base}.zip"'})
    except HTTPException:
        raise
    except Exception:
        logger.exception("Falha ao gerar backup")
        raise HTTPException(503, "Não foi possível gerar o backup. Tente novamente.")

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
            "app_metadata": {"role": cargo, "empresa_id": getattr(request.state, "empresa_id", DEFAULT_EMPRESA_ID)},
            "email_confirm": True,
        })
        if EMPRESA_TABLE_AVAILABLE and result.user and getattr(request.state, "empresa_id", None):
            try:
                supabase_client.table("usuarios_empresas").upsert({
                    "usuario_id": result.user.id, "empresa_id": request.state.empresa_id,
                    "papel": cargo, "ativo": True,
                }).execute()
            except Exception:
                logger.info("Vínculo do novo usuário à empresa indisponível.")
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

def _admin_client():
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise HTTPException(status_code=503, detail="Serviço de usuários não configurado no servidor.")
    try:
        from supabase import create_client
        return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    except Exception:
        logger.exception("Falha ao iniciar o serviço administrativo de usuários")
        raise HTTPException(status_code=503, detail="Serviço de usuários indisponível. Tente novamente.")

def _find_user_by_email(admin, email: str):
    try:
        users_result = admin.auth.admin.list_users(page=1, per_page=1000)
        users = getattr(users_result, "users", users_result)
        for user in users or []:
            if getattr(user, "email", "").lower() == email.lower():
                return user
    except Exception:
        logger.exception("Falha ao consultar usuários para redefinição de senha")
        raise HTTPException(status_code=503, detail="Não foi possível consultar os usuários cadastrados.")
    raise HTTPException(status_code=404, detail="Nenhuma conta cadastrada com este email.")


@app.get("/api/seguranca/auditoria")
async def consultar_auditoria(
    request: Request,
    limite: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0, le=1000000),
    usuario_email: str = Query(None, max_length=254),
    acao: str = Query(None, max_length=120),
    resultado: str = Query(None, max_length=40),
    inicio: date = None,
    fim: date = None,
):
    if not supabase_client:
        raise HTTPException(503, "Banco de dados não configurado.")
    try:
        query = (supabase_client.table("auditoria_gestao")
                 .select("id,acao,metodo,rota,resultado,usuario_email,usuario_id,empresa_id,criado_em", count="exact"))
        query = aplicar_empresa_auditoria(query, request)
        if usuario_email:
            query = query.ilike("usuario_email", f"%{usuario_email.strip()}%")
        if acao:
            query = query.ilike("acao", f"%{acao.strip()}%")
        if resultado:
            query = query.eq("resultado", resultado.strip())
        brasil = timezone(BRASIL_OFFSET)
        if inicio:
            query = query.gte("criado_em", datetime.combine(inicio, time.min, tzinfo=brasil).isoformat())
        if fim:
            query = query.lt("criado_em", datetime.combine(fim + timedelta(days=1), time.min, tzinfo=brasil).isoformat())
        result = (query.order("criado_em", desc=True)
                  .range(offset, offset + limite - 1).execute())
        total = result.count if result.count is not None else offset + len(result.data or [])
        return {"auditoria": result.data or [], "offset": offset, "limite": limite,
                "total": total, "has_more": offset + len(result.data or []) < total}
    except Exception as exc:
        # Older installations may not yet have empresa_id; retry with the stable columns.
        if "empresa_id" in str(exc).lower():
            try:
                query = (supabase_client.table("auditoria_gestao")
                         .select("id,acao,metodo,rota,resultado,usuario_email,usuario_id,criado_em", count="exact"))
                if usuario_email:
                    query = query.ilike("usuario_email", f"%{usuario_email.strip()}%")
                if acao:
                    query = query.ilike("acao", f"%{acao.strip()}%")
                if resultado:
                    query = query.eq("resultado", resultado.strip())
                result = query.order("criado_em", desc=True).range(offset, offset + limite - 1).execute()
                total = result.count if result.count is not None else offset + len(result.data or [])
                return {"auditoria": result.data or [], "offset": offset, "limite": limite,
                        "total": total, "has_more": offset + len(result.data or []) < total}
            except Exception:
                pass
        logger.exception("Falha ao consultar auditoria da gestão")
        raise HTTPException(503, "Auditoria indisponível. Execute a migração de segurança no Supabase.")

@app.get("/api/seguranca/historico-senhas")
async def historico_senhas(limite: int = Query(30, ge=1, le=100)):
    if not supabase_client:
        raise HTTPException(status_code=503, detail="Banco de dados não configurado.")
    try:
        result = supabase_client.table("historico_redefinicao_senhas").select(
            "id,criado_em,gestor_email,usuario_email,motivo"
        ).order("criado_em", desc=True).limit(limite).execute()
        return JSONResponse(content={"historico": result.data or []})
    except Exception:
        logger.exception("Falha ao consultar histórico de senhas")
        raise HTTPException(status_code=503, detail="Histórico indisponível. Execute a migração de segurança no Supabase.")

@app.post("/api/seguranca/redefinir-senha")
async def redefinir_senha(request: Request):
    try:
        data = await request.json()
        if not isinstance(data, dict):
            raise HTTPException(status_code=422, detail="Dados de redefinição inválidos.")
        email = data.get("email", "").strip().lower() if isinstance(data.get("email"), str) else ""
        senha = data.get("senha", "") if isinstance(data.get("senha"), str) else ""
        motivo = data.get("motivo", "").strip() if isinstance(data.get("motivo", ""), str) else ""
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise HTTPException(status_code=422, detail="Informe um email válido.")
        if not 12 <= len(senha) <= 128:
            raise HTTPException(status_code=422, detail="A senha deve conter de 12 a 128 caracteres.")
        if len(motivo) > 300:
            raise HTTPException(status_code=422, detail="O motivo pode ter até 300 caracteres.")
        if not supabase_client:
            raise HTTPException(status_code=503, detail="Banco de dados não configurado.")

        # Validate the audit table before changing credentials: every manager action must be auditable.
        supabase_client.table("historico_redefinicao_senhas").select("id", head=True).limit(1).execute()
        admin = _admin_client()
        target = _find_user_by_email(admin, email)
        actor = request.state.user
        actor_email = actor.get("email", "")
        if not actor_email:
            raise HTTPException(status_code=401, detail="Sessão sem email válido.")
        admin.auth.admin.update_user_by_id(target.id, {"password": senha})
        supabase_client.table("historico_redefinicao_senhas").insert({
            "gestor_id": actor["id"], "gestor_email": actor_email.lower(),
            "usuario_id": target.id, "usuario_email": email, "motivo": motivo or None,
        }).execute()
        logger.info("Senha redefinida por gestor; auditoria registrada")
        return JSONResponse(content={"mensagem": "Senha redefinida e registrada no histórico.", "email": email})
    except HTTPException:
        raise
    except Exception:
        logger.exception("Falha na redefinição de senha pelo gestor")
        raise HTTPException(status_code=503, detail="Não foi possível redefinir a senha. Tente novamente.")

@app.get("/api/relatorios/{relatorio_id}")
async def get_relatorio(relatorio_id: str, request: Request):
    if not supabase_client:
        raise HTTPException(status_code=503, detail="Banco de dados não configurado")
    try:
        query = aplicar_empresa(supabase_client.table("relatorios").select("*").eq("id", relatorio_id),
                                getattr(request.state, "empresa_id", DEFAULT_EMPRESA_ID))
        result = query.single().execute()
        return JSONResponse(content=result.data)
    except Exception as e:
        raise HTTPException(status_code=404, detail="Relatório não encontrado")


def _buscar_relatorio_evidencia(relatorio_id: UUID, request: Request = None):
    if not supabase_client:
        raise HTTPException(503, "Banco de dados não configurado.")
    try:
        query = aplicar_empresa(supabase_client.table("relatorios").select("id,user_id").eq("id", str(relatorio_id)),
                                getattr(getattr(request, "state", None), "empresa_id", DEFAULT_EMPRESA_ID))
        result = query.single().execute()
        if not result.data:
            raise HTTPException(404, "Relatório não encontrado.")
        return result.data
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(404, "Relatório não encontrado.")


def _url_assinada_evidencia(path: str):
    try:
        result = supabase_client.storage.from_(EVIDENCIAS_BUCKET).create_signed_url(path, 3600)
        data = getattr(result, "data", result)
        url = data.get("signedURL") or data.get("signed_url")
        if not url:
            raise ValueError("URL de imagem ausente")
        return url
    except Exception:
        logger.exception("Falha ao assinar URL de evidência")
        raise HTTPException(503, "Não foi possível abrir as imagens agora.")


@app.get("/api/relatorios/{relatorio_id}/imagens")
async def listar_imagens_relatorio(relatorio_id: UUID, request: Request):
    _buscar_relatorio_evidencia(relatorio_id, request)
    try:
        result = supabase_client.table("relatorio_imagens").select(
            "id,criado_em,nome_original,tipo,tamanho_bytes,caminho"
        ).eq("relatorio_id", str(relatorio_id)).order("criado_em").execute()
        imagens = []
        for imagem in result.data or []:
            imagens.append({
                "id": imagem["id"], "criado_em": imagem["criado_em"],
                "nome": imagem["nome_original"], "tipo": imagem["tipo"],
                "tamanho_bytes": imagem["tamanho_bytes"],
                "url": _url_assinada_evidencia(imagem["caminho"]),
            })
        return {"imagens": imagens}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Falha ao listar evidências")
        raise HTTPException(503, "Imagens indisponíveis. Execute a migração de evidências no Supabase.")


@app.post("/api/relatorios/{relatorio_id}/imagens")
async def adicionar_imagens_relatorio(relatorio_id: UUID, request: Request, arquivos: list[UploadFile] = File(...)):
    relatorio = _buscar_relatorio_evidencia(relatorio_id, request)
    role = role_of(request.state.user)
    if role not in ("gestor", "apoio") and relatorio.get("user_id") != request.state.user.get("id"):
        raise HTTPException(403, "Você só pode anexar imagens aos seus próprios relatórios.")
    arquivos = [arquivo for arquivo in arquivos if arquivo and arquivo.filename]
    if not arquivos or len(arquivos) > MAX_IMAGENS_POR_ENVIO:
        raise HTTPException(422, f"Envie de 1 a {MAX_IMAGENS_POR_ENVIO} imagens por vez.")
    try:
        existentes = (supabase_client.table("relatorio_imagens")
                      .select("id,tamanho_bytes")
                      .eq("relatorio_id", str(relatorio_id))
                      .execute().data or [])
        if len(existentes) + len(arquivos) > MAX_IMAGENS_POR_RELATORIO:
            raise HTTPException(422, f"Cada relatório aceita até {MAX_IMAGENS_POR_RELATORIO} imagens.")
        uploads = []
        tamanho_total = sum(int(item.get("tamanho_bytes") or 0) for item in existentes)
        for arquivo in arquivos:
            tipo = (arquivo.content_type or "").lower()
            if tipo not in TIPOS_IMAGEM:
                raise HTTPException(422, "Formato inválido. Use JPG, PNG, WEBP ou AVIF.")
            conteudo = await arquivo.read()
            if not conteudo or len(conteudo) > MAX_TAMANHO_IMAGEM:
                raise HTTPException(422, "Cada imagem deve ter no máximo 8 MB.")
            tamanho_total += len(conteudo)
            if tamanho_total > MAX_TAMANHO_TOTAL_IMAGENS:
                raise HTTPException(422, "O relatório pode armazenar no máximo 50 MB em imagens.")
            uploads.append((arquivo, tipo, conteudo))
        salvas = []
        for arquivo, tipo, conteudo in uploads:
            caminho = f"{relatorio_id}/{uuid4().hex}{TIPOS_IMAGEM[tipo]}"
            supabase_client.storage.from_(EVIDENCIAS_BUCKET).upload(
                caminho, conteudo, file_options={"content-type": tipo, "upsert": "false"}
            )
            try:
                registro = supabase_client.table("relatorio_imagens").insert({
                    "relatorio_id": str(relatorio_id), "caminho": caminho,
                    "nome_original": os.path.basename(arquivo.filename)[:255],
                    "tipo": tipo, "tamanho_bytes": len(conteudo),
                    "enviado_por": request.state.user["id"],
                }).execute()
                salvas.append(registro.data[0])
            except Exception:
                supabase_client.storage.from_(EVIDENCIAS_BUCKET).remove([caminho])
                raise
        logger.info("%s evidência(s) anexada(s) ao relatório %s", len(salvas), relatorio_id)
        return {"salvas": len(salvas), "tamanho_total_bytes": tamanho_total}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Falha ao salvar evidências")
        raise HTTPException(503, "Não foi possível salvar as imagens. Tente novamente.")


@app.delete("/api/relatorios/{relatorio_id}/imagens/{imagem_id}")
async def excluir_imagem_relatorio(relatorio_id: UUID, imagem_id: UUID, request: Request):
    relatorio = _buscar_relatorio_evidencia(relatorio_id, request)
    role = role_of(request.state.user)
    if role not in ("gestor", "apoio") and relatorio.get("user_id") != request.state.user.get("id"):
        raise HTTPException(403, "Você só pode alterar imagens dos seus próprios relatórios.")
    try:
        result = supabase_client.table("relatorio_imagens").select("id,caminho").eq("id", str(imagem_id)).eq("relatorio_id", str(relatorio_id)).single().execute()
        if not result.data:
            raise HTTPException(404, "Imagem não encontrada.")
        supabase_client.table("relatorio_imagens").delete().eq("id", str(imagem_id)).eq("relatorio_id", str(relatorio_id)).execute()
        try:
            supabase_client.storage.from_(EVIDENCIAS_BUCKET).remove([result.data["caminho"]])
        except Exception:
            logger.warning("Registro excluído, mas o arquivo físico não foi removido")
        return {"excluida": True}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Falha ao excluir evidência")
        raise HTTPException(503, "Não foi possível excluir a imagem.")

@app.put("/api/relatorios/{relatorio_id}/imagens/{imagem_id}")
async def substituir_imagem_relatorio(relatorio_id: UUID, imagem_id: UUID, request: Request, arquivo: UploadFile = File(...)):
    relatorio = _buscar_relatorio_evidencia(relatorio_id, request)
    role = role_of(request.state.user)
    if role not in ("gestor", "apoio") and relatorio.get("user_id") != request.state.user.get("id"):
        raise HTTPException(403, "Você só pode alterar imagens dos seus próprios relatórios.")
    tipo = (arquivo.content_type or "").lower()
    if tipo not in TIPOS_IMAGEM:
        raise HTTPException(422, "Formato inválido. Use JPG, PNG, WEBP ou AVIF.")
    conteudo = await arquivo.read()
    if not conteudo or len(conteudo) > MAX_TAMANHO_IMAGEM:
        raise HTTPException(422, "Cada imagem deve ter no máximo 8 MB.")
    try:
        old = supabase_client.table("relatorio_imagens").select("id,caminho").eq("id", str(imagem_id)).eq("relatorio_id", str(relatorio_id)).single().execute()
        if not old.data:
            raise HTTPException(404, "Imagem não encontrada.")
        novo_caminho = f"{relatorio_id}/{uuid4().hex}{TIPOS_IMAGEM[tipo]}"
        supabase_client.storage.from_(EVIDENCIAS_BUCKET).upload(novo_caminho, conteudo, file_options={"content-type": tipo, "upsert": "false"})
        try:
            supabase_client.table("relatorio_imagens").update({"caminho": novo_caminho, "nome_original": os.path.basename(arquivo.filename or "evidencia")[:255], "tipo": tipo, "tamanho_bytes": len(conteudo), "enviado_por": request.state.user["id"]}).eq("id", str(imagem_id)).eq("relatorio_id", str(relatorio_id)).execute()
        except Exception:
            supabase_client.storage.from_(EVIDENCIAS_BUCKET).remove([novo_caminho])
            raise
        try:
            supabase_client.storage.from_(EVIDENCIAS_BUCKET).remove([old.data["caminho"]])
        except Exception:
            logger.warning("Imagem antiga não removida após substituição")
        return {"substituida": True}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Falha ao substituir evidência")
        raise HTTPException(503, "Não foi possível substituir a imagem.")

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
    inicio = datetime.now(timezone.utc)
    supabase_status = "não configurado"
    supabase_ok = False
    if supabase_client:
        try:
            supabase_client.table("relatorios").select("id", head=True).limit(1).execute()
            supabase_status, supabase_ok = "conectado", True
        except Exception:
            supabase_status = "indisponível"
    status = "ok" if supabase_ok else "degradado"
    latency_ms = round((datetime.now(timezone.utc) - inicio).total_seconds() * 1000, 2)
    return {
        "status": status, "versao": APP_VERSION, "latencia_ms": latency_ms,
        "timezone": "America/Sao_Paulo (UTC-3)",
        "data_brasil": get_data_brasil(),
        "data_utc": datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M"),
        "materiais_carregados": len(MATERIAIS_CACHE) if MATERIAIS_CACHE else 0,
        "supabase": supabase_status,
        "checks": {
            "supabase": supabase_ok, "materiais": bool(MATERIAIS_CACHE),
            "filtro_empresa": TENANT_COLUMN_AVAILABLE,
            "status_relatorio": REPORT_STATUS_AVAILABLE,
        },
    }

@app.get("/api/saude")
async def saude_detalhada(request: Request):
    resultado = await health_check()
    resultado.update({
        "empresa_id": getattr(request.state, "empresa_id", DEFAULT_EMPRESA_ID),
        "recursos": {
            "filtro_empresa": TENANT_COLUMN_AVAILABLE,
            "status_relatorio": REPORT_STATUS_AVAILABLE,
            "avisos_por_empresa": NOTICE_TENANT_AVAILABLE,
            "auditoria_por_empresa": AUDIT_TENANT_AVAILABLE,
            "multiempresa": EMPRESA_TABLE_AVAILABLE,
        },
        "permissoes": permissoes_para(role_of(getattr(request.state, "user", {}) or {})),
    })
    return resultado

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
