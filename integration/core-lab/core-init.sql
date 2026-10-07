-- Core lab bootstrap at container init. GoTrue owns and migrates `auth`;
-- storage-api owns and migrates `storage`. The real Core migrations are applied
-- afterwards by lab.mjs as `postgres`, like hosted Supabase does.
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
ALTER ROLE supabase_auth_admin SET search_path = auth, public;
-- Realtime keeps its tenant catalog in `_realtime` (created by the hosted platform).
CREATE SCHEMA IF NOT EXISTS _realtime AUTHORIZATION supabase_admin;
