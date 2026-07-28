BEGIN;

-- If a team_match is transitioning to cancelled, do not block by challenge.status.
-- This prevents cancellation flows from failing when challenge status is out of sync.
CREATE OR REPLACE FUNCTION public.validate_team_match_payload()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_challenge public.challenges%ROWTYPE;
  v_team_a_format smallint;
  v_team_b_format smallint;
  v_is_cancel_transition boolean;
BEGIN
  SELECT t.format INTO v_team_a_format FROM public.teams t WHERE t.id = NEW.team_a_id;
  SELECT t.format INTO v_team_b_format FROM public.teams t WHERE t.id = NEW.team_b_id;

  IF v_team_a_format IS NULL OR v_team_b_format IS NULL THEN
    RAISE EXCEPTION 'team_a_id/team_b_id invalidos';
  END IF;

  IF NEW.challenge_id IS NULL THEN
    IF NEW.format <> v_team_a_format OR NEW.format <> v_team_b_format THEN
      RAISE EXCEPTION 'team_matches.format debe coincidir con formato de ambos equipos';
    END IF;
  END IF;

  IF NEW.challenge_id IS NOT NULL THEN
    SELECT *
    INTO v_challenge
    FROM public.challenges c
    WHERE c.id = NEW.challenge_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'challenge_id invalido';
    END IF;

    IF v_challenge.accepted_team_id IS NULL THEN
      RAISE EXCEPTION 'challenge_id no tiene rival aceptado';
    END IF;

    v_is_cancel_transition :=
      TG_OP = 'UPDATE'
      AND (
        lower(COALESCE(NEW.status, '')) IN ('cancelled', 'canceled', 'cancelado')
        OR lower(COALESCE(OLD.status, '')) IN ('cancelled', 'canceled', 'cancelado')
      );

    IF v_challenge.status NOT IN ('accepted', 'confirmed', 'completed')
       AND NOT v_is_cancel_transition THEN
      RAISE EXCEPTION 'challenge_id debe estar aceptado para registrar team_match';
    END IF;

    IF NEW.team_a_id <> v_challenge.challenger_team_id
       OR NEW.team_b_id <> v_challenge.accepted_team_id THEN
      RAISE EXCEPTION 'team_matches debe usar los equipos del challenge';
    END IF;

    IF NEW.format <> v_challenge.format THEN
      RAISE EXCEPTION 'team_matches.format debe coincidir con challenges.format';
    END IF;

    IF NEW.format <> v_team_a_format THEN
      RAISE EXCEPTION 'team_matches.format debe coincidir con formato del challenger';
    END IF;

    NEW.is_format_combined := (v_team_b_format <> NEW.format);

    IF TG_OP = 'INSERT'
       AND EXISTS (
         SELECT 1 FROM public.team_matches tm WHERE tm.challenge_id = NEW.challenge_id
       )
    THEN
      RAISE EXCEPTION 'ya existe un team_match para este challenge';
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.challenge_id IS DISTINCT FROM NEW.challenge_id
       AND EXISTS (
         SELECT 1 FROM public.team_matches tm WHERE tm.challenge_id = NEW.challenge_id
       )
    THEN
      RAISE EXCEPTION 'ya existe un team_match para este challenge';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF OLD.status = 'played' AND NEW.status <> 'played' THEN
      RAISE EXCEPTION 'no se puede cambiar estado desde played';
    END IF;

    IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
      RAISE EXCEPTION 'no se puede cambiar estado desde cancelled';
    END IF;

    IF OLD.status = 'pending' AND NEW.status NOT IN ('pending', 'confirmed', 'played', 'cancelled') THEN
      RAISE EXCEPTION 'transicion de estado invalida: % -> %', OLD.status, NEW.status;
    END IF;

    IF OLD.status = 'confirmed' AND NEW.status NOT IN ('pending', 'confirmed', 'played', 'cancelled') THEN
      RAISE EXCEPTION 'transicion de estado invalida: % -> %', OLD.status, NEW.status;
    END IF;
  END IF;

  IF NEW.status = 'played' THEN
    NEW.played_at := COALESCE(NEW.played_at, NEW.scheduled_at, now());
  END IF;

  NEW.location_name := COALESCE(NULLIF(btrim(COALESCE(NEW.location, '')), ''), NEW.location_name);

  RETURN NEW;
END;
$$;

COMMIT;
