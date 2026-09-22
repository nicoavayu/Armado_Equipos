CREATE SCHEMA private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
CREATE ROLE torneos_identity_writer NOLOGIN NOINHERIT;
CREATE TABLE public.torneos_identity (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 core_user_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.torneos_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.torneos_identity FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.torneos_identity FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO torneos_identity_writer;
GRANT SELECT, INSERT ON public.torneos_identity TO torneos_identity_writer;
CREATE POLICY bridge_identity ON public.torneos_identity TO torneos_identity_writer USING (true) WITH CHECK (true);
GRANT SELECT ON public.torneos_identity TO authenticated;
CREATE POLICY own_identity ON public.torneos_identity FOR SELECT TO authenticated USING (
 id = (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
 AND core_user_id::text = nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'core_user_id'
);
-- JWT signature is verified by PostgREST, using the certified bridge JWKS.
-- Same local issuer/audience and lifetime as Phase 1.5. No Core DB lookup.
CREATE FUNCTION private.current_identity_id() RETURNS uuid LANGUAGE plpgsql STABLE
SECURITY INVOKER SET search_path = '' AS $$
DECLARE c jsonb := nullif(current_setting('request.jwt.claims',true),'')::jsonb;
        ident uuid;
BEGIN
 IF c->>'role' IS DISTINCT FROM 'authenticated' THEN RETURN NULL; END IF;
 IF c->>'iss' IS DISTINCT FROM 'urn:arma2:local:identity-bridge'
 OR c->>'aud' IS DISTINCT FROM 'arma2-torneos-local'
 OR c->>'sub' IS NULL OR c->>'core_user_id' IS NULL
 OR c->>'session_id' IS NULL OR c->>'jti' IS NULL
 OR c->>'iat' IS NULL OR c->>'exp' IS NULL OR c->>'nbf' IS NULL
 OR (c->>'exp')::bigint-(c->>'iat')::bigint <> 120
 OR (c->>'nbf')::bigint <> (c->>'iat')::bigint
 OR (c->>'iat')::bigint > extract(epoch FROM now())+5
 OR (c->>'exp')::bigint <= extract(epoch FROM now())-5
 THEN RETURN NULL; END IF;
 SELECT id INTO ident FROM public.torneos_identity
 WHERE id=(c->>'sub')::uuid AND core_user_id=(c->>'core_user_id')::uuid;
 RETURN ident;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN NULL;
END $$;
CREATE FUNCTION private.check_token() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 IF current_user='anon' THEN RETURN; END IF;
 IF private.current_identity_id() IS NULL THEN
 RAISE SQLSTATE 'PT401' USING MESSAGE='invalid identity token'; END IF;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.current_identity_id(), private.check_token() TO anon, authenticated, service_role;
CREATE FUNCTION public.gen_random_uuid() RETURNS uuid LANGUAGE sql VOLATILE SET search_path='' AS $$ SELECT pg_catalog.gen_random_uuid() $$;
REVOKE ALL ON FUNCTION public.gen_random_uuid() FROM PUBLIC,anon,authenticated,service_role;
-- Preserve the certified bridge's INSERT ... ON CONFLICT ... DO UPDATE contract
-- while preventing reassignment of an existing local identity to another Core user.
GRANT UPDATE (core_user_id) ON public.torneos_identity TO torneos_identity_writer;
CREATE FUNCTION private.prevent_identity_reassignment() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.core_user_id IS DISTINCT FROM OLD.core_user_id THEN
  RAISE SQLSTATE '23514' USING MESSAGE='TORNEOS_IDENTITY_MAPPING_IMMUTABLE';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.prevent_identity_reassignment() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER torneos_identity_immutable BEFORE UPDATE ON public.torneos_identity
FOR EACH ROW EXECUTE FUNCTION private.prevent_identity_reassignment();
