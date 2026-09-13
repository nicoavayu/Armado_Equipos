-- GoTrue owns its own auth schema and runs its own auth migrations.
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
ALTER ROLE supabase_auth_admin SET search_path = auth, public;
CREATE ROLE poc_session_reader LOGIN;
GRANT USAGE ON SCHEMA auth TO poc_session_reader;
-- Column grants and the two reader policies are installed after GoTrue runs
-- its own migrations. Never grant access to passwords or refresh tokens.
