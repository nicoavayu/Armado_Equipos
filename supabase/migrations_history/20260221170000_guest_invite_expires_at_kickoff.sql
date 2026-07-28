-- Guest invite policy update:
-- - Expire exactly at match kickoff (fecha + hora), without grace period.
-- - Keep max_uses tied to roster capacity with a minimum of 26.
-- - Backfill existing tokens to the same kickoff expiry rule.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_guest_match_invite(p_partido_id bigint)
RETURNS TABLE(token text, expires_at timestamptz, max_uses int, uses_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing public.guest_match_invites%ROWTYPE;
  v_target_expires timestamptz;
  v_target_max_uses int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT
    CASE
      WHEN p.fecha IS NULL THEN NULL::timestamptz
      WHEN replace(trim(COALESCE(p.hora::text, '')), '.', ':') ~ '^[0-9]{1,2}:[0-9]{2}' THEN
        p.fecha::timestamp
        + substring(replace(trim(COALESCE(p.hora::text, '')), '.', ':') FROM '^[0-9]{1,2}:[0-9]{2}')::time
      ELSE
        p.fecha::timestamp
    END AS target_expires,
    GREATEST(26, COALESCE(p.cupo_jugadores, 0) + 4) AS target_max_uses
  INTO v_target_expires, v_target_max_uses
  FROM public.partidos p
  WHERE p.id = p_partido_id
    AND p.creado_por = v_uid
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  IF v_target_expires IS NULL THEN
    RAISE EXCEPTION 'match_without_start_datetime';
  END IF;

  IF v_target_expires <= now() THEN
    RAISE EXCEPTION 'match_already_started';
  END IF;

  -- Reuse newest active token when possible and align it to exact kickoff expiry.
  SELECT *
  INTO v_existing
  FROM public.guest_match_invites g
  WHERE g.partido_id = p_partido_id
    AND g.revoked_at IS NULL
    AND g.expires_at > now()
    AND g.uses_count < g.max_uses
  ORDER BY g.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.guest_match_invites g
    SET
      expires_at = v_target_expires,
      max_uses = GREATEST(g.max_uses, v_target_max_uses)
    WHERE g.id = v_existing.id
    RETURNING * INTO v_existing;

    RETURN QUERY
      SELECT v_existing.token, v_existing.expires_at, v_existing.max_uses, v_existing.uses_count;
    RETURN;
  END IF;

  INSERT INTO public.guest_match_invites(partido_id, token, created_by, expires_at, max_uses, uses_count)
  VALUES (
    p_partido_id,
    replace(gen_random_uuid()::text, '-', ''),
    v_uid,
    v_target_expires,
    v_target_max_uses,
    0
  )
  RETURNING guest_match_invites.token, guest_match_invites.expires_at, guest_match_invites.max_uses, guest_match_invites.uses_count
  INTO token, expires_at, max_uses, uses_count;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_guest_match_invite(bigint) TO authenticated;

ALTER TABLE public.guest_match_invites
  ALTER COLUMN max_uses SET DEFAULT 26;

WITH invite_targets AS (
  SELECT
    g.id,
    CASE
      WHEN p.fecha IS NULL THEN NULL::timestamptz
      WHEN replace(trim(COALESCE(p.hora::text, '')), '.', ':') ~ '^[0-9]{1,2}:[0-9]{2}' THEN
        p.fecha::timestamp
        + substring(replace(trim(COALESCE(p.hora::text, '')), '.', ':') FROM '^[0-9]{1,2}:[0-9]{2}')::time
      ELSE
        p.fecha::timestamp
    END AS target_expires,
    GREATEST(26, COALESCE(p.cupo_jugadores, 0) + 4) AS target_max_uses
  FROM public.guest_match_invites g
  JOIN public.partidos p ON p.id = g.partido_id
  WHERE g.revoked_at IS NULL
)
UPDATE public.guest_match_invites g
SET
  expires_at = t.target_expires,
  max_uses = GREATEST(g.max_uses, t.target_max_uses)
FROM invite_targets t
WHERE g.id = t.id
  AND t.target_expires IS NOT NULL
  AND (
    g.expires_at IS DISTINCT FROM t.target_expires
    OR g.max_uses < t.target_max_uses
  );

COMMIT;
