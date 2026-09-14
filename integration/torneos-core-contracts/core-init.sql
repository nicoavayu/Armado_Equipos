-- Core database bootstrap at container init (before GoTrue and before the real
-- Core migrations are applied by lab.mjs as `postgres`, the same role hosted
-- Supabase uses for migrations).
-- GoTrue owns its own auth schema and runs its own auth migrations.
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
ALTER ROLE supabase_auth_admin SET search_path = auth, public;
-- Certified Phase 1.5 session reader for the identity exchange (column grants and
-- the two reader policies are installed after GoTrue has migrated).
CREATE ROLE poc_session_reader LOGIN;
GRANT USAGE ON SCHEMA auth TO poc_session_reader;
-- storage-api is not part of this lab; the Core canonical baseline seeds bucket
-- rows and policies on these two relations, so provide their minimal shape.
CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, path_tokens text[]);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT ALL ON storage.buckets, storage.objects TO postgres;
