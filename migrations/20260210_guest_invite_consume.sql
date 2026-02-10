-- Consume an invite token (atomic increment) for guest self-join.
-- Only callable by service_role (edge function uses service role key).

CREATE OR REPLACE FUNCTION public.consume_guest_match_invite(
  p_partido_id bigint,
  p_token text
)
RETURNS TABLE(ok boolean, reason text, expires_at timestamptz, max_uses int, uses_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.guest_match_invites%rowtype;
BEGIN
  UPDATE public.guest_match_invites g
  SET uses_count = g.uses_count + 1
  WHERE g.partido_id = p_partido_id
    AND g.token = p_token
    AND g.revoked_at IS NULL
    AND g.expires_at > now()
    AND g.uses_count < g.max_uses
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN QUERY
      SELECT false, 'invalid_or_expired'::text, NULL::timestamptz, NULL::int, NULL::int;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT true, NULL::text, v_row.expires_at, v_row.max_uses, v_row.uses_count;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_guest_match_invite(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_guest_match_invite(bigint, text) TO service_role;

