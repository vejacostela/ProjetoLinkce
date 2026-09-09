-- Execute uma vez no SQL Editor do projeto Supabase usado pelo ProjetoLinkce.
-- O sistema registra a ação, nunca a senha informada.
create table if not exists public.historico_redefinicao_senhas (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  gestor_id uuid not null,
  gestor_email text not null,
  usuario_id uuid not null,
  usuario_email text not null,
  motivo text,
  constraint historico_redefinicao_senhas_motivo_tamanho check (char_length(coalesce(motivo, '')) <= 300)
);

create index if not exists historico_redefinicao_senhas_criado_em_idx
  on public.historico_redefinicao_senhas (criado_em desc);

alter table public.historico_redefinicao_senhas enable row level security;
revoke all on table public.historico_redefinicao_senhas from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert on table public.historico_redefinicao_senhas to service_role;
