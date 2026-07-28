CREATE OR REPLACE FUNCTION public.cancel_partido_with_notification(
  p_partido_id bigint,
  p_reason text DEFAULT 'Partido cancelado'
) RETURNS jsonb AS $$
DECLARE
  v_result jsonb;
  v_match_name text;
  v_trimmed_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_default_reason boolean;
  v_message text;
BEGIN
  SELECT NULLIF(btrim(nombre), '')
  INTO v_match_name
  FROM public.partidos
  WHERE id = p_partido_id;

  v_default_reason := COALESCE(lower(v_trimmed_reason), '') IN (
    '',
    'partido cancelado',
    'partido cancelado por el administrador'
  );

  v_message := CASE
    WHEN v_match_name IS NOT NULL AND v_default_reason THEN
      format('El partido "%s" fue cancelado por el administrador.', v_match_name)
    WHEN v_match_name IS NOT NULL AND v_trimmed_reason IS NOT NULL THEN
      format('El partido "%s" fue cancelado. %s', v_match_name, v_trimmed_reason)
    WHEN v_trimmed_reason IS NOT NULL THEN
      v_trimmed_reason
    ELSE
      'El partido fue cancelado por el administrador.'
  END;

  v_result := public.enqueue_partido_notification(
    p_partido_id,
    'match_cancelled',
    'Partido cancelado',
    v_message,
    jsonb_build_object(
      'match_id', p_partido_id,
      'partido_id', p_partido_id,
      'reason', COALESCE(v_trimmed_reason, 'Partido cancelado'),
      'match_name', v_match_name,
      'partido_nombre', v_match_name
    )
  );

  UPDATE public.partidos
  SET estado = 'cancelado', deleted_at = now()
  WHERE id = p_partido_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.cancel_partido_with_notification(bigint, text) TO authenticated;
