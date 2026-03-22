BEGIN;

-- Correct the post-match gate to use the valid starting roster.
-- Substitutes do not help enable post-match actions and also do not
-- invalidate an otherwise complete match when the starters are full.

CREATE OR REPLACE FUNCTION public.get_match_post_match_gate(
  p_partido_id bigint
)
RETURNS TABLE (
  qualifies boolean,
  reason text,
  modalidad text,
  cupo_jugadores integer,
  starter_slots integer,
  required_players integer,
  roster_count integer,
  registered_roster_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_modalidad text;
  v_cupo integer;
  v_starter_slots integer;
  v_required_players integer;
  v_has_is_substitute boolean := false;
  v_roster_count integer := 0;
  v_registered_roster_count integer := 0;
  v_starter_roster_count integer := 0;
  v_registered_starter_roster_count integer := 0;
BEGIN
  IF p_partido_id IS NULL OR p_partido_id <= 0 THEN
    RETURN QUERY
    SELECT
      false,
      'invalid_match_id'::text,
      NULL::text,
      NULL::integer,
      NULL::integer,
      NULL::integer,
      0,
      0;
    RETURN;
  END IF;

  SELECT p.modalidad, p.cupo_jugadores
  INTO v_modalidad, v_cupo
  FROM public.partidos p
  WHERE p.id = p_partido_id;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      false,
      'match_not_found'::text,
      NULL::text,
      NULL::integer,
      NULL::integer,
      NULL::integer,
      0,
      0;
    RETURN;
  END IF;

  v_starter_slots := public.resolve_partido_starter_slots(v_modalidad, v_cupo);
  v_required_players := public.resolve_post_match_required_players(v_starter_slots);

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'jugadores'
      AND column_name = 'is_substitute'
  )
  INTO v_has_is_substitute;

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE j.usuario_id IS NOT NULL)::integer
  INTO v_roster_count, v_registered_roster_count
  FROM public.jugadores j
  WHERE j.partido_id = p_partido_id;

  IF v_has_is_substitute THEN
    EXECUTE $sql$
      SELECT
        COUNT(*)::integer,
        COUNT(*) FILTER (WHERE j.usuario_id IS NOT NULL)::integer
      FROM public.jugadores j
      WHERE j.partido_id = $1
        AND COALESCE(j.is_substitute, false) = false
    $sql$
    INTO v_starter_roster_count, v_registered_starter_roster_count
    USING p_partido_id;

    IF v_starter_roster_count > 0 THEN
      v_roster_count := v_starter_roster_count;
      v_registered_roster_count := v_registered_starter_roster_count;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    v_roster_count = v_required_players,
    CASE
      WHEN v_roster_count = v_required_players THEN 'ok'
      ELSE 'incomplete_roster_for_match_type'
    END::text,
    v_modalidad,
    v_cupo,
    v_starter_slots,
    v_required_players,
    v_roster_count,
    v_registered_roster_count;
END;
$$;

COMMIT;
