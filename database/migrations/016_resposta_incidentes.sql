-- Procedimento operacional de resposta a incidentes, isolado por empresa.
ALTER TABLE public.lgpd_incidentes
  ADD COLUMN IF NOT EXISTS origem_deteccao text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS responsavel_email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS empresas_afetadas text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS logs_preservados boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS logs_referencia text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS causa_raiz text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS correcao text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS avaliacao_risco text NOT NULL DEFAULT 'nao_avaliado',
  ADD COLUMN IF NOT EXISTS comunicado_responsaveis boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sessoes_revogadas_em timestamptz,
  ADD COLUMN IF NOT EXISTS empresa_bloqueada_em timestamptz,
  ADD COLUMN IF NOT EXISTS chaves_rotacionadas_em timestamptz,
  ADD COLUMN IF NOT EXISTS encerrado_em timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lgpd_incidente_avaliacao_risco_check') THEN
    ALTER TABLE public.lgpd_incidentes ADD CONSTRAINT lgpd_incidente_avaliacao_risco_check
      CHECK (avaliacao_risco IN ('nao_avaliado','sem_risco_relevante','risco_relevante'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.incidente_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  incidente_id uuid NOT NULL REFERENCES public.lgpd_incidentes(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN (
    'criado','deteccao','preservacao_logs','revogacao_sessoes','bloqueio_empresa',
    'rotacao_chaves','contencao','correcao','comunicacao','encerramento','nota')),
  descricao text NOT NULL,
  metadados jsonb NOT NULL DEFAULT '{}'::jsonb,
  usuario_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  usuario_email text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (length(descricao) BETWEEN 1 AND 4000),
  CHECK (usuario_email IS NULL OR length(usuario_email) <= 254)
);

CREATE INDEX IF NOT EXISTS incidente_eventos_empresa_incidente_idx
  ON public.incidente_eventos(empresa_id, incidente_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS lgpd_incidentes_empresa_risco_idx
  ON public.lgpd_incidentes(empresa_id, avaliacao_risco, status, detectado_em DESC);

ALTER TABLE public.incidente_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.incidente_eventos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.incidente_eventos TO service_role;

CREATE OR REPLACE FUNCTION public.linkce_bloquear_alteracao_incidente_eventos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Eventos de incidentes são imutáveis';
END;
$$;
DROP TRIGGER IF EXISTS incidente_eventos_imutavel ON public.incidente_eventos;
CREATE TRIGGER incidente_eventos_imutavel BEFORE UPDATE OR DELETE ON public.incidente_eventos
FOR EACH ROW EXECUTE FUNCTION public.linkce_bloquear_alteracao_incidente_eventos();
REVOKE ALL ON FUNCTION public.linkce_bloquear_alteracao_incidente_eventos() FROM PUBLIC, anon, authenticated;
