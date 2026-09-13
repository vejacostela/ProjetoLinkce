"""Cria o primeiro gestor via Auth Admin API, com senha digitada fora do código."""
import getpass
import os
import re
from uuid import UUID
import httpx

def bootstrap():
    url = os.environ.get('SUPABASE_URL', '').rstrip('/')
    key = os.environ.get('SUPABASE_SERVICE_KEY', '')
    empresa = str(UUID(os.environ.get('DEFAULT_EMPRESA_ID', '00000000-0000-0000-0000-000000000001')))
    if not url.startswith('https://') or not key:
        raise SystemExit('Defina SUPABASE_URL HTTPS e SUPABASE_SERVICE_KEY no ambiente.')
    email = input('Email do primeiro gestor: ').strip().lower()
    nome = input('Nome: ').strip()
    password = getpass.getpass('Senha inicial (12 a 128 caracteres): ')
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email) or not nome or not 12 <= len(password) <= 128:
        raise SystemExit('Confira email, nome e tamanho da senha.')
    if password != getpass.getpass('Repita a senha: '):
        raise SystemExit('As senhas não coincidem.')
    headers = {'apikey': key, 'Authorization': 'Bearer ' + key}
    with httpx.Client(base_url=url, headers=headers, timeout=30) as client:
        check = client.get('/rest/v1/empresas', params={'id': 'eq.' + empresa, 'select': 'id', 'ativo': 'eq.true'})
        if check.status_code != 200 or not check.json():
            raise SystemExit('Empresa ausente. Aplique o instalador e confira DEFAULT_EMPRESA_ID.')
        # Só inicializa banco sem nenhum vínculo de usuário. Nunca redefine contas existentes.
        check = client.get('/rest/v1/usuarios_empresas', params={'select': 'usuario_id', 'limit': 1})
        if check.status_code != 200 or check.json():
            raise SystemExit('Instalação já possui usuários ou está indisponível. Use a gestão do painel.')
        created = client.post('/auth/v1/admin/users', json={
            'email': email, 'password': password, 'email_confirm': True,
            'user_metadata': {'nome': nome}, 'app_metadata': {'role': 'gestor', 'empresa_id': empresa},
        })
        if created.status_code not in (200, 201):
            raise SystemExit(f'Cadastro recusado pelo Auth (HTTP {created.status_code}). Confira logs privados do serviço.')
        usuario_id = created.json()['id']
        try:
            linked = client.post('/rest/v1/usuarios_empresas', json={
                'usuario_id': usuario_id, 'empresa_id': empresa, 'papel': 'gestor', 'ativo': True})
            linked.raise_for_status()
        except httpx.HTTPError:
            removed = client.delete('/auth/v1/admin/users/' + usuario_id)
            if removed.status_code not in (200, 204):
                raise SystemExit('Vínculo falhou; remova a conta recém-criada no Auth antes de repetir.')
            raise SystemExit('Vínculo falhou; criação cancelada. Confira a instalação do banco.')
    print('Gestor criado e vinculado. Entre no painel com o email informado.')

if __name__ == '__main__':
    bootstrap()
