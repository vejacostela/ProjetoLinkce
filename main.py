import os
import json
import datetime
import logging
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Configurar log
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# CORS - Permitir acesso de qualquer origem
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Montar arquivos estáticos apenas se a pasta existir
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(static_dir):
    app.mount("/static", StaticFiles(directory="static"), name="static")
    print("✅ Static files montados")
else:
    print("⚠️ Pasta 'static' não encontrada - ignorando")

# === FUNÇÃO PARA CARREGAR MATERIAIS DO .TXT ===
def carregar_materiais():
    """Carrega materiais do arquivo materiais.txt"""
    materiais = []
    try:
        caminho = os.path.join(os.path.dirname(__file__), "materiais.txt")
        logger.info(f"📁 Tentando carregar: {caminho}")
        
        if not os.path.exists(caminho):
            logger.error(f"❌ Arquivo não encontrado: {caminho}")
            # Retorna lista padrão de fallback
            return [
                {"nome": "CONECTOR APC", "categoria": "Conectores"},
                {"nome": "CABO DROP", "categoria": "Cabos"},
                {"nome": "SPLITER 1x8", "categoria": "Splitters"}
            ]
        
        with open(caminho, "r", encoding="utf-8") as f:
            conteudo = f.read()
            logger.info(f"📄 Conteúdo do arquivo ({len(conteudo)} bytes)")
            
            for i, linha in enumerate(conteudo.splitlines()):
                linha = linha.strip()
                
                # Ignora linhas vazias e comentários
                if not linha or linha.startswith('#'):
                    continue
                    
                partes = linha.split('|')
                
                if len(partes) >= 2:
                    materiais.append({
                        "nome": partes[0].strip(),
                        "categoria": partes[1].strip()
                    })
        
        logger.info(f"✅ {len(materiais)} materiais carregados com sucesso")
        return materiais
        
    except Exception as e:
        logger.error(f"❌ Erro ao carregar materiais: {e}")
        import traceback
        logger.error(traceback.format_exc())
        # Retorna lista padrão em caso de erro
        return [
            {"nome": "CONECTOR APC", "categoria": "Conectores"},
            {"nome": "CABO DROP", "categoria": "Cabos"}
        ]

# Cache de materiais (carregado uma vez ao iniciar)
MATERIAIS_CACHE = None

@app.on_event("startup")
async def startup_event():
    """Carrega materiais ao iniciar o servidor"""
    global MATERIAIS_CACHE
    MATERIAIS_CACHE = carregar_materiais()
    logger.info(f"🚀 Servidor iniciado com {len(MATERIAIS_CACHE)} materiais")

# Rota para silenciar log do Chrome DevTools
@app.get("/.well-known/appspecific/com.chrome.devtools.json", include_in_schema=False)
async def devtools_config():
    return JSONResponse(content={})

# === ROTAS PRINCIPAIS ===

@app.get("/", response_class=HTMLResponse)
async def index():
    """Serve a página principal do aplicativo"""
    try:
        caminho = os.path.join(os.path.dirname(__file__), "index.html")
        with open(caminho, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    except Exception as e:
        logger.error(f"Erro ao carregar HTML: {e}")
        return HTMLResponse(content=f"<h1>Erro ao carregar a página: {e}</h1>", status_code=500)

# === API PARA MATERIAIS ===

@app.get("/api/materiais")
async def get_materiais():
    """Retorna lista de materiais do arquivo .txt"""
    logger.info(f"📡 API /api/materiais chamada - {len(MATERIAIS_CACHE)} materiais")
    return JSONResponse(content={
        "materiais": MATERIAIS_CACHE,
        "total": len(MATERIAIS_CACHE)
    })

@app.post("/api/materiais/recarregar")
async def recarregar_materiais():
    """Recarrega materiais do arquivo .txt"""
    global MATERIAIS_CACHE
    MATERIAIS_CACHE = carregar_materiais()
    logger.info(f"🔄 Materiais recarregados: {len(MATERIAIS_CACHE)} itens")
    return JSONResponse(content={
        "mensagem": f"{len(MATERIAIS_CACHE)} materiais recarregados",
        "total": len(MATERIAIS_CACHE)
    })

# === DEBUG: Verificar arquivo materiais.txt ===
@app.get("/api/debug/materiais")
async def debug_materiais():
    """Endpoint de debug para verificar o arquivo materiais.txt"""
    caminho = os.path.join(os.path.dirname(__file__), "materiais.txt")
    existe = os.path.exists(caminho)
    
    conteudo = ""
    if existe:
        with open(caminho, "r", encoding="utf-8") as f:
            conteudo = f.read()
    
    return JSONResponse(content={
        "caminho": caminho,
        "existe": existe,
        "conteudo": conteudo,
        "materiais_no_cache": len(MATERIAIS_CACHE) if MATERIAIS_CACHE else 0,
        "primeiros_materiais": MATERIAIS_CACHE[:5] if MATERIAIS_CACHE else []
    })

# === GERAÇÃO DE RELATÓRIO ===

@app.post("/gerar_relatorio")
async def gerar_relatorio(request: Request):
    """Gera o relatório técnico com os dados enviados"""
    try:
        body = await request.body()
        logger.info(f"📦 Dados recebidos: {len(body)} bytes")
        
        data = json.loads(body)
        
        # Extrair dados do formulário
        tecnico = data.get("tecnico", "").strip()
        relatorio_texto = data.get("relatorio_texto", "").strip()
        problema_tecnico = data.get("problema_tecnico", "").strip()
        equipamento_status = data.get("equipamento_status", "").strip()
        equipamento_obs = data.get("equipamento_obs", "").strip()
        maior_sinal = data.get("maior_sinal", "").strip()
        materiais_utilizados = data.get("materiais_utilizados", "").strip()
        materiais_recolhidos = data.get("materiais_recolhidos", "").strip()

        # Data atual formatada
        data_atual = datetime.datetime.now().strftime("%d/%m/%Y %H:%M")

        # Montar o relatório formatado
        relatorio = f"""
==============================
Relatório Técnico - {data_atual}
==============================

Técnico: {tecnico}

Relatório fiz isso:
{relatorio_texto}

Problema encontrado pelo técnico:
{problema_tecnico}

Equipamento: {equipamento_status}
OBS: {equipamento_obs}

Maior sinal de RSSI: {maior_sinal}

Materiais Utilizados:
{materiais_utilizados if materiais_utilizados else "Nenhum"}

Materiais Recolhidos:
{materiais_recolhidos if materiais_recolhidos else "Nenhum"}
==============================
""".strip()

        logger.info(f"✅ Relatório gerado para técnico: {tecnico}")
        return JSONResponse(content={"relatorio": relatorio})

    except json.JSONDecodeError as e:
        logger.error(f"❌ Erro de JSON: {e}")
        raise HTTPException(status_code=400, detail=f"Formato de dados inválido: {str(e)}")
    except Exception as e:
        logger.error(f"❌ Erro interno: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao gerar relatório: {str(e)}")

# === HEALTH CHECK ===
@app.get("/health")
async def health_check():
    """Endpoint para verificar se o servidor está online"""
    return {
        "status": "ok",
        "materiais_carregados": len(MATERIAIS_CACHE) if MATERIAIS_CACHE else 0,
        "timestamp": datetime.datetime.now().isoformat()
    }

# === INÍCIO DO SERVIDOR ===
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    logger.info(f"🚀 Iniciando servidor na porta {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)