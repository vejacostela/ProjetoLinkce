-- Links temporários para redefinição aprovada pela gestão.
-- O token em claro nunca é armazenado; somente seu SHA-256 é persistido.
create table if not exists public.links_redefinicao_senha (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  usuario_id uuid not null,
  usuario_email text not null,
  empresa_id uuid,
  solicitado_por uuid not null,
  solicitado_por_email text not null,
  motivo text,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  usado_em timestamptz,
  constraint links_redefinicao_token_hash_tamanho check (char_length(token_hash) = 64),
  constraint links_redefinicao_motivo_tamanho check (char_length(coalesce(motivo, '')) <= 300)
);

create index if not exists links_redefinicao_expiracao_idx
  on public.links_redefinicao_senha (expira_em);
create index if not exists links_redefinicao_usuario_idx
  on public.links_redefinicao_senha (usuario_id, criado_em desc);

alter table public.links_redefinicao_senha enable row level security;
revoke all on table public.links_redefinicao_senha from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update on table public.links_redefinicao_senha to service_role;
