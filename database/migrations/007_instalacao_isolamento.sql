-- Compatibilidade dos avisos antigos (id=1) com múltiplas empresas.
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
