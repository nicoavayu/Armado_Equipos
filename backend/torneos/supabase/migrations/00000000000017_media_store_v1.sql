-- MEDIA-STORE-V1 — the storage authorization the torneos-media-store function asks before each operation.
--
-- Why: hosted Supabase Storage verifies only the project's own signing keys. The bridge's RS256 tokens (trusted by the
-- Data API through Third-Party Auth) are refused by Storage before any policy runs ("alg" not allowed), so the gateway
-- can no longer write, remove or sign with the caller's token. The torneos-media-store Edge Function performs those
-- operations with the project's service key, which never leaves Supabase, and ONLY after this function says the
-- caller may: the decision stays in the database, with the bucket rules of 00000000000010 and 00000000000012.
--
-- What it adds, and nothing else:
--   * public.authorize_tournament_storage_objects(bucket, operation, names[]): the subset of names the caller's identity
--     may read / write / delete, evaluated with the EXISTING storage predicates (unchanged):
--       tournament-branding read   → can_read_tournament_branding_object
--       tournament-branding write  → is_tournament_branding_path + can_write_tournament_branding_object
--       tournament-branding delete → can_write_tournament_branding_object AND the object is referenced nowhere
--                                    (organization / tournament logo, team shield, published shield snapshot): stricter
--                                    than the delete policy, which also allowed removing a logo in use
--       tournament-media    write  → can_write_tournament_media_gateway_object (the gateway's session claim)
--       tournament-media    delete → can_delete_tournament_media_gateway_object (an upload that never became an asset)
--       tournament-media    read   → can_read_tournament_media_object
--     No identity → 42501 TORNEOS_AUTH_REQUIRED. Malformed input (unknown bucket or operation, 0 or more than 200
--     names) → 22023. It never lists objects, never accepts a role or a claim, and returns only names it was given.
--   * private.tournament_branding_object_in_use(name): the reference check above (no grant to any client role).
-- Buckets stay private; no policy, table grant or bucket changes.
BEGIN;

DO $pre$
BEGIN
  IF to_regprocedure('public.can_write_tournament_branding_object(text)') IS NULL
    OR to_regprocedure('public.can_read_tournament_branding_object(text)') IS NULL
    OR to_regprocedure('public.is_tournament_branding_path(text,text)') IS NULL
    OR to_regprocedure('public.can_write_tournament_media_gateway_object(text)') IS NULL
    OR to_regprocedure('public.can_delete_tournament_media_gateway_object(text)') IS NULL
    OR to_regprocedure('public.can_read_tournament_media_object(text)') IS NULL
    OR to_regprocedure('private.current_identity_id()') IS NULL THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_STORE_V1_PRECONDITION_FAILED: 00000000000010 and 00000000000012 are required';
  END IF;
  IF to_regprocedure('public.authorize_tournament_storage_objects(text,text,text[])') IS NOT NULL
    OR to_regprocedure('private.tournament_branding_object_in_use(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_STORE_V1_PRECONDITION_FAILED: already applied';
  END IF;
  IF (select public from storage.buckets where id = 'tournament-branding') IS DISTINCT FROM false
    OR (select public from storage.buckets where id = 'tournament-media') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_STORE_V1_PRECONDITION_FAILED: both buckets must exist and be private';
  END IF;
END
$pre$;

create function private.tournament_branding_object_in_use(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.tournament_organizations organization where organization.logo_path = p_name)
    or exists (select 1 from public.tournaments tournament where tournament.logo_path = p_name)
    or exists (select 1 from public.tournament_team_entries entry where entry.shield_path = p_name)
    or exists (select 1 from public.tournament_competition_participants participant
               where participant.snapshot_shield_path = p_name);
$$;
revoke all on function private.tournament_branding_object_in_use(text) from public, anon, authenticated, service_role;

create function public.authorize_tournament_storage_objects(p_bucket text, p_operation text, p_names text[])
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_allowed text[] := array[]::text[];
begin
  if private.current_identity_id() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_bucket is null or p_bucket not in ('tournament-branding', 'tournament-media')
    or p_operation is null or p_operation not in ('read', 'write', 'delete')
    or p_names is null or cardinality(p_names) not between 1 and 200
    or array_position(p_names, null) is not null then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_ARGUMENTS';
  end if;
  foreach v_name in array p_names loop
    if v_name = any (v_allowed) then
      continue;
    end if;
    if (p_bucket = 'tournament-branding' and p_operation = 'read'
          and public.can_read_tournament_branding_object(v_name))
      or (p_bucket = 'tournament-branding' and p_operation = 'write'
          and public.is_tournament_branding_path(v_name)
          and public.can_write_tournament_branding_object(v_name))
      or (p_bucket = 'tournament-branding' and p_operation = 'delete'
          and public.is_tournament_branding_path(v_name)
          and public.can_write_tournament_branding_object(v_name)
          and not private.tournament_branding_object_in_use(v_name))
      or (p_bucket = 'tournament-media' and p_operation = 'write'
          and public.can_write_tournament_media_gateway_object(v_name))
      or (p_bucket = 'tournament-media' and p_operation = 'delete'
          and public.can_delete_tournament_media_gateway_object(v_name))
      or (p_bucket = 'tournament-media' and p_operation = 'read'
          and public.can_read_tournament_media_object(v_name)) then
      v_allowed := v_allowed || v_name;
    end if;
  end loop;
  return v_allowed;
end;
$$;
-- Applied as postgres (the hosted installer), whose default privileges grant EXECUTE on new public functions to anon:
-- revoked explicitly; only an authenticated identity may ask.
revoke all on function public.authorize_tournament_storage_objects(text, text, text[]) from public, anon, service_role;
grant execute on function public.authorize_tournament_storage_objects(text, text, text[]) to authenticated;

DO $post$
BEGIN
  IF has_function_privilege('anon', 'public.authorize_tournament_storage_objects(text,text,text[])', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.authorize_tournament_storage_objects(text,text,text[])', 'EXECUTE')
    OR has_function_privilege('anon', 'private.tournament_branding_object_in_use(text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'private.tournament_branding_object_in_use(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_STORE_V1_POSTCONDITION_FAILED: grants';
  END IF;
  IF (select public from storage.buckets where id = 'tournament-branding') IS DISTINCT FROM false
    OR (select public from storage.buckets where id = 'tournament-media') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_STORE_V1_POSTCONDITION_FAILED: buckets must stay private';
  END IF;
END
$post$;

COMMIT;
