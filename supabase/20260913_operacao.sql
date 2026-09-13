-- Linkce Operação: status de envio, multiempresa e índices operacionais
-- Execute no SQL Editor do Supabase após as migrações de avisos, evidências e segurança.
begin;

alter table if exists public.relatorios
  add column if not exists status_envio text not null default 'sincronizado',
  add column if not exists ultima_tentativa_em timestamptz,
  add column if not exists tentativas_envio integer not null default 0,
  add column if not exists sincronizado_em timestamptz,
  add column if not exists erro_envio text,
  add column if not exists origem_envio text not null default 'online',
  add column if not exists empresa_id uuid;

update public.relatorios
set status_envio = coalesce(nullif(status_envio, ''), 'sincronizado'),
    tentativas_envio = greatest(coalesce(tentativas_envio, 0), 0),
    origem_envio = coalesce(nullif(origem_envio, ''), 'online'),
    sincronizado_em = coalesce(sincronizado_em, criado_em)
where true;

alter table if exists public.relatorios
  alter column empresa_id set default '00000000-0000-0000-0000-000000000001'::uuid;

update public.relatorios
set empresa_id = '00000000-0000-0000-0000-000000000001'::uuid
where empresa_id is null;

create index if not exists relatorios_criado_em_idx
  on public.relatorios (criado_em desc);
create index if not exists relatorios_tecnico_criado_em_idx
  on public.relatorios (tecnico, criado_em desc);
create index if not exists relatorios_user_id_criado_em_idx
  on public.relatorios (user_id, criado_em desc);
create index if not exists relatorios_empresa_criado_em_idx
  on public.relatorios (empresa_id, criado_em desc);
create index if not exists relatorios_empresa_status_idx
  on public.relatorios (empresa_id, status_envio, criado_em desc);
create index if not exists relatorio_imagens_relatorio_id_idx
  on public.relatorio_imagens (relatorio_id, criado_em);

create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  ativo boolean not null default true,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now()
);

insert into public.empresas (id, nome, slug, ativo)
values ('00000000-0000-0000-0000-000000000001', 'Empresa principal', 'principal', true)
on conflict (id) do update set ativo = true;

create table if not exists public.usuarios_empresas (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  papel text not null default 'tecnico' check (papel in ('gestor','apoio','tecnico')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  primary key (usuario_id, empresa_id)
);

insert into public.usuarios_empresas (usuario_id, empresa_id, papel)
select id, '00000000-0000-0000-0000-000000000001'::uuid,
       case when raw_app_meta_data->>'role' in ('gestor','apoio','tecnico')
            then raw_app_meta_data->>'role' else 'tecnico' end
from auth.users
on conflict (usuario_id, empresa_id) do update
set papel = excluded.papel, ativo = true;

do $$
begin
  if to_regclass('public.auditoria_gestao') is not null then
    execute 'alter table public.auditoria_gestao add column if not exists empresa_id uuid';
    execute 'create index if not exists auditoria_gestao_empresa_criado_idx on public.auditoria_gestao (empresa_id, criado_em desc)';
  end if;
  if to_regclass('public.avisos_operacao') is not null then
    execute 'alter table public.avisos_operacao add column if not exists empresa_id uuid';
    execute 'create index if not exists avisos_operacao_empresa_idx on public.avisos_operacao (empresa_id)';
  end if;
  if to_regclass('public.avisos_modelos') is not null then
    execute 'alter table public.avisos_modelos add column if not exists empresa_id uuid';
    execute 'create index if not exists avisos_modelos_empresa_idx on public.avisos_modelos (empresa_id)';
  end if;
  if to_regclass('public.avisos_historico') is not null then
    execute 'alter table public.avisos_historico add column if not exists empresa_id uuid';
    execute 'create index if not exists avisos_historico_empresa_criado_idx on public.avisos_historico (empresa_id, criado_em desc)';
  end if;
end $$;

do $$
begin
  if to_regclass('public.auditoria_gestao') is not null then
    execute 'update public.auditoria_gestao set empresa_id = ''00000000-0000-0000-0000-000000000001''::uuid where empresa_id is null';
  end if;
  if to_regclass('public.avisos_operacao') is not null then
    execute 'update public.avisos_operacao set empresa_id = ''00000000-0000-0000-0000-000000000001''::uuid where empresa_id is null';
  end if;
  if to_regclass('public.avisos_modelos') is not null then
    execute 'update public.avisos_modelos set empresa_id = ''00000000-0000-0000-0000-000000000001''::uuid where empresa_id is null';
  end if;
  if to_regclass('public.avisos_historico') is not null then
    execute 'update public.avisos_historico set empresa_id = ''00000000-0000-0000-0000-000000000001''::uuid where empresa_id is null';
  end if;
end $$;

alter table if exists public.empresas enable row level security;
alter table if exists public.usuarios_empresas enable row level security;
revoke all on public.empresas, public.usuarios_empresas from public, anon, authenticated;
grant select, insert, update on public.empresas to service_role;
grant select, insert, update, delete on public.usuarios_empresas to service_role;

commit;
