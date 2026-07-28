-- ============================================================================
-- Directed team challenges (Equipo A -> Equipo B) + reglas del MVP
-- Date: 2026-06-17
--
-- Agrega desafíos DIRIGIDOS a un equipo puntual sobre la tabla `challenges`
-- existente (compatibilidad total: challenged_team_id NULL = desafío genérico):
--   * challenges.challenged_team_id  -> equipo objetivo del desafío.
--   * challenges.expires_at          -> vencimiento (48 h para aceptar).
--   * status nuevos: 'rejected' y 'expired'.
--   * validate_challenge_payload()   -> reproduce la lógica vigente + agrega
--       validación del challenged_team_id, el guard "solo el rival acepta" y las
--       transiciones open->rejected / open->expired.
--   * expire_stale_directed_challenges() + cron pg_cron (cada 10 min) -> vence
--       automáticamente los dirigidos open pasados de expires_at.
--   * rpc_create_directed_challenge(...) -> crea el desafío con TODAS las reglas
--       backend: <=2 abiertos por equipo, <=1 abierto por día, sin duplicar al
--       mismo rival, sin desafiar al propio equipo. Notifica al rival
--       (type='team_challenge_received').
--   * rpc_reject_directed_challenge(...) -> solo el rival rechaza. Notifica al
--       creador (type='team_challenge_rejected').
--
-- No se toca rpc_accept_challenge (la regla "solo el rival acepta" vive en el
-- trigger; el push de aceptación lo inserta el cliente para los dirigidos).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Columnas nuevas (aditivas / idempotentes)
-- ---------------------------------------------------------------------------
ALTER TABLE public.challenges ADD COLUMN IF NOT EXISTS challenged_team_id uuid NULL;
ALTER TABLE public.challenges ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'challenges_challenged_team_id_fkey'
  ) THEN
    ALTER TABLE public.challenges
      ADD CONSTRAINT challenges_challenged_team_id_fkey
      FOREIGN KEY (challenged_team_id)
      REFERENCES public.teams(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS challenges_challenged_team_id_idx
  ON public.challenges(challenged_team_id);

CREATE INDEX IF NOT EXISTS challenges_open_expires_at_idx
  ON public.challenges(expires_at)
  WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- 2) Estados nuevos: rejected / expired
-- ---------------------------------------------------------------------------
ALTER TABLE public.challenges DROP CONSTRAINT IF EXISTS challenges_status_check;
ALTER TABLE public.challenges
  ADD CONSTRAINT challenges_status_check
  CHECK (status IN ('open', 'accepted', 'confirmed', 'completed', 'canceled', 'rejected', 'expired'));

-- ---------------------------------------------------------------------------
-- 3) validate_challenge_payload(): lógica vigente (20260614000629) + agregados
--    para desafíos dirigidos. Sólo se AGREGA; nada de lo existente se quita.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_challenge_payload()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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

  -- Desafío dirigido: validar el equipo objetivo y la regla "solo el rival acepta".
  IF NEW.challenged_team_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = NEW.challenged_team_id AND t.is_active = true
    ) THEN
      RAISE EXCEPTION 'challenged_team_id invalido';
    END IF;

    IF NEW.challenged_team_id = NEW.challenger_team_id THEN
      RAISE EXCEPTION 'no podes desafiar a tu propio equipo';
    END IF;

    IF NEW.accepted_team_id IS NOT NULL
       AND NEW.accepted_team_id <> NEW.challenged_team_id THEN
      RAISE EXCEPTION 'desafio dirigido: solo el equipo desafiado puede aceptar';
    END IF;
  END IF;

  IF NEW.status = 'open' THEN
    IF NEW.accepted_team_id IS NOT NULL OR NEW.accepted_by_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'challenges open no pueden tener accepted_team_id/accepted_by_user_id';
    END IF;
  END IF;

  IF NEW.status IN ('accepted', 'confirmed', 'completed')
     AND NEW.accepted_team_id IS NULL THEN
    RAISE EXCEPTION 'status % requiere accepted_team_id', NEW.status;
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

  IF OLD.status IN ('completed', 'canceled', 'rejected', 'expired') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'no se puede cambiar estado desde %', OLD.status;
  END IF;

  IF OLD.accepted_team_id IS NOT NULL
     AND NEW.accepted_team_id IS DISTINCT FROM OLD.accepted_team_id THEN
    RAISE EXCEPTION 'accepted_team_id no puede cambiar una vez asignado';
  END IF;

  IF OLD.accepted_by_user_id IS NOT NULL
     AND NEW.accepted_by_user_id IS DISTINCT FROM OLD.accepted_by_user_id
     AND NEW.accepted_by_user_id IS NOT NULL THEN
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

    ELSIF OLD.status = 'open' AND NEW.status = 'rejected' THEN
      -- Sólo el equipo desafiado puede rechazar un desafío dirigido.
      IF NOT v_is_service_role THEN
        IF v_uid IS NULL
           OR NEW.challenged_team_id IS NULL
           OR NOT public.team_user_is_captain_or_owner(NEW.challenged_team_id, v_uid) THEN
          RAISE EXCEPTION 'solo el equipo desafiado puede rechazar';
        END IF;
      END IF;

    ELSIF OLD.status = 'open' AND NEW.status = 'expired' THEN
      -- Expiración automática a las 48 h (cron / barrido del sistema).
      NULL;

    ELSE
      RAISE EXCEPTION 'transicion de estado invalida: % -> %', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4) Vencimiento automático a las 48 h
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_stale_directed_challenges()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.challenges c
    SET status = 'expired', updated_at = now()
    WHERE c.status = 'open'
      AND c.challenged_team_id IS NOT NULL
      AND c.expires_at IS NOT NULL
      AND c.expires_at < now()
    RETURNING c.id
  )
  SELECT count(*) INTO v_count FROM expired;
  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_directed_challenges() FROM public;
GRANT EXECUTE ON FUNCTION public.expire_stale_directed_challenges() TO authenticated, service_role;

-- Cron pg_cron cada 10 minutos (patrón guardado: no rompe si pg_cron no está).
DO $cron$
DECLARE
  v_job_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'Skipping directed challenge expiry cron because pg_cron is not enabled.';
    RETURN;
  END IF;

  FOR v_job_id IN
    SELECT jobid FROM cron.job WHERE jobname = 'directed_challenge_expiry_scheduler'
  LOOP
    EXECUTE format('SELECT cron.unschedule(%s)', v_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'directed_challenge_expiry_scheduler',
    '*/10 * * * *',
    'SELECT public.expire_stale_directed_challenges();'
  );
END
$cron$;

-- ---------------------------------------------------------------------------
-- 5) Crear desafío dirigido (todas las reglas validadas en backend)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_create_directed_challenge(
  p_challenger_team_id uuid,
  p_challenged_team_id uuid,
  p_scheduled_at timestamptz DEFAULT NULL,
  p_location_name text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.challenges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenger public.teams%ROWTYPE;
  v_challenged public.teams%ROWTYPE;
  v_open_count int;
  v_day date;
  v_tz text := 'America/Argentina/Buenos_Aires';
  v_challenge public.challenges%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- Barrido de vencidos primero, para que los límites cuenten estado fresco.
  PERFORM public.expire_stale_directed_challenges();

  SELECT * INTO v_challenger FROM public.teams WHERE id = p_challenger_team_id;
  IF NOT FOUND OR COALESCE(v_challenger.is_active, false) = false THEN
    RAISE EXCEPTION 'Equipo desafiante invalido';
  END IF;

  IF NOT public.team_user_is_captain_or_owner(p_challenger_team_id, v_uid) THEN
    RAISE EXCEPTION 'Solo owner/capitan del equipo desafiante puede crear el desafio';
  END IF;

  IF p_challenged_team_id IS NULL OR p_challenged_team_id = p_challenger_team_id THEN
    RAISE EXCEPTION 'No podes desafiar a tu propio equipo';
  END IF;

  SELECT * INTO v_challenged FROM public.teams WHERE id = p_challenged_team_id;
  IF NOT FOUND OR COALESCE(v_challenged.is_active, false) = false THEN
    RAISE EXCEPTION 'Equipo desafiado invalido';
  END IF;

  IF v_challenged.format <> v_challenger.format THEN
    RAISE EXCEPTION 'Ambos equipos deben tener el mismo formato';
  END IF;

  -- Regla: máximo 2 desafíos abiertos por equipo (como challenger).
  SELECT count(*) INTO v_open_count
  FROM public.challenges c
  WHERE c.challenger_team_id = p_challenger_team_id
    AND c.status = 'open'
    AND (c.expires_at IS NULL OR c.expires_at > now());

  IF v_open_count >= 2 THEN
    RAISE EXCEPTION 'Ya tenés 2 desafíos abiertos. Cerrá uno pendiente para crear otro.';
  END IF;

  -- Regla: máximo 1 desafío abierto por día calendario (fecha propuesta, tz AR).
  IF p_scheduled_at IS NOT NULL THEN
    v_day := (p_scheduled_at AT TIME ZONE v_tz)::date;
    IF EXISTS (
      SELECT 1 FROM public.challenges c
      WHERE c.challenger_team_id = p_challenger_team_id
        AND c.status = 'open'
        AND (c.expires_at IS NULL OR c.expires_at > now())
        AND c.scheduled_at IS NOT NULL
        AND (c.scheduled_at AT TIME ZONE v_tz)::date = v_day
    ) THEN
      RAISE EXCEPTION 'Ya tenés un desafío abierto para ese día.';
    END IF;
  END IF;

  -- Regla: no duplicar desafío abierto contra el mismo rival.
  IF EXISTS (
    SELECT 1 FROM public.challenges c
    WHERE c.challenger_team_id = p_challenger_team_id
      AND c.challenged_team_id = p_challenged_team_id
      AND c.status = 'open'
      AND (c.expires_at IS NULL OR c.expires_at > now())
  ) THEN
    RAISE EXCEPTION 'Ya existe un desafío pendiente para ese equipo';
  END IF;

  INSERT INTO public.challenges (
    created_by_user_id,
    challenger_team_id,
    challenged_team_id,
    status,
    scheduled_at,
    location_name,
    location,
    format,
    skill_level,
    notes,
    expires_at
  ) VALUES (
    v_uid,
    p_challenger_team_id,
    p_challenged_team_id,
    'open',
    p_scheduled_at,
    NULLIF(btrim(COALESCE(p_location_name, '')), ''),
    NULLIF(btrim(COALESCE(p_location_name, '')), ''),
    v_challenger.format,
    v_challenger.skill_level,
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    now() + interval '48 hours'
  )
  RETURNING * INTO v_challenge;

  -- Notificación al equipo desafiado (owner / capitanes / admins). Nunca rollbackea.
  BEGIN
    INSERT INTO public.notifications (user_id, type, title, message, data, read, created_at)
    SELECT
      recipients.user_id,
      'team_challenge_received',
      'Nuevo desafío',
      format('%s desafió a tu equipo', COALESCE(NULLIF(v_challenger.name, ''), 'Un equipo')),
      jsonb_build_object(
        'challenge_id', v_challenge.id,
        'challenger_team_id', v_challenge.challenger_team_id,
        'challenged_team_id', v_challenge.challenged_team_id,
        'challenger_team_name', v_challenger.name,
        'challenged_team_name', v_challenged.name,
        'source', 'team_challenge',
        'link', '/desafios'
      ),
      false,
      now()
    FROM (
      SELECT DISTINCT user_id FROM (
        SELECT t.owner_user_id AS user_id
        FROM public.teams t
        WHERE t.id = p_challenged_team_id

        UNION ALL

        SELECT tm.user_id
        FROM public.team_members tm
        WHERE tm.team_id = p_challenged_team_id
          AND tm.user_id IS NOT NULL
          AND (
            tm.is_captain = true
            OR tm.role = 'captain'
            OR lower(COALESCE(tm.permissions_role, '')) IN ('admin', 'owner')
          )

        UNION ALL

        SELECT j.usuario_id
        FROM public.team_members tm
        JOIN public.jugadores j ON j.id = tm.jugador_id
        WHERE tm.team_id = p_challenged_team_id
          AND j.usuario_id IS NOT NULL
          AND (
            tm.is_captain = true
            OR tm.role = 'captain'
            OR lower(COALESCE(tm.permissions_role, '')) IN ('admin', 'owner')
          )
      ) raw_members
      WHERE user_id IS NOT NULL
    ) recipients;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_challenge;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_create_directed_challenge(uuid, uuid, timestamptz, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_create_directed_challenge(uuid, uuid, timestamptz, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) Rechazar desafío dirigido (solo el equipo desafiado)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_reject_directed_challenge(
  p_challenge_id uuid
)
RETURNS public.challenges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenge public.challenges%ROWTYPE;
  v_challenger_name text;
  v_challenged_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT *
  INTO v_challenge
  FROM public.challenges c
  WHERE c.id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge no encontrado';
  END IF;

  IF v_challenge.challenged_team_id IS NULL THEN
    RAISE EXCEPTION 'Este desafio no es dirigido';
  END IF;

  IF v_challenge.status <> 'open' THEN
    RAISE EXCEPTION 'Solo se pueden rechazar desafios pendientes';
  END IF;

  IF NOT public.team_user_is_captain_or_owner(v_challenge.challenged_team_id, v_uid) THEN
    RAISE EXCEPTION 'Solo el equipo desafiado puede rechazar';
  END IF;

  UPDATE public.challenges c
  SET status = 'rejected', updated_at = now()
  WHERE c.id = p_challenge_id
  RETURNING * INTO v_challenge;

  BEGIN
    SELECT t.name INTO v_challenger_name FROM public.teams t WHERE t.id = v_challenge.challenger_team_id;
    SELECT t.name INTO v_challenged_name FROM public.teams t WHERE t.id = v_challenge.challenged_team_id;

    INSERT INTO public.notifications (user_id, type, title, message, data, read, created_at)
    SELECT
      recipients.user_id,
      'team_challenge_rejected',
      'Desafío rechazado',
      format('%s rechazó el desafío', COALESCE(NULLIF(v_challenged_name, ''), 'El equipo rival')),
      jsonb_build_object(
        'challenge_id', v_challenge.id,
        'challenger_team_id', v_challenge.challenger_team_id,
        'challenged_team_id', v_challenge.challenged_team_id,
        'challenger_team_name', v_challenger_name,
        'challenged_team_name', v_challenged_name,
        'source', 'team_challenge',
        'link', '/desafios'
      ),
      false,
      now()
    FROM (
      SELECT DISTINCT user_id FROM (
        SELECT t.owner_user_id AS user_id
        FROM public.teams t
        WHERE t.id = v_challenge.challenger_team_id

        UNION ALL

        SELECT tm.user_id
        FROM public.team_members tm
        WHERE tm.team_id = v_challenge.challenger_team_id
          AND tm.user_id IS NOT NULL

        UNION ALL

        SELECT j.usuario_id
        FROM public.team_members tm
        JOIN public.jugadores j ON j.id = tm.jugador_id
        WHERE tm.team_id = v_challenge.challenger_team_id
          AND j.usuario_id IS NOT NULL
      ) raw_members
      WHERE user_id IS NOT NULL
    ) recipients;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_challenge;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_reject_directed_challenge(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_reject_directed_challenge(uuid) TO authenticated, service_role;

COMMIT;
