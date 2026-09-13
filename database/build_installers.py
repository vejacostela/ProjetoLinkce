"""Gera SQL autocontido para SQL Editor ou psql; sem dependências externas."""
import hashlib
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent

def render():
    parts = ["""-- Gerado por database/build_installers.py. Não editar diretamente.
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
"""]
    for path in sorted((ROOT / 'migrations').glob('*.sql')):
        sql = path.read_text(encoding='utf-8')
        checksum = hashlib.sha256(sql.encode()).hexdigest()
        # Dollar quoting permite corpos de funções e comentários sem interpretar texto.
        if '$linkce_migration$' in sql:
            raise ValueError('Delimitador reservado na migração')
        parts.append(f"""
-- {path.name}
DO $linkce_step$
BEGIN
  IF EXISTS (SELECT 1 FROM public.linkce_schema_migrations
             WHERE versao = '{path.name}' AND checksum <> '{checksum}') THEN
    RAISE EXCEPTION 'Migração já aplicada foi alterada: {path.name}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.linkce_schema_migrations WHERE versao = '{path.name}') THEN
    EXECUTE $linkce_migration${sql}$linkce_migration$;
    INSERT INTO public.linkce_schema_migrations(versao, checksum) VALUES ('{path.name}', '{checksum}');
  END IF;
END $linkce_step$;
""")
    parts.append("COMMIT;\nSELECT versao, aplicado_em FROM public.linkce_schema_migrations ORDER BY versao;\n")
    return ''.join(parts)

def main():
    content = render()
    folder = ROOT / 'install'
    folder.mkdir(exist_ok=True)
    for name in ('install_cloud.sql', 'install_servidor_proprio.sql'):
        path = folder / name
        if '--check' in sys.argv:
            if not path.exists() or path.read_text(encoding='utf-8') != content:
                raise SystemExit(f'Instalador desatualizado: {name}')
        else:
            path.write_text(content, encoding='utf-8')

if __name__ == '__main__':
    main()
