-- Suplentes automáticos por partido (+2) y promoción automática al liberar cupo.

ALTER TABLE public.jugadores
  ADD COLUMN IF NOT EXISTS is_substitute boolean NOT NULL DEFAULT false;

ALTER TABLE public.jugadores
  ADD COLUMN IF NOT EXISTS substitute_order smallint;

CREATE INDEX IF NOT EXISTS jugadores_partido_substitute_idx
  ON public.jugadores (partido_id, is_substitute, substitute_order, created_at);

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
  -- Some DBs don't have partidos.cupo; keep it strictly on cupo_jugadores.
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

DROP TRIGGER IF EXISTS trg_assign_substitute_slot ON public.jugadores;
CREATE TRIGGER trg_assign_substitute_slot
BEFORE INSERT ON public.jugadores
FOR EACH ROW
EXECUTE FUNCTION public.assign_substitute_slot();

CREATE OR REPLACE FUNCTION public.promote_substitute_after_player_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promoted_id bigint;
  v_promoted_user uuid;
  v_promoted_name text;
  v_match_name text;
BEGIN
  -- Si salió un titular, promover el primer suplente.
  IF COALESCE(OLD.is_substitute, false) = false THEN
    SELECT j.id, j.usuario_id, j.nombre
      INTO v_promoted_id, v_promoted_user, v_promoted_name
    FROM public.jugadores j
    WHERE j.partido_id = OLD.partido_id
      AND COALESCE(j.is_substitute, false) = true
    ORDER BY COALESCE(j.substitute_order, 999), j.created_at, j.id
    LIMIT 1;

    IF v_promoted_id IS NOT NULL THEN
      UPDATE public.jugadores
      SET is_substitute = false,
          substitute_order = NULL
      WHERE id = v_promoted_id;

      -- Reordenar suplentes restantes
      WITH ordered AS (
        SELECT id,
               ROW_NUMBER() OVER (ORDER BY COALESCE(substitute_order, 999), created_at, id) AS rn
        FROM public.jugadores
        WHERE partido_id = OLD.partido_id
          AND COALESCE(is_substitute, false) = true
      )
      UPDATE public.jugadores j
      SET substitute_order = o.rn
      FROM ordered o
      WHERE j.id = o.id;

      IF v_promoted_user IS NOT NULL THEN
        SELECT COALESCE(nombre, 'Partido') INTO v_match_name
        FROM public.partidos
        WHERE id = OLD.partido_id;

        INSERT INTO public.notifications (user_id, type, title, message, partido_id, data, read, created_at)
        VALUES (
          v_promoted_user,
          'substitute_promoted',
          'Ahora sos titular',
          FORMAT('Subiste de suplente a titular en "%s".', v_match_name),
          OLD.partido_id,
          jsonb_build_object('matchId', OLD.partido_id, 'playerName', v_promoted_name),
          false,
          now()
        );
      END IF;
    END IF;
  ELSE
    -- Si salió un suplente, solo reordenar la cola.
    WITH ordered AS (
      SELECT id,
             ROW_NUMBER() OVER (ORDER BY COALESCE(substitute_order, 999), created_at, id) AS rn
      FROM public.jugadores
      WHERE partido_id = OLD.partido_id
        AND COALESCE(is_substitute, false) = true
    )
    UPDATE public.jugadores j
    SET substitute_order = o.rn
    FROM ordered o
    WHERE j.id = o.id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_promote_substitute_after_player_leave ON public.jugadores;
CREATE TRIGGER trg_promote_substitute_after_player_leave
AFTER DELETE ON public.jugadores
FOR EACH ROW
EXECUTE FUNCTION public.promote_substitute_after_player_leave();
