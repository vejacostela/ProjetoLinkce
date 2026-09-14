-- Executar uma única vez no Supabase da plataforma.
-- Esta conta poderá criar empresas e baixar o pacote de instalação.
-- Gestores de clientes continuam limitados à própria empresa.
DO $$
DECLARE
  v_email constant text := 'gestor@gestor.linkce';
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(v_email)
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Conta % não encontrada em auth.users.', v_email;
  END IF;

  UPDATE auth.users
  SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('platform_admin', true, 'role', 'gestor'),
      updated_at = now()
  WHERE id = v_user_id;
END
$$;

SELECT email,
       raw_app_meta_data ->> 'role' AS perfil,
       coalesce((raw_app_meta_data ->> 'platform_admin')::boolean, false) AS admin_plataforma
FROM auth.users
WHERE lower(email) = 'gestor@gestor.linkce';
