-- Hotfix: some DBs don't have partidos.cupo, only partidos.cupo_jugadores.
-- The trigger function must not reference a non-existent column.

CREATE OR REPLACE FUNCTION public.assign_substitute_slot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_capacity integer;
  v_titulares integer;
  v_suplentes integer;
  v_total integer;
  v_max_roster integer;
BEGIN
  SELECT COALESCE(p.cupo_jugadores, 0)
  INTO v_capacity
  FROM public.partidos p
  WHERE p.id = NEW.partido_id;

  IF COALESCE(v_capacity, 0) <= 0 THEN
    NEW.is_substitute := false;
    NEW.substitute_order := NULL;
    RETURN NEW;
  END IF;

  v_max_roster := v_capacity + 2;

  SELECT COUNT(*)
  INTO v_total
  FROM public.jugadores j
  WHERE j.partido_id = NEW.partido_id;

  IF v_total >= v_max_roster THEN
    RAISE EXCEPTION 'MATCH_FULL_WITH_SUBSTITUTES'
      USING ERRCODE = 'P0001', HINT = 'No hay más cupos (titulares + suplentes).';
  END IF;

  SELECT COUNT(*)
  INTO v_titulares
  FROM public.jugadores j
  WHERE j.partido_id = NEW.partido_id
    AND COALESCE(j.is_substitute, false) = false;

  IF v_titulares < v_capacity THEN
    NEW.is_substitute := false;
    NEW.substitute_order := NULL;
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
  INTO v_suplentes
  FROM public.jugadores j
  WHERE j.partido_id = NEW.partido_id
    AND COALESCE(j.is_substitute, false) = true;

  IF v_suplentes >= 2 THEN
    RAISE EXCEPTION 'MATCH_FULL_WITH_SUBSTITUTES'
      USING ERRCODE = 'P0001', HINT = 'No hay más cupos de suplente.';
  END IF;

  NEW.is_substitute := true;
  NEW.substitute_order := v_suplentes + 1;

  RETURN NEW;
END;
$$;

