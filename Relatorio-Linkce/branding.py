"""Company branding stored separately from private report evidence."""
import json
import struct
from uuid import uuid4
from fastapi import HTTPException

BUCKET = 'empresa-identidade'
MAX_IMAGE = 3 * 1024 * 1024

def missing(exc):
    data = exc.args[0] if exc.args and isinstance(exc.args[0], dict) else {}
    status = str(getattr(exc, 'status', '') or getattr(exc, 'status_code', '') or data.get('statusCode', ''))
    return status == '404' or 'not found' in str(exc).lower() or 'does not exist' in str(exc).lower()

def load_config(db, company):
    if not db: raise HTTPException(503, 'Armazenamento da identidade visual indisponível.')
    try:
        raw = db.storage.from_(BUCKET).download(f'{company}/config.json')
        if len(raw) > 64000: raise ValueError('Configuração inválida')
        config = json.loads(raw)
        if not isinstance(config, dict): raise ValueError('Configuração inválida')
        return config
    except Exception as exc:
        if missing(exc): return {}
        raise HTTPException(503, 'Não foi possível consultar a identidade visual.')

def ensure_bucket(db):
    try:
        db.storage.get_bucket(BUCKET)
    except Exception as exc:
        if not missing(exc): raise HTTPException(503, 'Armazenamento da marca indisponível.')
        try:
            db.storage.create_bucket(BUCKET, options={'public': False, 'file_size_limit': MAX_IMAGE,
                'allowed_mime_types': ['image/png', 'image/jpeg', 'image/webp', 'application/json']})
        except Exception:
            # Another request may have created it in the meantime.
            try: db.storage.get_bucket(BUCKET)
            except Exception: raise HTTPException(503, 'Não foi possível preparar o armazenamento da marca.')

def validate_icon(content, size):
    if not content or len(content) > 1024 * 1024 or content[:8] != b'\x89PNG\r\n\x1a\n' or len(content) < 33 or content[12:16] != b'IHDR':
        raise HTTPException(422, 'O ícone deve ser uma imagem PNG válida.')
    width, height = struct.unpack('>II', content[16:24])
    if (width, height) != (size, size):
        raise HTTPException(422, f'O ícone deve ter {size} × {size} pixels.')

def safe_asset(config, company, asset):
    item = config.get(asset)
    if not isinstance(item, dict): return None
    path = item.get('path', '')
    if not isinstance(path, str) or not path.startswith(f'{company}/') or '..' in path or item.get('mime') not in ('image/png','image/jpeg','image/webp'):
        raise HTTPException(503, 'Configuração da marca inválida.')
    return item

def presentation(config, company):
    revision = str(config.get('revision') or '')
    urls = {}
    for asset in ('icon192', 'icon512'):
        urls[asset] = f'/marca/{company}/{asset}?v={revision}' if safe_asset(config, company, asset) else None
    return {'empresa_id': str(company), 'nome': config.get('nome') or '', **urls,
            'manifest': f'/marca/{company}/manifest.webmanifest?v={revision}', 'revision': revision}

def save_config(db, company, name, assets, remove_icon=False):
    old = load_config(db, company)
    ensure_bucket(db)
    revision = uuid4().hex
    config = {**old, 'nome': name, 'revision': revision}
    if remove_icon:
        config.pop('icon192', None); config.pop('icon512', None)
    config.pop('banner', None) # Retire legacy banners without deleting stored originals.
    bucket = db.storage.from_(BUCKET)
    try:
        for kind, content, mime in assets:
            extension = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[mime]
            path = f'{company}/{revision}/{kind}.{extension}'
            bucket.upload(path, content, file_options={'content-type':mime, 'upsert':'false', 'cache-control':'300'})
            config[kind] = {'path':path, 'mime':mime}
        # Publish only after all files have uploaded successfully. Failed uploads
        # never alter the previously published brand or touch report evidence.
        bucket.upload(f'{company}/config.json', json.dumps(config, ensure_ascii=False).encode(),
                      file_options={'content-type':'application/json','upsert':'true','cache-control':'0'})
    except Exception:
        raise HTTPException(503, 'A marca não foi publicada. A configuração anterior foi preservada; tente novamente.')
    return presentation(config, company)

def manifest(config, company):
    brand = presentation(config, company)
    name = str(config.get('nome') or 'Sistema de Campo')[:120]
    return {'name':name, 'short_name':name[:24], 'description':'Relatórios técnicos em campo',
        'id':f'/tecnico?empresa={company}', 'start_url':f'/tecnico?empresa={company}', 'scope':'/tecnico',
        'display':'standalone', 'lang':'pt-BR','background_color':'#f3f5f7','theme_color':'#182b3a',
        'icons':[{'src':brand['icon192'] or '/static/icon-192.png','sizes':'192x192','type':'image/png','purpose':'any'},
                 {'src':brand['icon512'] or '/static/icon-512.png','sizes':'512x512','type':'image/png','purpose':'any'}]}
