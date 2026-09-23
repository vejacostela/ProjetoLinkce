-- Isolamento e integridade das evidências fotográficas.
UPDATE storage.buckets
SET public = false,
    file_size_limit = 8388608,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif']
WHERE id = 'relatorio-evidencias';

ALTER TABLE public.relatorio_imagens
  ADD COLUMN IF NOT EXISTS empresa_id uuid,
  ADD COLUMN IF NOT EXISTS sha256 text;

UPDATE public.relatorio_imagens imagem
SET empresa_id = relatorio.empresa_id
FROM public.relatorios relatorio
WHERE imagem.relatorio_id = relatorio.id
  AND imagem.empresa_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.relatorio_imagens WHERE empresa_id IS NULL) THEN
    RAISE EXCEPTION 'Há imagens sem empresa correspondente. Corrija os registros antes de continuar.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relatorio_imagens_empresa_fk') THEN
    ALTER TABLE public.relatorio_imagens
      ADD CONSTRAINT relatorio_imagens_empresa_fk
      FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relatorio_imagens_sha256_check') THEN
    ALTER TABLE public.relatorio_imagens
      ADD CONSTRAINT relatorio_imagens_sha256_check
      CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

ALTER TABLE public.relatorio_imagens ALTER COLUMN empresa_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS relatorio_imagens_empresa_relatorio_idx
  ON public.relatorio_imagens(empresa_id, relatorio_id, criado_em);

CREATE OR REPLACE FUNCTION public.linkce_validar_empresa_imagem()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_empresa uuid;
BEGIN
  SELECT empresa_id INTO v_empresa
  FROM public.relatorios
  WHERE id = NEW.relatorio_id;
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'Relatório inexistente';
  END IF;
  IF NEW.empresa_id IS NULL THEN
    NEW.empresa_id := v_empresa;
  ELSIF NEW.empresa_id <> v_empresa THEN
    RAISE EXCEPTION 'A imagem e o relatório pertencem a empresas diferentes';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS relatorio_imagens_validar_empresa ON public.relatorio_imagens;
CREATE TRIGGER relatorio_imagens_validar_empresa
BEFORE INSERT OR UPDATE OF empresa_id, relatorio_id
ON public.relatorio_imagens
FOR EACH ROW EXECUTE FUNCTION public.linkce_validar_empresa_imagem();

REVOKE ALL ON public.relatorio_imagens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.relatorio_imagens TO service_role;
REVOKE ALL ON FUNCTION public.linkce_validar_empresa_imagem() FROM PUBLIC, anon, authenticated;
