"""Teste destrutivo somente no banco descartável linkce_install_test, em localhost."""
import os
from pathlib import Path
import psycopg

ROOT = Path(__file__).resolve().parent.parent

def run():
    with psycopg.connect(os.environ['LINKCE_TEST_DSN'], autocommit=True) as conn:
        if conn.info.dbname != 'linkce_install_test' or conn.info.host not in ('localhost', '127.0.0.1'):
            raise RuntimeError('O teste só aceita banco local descartável linkce_install_test')
        for legacy in (False, True):
            conn.execute('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS storage CASCADE;')
            conn.execute("""
                DO $$ BEGIN
                  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
                  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
                  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
                END $$;
                CREATE SCHEMA auth;
                CREATE TABLE auth.users(id uuid PRIMARY KEY, raw_app_meta_data jsonb DEFAULT '{}');
                CREATE SCHEMA storage;
                CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
            """)
            if legacy:
                for name in ('Relatorio-Linkce/supabase_setup.sql', 'supabase/20260909_evidencias_relatorios.sql',
                             'supabase/20260909_avisos.sql', 'supabase/20260909_historico_redefinicao_senhas.sql',
                             'supabase/20260911_seguranca.sql', 'supabase/20260913_operacao.sql'):
                    conn.execute((ROOT / name).read_text())
                conn.execute("UPDATE public.empresas SET ativo=false")
                conn.execute("INSERT INTO public.relatorios(tecnico) VALUES ('Preservado')")
            sql = (ROOT / 'database/install/install_cloud.sql').read_text()
            conn.execute(sql)
            conn.execute(sql)
            expected_migrations = len(list((ROOT / 'database' / 'migrations').glob('*.sql')))
            assert conn.execute('SELECT count(*) FROM public.linkce_schema_migrations').fetchone()[0] == expected_migrations
            if legacy:
                assert conn.execute('SELECT ativo FROM public.empresas').fetchone()[0] is False
                assert conn.execute('SELECT tecnico FROM public.relatorios').fetchone()[0] == 'Preservado'
            actor = '11111111-1111-4111-8111-111111111111'
            conn.execute('INSERT INTO auth.users(id) VALUES (%s)', (actor,))
            company = conn.execute("SELECT id FROM public.linkce_criar_empresa('Provedor Teste','teste',%s,'servidor_proprio','sistema.example.com')", (actor,)).fetchone()[0]
            assert conn.execute('SELECT papel FROM public.usuarios_empresas WHERE empresa_id=%s', (company,)).fetchone()[0] == 'gestor'
            assert conn.execute('SELECT count(*) FROM public.avisos_operacao WHERE empresa_id=%s', (company,)).fetchone()[0] == 1
            assert conn.execute('SELECT count(*) FROM public.avisos_modelos WHERE empresa_id=%s', (company,)).fetchone()[0] == 2
            for role in ('anon', 'authenticated'):
                assert not conn.execute("SELECT has_table_privilege(%s,'public.relatorios','SELECT')", (role,)).fetchone()[0]
                assert not conn.execute("SELECT has_function_privilege(%s,'public.linkce_criar_empresa(text,text,uuid,text,text)','EXECUTE')", (role,)).fetchone()[0]
                assert not conn.execute(
                    "SELECT has_function_privilege(%s,'public.linkce_consumir_limite(text,integer,integer)','EXECUTE')",
                    (role,),
                ).fetchone()[0]
            rate_key = 'a' * 64
            first = conn.execute(
                'SELECT permitido, restante FROM public.linkce_consumir_limite(%s, 60, 2)',
                (rate_key,),
            ).fetchone()
            second = conn.execute(
                'SELECT permitido, restante FROM public.linkce_consumir_limite(%s, 60, 2)',
                (rate_key,),
            ).fetchone()
            third = conn.execute(
                'SELECT permitido, restante FROM public.linkce_consumir_limite(%s, 60, 2)',
                (rate_key,),
            ).fetchone()
            assert first == (True, 1)
            assert second == (True, 0)
            assert third == (False, 0)
            before = conn.execute('SELECT count(*) FROM public.empresas').fetchone()[0]
            try:
                conn.execute("SELECT * FROM public.linkce_criar_empresa('Sem usuário','falha','22222222-2222-4222-8222-222222222222','cloud','')")
            except psycopg.errors.ForeignKeyViolation:
                pass
            else:
                raise AssertionError('Deveria rejeitar usuário inexistente')
            assert conn.execute('SELECT count(*) FROM public.empresas').fetchone()[0] == before
            conn.execute(sql)
            assert conn.execute('SELECT count(*) FROM public.empresas').fetchone()[0] == before
            print('OK:', 'atualização legado' if legacy else 'instalação nova')

if __name__ == '__main__':
    run()
