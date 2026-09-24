-- Auditoria pesquisável por categoria e entidade, sem armazenar conteúdo sensível.
ALTER TABLE public.auditoria_gestao
  ADD COLUMN IF NOT EXISTS categoria text NOT NULL DEFAULT 'gestao',
  ADD COLUMN IF NOT EXISTS entidade_tipo text,
  ADD COLUMN IF NOT EXISTS entidade_id text,
  ADD COLUMN IF NOT EXISTS descricao text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auditoria_categoria_check') THEN
    ALTER TABLE public.auditoria_gestao
      ADD CONSTRAINT auditoria_categoria_check
      CHECK (categoria ~ '^[a-z0-9_]{2,40}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auditoria_entidade_tipo_check') THEN
    ALTER TABLE public.auditoria_gestao
      ADD CONSTRAINT auditoria_entidade_tipo_check
      CHECK (entidade_tipo IS NULL OR entidade_tipo ~ '^[a-z0-9_]{2,60}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auditoria_entidade_id_check') THEN
    ALTER TABLE public.auditoria_gestao
      ADD CONSTRAINT auditoria_entidade_id_check
      CHECK (entidade_id IS NULL OR length(entidade_id) BETWEEN 1 AND 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auditoria_descricao_check') THEN
    ALTER TABLE public.auditoria_gestao
      ADD CONSTRAINT auditoria_descricao_check
      CHECK (descricao IS NULL OR length(descricao) <= 300);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS auditoria_empresa_categoria_criado_idx
  ON public.auditoria_gestao(empresa_id, categoria, criado_em DESC);
CREATE INDEX IF NOT EXISTS auditoria_empresa_entidade_idx
  ON public.auditoria_gestao(empresa_id, entidade_tipo, entidade_id, criado_em DESC)
  WHERE entidade_tipo IS NOT NULL;

REVOKE ALL ON public.auditoria_gestao FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.auditoria_gestao TO service_role;
