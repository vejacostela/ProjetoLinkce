-- Gerado por database/build_installers.py. Não editar diretamente.
-- Requer Supabase (Cloud ou self-hosted), incluindo Auth e Storage.
BEGIN;
SELECT pg_advisory_xact_lock(734092610);
DO $$ BEGIN
  IF to_regclass('auth.users') IS NULL OR to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION 'Instale Supabase com Auth e Storage antes de executar o instalador LinkCE.';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.linkce_schema_migrations (
  versao text PRIMARY KEY, checksum text NOT NULL, aplicado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.linkce_schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.linkce_schema_migrations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.linkce_schema_migrations TO service_role;

-- 001_relatorios.sql
DO $linkce_step$
BEGIN
  IF EXISTS (SELECT 1 FROM public.linkce_schema_migrations
             WHERE versao = '001_relatorios.sql' AND checksum <> 'a80676b8d5ec20c935b8eb588b14cfe9f90d145149fb9386bec6a2972ef96d10') THEN
    RAISE EXCEPTION 'Migração já aplicada foi alterada: 001_relatorios.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.linkce_schema_migrations WHERE versao = '001_relatorios.sql') THEN
    EXECUTE $linkce_migration$-- Tabela de relatórios técnicos
CREATE TABLE IF NOT EXISTS public.relatorios (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  criado_em        TIMESTAMPTZ DEFAULT NOW(),
  tecnico          TEXT        NOT NULL,
  situacao_encontrada  TEXT,
  resolucao_problema   TEXT,
  equipamento_status   TEXT,
  equipamento_obs      TEXT,
  maior_sinal          TEXT,
  materiais_utilizados TEXT,
  materiais_recolhidos TEXT,
  obs_fotos            TEXT,
  check_sinal_fibra    BOOLEAN DEFAULT FALSE,
  check_serial         BOOLEAN DEFAULT FALSE,
  check_cto            BOOLEAN DEFAULT FALSE,
  check_panoramica     BOOLEAN DEFAULT FALSE,
  check_sobra          BOOLEAN DEFAULT FALSE,
  check_metragem       BOOLEAN DEFAULT FALSE,
  check_velocidade     BOOLEAN DEFAULT FALSE,
  check_local_ont      BOOLEAN DEFAULT FALSE,
  check_frente         BOOLEAN DEFAULT FALSE,
  relatorio_completo   TEXT
);

-- Somente o backend com service key acessa os relatórios.
ALTER TABLE relatorios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE relatorios FROM anon, authenticated;
ALTER TABLE relatorios ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE relatorios ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE relatorios ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE relatorios ADD COLUMN IF NOT EXISTS endereco TEXT;

-- Índices para filtros comuns
CREATE INDEX IF NOT EXISTS idx_relatorios_tecnico   ON relatorios (tecnico);
CREATE INDEX IF NOT EXISTS idx_relatorios_criado_em ON relatorios (criado_em DESC);

$linkce_migration$;
    INSERT INTO public.linkce_schema_migrations(versao, checksum) VALUES ('001_relatorios.sql', 'a80676b8d5ec20c935b8eb588b14cfe9f90d145149fb9386bec6a2972ef96d10');
  END IF;
END $linkce_step$;

-- 002_imagens.sql
DO $linkce_step$
BEGIN
  IF EXISTS (SELECT 1 FROM public.linkce_schema_migrations
             WHERE versao = '002_imagens.sql' AND checksum <> 'b76dc58903f6b9c1be3f74e8e532a871b08d10535b31e5d9e7218ecb4d71d19c') THEN
    RAISE EXCEPTION 'Migração já aplicada foi alterada: 002_imagens.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.linkce_schema_migrations WHERE versao = '002_imagens.sql') THEN
    EXECUTE $linkce_migration$-- Execute uma vez no SQL Editor do Supabase usado pelo ProjetoLinkce.
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

$linkce_migration$;
    INSERT INTO public.linkce_schema_migrations(versao, checksum) VALUES ('002_imagens.sql', 'b76dc58903f6b9c1be3f74e8e532a871b08d10535b31e5d9e7218ecb4d71d19c');
  END IF;
END $linkce_step$;

-- 003_avisos.sql
DO $linkce_step$
BEGIN
  IF EXISTS (SELECT 1 FROM public.linkce_schema_migrations
             WHERE versao = '003_avisos.sql' AND checksum <> 'e65d8bb0de5d48f5f66c550bc869826f06a6da8e710263021ceb7bfde5fdd0a3') THEN
    RAISE EXCEPTION 'Migração já aplicada foi alterada: 003_avisos.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.linkce_schema_migrations WHERE versao = '003_avisos.sql') THEN
    EXECUTE $linkce_migration$
create table if not exists public.avisos_operacao (
 id integer primary key check(id=1),
 mensagem text not null default '' check(length(mensagem)<=3000),
 bloqueado boolean not null default false,
 atualizado_por uuid,
 atualizado_em timestamptz not null default now(),
 check(not bloqueado or length(trim(mensagem))>0)
);
insert into public.avisos_operacao(id) values(1) on conflict do nothing;
alter table public.avisos_operacao enable row level security;
revoke all on public.avisos_operacao from public,anon,authenticated;
grant select,insert,update on public.avisos_operacao to service_role;
create table if not exists public.avisos_modelos (
 id bigint generated by default as identity primary key,
 titulo text not null check(length(titulo) between 1 and 120),
 mensagem text not null check(length(mensagem) between 1 and 3000),
 atualizado_por uuid,
 criado_em timestamptz not null default now()
);
alter table public.avisos_modelos enable row level security;
revoke all on public.avisos_modelos from public,anon,authenticated;
grant select,insert,update,delete on public.avisos_modelos to service_role;
grant usage, select, update on sequence public.avisos_modelos_id_seq to service_role;
grant usage on schema public to service_role;
create table if not exists public.avisos_historico (
 id bigint generated by default as identity primary key,
 acao text not null check(acao in ('mensagem_criada','mensagem_atualizada','mensagem_excluida','publicado','bloqueado','liberado')),
 modelo_id bigint references public.avisos_modelos(id) on delete set null,
 titulo text not null default '' check(length(titulo)<=120),
 mensagem text not null default '' check(length(mensagem)<=3000),
 bloqueado boolean not null default false,
 usuario_id uuid,
 usuario_email text not null default '',
 criado_em timestamptz not null default now()
);
alter table public.avisos_historico enable row level security;
revoke all on public.avisos_historico from public,anon,authenticated;
grant select,insert on public.avisos_historico to service_role;
grant usage, select on sequence public.avisos_historico_id_seq to service_role;
insert into public.avisos_modelos(titulo,mensagem) select * from (values
 ('Bom dia de trabalho','Bom dia de trabalho! A equipe está disponível para apoiar as rotas de hoje.'),
 ('Atenção às evidências','Atenção: siga o checklist, registre as evidências e confira os materiais antes de finalizar.'),
 ('Manutenção do sistema','Aviso: o sistema estará em manutenção. Aguarde a liberação antes de enviar relatórios.')
) as modelos(titulo,mensagem) where not exists(select 1 from public.avisos_modelos);

$linkce_migration$;
    INSERT INTO public.linkce_schema_migrations(versao, checksum) VALUES ('003_avisos.sql', 'e65d8bb0de5d48f5f66c550bc869826f06a6da8e710263021ceb7bfde5fdd0a3');
  END IF;
END $linkce_step$;

-- 004_historico_senhas.sql
DO $linkce_step$
BEGIN
  IF EXISTS (SELECT 1 FROM public.linkce_schema_migrations
             WHERE versao = '004_historico_senhas.sql' AND checksum <> '3f46104a14e483e894169048544001f1c27f0cc91d4cb702cfa64ee918ec1676') THEN
    RAISE EXCEPTION 'Migração já aplicada foi alterada: 004_historico_senhas.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.linkce_schema_migrations WHERE versao = '004_historico_senhas.sql') THEN
    EXECUTE $linkce_migration$-- Execute uma vez no SQL Editor do projeto Supabase usado pelo ProjetoLinkce.
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

$linkce_migration$;
    INSERT INTO public.linkce_schema_migrations(versao, checksum) VALUES ('004_historico_senhas.sql', '3f46104a14e483e894169048544001f1c27f0cc91d4cb702cfa64ee918ec1676');
  END IF;
END $linkce_step$;

-- 005_auditoria.sql
DO $linkce_step$
BEGIN
  IF EXISTS (SELECT 1 FROM public.linkce_schema_migrations
             WHERE versao = '005_auditoria.sql' AND checksum <> '579fe75bb3bfa1e82541c447bb2cc6c093011201e565a34592873137bb59382a') THEN
    RAISE EXCEPTION 'Migração já aplicada foi alterada: 005_auditoria.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.linkce_schema_migrations WHERE versao = '005_auditoria.sql') THEN
    EXECUTE $linkce_migration$
create table if not exists public.auditoria_gestao (
  id bigint generated by default as identity primary key,
  acao text not null check (length(acao) between 1 and 120),
  metodo text not null check (length(metodo) between 1 and 12),
  rota text not null check (length(rota) between 1 and 300),
  resultado text not null default 'sucesso',
  usuario_id uuid,
  usuario_email text,
  criado_em timestamptz not null default now()
);
create index if not exists auditoria_gestao_criado_em_idx on public.auditoria_gestao (criado_em desc);
create index if not exists auditoria_gestao_usuario_idx on public.auditoria_gestao (usuario_id, criado_em desc);
alter table public.auditoria_gestao enable row level security;
revoke all on public.auditoria_gestao from public, anon, authenticated;
grant select, insert on public.auditoria_gestao to service_role;

$linkce_migration$;
    INSERT INTO public.linkce_schema_migrations(versao, checksum) VALUES ('005_auditoria.sql', '579fe75bb3bfa1e82541c447bb2cc6c093011201e565a34592873137bb59382a');
  END IF;
END $linkce_step$;

-- 006_empresas_operacao.sql
DO $linkce_step$
BEGIN
  IF EXISTS (SELECT 1 FROM public.linkce_schema_migrations
             WHERE versao = '006_empresas_operacao.sql' AND checksum <> '199ed976169ff49f85a656a0304ec5bc949d0e5172764bc3cb9abd8f9ef8de26') THEN
    RAISE EXCEPTION 'Migração já aplicada foi alterada: 006_empresas_operacao.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.linkce_schema_migrations WHERE versao = '006_empresas_operacao.sql') THEN
    EXECUTE $linkce_migration$-- Linkce Operação: status de envio, multiempresa e índices operacionais
-- Execute no SQL Editor do Supabase após as migrações de avisos, evidências e segurança.

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
on conflict (id) do nothing;

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
where coalesce(raw_app_meta_data->>'empresa_id', '00000000-0000-0000-0000-000000000001') = '00000000-0000-0000-0000-000000000001'
on conflict (usuario_id, empresa_id) do nothing;

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

$linkce_migration$;
    INSERT INTO public.linkce_schema_migrations(versao, checksum) VALUES ('006_empresas_operacao.sql', '199ed976169ff49f85a656a0304ec5bc949d0e5172764bc3cb9abd8f9ef8de26');
  END IF;
END $linkce_step$;

-- 007_instalacao_isolamento.sql
DO $linkce_step$
BEGIN
  IF EXISTS (SELECT 1 FROM public.linkce_schema_migrations
             WHERE versao = '007_instalacao_isolamento.sql' AND checksum <> 'deb2ac7a968523385aa298dd645b8eaa7daa927f2f982ea88043f918b930f5cf') THEN
    RAISE EXCEPTION 'Migração já aplicada foi alterada: 007_instalacao_isolamento.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.linkce_schema_migrations WHERE versao = '007_instalacao_isolamento.sql') THEN
    EXECUTE $linkce_migration$-- Compatibilidade dos avisos antigos (id=1) com múltiplas empresas.
ALTER TABLE public.avisos_operacao DROP CONSTRAINT IF EXISTS avisos_operacao_id_check;
CREATE SEQUENCE IF NOT EXISTS public.avisos_operacao_id_seq OWNED BY public.avisos_operacao.id;
ALTER TABLE public.avisos_operacao ALTER COLUMN id SET DEFAULT nextval('public.avisos_operacao_id_seq');
SELECT setval('public.avisos_operacao_id_seq', greatest(coalesce((SELECT max(id) FROM public.avisos_operacao), 0) + 1, 1), false);
CREATE UNIQUE INDEX IF NOT EXISTS avisos_operacao_empresa_unique ON public.avisos_operacao(empresa_id);

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS modo_hospedagem text NOT NULL DEFAULT 'cloud'
    CHECK (modo_hospedagem IN ('cloud', 'servidor_proprio')),
  ADD COLUMN IF NOT EXISTS dominio text NOT NULL DEFAULT '';
ALTER TABLE public.historico_redefinicao_senhas ADD COLUMN IF NOT EXISTS empresa_id uuid;
UPDATE public.historico_redefinicao_senhas
  SET empresa_id = '00000000-0000-0000-0000-000000000001' WHERE empresa_id IS NULL;
CREATE INDEX IF NOT EXISTS historico_senhas_empresa_idx ON public.historico_redefinicao_senhas(empresa_id, criado_em DESC);

-- Nenhuma credencial ou senha padrão é criada por migração.
-- Cada tabela é acessada pelo backend, que aplica a empresa autorizada.
DO $$
DECLARE tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['relatorios', 'relatorio_imagens', 'avisos_operacao',
    'avisos_modelos', 'avisos_historico', 'auditoria_gestao', 'historico_redefinicao_senhas',
    'empresas', 'usuarios_empresas'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', tabela);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.relatorios, public.relatorio_imagens TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.avisos_operacao_id_seq, public.auditoria_gestao_id_seq TO service_role;

-- Uma empresa e seu vínculo inicial são criados na mesma transação.
CREATE OR REPLACE FUNCTION public.linkce_criar_empresa(
  p_nome text, p_slug text, p_usuario_id uuid, p_modo text, p_dominio text
) RETURNS SETOF public.empresas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE nova public.empresas;
BEGIN
  INSERT INTO public.empresas(nome, slug, criado_por, modo_hospedagem, dominio)
    VALUES(p_nome, p_slug, p_usuario_id, p_modo, p_dominio) RETURNING * INTO nova;
  INSERT INTO public.usuarios_empresas(usuario_id, empresa_id, papel)
    VALUES(p_usuario_id, nova.id, 'gestor');
  INSERT INTO public.avisos_operacao(empresa_id) VALUES(nova.id);
  INSERT INTO public.avisos_modelos(titulo, mensagem, empresa_id)
    VALUES('Bom dia de trabalho', 'Bom dia de trabalho! A equipe está disponível para apoiar as rotas de hoje.', nova.id),
          ('Manutenção do sistema', 'Sistema em manutenção. Aguarde a liberação antes de enviar relatórios.', nova.id);
  RETURN NEXT nova;
END $$;
REVOKE ALL ON FUNCTION public.linkce_criar_empresa(text,text,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.linkce_criar_empresa(text,text,uuid,text,text) TO service_role;
NOTIFY pgrst, 'reload schema';
$linkce_migration$;
    INSERT INTO public.linkce_schema_migrations(versao, checksum) VALUES ('007_instalacao_isolamento.sql', 'deb2ac7a968523385aa298dd645b8eaa7daa927f2f982ea88043f918b930f5cf');
  END IF;
END $linkce_step$;

-- 008_bloqueio_empresas.sql
DO $linkce_step$
BEGIN
  IF EXISTS (SELECT 1 FROM public.linkce_schema_migrations
             WHERE versao = '008_bloqueio_empresas.sql' AND checksum <> 'ddd42f56813eae559ca2d425f00099326de870a515ca9490fb4de6c56050ec18') THEN
    RAISE EXCEPTION 'Migração já aplicada foi alterada: 008_bloqueio_empresas.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.linkce_schema_migrations WHERE versao = '008_bloqueio_empresas.sql') THEN
    EXECUTE $linkce_migration$ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS bloqueada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS liberada_ate timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_bloqueio text NOT NULL DEFAULT '';
$linkce_migration$;
    INSERT INTO public.linkce_schema_migrations(versao, checksum) VALUES ('008_bloqueio_empresas.sql', 'ddd42f56813eae559ca2d425f00099326de870a515ca9490fb4de6c56050ec18');
  END IF;
END $linkce_step$;

-- 009_links_redefinicao.sql
DO $linkce_step$
BEGIN
  IF EXISTS (SELECT 1 FROM public.linkce_schema_migrations
             WHERE versao = '009_links_redefinicao.sql' AND checksum <> '545140b6495feac02c68be09e73a90e6713bfd103b1a1a2c57e6a155df5cbeb0') THEN
    RAISE EXCEPTION 'Migração já aplicada foi alterada: 009_links_redefinicao.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.linkce_schema_migrations WHERE versao = '009_links_redefinicao.sql') THEN
    EXECUTE $linkce_migration$-- Links temporários para redefinição aprovada pela gestão.
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
$linkce_migration$;
    INSERT INTO public.linkce_schema_migrations(versao, checksum) VALUES ('009_links_redefinicao.sql', '545140b6495feac02c68be09e73a90e6713bfd103b1a1a2c57e6a155df5cbeb0');
  END IF;
END $linkce_step$;
COMMIT;
SELECT versao, aplicado_em FROM public.linkce_schema_migrations ORDER BY versao;
