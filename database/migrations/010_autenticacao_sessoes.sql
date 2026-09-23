-- Proteção persistente de login e sessões. A aplicação acessa estas tabelas
-- somente com a service_role; navegador e usuários autenticados não têm acesso.
CREATE TABLE IF NOT EXISTS public.login_tentativas (
  chave_hash text PRIMARY KEY CHECK (length(chave_hash) = 64),
  falhas smallint NOT NULL DEFAULT 0 CHECK (falhas BETWEEN 0 AND 100),
  bloqueado_ate timestamptz,
  ultima_tentativa_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sessoes_ativas (
  sessao_id text PRIMARY KEY CHECK (length(sessao_id) BETWEEN 8 AND 200),
  usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE CASCADE,
  criada_em timestamptz NOT NULL DEFAULT now(),
  ultima_atividade_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  revogada_em timestamptz
);

CREATE INDEX IF NOT EXISTS sessoes_ativas_usuario_idx
  ON public.sessoes_ativas(usuario_id, revogada_em, ultima_atividade_em DESC);
CREATE INDEX IF NOT EXISTS sessoes_ativas_empresa_idx
  ON public.sessoes_ativas(empresa_id, revogada_em, ultima_atividade_em DESC);
CREATE INDEX IF NOT EXISTS login_tentativas_limpeza_idx
  ON public.login_tentativas(ultima_tentativa_em);

ALTER TABLE public.login_tentativas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessoes_ativas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.login_tentativas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.sessoes_ativas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.login_tentativas TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessoes_ativas TO service_role;
