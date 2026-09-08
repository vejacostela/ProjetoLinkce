"""Single Vercel application: management, capture and authenticated API."""
from importlib import import_module
from pathlib import Path
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
collector = import_module("Relatorio-Linkce.main")
app = collector.app
app.mount("/panel-assets", StaticFiles(directory=ROOT / "static"), name="panel-assets")

@app.get("/")
async def management():
    return FileResponse(ROOT / "index.html", headers={"Cache-Control": "no-store"})

