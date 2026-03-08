import os
import json
import logging
from datetime import datetime, timedelta, timezone
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Configurar log
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === TIMEZONE BRASIL (Solução compatível com Vercel) ===
# Brasil = UTC-3 (horário padrão)
# Para horário de verão, ajuste para UTC-2 se necessário
BRASIL_OFFSET = timedelta(hours=-3)

def get_data_brasil():
    """Retorna data/hora formatada no fuso horário do Brasil (UTC-3)"""
    agora_utc = datetime.now(timezone.utc)
    agora_brasil = agora_utc.astimezone(timezone(BRASIL_OFFSET))
    return agora_brasil.strftime("%d/%m/%Y %H:%M")

# Montar static files
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(static_dir):
    app.mount("/static", StaticFiles(directory="static"), name="static")
    print("✅ Static files montados")
else:
    print("⚠️ Pasta 'static' não encontrada - ignorando")

# === CARREGAR MATERIAIS ===
def carregar_materiais():
    """Carrega materiais do arquivo materiais.txt"""
    materiais = []
    try:
        caminho = os.path.join(os.path.dirname(__file__), "materiais.txt")
        
        if not os.path.exists(caminho):
            logger.warning(f"Arquivo não encontrado: {caminho}")
            return [
                {"nome": "CONECTOR APC", "categoria": "Conectores"},
                {"nome": "CABO DROP", "categoria": "Cabos"},
                {"nome": "SPLITER 1x8", "categoria": "Splitters"}
            ]
        
        with open(caminho, "r", encoding="utf-8") as f:
            for linha in f:
                linha = linha.strip()
                if not linha or linha.startswith('#'):
                    continue
                partes = linha.split('|')
                if len(partes) >= 2:
                    materiais.append({
                        "nome": partes[0].strip(),
                        "categoria": partes[1].strip()
                    })
        
        logger.info(f"✅ {len(materiais)} materiais carregados")
        return materiais
        
    except Exception as e:
        logger.error(f"❌ Erro ao carregar materiais: {e}")
        return [
            {"nome": "CONECTOR APC", "categoria": "Conectores"},
            {"nome": "CABO DROP", "categoria": "Cabos"}
        ]

MATERIAIS_CACHE = None

@app.on_event("startup")
async def startup_event():
    global MATERIAIS_CACHE
    MATERIAIS_CACHE = carregar_materiais()
    logger.info(f"🚀 Servidor iniciado - {len(MATERIAIS_CACHE)} materiais")

@app.get("/.well-known/appspecific/com.chrome.devtools.json", include_in_schema=False)
async def devtools_config():
    return JSONResponse(content={})

@app.get("/", response_class=HTMLResponse)
async def index():
    try:
        caminho = os.path.join(os.path.dirname(__file__), "index.html")
        with open(caminho, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    except Exception as e:
        logger.error(f"Erro ao carregar HTML: {e}")
        return HTMLResponse(content=f"<h1>Erro: {e}</h1>", status_code=500)

@app.get("/api/materiais")
async def get_materiais():
    return JSONResponse(content={
        "materiais": MATERIAIS_CACHE,
        "total": len(MATERIAIS_CACHE)
    })

@app.post("/api/materiais/recarregar")
async def recarregar_materiais():
    global MATERIAIS_CACHE
    MATERIAIS_CACHE = carregar_materiais()
    return JSONResponse(content={
        "mensagem": f"{len(MATERIAIS_CACHE)} materiais recarregados",
        "total": len(MATERIAIS_CACHE)
    })

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

@app.post("/gerar_relatorio")
async def gerar_relatorio(request: Request):
    try:
        body = await request.body()
        data = json.loads(body)
        
        tecnico = data.get("tecnico", "").strip()
        relatorio_texto = data.get("relatorio_texto", "").strip()
        problema_tecnico = data.get("problema_tecnico", "").strip()
        equipamento_status = data.get("equipamento_status", "").strip()
        equipamento_obs = data.get("equipamento_obs", "").strip()
        maior_sinal = data.get("maior_sinal", "").strip()
        materiais_utilizados = data.get("materiais_utilizados", "").strip()
        materiais_recolhidos = data.get("materiais_recolhidos", "").strip()

        # ✅ DATA/HORA DO BRASIL (UTC-3)
        data_atual = get_data_brasil()

        relatorio = f"""
=====================================
Relatório Técnico - {data_atual}
=====================================
                                
> Técnico: {tecnico}              
                                

Problema encontrado:
{relatorio_texto}

Resolução do Problema:
{problema_tecnico}

Equipamento: {equipamento_status}
OBS: {equipamento_obs}

Maior sinal de RSSI: {maior_sinal}

Materiais Utilizados:
{materiais_utilizados if materiais_utilizados else "Nenhum"}

Materiais Recolhidos:
{materiais_recolhidos if materiais_recolhidos else "Nenhum"}
=====================================
""".strip()

        logger.info(f"✅ Relatório gerado - {tecnico}")
        return JSONResponse(content={"relatorio": relatorio})

    except json.JSONDecodeError as e:
        logger.error(f"❌ Erro de JSON: {e}")
        raise HTTPException(status_code=400, detail=f"Formato inválido: {str(e)}")
    except Exception as e:
        logger.error(f"❌ Erro interno: {e}")
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")

@app.get("/health")
async def health_check():
    """Teste de timezone - compare com seu horário local"""
    return {
        "status": "ok",
        "timezone": "America/Sao_Paulo (UTC-3)",
        "data_brasil": get_data_brasil(),
        "data_utc": datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M"),
        "materiais_carregados": len(MATERIAIS_CACHE) if MATERIAIS_CACHE else 0
    }

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)