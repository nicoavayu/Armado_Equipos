BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_challenge_team_squad_limits()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_challenge public.challenges%ROWTYPE;
  v_player_user_id public.jugadores.usuario_id%TYPE;
  v_starters_count integer := 0;
  v_substitutes_count integer := 0;
  v_selected_count integer := 0;
BEGIN
  SELECT *
  INTO v_challenge
  FROM public.challenges c
  WHERE c.id = NEW.challenge_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge invalido para challenge_team_squad';
  END IF;

  IF NEW.team_id IS DISTINCT FROM v_challenge.challenger_team_id
     AND NEW.team_id IS DISTINCT FROM v_challenge.accepted_team_id THEN
    RAISE EXCEPTION 'team_id no pertenece al challenge';
  END IF;

  SELECT j.usuario_id
  INTO v_player_user_id
  FROM public.jugadores j
  WHERE j.id = NEW.player_id
  LIMIT 1;

  -- Manual players do not confirm availability themselves.
  IF v_player_user_id IS NULL THEN
    IF COALESCE(NEW.availability_status, 'pending') = 'pending' THEN
      NEW.availability_status := 'available';
    END IF;

    IF COALESCE(NEW.availability_status, '') = 'available' THEN
      NEW.responded_at := COALESCE(NEW.responded_at, now());
    END IF;
  END IF;

  IF NEW.availability_status = 'unavailable' THEN
    NEW.selection_status := 'not_selected';
    NEW.approved_by_captain := false;
  END IF;

  IF NEW.selection_status = 'not_selected' THEN
    NEW.approved_by_captain := false;
  END IF;

  IF NEW.approved_by_captain AND NEW.selection_status IN ('starter', 'substitute') THEN
    IF NEW.availability_status <> 'available' THEN
      RAISE EXCEPTION 'Solo jugadores disponibles pueden ser convocados';
    END IF;

    SELECT
      COUNT(*) FILTER (WHERE selection_status = 'starter' AND approved_by_captain = true),
      COUNT(*) FILTER (WHERE selection_status = 'substitute' AND approved_by_captain = true),
      COUNT(*) FILTER (WHERE selection_status IN ('starter', 'substitute') AND approved_by_captain = true)
    INTO v_starters_count, v_substitutes_count, v_selected_count
    FROM public.challenge_team_squad cts
    WHERE cts.challenge_id = NEW.challenge_id
      AND cts.team_id = NEW.team_id
      AND cts.id IS DISTINCT FROM NEW.id;

    IF NEW.selection_status = 'starter' AND (v_starters_count + 1) > COALESCE(v_challenge.max_starters_per_team, 0) THEN
      RAISE EXCEPTION 'No podes superar % titulares para este desafio', v_challenge.max_starters_per_team;
    END IF;

    IF NEW.selection_status = 'substitute' AND (v_substitutes_count + 1) > COALESCE(v_challenge.max_substitutes_per_team, 0) THEN
      RAISE EXCEPTION 'No podes superar % suplentes para este desafio', v_challenge.max_substitutes_per_team;
    END IF;

    IF (v_selected_count + 1) > COALESCE(v_challenge.max_selected_per_team, 0) THEN
      RAISE EXCEPTION 'No podes superar % convocados para este desafio', v_challenge.max_selected_per_team;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

UPDATE public.challenge_team_squad cts
SET
  availability_status = 'available',
  responded_at = COALESCE(cts.responded_at, now()),
  updated_at = now()
FROM public.jugadores j,
     public.challenges c
WHERE cts.player_id = j.id
  AND cts.challenge_id = c.id
  AND j.usuario_id IS NULL
  AND COALESCE(cts.availability_status, 'pending') = 'pending'
  AND c.accepted_team_id IS NOT NULL
  AND COALESCE(c.squad_status, 'not_open') IN ('open', 'closed')
  AND lower(COALESCE(c.status, '')) NOT IN ('completed', 'canceled', 'cancelled');

COMMIT;
