-- Controles operacionais da instalação em servidor próprio, isolados por empresa.
CREATE TABLE IF NOT EXISTS public.servidor_seguranca (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas(id) ON DELETE CASCADE,
  firewall_ativo boolean NOT NULL DEFAULT false,
  https_valido boolean NOT NULL DEFAULT false,
  banco_nao_exposto boolean NOT NULL DEFAULT false,
  administracao_restrita boolean NOT NULL DEFAULT false,
  usuario_sem_admin boolean NOT NULL DEFAULT false,
  atualizacoes_controladas boolean NOT NULL DEFAULT false,
  monitoramento_ativo boolean NOT NULL DEFAULT false,
  backup_local boolean NOT NULL DEFAULT false,
  backup_externo boolean NOT NULL DEFAULT false,
  restauracao_testada boolean NOT NULL DEFAULT false,
  observacoes text NOT NULL DEFAULT '',
  verificado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verificado_email text,
  verificado_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT servidor_seguranca_observacoes_len CHECK (char_length(observacoes) <= 3000)
);

CREATE TABLE IF NOT EXISTS public.servidor_backup_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('local','externo','restauracao')),
  status text NOT NULL CHECK (status IN ('sucesso','falha')),
  referencia text NOT NULL DEFAULT '',
  tamanho_bytes bigint CHECK (tamanho_bytes IS NULL OR tamanho_bytes >= 0),
  checksum_sha256 text CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[a-f0-9]{64}$'),
  detalhes text NOT NULL DEFAULT '',
  executado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  executado_email text,
  executado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT servidor_backup_referencia_len CHECK (char_length(referencia) <= 500),
  CONSTRAINT servidor_backup_detalhes_len CHECK (char_length(detalhes) <= 2000)
);

CREATE INDEX IF NOT EXISTS servidor_backup_empresa_data_idx
  ON public.servidor_backup_execucoes(empresa_id, executado_em DESC);

ALTER TABLE public.servidor_seguranca ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.servidor_backup_execucoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.servidor_seguranca, public.servidor_backup_execucoes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.servidor_seguranca TO service_role;
GRANT SELECT, INSERT ON public.servidor_backup_execucoes TO service_role;

CREATE OR REPLACE FUNCTION public.linkce_bloquear_alteracao_backup_servidor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'O histórico de backup do servidor é imutável';
END;
$$;
REVOKE ALL ON FUNCTION public.linkce_bloquear_alteracao_backup_servidor() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.linkce_bloquear_alteracao_backup_servidor() TO service_role;

DROP TRIGGER IF EXISTS servidor_backup_imutavel ON public.servidor_backup_execucoes;
CREATE TRIGGER servidor_backup_imutavel BEFORE UPDATE OR DELETE ON public.servidor_backup_execucoes
FOR EACH ROW EXECUTE FUNCTION public.linkce_bloquear_alteracao_backup_servidor();
