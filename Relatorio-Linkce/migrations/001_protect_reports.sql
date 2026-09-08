-- Apply once with an administrative database connection, after backup.
-- Does not delete reports or automatically promote existing users.
BEGIN;
ALTER TABLE public.relatorios ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.relatorios ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE public.relatorios ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE public.relatorios ADD COLUMN IF NOT EXISTS endereco TEXT;
ALTER TABLE public.relatorios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.relatorios FROM anon, authenticated;
COMMIT;
-- Backend uses SUPABASE_SERVICE_KEY; never expose it through /api/config.
-- Review existing RPC grants separately; production schema may differ.

