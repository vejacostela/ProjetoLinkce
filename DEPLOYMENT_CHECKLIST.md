# Linkce — checklist de produção

## Variáveis obrigatórias na Vercel

- `SUPABASE_URL`: URL pública do projeto Supabase.
- `SUPABASE_KEY`: chave pública (anon).
- `SUPABASE_SERVICE_KEY`: chave de serviço, somente no servidor.
- `ALLOWED_ORIGINS`: domínio da aplicação, por exemplo `https://projeto-linkce.vercel.app`.
- `APP_VERSION`: versão exibida no health check.

Nunca coloque a chave de serviço no HTML, no JavaScript ou em variáveis públicas.

## Migrações

Execute no SQL Editor do Supabase, nesta ordem:

1. Migração de relatórios/evidências já utilizada pelo projeto.
2. `supabase/20260909_avisos.sql`.
3. `supabase/20260911_seguranca.sql`.
4. `supabase/20260913_operacao.sql`.

As migrações usam `if not exists` e podem ser reaplicadas com segurança.

## Verificação rápida

- `GET /health`: deve responder `status: ok` e `checks.supabase: true`.
- Login de gestor, apoio e técnico.
- Criar relatório com localização e fotos.
- Desconectar o celular, criar um relatório e reconectar.
- Conferir fotos e auditoria no dashboard.
- Confirmar que técnico não acessa APIs de gestão.

## Backup

Configure o backup diário do projeto Supabase pelo painel do provedor e teste uma restauração periodicamente. A retenção do banco não deve depender apenas da limpeza manual do dashboard.
