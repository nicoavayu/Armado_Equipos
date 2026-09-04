-- LOCAL PROPOSAL ONLY. Not certified or authorized for Production execution.
-- Production-specific prerequisite, executed BEFORE the historical Torneos
-- chain despite this new filename. Do not use db push to determine its order.
-- These exact signatures are absent in the 2026-09-03 Production snapshot.
-- CREATE (not OR REPLACE) deliberately aborts on unexpected drift.
-- SQL/invoker wrappers preserve pgcrypto in extensions; no extension move,
-- legacy object replacement, role changes, data writes or network activity.
CREATE FUNCTION public.digest(data text, type text) RETURNS bytea
LANGUAGE sql IMMUTABLE STRICT SET search_path = ''
AS $$ SELECT extensions.digest(data, type) $$;

CREATE FUNCTION public.gen_random_bytes(p_length integer) RETURNS bytea
LANGUAGE sql VOLATILE SET search_path = ''
AS $$ SELECT extensions.gen_random_bytes(p_length) $$;

-- Production default ACL grants API roles EXECUTE: revoke explicitly, not
-- just PUBLIC. Torneos SECURITY DEFINER owners invoke these internally.
REVOKE ALL ON FUNCTION public.digest(text,text)
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.gen_random_bytes(integer)
FROM PUBLIC, anon, authenticated, service_role;
