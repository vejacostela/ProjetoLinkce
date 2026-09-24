-- LGPD operacional por empresa: governança, aceites, solicitações e incidentes.
CREATE TABLE IF NOT EXISTS public.lgpd_configuracao (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas(id) ON DELETE CASCADE,
  controlador_nome text NOT NULL DEFAULT '',
  operador_nome text NOT NULL DEFAULT '',
  encarregado_nome text NOT NULL DEFAULT '',
  encarregado_email text NOT NULL DEFAULT '',
  canal_titular text NOT NULL DEFAULT '',
  finalidades text NOT NULL DEFAULT '',
  politica_url text NOT NULL DEFAULT '',
  politica_versao text NOT NULL DEFAULT 'v1',
  termos_url text NOT NULL DEFAULT '',
  termos_versao text NOT NULL DEFAULT 'v1',
  retencao_dias integer NOT NULL DEFAULT 365 CHECK (retencao_dias BETWEEN 1 AND 36500),
  atualizado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (length(controlador_nome) <= 160 AND length(operador_nome) <= 160),
  CHECK (length(encarregado_nome) <= 160 AND length(encarregado_email) <= 254),
  CHECK (length(canal_titular) <= 500 AND length(finalidades) <= 4000),
  CHECK (length(politica_url) <= 1000 AND length(termos_url) <= 1000),
  CHECK (length(politica_versao) BETWEEN 1 AND 120 AND length(termos_versao) BETWEEN 1 AND 120)
);

CREATE TABLE IF NOT EXISTS public.lgpd_aceites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  usuario_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  usuario_email text,
  politica_versao text NOT NULL,
  politica_url text,
  termos_versao text,
  termos_url text,
  finalidade text NOT NULL DEFAULT 'primeiro_acesso',
  request_id text,
  aceito_em timestamptz NOT NULL DEFAULT now(),
  CHECK (usuario_email IS NULL OR length(usuario_email) <= 254),
  CHECK (length(politica_versao) BETWEEN 1 AND 120),
  CHECK (termos_versao IS NULL OR length(termos_versao) BETWEEN 1 AND 120)
);

CREATE TABLE IF NOT EXISTS public.lgpd_solicitacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  protocolo text NOT NULL UNIQUE,
  tipo text NOT NULL CHECK (tipo IN ('acesso','correcao','exportacao','anonimizacao','exclusao','oposicao','revogacao')),
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','em_analise','aguardando_titular','concluida','negada','cancelada')),
  titular_nome text NOT NULL,
  titular_email text NOT NULL,
  descricao text NOT NULL DEFAULT '',
  resposta text NOT NULL DEFAULT '',
  prazo_em timestamptz NOT NULL DEFAULT (now() + interval '15 days'),
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  atualizado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz,
  CHECK (length(titular_nome) BETWEEN 1 AND 160),
  CHECK (length(titular_email) BETWEEN 3 AND 254),
  CHECK (length(descricao) <= 4000 AND length(resposta) <= 4000)
);

CREATE TABLE IF NOT EXISTS public.lgpd_incidentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  codigo text NOT NULL UNIQUE,
  titulo text NOT NULL,
  severidade text NOT NULL CHECK (severidade IN ('baixa','media','alta','critica')),
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','investigando','contido','encerrado')),
  resumo text NOT NULL,
  dados_afetados text NOT NULL DEFAULT '',
  medidas text NOT NULL DEFAULT '',
  ocorrido_em timestamptz,
  detectado_em timestamptz NOT NULL DEFAULT now(),
  comunicar_anpd boolean NOT NULL DEFAULT false,
  comunicar_titulares boolean NOT NULL DEFAULT false,
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  atualizado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (length(titulo) BETWEEN 3 AND 200),
  CHECK (length(resumo) BETWEEN 3 AND 4000),
  CHECK (length(dados_afetados) <= 4000 AND length(medidas) <= 4000)
);

CREATE INDEX IF NOT EXISTS lgpd_aceites_empresa_data_idx ON public.lgpd_aceites(empresa_id, aceito_em DESC);
CREATE INDEX IF NOT EXISTS lgpd_solicitacoes_empresa_status_idx ON public.lgpd_solicitacoes(empresa_id, status, prazo_em);
CREATE INDEX IF NOT EXISTS lgpd_incidentes_empresa_status_idx ON public.lgpd_incidentes(empresa_id, status, detectado_em DESC);

ALTER TABLE public.lgpd_configuracao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lgpd_aceites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lgpd_solicitacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lgpd_incidentes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lgpd_configuracao, public.lgpd_aceites, public.lgpd_solicitacoes, public.lgpd_incidentes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lgpd_configuracao, public.lgpd_solicitacoes, public.lgpd_incidentes TO service_role;
GRANT SELECT, INSERT ON public.lgpd_aceites TO service_role;

CREATE OR REPLACE FUNCTION public.linkce_bloquear_alteracao_lgpd_aceites()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Registros de aceite são imutáveis';
END;
$$;
DROP TRIGGER IF EXISTS lgpd_aceites_imutavel ON public.lgpd_aceites;
CREATE TRIGGER lgpd_aceites_imutavel BEFORE UPDATE OR DELETE ON public.lgpd_aceites
FOR EACH ROW EXECUTE FUNCTION public.linkce_bloquear_alteracao_lgpd_aceites();
REVOKE ALL ON FUNCTION public.linkce_bloquear_alteracao_lgpd_aceites() FROM PUBLIC, anon, authenticated;
