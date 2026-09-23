-- Auditoria operacional completa, com identificadores técnicos pseudonimizados.
ALTER TABLE public.auditoria_gestao
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS status_code smallint,
  ADD COLUMN IF NOT EXISTS ip_hash text,
  ADD COLUMN IF NOT EXISTS user_agent_hash text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auditoria_request_id_check') THEN
    ALTER TABLE public.auditoria_gestao
      ADD CONSTRAINT auditoria_request_id_check
      CHECK (request_id IS NULL OR length(request_id) BETWEEN 8 AND 64);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auditoria_status_code_check') THEN
    ALTER TABLE public.auditoria_gestao
      ADD CONSTRAINT auditoria_status_code_check
      CHECK (status_code IS NULL OR status_code BETWEEN 100 AND 599);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auditoria_ip_hash_check') THEN
    ALTER TABLE public.auditoria_gestao
      ADD CONSTRAINT auditoria_ip_hash_check
      CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auditoria_user_agent_hash_check') THEN
    ALTER TABLE public.auditoria_gestao
      ADD CONSTRAINT auditoria_user_agent_hash_check
      CHECK (user_agent_hash IS NULL OR user_agent_hash ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS auditoria_gestao_request_id_idx
  ON public.auditoria_gestao(request_id)
  WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS auditoria_gestao_resultado_criado_idx
  ON public.auditoria_gestao(resultado, criado_em DESC);

CREATE OR REPLACE FUNCTION public.linkce_bloquear_alteracao_auditoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Registros de auditoria são imutáveis';
END;
$$;

DROP TRIGGER IF EXISTS auditoria_gestao_imutavel ON public.auditoria_gestao;
CREATE TRIGGER auditoria_gestao_imutavel
BEFORE UPDATE OR DELETE ON public.auditoria_gestao
FOR EACH ROW EXECUTE FUNCTION public.linkce_bloquear_alteracao_auditoria();

REVOKE ALL ON public.auditoria_gestao FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.auditoria_gestao TO service_role;
REVOKE ALL ON FUNCTION public.linkce_bloquear_alteracao_auditoria() FROM PUBLIC, anon, authenticated;
