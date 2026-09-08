"""Management UI. The collector API remains the authorization/data authority."""
import os
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
COLLECTOR = os.getenv('RELATORIO_API_URL', 'https://relatorio-linkce.vercel.app').rstrip('/')
parsed = urlsplit(COLLECTOR)
if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:
    raise RuntimeError('RELATORIO_API_URL deve ser uma origem HTTPS sem credenciais ou caminho.')

app = FastAPI(docs_url=None, redoc_url=None)
app.mount('/static', StaticFiles(directory=ROOT / 'static'), name='static')

@app.middleware('http')
async def headers(request, call_next):
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['X-Frame-Options'] = 'DENY'
    if not request.url.path.startswith('/static/'):
        response.headers['Cache-Control'] = 'no-store'
    return response

async def forward(request, path, public=False):
    headers = {'Content-Type': 'application/json'}
    if not public:
        bearer = request.headers.get('authorization', '')
        if not bearer.startswith('Bearer ') or not bearer[7:].strip():
            raise HTTPException(401, 'Entre para continuar.')
        headers['Authorization'] = bearer
    try:
        async with httpx.AsyncClient(timeout=25, follow_redirects=False) as client:
            response = await client.request(request.method, COLLECTOR + path,
                headers=headers, params=request.query_params,
                content=await request.body() if request.method == 'POST' else None)
        data = response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(503, 'Não foi possível consultar o serviço de relatórios. Tente novamente.')
    if response.status_code >= 500:
        raise HTTPException(503, 'Serviço de relatórios indisponível. Seus dados não foram apagados.')
    if response.status_code not in (200, 400, 401, 403, 404, 409, 422, 429):
        raise HTTPException(502, 'Resposta inesperada do serviço de relatórios.')
    return JSONResponse(data, status_code=response.status_code)

@app.get('/')
@app.get('/dashboard')
async def dashboard():
    return FileResponse(ROOT / 'index.html')

@app.get('/tecnico')
async def tecnico():
    return RedirectResponse(COLLECTOR + '/', status_code=302)

@app.get('/recuperar-senha')
async def recuperar():
    return RedirectResponse(COLLECTOR + '/recuperar-senha', status_code=302)

@app.get('/api/config')
async def config(request: Request):
    return await forward(request, '/api/config', public=True)

@app.get('/api/relatorios')
async def reports(request: Request):
    return await forward(request, '/api/relatorios')

@app.get('/api/relatorios/{report_id}')
async def report(report_id: UUID, request: Request):
    return await forward(request, '/api/relatorios/' + str(report_id))

@app.post('/api/criar-usuario')
async def create_user(request: Request):
    return await forward(request, '/api/criar-usuario')

@app.get('/health')
async def health():
    return {'status': 'ok', 'application': 'ProjetoLinkce'}
