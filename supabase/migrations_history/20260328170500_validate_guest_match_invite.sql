-- Validate a public guest invite link without consuming it.
-- This lets the web flow reject tampered links before the join attempt.

CREATE OR REPLACE FUNCTION public.validate_guest_match_invite(
  p_partido_id bigint,
  p_codigo text,
  p_token text
)
RETURNS TABLE(ok boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match_code text;
  v_token text := trim(COALESCE(p_token, ''));
BEGIN
  SELECT trim(COALESCE(p.codigo, ''))
  INTO v_match_code
  FROM public.partidos p
  WHERE p.id = p_partido_id;

  IF NOT FOUND THEN
    RETURN QUERY
      SELECT false, 'not_found'::text;
    RETURN;
  END IF;

  IF trim(COALESCE(p_codigo, '')) = '' OR trim(COALESCE(p_codigo, '')) <> v_match_code THEN
    RETURN QUERY
      SELECT false, 'invalid_code'::text;
    RETURN;
  END IF;

  IF v_token = '' THEN
    RETURN QUERY
      SELECT false, 'invalid_invite'::text;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.guest_match_invites g
    WHERE g.partido_id = p_partido_id
      AND g.token = v_token
      AND g.revoked_at IS NULL
      AND g.expires_at > now()
      AND g.uses_count < g.max_uses
  ) THEN
    RETURN QUERY
      SELECT false, 'invalid_invite'::text;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT true, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_guest_match_invite(bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_guest_match_invite(bigint, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.validate_guest_match_invite(bigint, text, text) TO authenticated;

COMMENT ON FUNCTION public.validate_guest_match_invite(bigint, text, text)
IS 'Validates a guest self-join invite link without consuming the token.';
