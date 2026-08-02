BEGIN;

-- Allow current captains to publish open challenges (not only team owners).
CREATE OR REPLACE FUNCTION public.validate_challenge_payload()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := auth.role();
  v_is_service_role boolean := COALESCE(v_role, '') = 'service_role';
  v_challenger_format smallint;
  v_accepted_format smallint;
BEGIN
  SELECT t.format
  INTO v_challenger_format
  FROM public.teams t
  WHERE t.id = NEW.challenger_team_id;

  IF v_challenger_format IS NULL THEN
    RAISE EXCEPTION 'challenger_team_id invalido';
  END IF;

  IF NEW.format <> v_challenger_format THEN
    RAISE EXCEPTION 'challenge.format debe coincidir con teams.format del challenger';
  END IF;

  IF NEW.accepted_team_id IS NOT NULL THEN
    SELECT t.format
    INTO v_accepted_format
    FROM public.teams t
    WHERE t.id = NEW.accepted_team_id;

    IF v_accepted_format IS NULL THEN
      RAISE EXCEPTION 'accepted_team_id invalido';
    END IF;

    IF NEW.accepted_team_id = NEW.challenger_team_id THEN
      RAISE EXCEPTION 'challenger_team_id y accepted_team_id no pueden ser iguales';
    END IF;
  END IF;

  IF NEW.status = 'open' THEN
    IF NEW.accepted_team_id IS NOT NULL OR NEW.accepted_by_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'challenges open no pueden tener accepted_team_id/accepted_by_user_id';
    END IF;
  END IF;

  IF NEW.status IN ('accepted', 'confirmed', 'completed')
     AND (NEW.accepted_team_id IS NULL OR NEW.accepted_by_user_id IS NULL) THEN
    RAISE EXCEPTION 'status % requiere accepted_team_id y accepted_by_user_id', NEW.status;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT v_is_service_role THEN
      IF v_uid IS NULL THEN
        RAISE EXCEPTION 'usuario no autenticado';
      END IF;

      IF NOT public.team_user_is_captain_or_owner(NEW.challenger_team_id, v_uid) THEN
        RAISE EXCEPTION 'solo owner/capitan del challenger_team puede crear el challenge';
      END IF;

      IF NEW.status <> 'open' THEN
        RAISE EXCEPTION 'challenge inicial debe ser open';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF OLD.status IN ('completed', 'canceled') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'no se puede cambiar estado desde %', OLD.status;
  END IF;

  IF OLD.accepted_team_id IS NOT NULL
     AND NEW.accepted_team_id IS DISTINCT FROM OLD.accepted_team_id THEN
    RAISE EXCEPTION 'accepted_team_id no puede cambiar una vez asignado';
  END IF;

  IF OLD.accepted_by_user_id IS NOT NULL
     AND NEW.accepted_by_user_id IS DISTINCT FROM OLD.accepted_by_user_id THEN
    RAISE EXCEPTION 'accepted_by_user_id no puede cambiar una vez asignado';
  END IF;

  IF OLD.status <> NEW.status THEN
    IF OLD.status = 'open' AND NEW.status = 'accepted' THEN
      IF NOT v_is_service_role THEN
        IF v_uid IS NULL THEN
          RAISE EXCEPTION 'usuario no autenticado';
        END IF;

        IF NEW.accepted_by_user_id IS DISTINCT FROM v_uid THEN
          RAISE EXCEPTION 'accepted_by_user_id debe ser auth.uid()';
        END IF;

        IF NOT public.team_user_is_admin_or_owner(NEW.accepted_team_id, v_uid) THEN
          RAISE EXCEPTION 'solo owner/admin del accepted_team puede aceptar';
        END IF;
      END IF;

    ELSIF OLD.status = 'accepted' AND NEW.status = 'confirmed' THEN
      IF NOT v_is_service_role THEN
        IF v_uid IS NULL OR NOT public.challenge_user_is_owner_or_captain(OLD.id, v_uid) THEN
          RAISE EXCEPTION 'solo owner/capitan involucrado puede confirmar';
        END IF;
      END IF;

    ELSIF OLD.status = 'confirmed' AND NEW.status = 'completed' THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.team_matches tm
        WHERE tm.challenge_id = OLD.id
      ) THEN
        RAISE EXCEPTION 'no se puede completar challenge sin team_match';
      END IF;

      IF NOT v_is_service_role THEN
        IF v_uid IS NULL OR NOT public.challenge_user_is_owner_or_captain(OLD.id, v_uid) THEN
          RAISE EXCEPTION 'solo owner/capitan involucrado puede completar';
        END IF;
      END IF;

    ELSIF NEW.status = 'canceled' AND OLD.status IN ('open', 'accepted', 'confirmed') THEN
      IF NOT v_is_service_role THEN
        IF v_uid IS NULL OR NOT public.challenge_user_is_owner_or_captain(OLD.id, v_uid) THEN
          RAISE EXCEPTION 'solo owner/capitan involucrado puede cancelar';
        END IF;
      END IF;

    ELSE
      RAISE EXCEPTION 'transicion de estado invalida: % -> %', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS challenges_insert_owner_of_challenger ON public.challenges;
CREATE POLICY challenges_insert_owner_of_challenger
ON public.challenges
FOR INSERT
TO authenticated
WITH CHECK (
  public.team_user_is_captain_or_owner(challenger_team_id, auth.uid())
  AND status = 'open'
  AND accepted_team_id IS NULL
  AND accepted_by_user_id IS NULL
);

COMMIT;
