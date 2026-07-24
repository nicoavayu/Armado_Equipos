-- ===========================================================================
-- Security patch M4 — Storage jugadores-fotos (Stage A)
-- ---------------------------------------------------------------------------
-- Confirmed holes (bucket jugadores-fotos): anon INSERT + anon UPDATE scoped
-- ONLY by bucket_id => anyone can overwrite anyone's photo; no allowed_mime_types
-- or file_size_limit; predictable object names.
--
-- Stage A (NON-BREAKING):
--   * DROP the anon/authenticated UPDATE policy (there is no legitimate UPDATE:
--     uploads use unique names, so overwriting an existing object is never
--     needed). This closes "overwrite anyone's photo" immediately.
--   * ADD owner-scoped INSERT + UPDATE policies for authenticated, compatible
--     with BOTH the new path "{uid}/{random}.ext" and the legacy flat name
--     "{uid}_{ts}.ext" (name LIKE auth.uid()||'%'). Legacy installed apps keep
--     uploading their own photo.
--   * Constrain the bucket: allowed_mime_types (real image types; SVG dropped —
--     stored-XSS vector in a public bucket) and a 15 MB file_size_limit
--     (matches the client's own DEFAULT_MAX_IMAGE_BYTES so no legit upload is
--     rejected; jpeg/png/webp are already re-encoded to <=1.5 MB client-side).
--   * ADD the guest-photo capability-token table used by the upload Edge
--     Functions (issue-voting-photo-token / upload-voting-photo). RLS on, no
--     anon/authenticated policies => only service_role (Edge Functions) touch it.
--
-- The broad anon INSERT policy (jugadores_fotos_anon_authenticated_insert) is
-- intentionally LEFT until Stage B (20260724134000), which drops it once the
-- web build routes guest uploads through the Edge Function. `public` is NOT
-- changed (would break already-served images). Rollback SQL at the bottom.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Guest-photo capability token (single-use, short-lived). service_role only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.voting_photo_upload_tokens (
  token_hash text PRIMARY KEY,
  match_id bigint NOT NULL,
  player_id bigint NOT NULL,
  guest_session_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voting_photo_upload_tokens_match_session_idx
  ON public.voting_photo_upload_tokens (match_id, guest_session_id);
CREATE INDEX IF NOT EXISTS voting_photo_upload_tokens_expires_idx
  ON public.voting_photo_upload_tokens (expires_at);

ALTER TABLE public.voting_photo_upload_tokens ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated: table is reachable only via service_role
-- (the Edge Functions), which bypasses RLS.
REVOKE ALL ON public.voting_photo_upload_tokens FROM anon, authenticated;
GRANT ALL ON public.voting_photo_upload_tokens TO service_role;

COMMENT ON TABLE public.voting_photo_upload_tokens
  IS 'Single-use, short-lived capability tokens binding a guest voting session to one match/player slot for avatar upload. Written/consumed only by Edge Functions (service_role).';

-- Durable session->slot binding (survives the short token window). A guest
-- session may only ever upload for the ONE player slot it first claimed, even
-- after the rate-limit / token window elapses. PK enforces one slot per
-- (match, session). service_role only.
CREATE TABLE IF NOT EXISTS public.voting_photo_slot_claims (
  match_id bigint NOT NULL,
  guest_session_id text NOT NULL,
  player_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, guest_session_id)
);
ALTER TABLE public.voting_photo_slot_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voting_photo_slot_claims FROM anon, authenticated;
GRANT ALL ON public.voting_photo_slot_claims TO service_role;

COMMENT ON TABLE public.voting_photo_slot_claims
  IS 'Durable (match_id, guest_session_id) -> player_id binding for guest photo uploads. Prevents a session from switching slots regardless of elapsed time. service_role only.';

-- Atomic, permanent claim: binds the session to the requested player if unbound,
-- and ALWAYS returns the bound player_id. The caller (Edge Function) rejects when
-- the returned id differs from the requested one (session already owns another
-- slot). ON CONFLICT DO NOTHING makes concurrent claims deterministic.
CREATE OR REPLACE FUNCTION public.bind_voting_photo_slot(
  p_match_id bigint,
  p_guest_session_id text,
  p_player_id bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bound bigint;
BEGIN
  INSERT INTO public.voting_photo_slot_claims (match_id, guest_session_id, player_id)
  VALUES (p_match_id, p_guest_session_id, p_player_id)
  ON CONFLICT (match_id, guest_session_id) DO NOTHING;

  SELECT player_id INTO v_bound
  FROM public.voting_photo_slot_claims
  WHERE match_id = p_match_id AND guest_session_id = p_guest_session_id;

  RETURN v_bound;
END;
$$;

REVOKE ALL ON FUNCTION public.bind_voting_photo_slot(bigint, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bind_voting_photo_slot(bigint, text, bigint) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Remove anon/authenticated UPDATE (overwrite-anyone hole).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS jugadores_fotos_anon_authenticated_update ON storage.objects;

-- ---------------------------------------------------------------------------
-- 3. Owner-scoped INSERT/UPDATE for authenticated (legacy + new name schemes).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS jugadores_fotos_owner_insert ON storage.objects;
CREATE POLICY jugadores_fotos_owner_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'jugadores-fotos'
  AND name LIKE (auth.uid()::text || '%')
);

DROP POLICY IF EXISTS jugadores_fotos_owner_update ON storage.objects;
CREATE POLICY jugadores_fotos_owner_update
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'jugadores-fotos'
  AND name LIKE (auth.uid()::text || '%')
)
WITH CHECK (
  bucket_id = 'jugadores-fotos'
  AND name LIKE (auth.uid()::text || '%')
);

-- ---------------------------------------------------------------------------
-- 4. Bucket constraints: real image MIME types + size cap.
-- ---------------------------------------------------------------------------
UPDATE storage.buckets
SET
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  file_size_limit = 15728640  -- 15 MB, matches client DEFAULT_MAX_IMAGE_BYTES
WHERE id = 'jugadores-fotos';

COMMIT;

-- ===========================================================================
-- ROLLBACK (Stage A)
-- ===========================================================================
-- BEGIN;
-- UPDATE storage.buckets SET allowed_mime_types = NULL, file_size_limit = NULL
--   WHERE id = 'jugadores-fotos';
-- DROP POLICY IF EXISTS jugadores_fotos_owner_update ON storage.objects;
-- DROP POLICY IF EXISTS jugadores_fotos_owner_insert ON storage.objects;
-- CREATE POLICY jugadores_fotos_anon_authenticated_update ON storage.objects
--   FOR UPDATE TO anon, authenticated
--   USING (bucket_id = 'jugadores-fotos') WITH CHECK (bucket_id = 'jugadores-fotos');
-- DROP FUNCTION IF EXISTS public.bind_voting_photo_slot(bigint, text, bigint);
-- DROP TABLE IF EXISTS public.voting_photo_slot_claims;
-- DROP TABLE IF EXISTS public.voting_photo_upload_tokens;
-- COMMIT;
