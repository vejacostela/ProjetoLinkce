-- Rate limiting persistente e atômico para APIs públicas e autenticadas.
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  chave_hash text PRIMARY KEY CHECK (length(chave_hash) = 64),
  janela_inicio timestamptz NOT NULL DEFAULT now(),
  contador integer NOT NULL DEFAULT 0 CHECK (contador BETWEEN 0 AND 1000000),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_rate_limits_atualizado_idx
  ON public.api_rate_limits(atualizado_em);

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.linkce_consumir_limite(
  p_chave_hash text,
  p_janela_segundos integer,
  p_limite integer
) RETURNS TABLE(permitido boolean, restante integer, reinicia_em timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_agora timestamptz := now();
  v_inicio timestamptz;
  v_contador integer;
BEGIN
  IF length(p_chave_hash) <> 64 OR p_janela_segundos NOT BETWEEN 1 AND 86400
     OR p_limite NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'Parâmetros de limite inválidos';
  END IF;

  INSERT INTO public.api_rate_limits(chave_hash, janela_inicio, contador, atualizado_em)
  VALUES (p_chave_hash, v_agora, 1, v_agora)
  ON CONFLICT (chave_hash) DO UPDATE SET
    contador = CASE
      WHEN api_rate_limits.janela_inicio <= v_agora - make_interval(secs => p_janela_segundos)
        THEN 1
      ELSE api_rate_limits.contador + 1
    END,
    janela_inicio = CASE
      WHEN api_rate_limits.janela_inicio <= v_agora - make_interval(secs => p_janela_segundos)
        THEN v_agora
      ELSE api_rate_limits.janela_inicio
    END,
    atualizado_em = v_agora
  RETURNING api_rate_limits.janela_inicio, api_rate_limits.contador
    INTO v_inicio, v_contador;

  RETURN QUERY SELECT
    v_contador <= p_limite,
    greatest(p_limite - v_contador, 0),
    v_inicio + make_interval(secs => p_janela_segundos);
END;
$function$;

REVOKE ALL ON FUNCTION public.linkce_consumir_limite(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.linkce_consumir_limite(text, integer, integer)
  TO service_role;
