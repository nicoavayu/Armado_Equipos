-- Disposable POC bootstrap; intentionally outside supabase/migrations.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
CREATE ROLE poc_identity_writer LOGIN;
GRANT USAGE ON SCHEMA public TO poc_identity_writer;

CREATE TABLE public.torneos_identity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  core_user_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.sso_probe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES public.torneos_identity(id),
  note text NOT NULL CHECK (length(note) <= 200)
);
ALTER TABLE public.torneos_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.torneos_identity FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sso_probe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sso_probe FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.torneos_identity, public.sso_probe FROM anon, authenticated;
GRANT SELECT ON public.torneos_identity TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sso_probe TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.torneos_identity TO poc_identity_writer;
CREATE POLICY bridge_identity ON public.torneos_identity TO poc_identity_writer
  USING (true) WITH CHECK (true);
CREATE POLICY own_identity ON public.torneos_identity FOR SELECT TO authenticated
  USING (id = (current_setting('request.jwt.claims', true)::jsonb->>'sub')::uuid AND core_user_id::text =
    current_setting('request.jwt.claims', true)::jsonb->>'core_user_id');
CREATE POLICY own_probe ON public.sso_probe TO authenticated
  USING (identity_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub')::uuid AND EXISTS (
    SELECT 1 FROM public.torneos_identity i WHERE i.id = identity_id
  ))
  WITH CHECK (identity_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub')::uuid AND EXISTS (
    SELECT 1 FROM public.torneos_identity i WHERE i.id = identity_id
  ));

CREATE FUNCTION private.check_token() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE c jsonb := current_setting('request.jwt.claims', true)::jsonb;
BEGIN
  IF c->>'iss' IS DISTINCT FROM 'urn:arma2:local:identity-bridge'
    OR c->>'aud' IS DISTINCT FROM 'arma2-torneos-local'
    OR c->>'role' IS DISTINCT FROM 'authenticated'
    OR c->>'sub' IS NULL OR c->>'core_user_id' IS NULL
    OR c->>'session_id' IS NULL OR c->>'jti' IS NULL
    OR c->>'iat' IS NULL OR c->>'exp' IS NULL OR c->>'nbf' IS NULL
    OR (c->>'exp')::bigint - (c->>'iat')::bigint <> 120
    OR (c->>'nbf')::bigint <> (c->>'iat')::bigint
    OR (c->>'iat')::bigint > extract(epoch FROM now()) + 5
    OR (c->>'exp')::bigint <= extract(epoch FROM now()) - 5
  THEN RAISE SQLSTATE 'PT401' USING MESSAGE = 'invalid identity token'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.torneos_identity
    WHERE id = (c->>'sub')::uuid AND core_user_id = (c->>'core_user_id')::uuid)
  THEN RAISE SQLSTATE 'PT401' USING MESSAGE = 'identity mismatch'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.check_token() FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.check_token() TO authenticated;
-- Only authenticator can SET ROLE; it is never exposed through the browser.
GRANT authenticated, anon TO authenticator;
