ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS bloqueada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS liberada_ate timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_bloqueio text NOT NULL DEFAULT '';
