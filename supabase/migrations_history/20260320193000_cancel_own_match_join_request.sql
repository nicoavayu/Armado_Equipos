BEGIN;

CREATE OR REPLACE FUNCTION public.cancel_own_match_join_request(
  p_match_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_request_id bigint;
  v_rows_updated integer := 0;
  v_applied_status text := null;
  v_has_cancelled_at boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  SELECT r.id
  INTO v_request_id
  FROM public.match_join_requests r
  WHERE r.match_id = p_match_id
    AND r.user_id = v_user_id
    AND lower(trim(COALESCE(r.status, ''))) = 'pending'
  ORDER BY r.created_at DESC NULLS LAST, r.id DESC
  LIMIT 1;

  IF v_request_id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'match_join_requests'
      AND column_name = 'cancelled_at'
  )
  INTO v_has_cancelled_at;

  BEGIN
    IF v_has_cancelled_at THEN
      UPDATE public.match_join_requests
      SET
        status = 'cancelled',
        cancelled_at = COALESCE(cancelled_at, now())
      WHERE id = v_request_id
        AND match_id = p_match_id
        AND user_id = v_user_id
        AND lower(trim(COALESCE(status, ''))) = 'pending';
    ELSE
      UPDATE public.match_join_requests
      SET status = 'cancelled'
      WHERE id = v_request_id
        AND match_id = p_match_id
        AND user_id = v_user_id
        AND lower(trim(COALESCE(status, ''))) = 'pending';
    END IF;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    v_applied_status := 'cancelled';
  EXCEPTION
    WHEN check_violation OR invalid_text_representation THEN
      UPDATE public.match_join_requests
      SET status = 'rejected'
      WHERE id = v_request_id
        AND match_id = p_match_id
        AND user_id = v_user_id
        AND lower(trim(COALESCE(status, ''))) = 'pending';

      GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
      v_applied_status := 'rejected';
  END;

  IF v_rows_updated = 0 THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'status', v_applied_status,
    'request_id', v_request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_own_match_join_request(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_own_match_join_request(bigint) TO authenticated;

COMMIT;
