-- Execute uma vez no SQL Editor do Supabase usado pelo ProjetoLinkce.
-- As imagens permanecem privadas: somente o backend com service_role as acessa.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'relatorio-evidencias', 'relatorio-evidencias', false, 8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.relatorio_imagens (
  id uuid primary key default gen_random_uuid(),
  relatorio_id uuid not null references public.relatorios(id) on delete cascade,
  caminho text not null unique,
  nome_original text not null,
  tipo text not null check (tipo in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
  tamanho_bytes integer not null check (tamanho_bytes > 0 and tamanho_bytes <= 8388608),
  enviado_por uuid not null,
  criado_em timestamptz not null default now()
);

create index if not exists relatorio_imagens_relatorio_criado_idx
  on public.relatorio_imagens (relatorio_id, criado_em);

alter table public.relatorio_imagens enable row level security;
revoke all on table public.relatorio_imagens from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, delete on table public.relatorio_imagens to service_role;
