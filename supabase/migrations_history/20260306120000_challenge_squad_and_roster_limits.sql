BEGIN;

-- ============================================================================
-- Challenge squads + team roster limits (additive, backwards-compatible)
-- Date: 2026-03-06
-- Scope:
--   - Enforce max roster by team format (F5/F6/F7/F8/F9/F11)
--   - Introduce challenge_team_squad (availability + final approved squad)
--   - Snapshot challenge squad limits per format
--   - Open challenge squad automatically when challenge is accepted/confirmed
--   - Keep legacy data readable; block only new writes that exceed limits
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Teams: roster limit snapshot derived from format
-- ---------------------------------------------------------------------------
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS max_roster_size smallint;

UPDATE public.teams
SET max_roster_size = GREATEST(2, COALESCE(format, 5) * 2)
WHERE max_roster_size IS NULL;

ALTER TABLE public.teams
  DROP CONSTRAINT IF EXISTS teams_max_roster_size_check;

ALTER TABLE public.teams
  ADD CONSTRAINT teams_max_roster_size_check
  CHECK (max_roster_size IS NULL OR max_roster_size BETWEEN 2 AND 40);

CREATE OR REPLACE FUNCTION public.resolve_team_roster_limit(p_team_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(
      NULLIF(t.max_roster_size, 0),
      GREATEST(2, COALESCE(t.format, 5) * 2)
    )::integer
  FROM public.teams t
  WHERE t.id = p_team_id;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_team_roster_limit(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_team_roster_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_limit smallint;
BEGIN
  v_limit := GREATEST(2, COALESCE(NEW.format, 5) * 2);

  -- Keep a stable persisted limit while still deriving from format.
  NEW.max_roster_size := v_limit;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_teams_apply_roster_defaults ON public.teams;
CREATE TRIGGER trg_teams_apply_roster_defaults
BEFORE INSERT OR UPDATE OF format, max_roster_size
ON public.teams
FOR EACH ROW
EXECUTE FUNCTION public.apply_team_roster_defaults();

CREATE OR REPLACE FUNCTION public.enforce_team_format_roster_compatibility()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_members integer;
  v_new_limit integer;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.format IS NOT DISTINCT FROM OLD.format THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
  INTO v_current_members
  FROM public.team_members tm
  WHERE tm.team_id = NEW.id;

  v_new_limit := GREATEST(2, COALESCE(NEW.format, 5) * 2);

  IF v_current_members > v_new_limit THEN
    RAISE EXCEPTION 'No se puede cambiar a F%: el equipo tiene % jugadores y el maximo permitido es %',
      NEW.format,
      v_current_members,
      v_new_limit;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_teams_enforce_roster_on_format_change ON public.teams;
CREATE TRIGGER trg_teams_enforce_roster_on_format_change
BEFORE UPDATE OF format
ON public.teams
FOR EACH ROW
EXECUTE FUNCTION public.enforce_team_format_roster_compatibility();

CREATE OR REPLACE FUNCTION public.enforce_team_member_roster_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_limit integer;
  v_count integer;
  v_team_format smallint;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.team_id IS NOT DISTINCT FROM OLD.team_id THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(NULLIF(t.max_roster_size, 0), GREATEST(2, COALESCE(t.format, 5) * 2)),
    t.format
  INTO v_limit, v_team_format
  FROM public.teams t
  WHERE t.id = NEW.team_id;

  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
  INTO v_count
  FROM public.team_members tm
  WHERE tm.team_id = NEW.team_id;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'Plantilla completa: este equipo F% ya alcanzo su maximo de % jugadores',
      COALESCE(v_team_format, 5),
      v_limit;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_members_enforce_roster_limit ON public.team_members;
CREATE TRIGGER trg_team_members_enforce_roster_limit
BEFORE INSERT OR UPDATE OF team_id
ON public.team_members
FOR EACH ROW
EXECUTE FUNCTION public.enforce_team_member_roster_limit();

-- ---------------------------------------------------------------------------
-- 2) Challenges: squad snapshot columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS match_format smallint,
  ADD COLUMN IF NOT EXISTS max_starters_per_team smallint,
  ADD COLUMN IF NOT EXISTS max_substitutes_per_team smallint,
  ADD COLUMN IF NOT EXISTS max_selected_per_team smallint,
  ADD COLUMN IF NOT EXISTS squad_status text,
  ADD COLUMN IF NOT EXISTS squad_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS squad_closed_at timestamptz;

ALTER TABLE public.challenges
  DROP CONSTRAINT IF EXISTS challenges_squad_status_check;

ALTER TABLE public.challenges
  ADD CONSTRAINT challenges_squad_status_check
  CHECK (squad_status IN ('not_open', 'open', 'closed', 'finalized'));

UPDATE public.challenges
SET match_format = COALESCE(match_format, format)
WHERE match_format IS NULL;

CREATE OR REPLACE FUNCTION public.resolve_challenge_squad_limits(p_format smallint)
RETURNS TABLE(
  max_starters smallint,
  max_substitutes smallint,
  max_selected smallint
)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE p_format
      WHEN 5 THEN 5
      WHEN 6 THEN 6
      WHEN 7 THEN 7
      WHEN 8 THEN 8
      WHEN 9 THEN 9
      WHEN 11 THEN 11
      ELSE 5
    END::smallint AS max_starters,
    CASE p_format
      WHEN 5 THEN 3
      WHEN 6 THEN 3
      WHEN 7 THEN 4
      WHEN 8 THEN 4
      WHEN 9 THEN 4
      WHEN 11 THEN 5
      ELSE 3
    END::smallint AS max_substitutes,
    CASE p_format
      WHEN 5 THEN 8
      WHEN 6 THEN 9
      WHEN 7 THEN 11
      WHEN 8 THEN 12
      WHEN 9 THEN 13
      WHEN 11 THEN 16
      ELSE 8
    END::smallint AS max_selected;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_challenge_squad_limits(smallint) TO authenticated, service_role;

UPDATE public.challenges c
SET
  max_starters_per_team = COALESCE(c.max_starters_per_team, limits.max_starters),
  max_substitutes_per_team = COALESCE(c.max_substitutes_per_team, limits.max_substitutes),
  max_selected_per_team = COALESCE(c.max_selected_per_team, limits.max_selected)
FROM (
  SELECT
    c2.id,
    l.max_starters,
    l.max_substitutes,
    l.max_selected
  FROM public.challenges c2
  CROSS JOIN LATERAL public.resolve_challenge_squad_limits(COALESCE(c2.match_format, c2.format)) l
) limits
WHERE c.id = limits.id
  AND (
    c.max_starters_per_team IS NULL
    OR c.max_substitutes_per_team IS NULL
    OR c.max_selected_per_team IS NULL
  );

UPDATE public.challenges
SET squad_status = CASE
  WHEN status IN ('accepted', 'confirmed') THEN 'open'
  WHEN status IN ('completed', 'canceled') THEN 'finalized'
  ELSE 'not_open'
END
WHERE squad_status IS NULL;

UPDATE public.challenges
SET squad_opened_at = COALESCE(squad_opened_at, updated_at, created_at)
WHERE squad_status = 'open'
  AND squad_opened_at IS NULL;

UPDATE public.challenges
SET squad_closed_at = COALESCE(squad_closed_at, updated_at, created_at)
WHERE squad_status IN ('closed', 'finalized')
  AND squad_closed_at IS NULL;

CREATE OR REPLACE FUNCTION public.apply_challenge_squad_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_limits record;
BEGIN
  NEW.match_format := COALESCE(NEW.match_format, NEW.format);

  SELECT *
  INTO v_limits
  FROM public.resolve_challenge_squad_limits(COALESCE(NEW.match_format, NEW.format));

  IF NEW.max_starters_per_team IS NULL THEN
    NEW.max_starters_per_team := v_limits.max_starters;
  END IF;

  IF NEW.max_substitutes_per_team IS NULL THEN
    NEW.max_substitutes_per_team := v_limits.max_substitutes;
  END IF;

  IF NEW.max_selected_per_team IS NULL THEN
    NEW.max_selected_per_team := v_limits.max_selected;
  END IF;

  IF NEW.status = 'completed' THEN
    NEW.squad_status := 'finalized';
  ELSIF NEW.status = 'canceled' THEN
    NEW.squad_status := COALESCE(NEW.squad_status, 'finalized');
    IF NEW.squad_status = 'open' THEN
      NEW.squad_status := 'finalized';
    END IF;
  ELSIF NEW.status IN ('accepted', 'confirmed') THEN
    NEW.squad_status := COALESCE(NEW.squad_status, 'open');
  ELSE
    NEW.squad_status := COALESCE(NEW.squad_status, 'not_open');
  END IF;

  IF NEW.squad_status = 'open' AND NEW.squad_opened_at IS NULL THEN
    NEW.squad_opened_at := now();
  END IF;

  IF NEW.squad_status IN ('closed', 'finalized') AND NEW.squad_closed_at IS NULL THEN
    NEW.squad_closed_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_challenges_apply_squad_defaults ON public.challenges;
CREATE TRIGGER trg_challenges_apply_squad_defaults
BEFORE INSERT OR UPDATE OF
  format,
  match_format,
  max_starters_per_team,
  max_substitutes_per_team,
  max_selected_per_team,
  status,
  squad_status,
  squad_opened_at,
  squad_closed_at
ON public.challenges
FOR EACH ROW
EXECUTE FUNCTION public.apply_challenge_squad_defaults();

-- ---------------------------------------------------------------------------
-- 3) Challenge squad table (availability + final selected roster)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_jugador_id_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
  INTO v_jugador_id_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'jugadores'
    AND a.attname = 'id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_jugador_id_type IS NULL THEN
    RAISE EXCEPTION 'No se encontro public.jugadores.id para challenge_team_squad.player_id';
  END IF;

  EXECUTE format($fmt$
    CREATE TABLE IF NOT EXISTS public.challenge_team_squad (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
      team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
      player_id %s NOT NULL REFERENCES public.jugadores(id) ON DELETE CASCADE,
      availability_status text NOT NULL DEFAULT 'pending',
      selection_status text NOT NULL DEFAULT 'not_selected',
      approved_by_captain boolean NOT NULL DEFAULT false,
      participated boolean NULL,
      attendance_locked boolean NOT NULL DEFAULT false,
      responded_at timestamptz NULL,
      selected_at timestamptz NULL,
      selected_by uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT challenge_team_squad_availability_check
        CHECK (availability_status IN ('pending', 'available', 'unavailable')),
      CONSTRAINT challenge_team_squad_selection_check
        CHECK (selection_status IN ('starter', 'substitute', 'not_selected')),
      CONSTRAINT challenge_team_squad_unique_player_per_challenge
        UNIQUE (challenge_id, team_id, player_id)
    )
  $fmt$, v_jugador_id_type);
END;
$$;

CREATE INDEX IF NOT EXISTS challenge_team_squad_challenge_team_idx
  ON public.challenge_team_squad(challenge_id, team_id);

CREATE INDEX IF NOT EXISTS challenge_team_squad_availability_idx
  ON public.challenge_team_squad(challenge_id, team_id, availability_status);

CREATE INDEX IF NOT EXISTS challenge_team_squad_selection_idx
  ON public.challenge_team_squad(challenge_id, team_id, selection_status, approved_by_captain);

CREATE OR REPLACE FUNCTION public.set_challenge_team_squad_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_challenge_team_squad_set_updated_at ON public.challenge_team_squad;
CREATE TRIGGER trg_challenge_team_squad_set_updated_at
BEFORE UPDATE ON public.challenge_team_squad
FOR EACH ROW
EXECUTE FUNCTION public.set_challenge_team_squad_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_challenge_team_squad_limits()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_challenge public.challenges%ROWTYPE;
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

DROP TRIGGER IF EXISTS trg_challenge_team_squad_enforce_limits ON public.challenge_team_squad;
CREATE TRIGGER trg_challenge_team_squad_enforce_limits
BEFORE INSERT OR UPDATE OF
  challenge_id,
  team_id,
  player_id,
  availability_status,
  selection_status,
  approved_by_captain
ON public.challenge_team_squad
FOR EACH ROW
EXECUTE FUNCTION public.enforce_challenge_team_squad_limits();

ALTER TABLE public.challenge_team_squad ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS challenge_team_squad_select_involved ON public.challenge_team_squad;
CREATE POLICY challenge_team_squad_select_involved
ON public.challenge_team_squad
FOR SELECT
TO authenticated
USING (
  public.team_user_is_member(team_id, auth.uid())
  OR public.challenge_user_is_owner_or_captain(challenge_id, auth.uid())
);

DROP POLICY IF EXISTS challenge_team_squad_insert_captains ON public.challenge_team_squad;
CREATE POLICY challenge_team_squad_insert_captains
ON public.challenge_team_squad
FOR INSERT
TO authenticated
WITH CHECK (public.team_user_is_captain_or_owner(team_id, auth.uid()));

DROP POLICY IF EXISTS challenge_team_squad_update_captains ON public.challenge_team_squad;
CREATE POLICY challenge_team_squad_update_captains
ON public.challenge_team_squad
FOR UPDATE
TO authenticated
USING (public.team_user_is_captain_or_owner(team_id, auth.uid()))
WITH CHECK (public.team_user_is_captain_or_owner(team_id, auth.uid()));

DROP POLICY IF EXISTS challenge_team_squad_delete_captains ON public.challenge_team_squad;
CREATE POLICY challenge_team_squad_delete_captains
ON public.challenge_team_squad
FOR DELETE
TO authenticated
USING (public.team_user_is_captain_or_owner(team_id, auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.challenge_team_squad TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) RPCs for challenge squad lifecycle
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prepare_challenge_team_squad(
  p_challenge_id uuid,
  p_open boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_challenge public.challenges%ROWTYPE;
  v_team_match_id uuid;
  v_notified_count integer := 0;
BEGIN
  IF p_challenge_id IS NULL THEN
    RETURN jsonb_build_object('prepared', false, 'reason', 'missing_challenge_id');
  END IF;

  SELECT *
  INTO v_challenge
  FROM public.challenges c
  WHERE c.id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('prepared', false, 'reason', 'challenge_not_found');
  END IF;

  IF v_challenge.accepted_team_id IS NULL THEN
    RETURN jsonb_build_object('prepared', false, 'reason', 'challenge_without_rival');
  END IF;

  UPDATE public.challenges c
  SET
    match_format = COALESCE(c.match_format, c.format),
    max_starters_per_team = COALESCE(c.max_starters_per_team, limits.max_starters),
    max_substitutes_per_team = COALESCE(c.max_substitutes_per_team, limits.max_substitutes),
    max_selected_per_team = COALESCE(c.max_selected_per_team, limits.max_selected),
    squad_status = CASE
      WHEN p_open THEN
        CASE
          WHEN c.status IN ('completed', 'canceled') THEN 'finalized'
          ELSE 'open'
        END
      ELSE COALESCE(c.squad_status, 'not_open')
    END,
    squad_opened_at = CASE
      WHEN p_open AND c.status IN ('accepted', 'confirmed')
        THEN COALESCE(c.squad_opened_at, now())
      ELSE c.squad_opened_at
    END,
    updated_at = now()
  FROM (
    SELECT
      c2.id,
      l.max_starters,
      l.max_substitutes,
      l.max_selected
    FROM public.challenges c2
    CROSS JOIN LATERAL public.resolve_challenge_squad_limits(COALESCE(c2.match_format, c2.format)) l
    WHERE c2.id = v_challenge.id
  ) limits
  WHERE c.id = limits.id
  RETURNING c.* INTO v_challenge;

  INSERT INTO public.challenge_team_squad (
    challenge_id,
    team_id,
    player_id,
    availability_status,
    selection_status,
    approved_by_captain,
    created_at,
    updated_at
  )
  SELECT
    v_challenge.id,
    tm.team_id,
    tm.jugador_id,
    'pending',
    'not_selected',
    false,
    now(),
    now()
  FROM public.team_members tm
  WHERE tm.team_id IN (v_challenge.challenger_team_id, v_challenge.accepted_team_id)
  ON CONFLICT (challenge_id, team_id, player_id) DO NOTHING;

  SELECT tm.id
  INTO v_team_match_id
  FROM public.team_matches tm
  WHERE tm.challenge_id = v_challenge.id
  ORDER BY tm.updated_at DESC NULLS LAST, tm.created_at DESC NULLS LAST
  LIMIT 1;

  IF p_open
     AND COALESCE(v_challenge.squad_status, 'not_open') = 'open' THEN
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, data, read, created_at)
      SELECT
        recipients.user_id,
        'challenge_squad_open',
        'Convocatoria abierta',
        'Ya podés confirmar disponibilidad para el desafío.',
        jsonb_build_object(
          'challenge_id', v_challenge.id,
          'team_match_id', v_team_match_id,
          'team_a_id', v_challenge.challenger_team_id,
          'team_b_id', v_challenge.accepted_team_id,
          'team_a_name', COALESCE((SELECT t.name FROM public.teams t WHERE t.id = v_challenge.challenger_team_id), 'Equipo A'),
          'team_b_name', COALESCE((SELECT t.name FROM public.teams t WHERE t.id = v_challenge.accepted_team_id), 'Equipo B'),
          'scheduled_at', v_challenge.scheduled_at,
          'origin_type', 'challenge',
          'source', 'team_challenge',
          'link', CASE
            WHEN v_team_match_id IS NULL THEN '/desafios'
            ELSE '/desafios/equipos/partidos/' || v_team_match_id::text
          END
        ),
        false,
        now()
      FROM (
        SELECT DISTINCT user_id
        FROM (
          SELECT t.owner_user_id AS user_id
          FROM public.teams t
          WHERE t.id IN (v_challenge.challenger_team_id, v_challenge.accepted_team_id)

          UNION ALL

          SELECT tm.user_id
          FROM public.team_members tm
          WHERE tm.team_id IN (v_challenge.challenger_team_id, v_challenge.accepted_team_id)
            AND tm.user_id IS NOT NULL

          UNION ALL

          SELECT j.usuario_id
          FROM public.team_members tm
          JOIN public.jugadores j ON j.id = tm.jugador_id
          WHERE tm.team_id IN (v_challenge.challenger_team_id, v_challenge.accepted_team_id)
            AND j.usuario_id IS NOT NULL
        ) all_members
        WHERE user_id IS NOT NULL
      ) recipients
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.user_id = recipients.user_id
          AND n.type = 'challenge_squad_open'
          AND COALESCE(n.data->>'challenge_id', '') = v_challenge.id::text
      );

      GET DIAGNOSTICS v_notified_count = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      v_notified_count := 0;
    END;
  END IF;

  RETURN jsonb_build_object(
    'prepared', true,
    'challenge_id', v_challenge.id,
    'team_match_id', v_team_match_id,
    'squad_status', v_challenge.squad_status,
    'max_starters_per_team', v_challenge.max_starters_per_team,
    'max_substitutes_per_team', v_challenge.max_substitutes_per_team,
    'max_selected_per_team', v_challenge.max_selected_per_team,
    'notified', v_notified_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.prepare_challenge_team_squad(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_set_challenge_availability(
  p_challenge_id uuid,
  p_availability_status text
)
RETURNS public.challenge_team_squad
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenge public.challenges%ROWTYPE;
  v_member record;
  v_row public.challenge_team_squad%ROWTYPE;
  v_status text := lower(COALESCE(p_availability_status, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF v_status NOT IN ('available', 'unavailable') THEN
    RAISE EXCEPTION 'Estado de disponibilidad inválido';
  END IF;

  SELECT *
  INTO v_challenge
  FROM public.challenges c
  WHERE c.id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge no encontrado';
  END IF;

  IF v_challenge.accepted_team_id IS NULL THEN
    RAISE EXCEPTION 'El desafío todavía no tiene rival confirmado';
  END IF;

  PERFORM public.prepare_challenge_team_squad(p_challenge_id, true);

  SELECT
    tm.team_id,
    tm.jugador_id
  INTO v_member
  FROM public.team_members tm
  LEFT JOIN public.jugadores j ON j.id = tm.jugador_id
  WHERE tm.team_id IN (v_challenge.challenger_team_id, v_challenge.accepted_team_id)
    AND (
      tm.user_id = v_uid
      OR j.usuario_id = v_uid
    )
  ORDER BY tm.is_captain DESC, tm.created_at ASC
  LIMIT 1;

  IF v_member.team_id IS NULL OR v_member.jugador_id IS NULL THEN
    RAISE EXCEPTION 'No pertenecés al plantel de este desafío';
  END IF;

  INSERT INTO public.challenge_team_squad (
    challenge_id,
    team_id,
    player_id,
    availability_status,
    selection_status,
    approved_by_captain,
    responded_at,
    updated_at
  ) VALUES (
    p_challenge_id,
    v_member.team_id,
    v_member.jugador_id,
    v_status,
    'not_selected',
    false,
    now(),
    now()
  )
  ON CONFLICT (challenge_id, team_id, player_id)
  DO UPDATE SET
    availability_status = EXCLUDED.availability_status,
    responded_at = now(),
    selection_status = CASE
      WHEN EXCLUDED.availability_status = 'unavailable' THEN 'not_selected'
      ELSE public.challenge_team_squad.selection_status
    END,
    approved_by_captain = CASE
      WHEN EXCLUDED.availability_status = 'unavailable' THEN false
      ELSE public.challenge_team_squad.approved_by_captain
    END,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_set_challenge_availability(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_upsert_challenge_team_selection(
  p_challenge_id uuid,
  p_team_id uuid,
  p_player_id text,
  p_selection_status text,
  p_approved_by_captain boolean DEFAULT true
)
RETURNS public.challenge_team_squad
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenge public.challenges%ROWTYPE;
  v_player_id public.jugadores.id%TYPE;
  v_selection text := lower(COALESCE(p_selection_status, 'not_selected'));
  v_row public.challenge_team_squad%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF v_selection NOT IN ('starter', 'substitute', 'not_selected') THEN
    RAISE EXCEPTION 'Estado de selección inválido';
  END IF;

  SELECT *
  INTO v_challenge
  FROM public.challenges c
  WHERE c.id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge no encontrado';
  END IF;

  IF v_challenge.accepted_team_id IS NULL THEN
    RAISE EXCEPTION 'El desafío todavía no tiene rival confirmado';
  END IF;

  IF p_team_id IS DISTINCT FROM v_challenge.challenger_team_id
     AND p_team_id IS DISTINCT FROM v_challenge.accepted_team_id THEN
    RAISE EXCEPTION 'team_id no pertenece al desafío';
  END IF;

  IF NOT public.team_user_is_captain_or_owner(p_team_id, v_uid) THEN
    RAISE EXCEPTION 'Solo capitán/admin puede editar el plantel final';
  END IF;

  IF COALESCE(v_challenge.squad_status, 'not_open') IN ('closed', 'finalized') THEN
    RAISE EXCEPTION 'La convocatoria ya está cerrada';
  END IF;

  SELECT j.id
  INTO v_player_id
  FROM public.jugadores j
  WHERE j.id::text = trim(COALESCE(p_player_id, ''))
  LIMIT 1;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'Jugador inválido para convocatoria';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.team_members tm
    WHERE tm.team_id = p_team_id
      AND tm.jugador_id = v_player_id
  ) THEN
    RAISE EXCEPTION 'El jugador no pertenece a ese equipo';
  END IF;

  PERFORM public.prepare_challenge_team_squad(p_challenge_id, true);

  INSERT INTO public.challenge_team_squad (
    challenge_id,
    team_id,
    player_id,
    availability_status,
    selection_status,
    approved_by_captain,
    selected_at,
    selected_by,
    updated_at
  ) VALUES (
    p_challenge_id,
    p_team_id,
    v_player_id,
    'pending',
    v_selection,
    CASE
      WHEN v_selection = 'not_selected' THEN false
      ELSE COALESCE(p_approved_by_captain, true)
    END,
    CASE
      WHEN v_selection = 'not_selected' THEN NULL
      ELSE now()
    END,
    CASE
      WHEN v_selection = 'not_selected' THEN NULL
      ELSE v_uid
    END,
    now()
  )
  ON CONFLICT (challenge_id, team_id, player_id)
  DO UPDATE SET
    selection_status = EXCLUDED.selection_status,
    approved_by_captain = EXCLUDED.approved_by_captain,
    selected_at = EXCLUDED.selected_at,
    selected_by = EXCLUDED.selected_by,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_upsert_challenge_team_selection(uuid, uuid, text, text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_set_challenge_squad_status(
  p_challenge_id uuid,
  p_squad_status text
)
RETURNS public.challenges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenge public.challenges%ROWTYPE;
  v_next_status text := lower(COALESCE(p_squad_status, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF v_next_status NOT IN ('open', 'closed', 'finalized') THEN
    RAISE EXCEPTION 'Estado de convocatoria inválido';
  END IF;

  SELECT *
  INTO v_challenge
  FROM public.challenges c
  WHERE c.id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge no encontrado';
  END IF;

  IF NOT public.challenge_user_is_owner_or_captain(p_challenge_id, v_uid) THEN
    RAISE EXCEPTION 'Solo capitán/admin puede cambiar la convocatoria';
  END IF;

  IF v_challenge.status IN ('completed', 'canceled') THEN
    RAISE EXCEPTION 'El desafío ya está finalizado o cancelado';
  END IF;

  IF v_next_status = 'open' THEN
    IF v_challenge.scheduled_at IS NOT NULL AND v_challenge.scheduled_at <= now() THEN
      RAISE EXCEPTION 'No se puede reabrir la convocatoria después del horario del partido';
    END IF;

    UPDATE public.challenges c
    SET
      squad_status = 'open',
      squad_opened_at = COALESCE(c.squad_opened_at, now()),
      squad_closed_at = NULL,
      updated_at = now()
    WHERE c.id = p_challenge_id
    RETURNING * INTO v_challenge;
  ELSIF v_next_status = 'closed' THEN
    UPDATE public.challenges c
    SET
      squad_status = 'closed',
      squad_closed_at = now(),
      updated_at = now()
    WHERE c.id = p_challenge_id
    RETURNING * INTO v_challenge;
  ELSE
    UPDATE public.challenges c
    SET
      squad_status = 'finalized',
      squad_closed_at = COALESCE(c.squad_closed_at, now()),
      updated_at = now()
    WHERE c.id = p_challenge_id
    RETURNING * INTO v_challenge;
  END IF;

  RETURN v_challenge;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_set_challenge_squad_status(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Enforce same format on challenge acceptance + open squad automatically
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rpc_accept_challenge(uuid, uuid);
CREATE OR REPLACE FUNCTION public.rpc_accept_challenge(
  p_challenge_id uuid,
  p_accepted_team_id uuid
)
RETURNS TABLE(challenge_id uuid, match_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenge public.challenges%ROWTYPE;
  v_match public.team_matches%ROWTYPE;
  v_accepted_format smallint;
  v_is_format_combined boolean := false;
  v_challenger_name text;
  v_accepted_name text;
  v_accept_message text;
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

  IF v_challenge.challenger_team_id = p_accepted_team_id THEN
    RAISE EXCEPTION 'Un equipo no puede aceptarse a si mismo';
  END IF;

  IF NOT public.team_user_is_admin_or_owner(p_accepted_team_id, v_uid) THEN
    RAISE EXCEPTION 'Solo owner/admin del equipo rival puede aceptar';
  END IF;

  SELECT t.format
  INTO v_accepted_format
  FROM public.teams t
  WHERE t.id = p_accepted_team_id
    AND t.is_active = true;

  IF v_accepted_format IS NULL THEN
    RAISE EXCEPTION 'Equipo inactivo o invalido para aceptar challenge';
  END IF;

  IF v_accepted_format <> v_challenge.format THEN
    RAISE EXCEPTION 'Formato invalido para aceptar challenge: ambos equipos deben ser del mismo formato';
  END IF;

  v_is_format_combined := false;

  IF v_challenge.status IN ('accepted', 'confirmed', 'completed') THEN
    IF v_challenge.accepted_team_id IS DISTINCT FROM p_accepted_team_id THEN
      RAISE EXCEPTION 'Challenge ya fue aceptado por otro equipo';
    END IF;

    SELECT *
    INTO v_match
    FROM public.team_matches tm
    WHERE tm.challenge_id = v_challenge.id
    ORDER BY tm.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.team_matches (
        origin_type,
        challenge_id,
        team_a_id,
        team_b_id,
        format,
        mode,
        scheduled_at,
        location,
        cancha_cost,
        status,
        is_format_combined,
        location_name,
        updated_at
      ) VALUES (
        'challenge',
        v_challenge.id,
        v_challenge.challenger_team_id,
        v_challenge.accepted_team_id,
        v_challenge.format,
        v_challenge.mode,
        v_challenge.scheduled_at,
        COALESCE(v_challenge.location, v_challenge.location_name),
        COALESCE(v_challenge.cancha_cost, v_challenge.field_price),
        CASE
          WHEN v_challenge.status = 'completed' THEN 'played'
          WHEN v_challenge.status = 'confirmed' THEN 'confirmed'
          ELSE 'pending'
        END,
        v_is_format_combined,
        COALESCE(v_challenge.location, v_challenge.location_name),
        now()
      )
      RETURNING * INTO v_match;
    END IF;

    PERFORM public.prepare_challenge_team_squad(v_challenge.id, true);

    RETURN QUERY SELECT v_challenge.id, v_match.id;
    RETURN;
  END IF;

  IF v_challenge.status <> 'open' THEN
    RAISE EXCEPTION 'Solo se pueden aceptar challenges en estado open';
  END IF;

  UPDATE public.challenges c
  SET
    status = 'accepted',
    accepted_team_id = p_accepted_team_id,
    accepted_by_user_id = v_uid,
    updated_at = now()
  WHERE c.id = p_challenge_id
  RETURNING * INTO v_challenge;

  SELECT *
  INTO v_match
  FROM public.team_matches tm
  WHERE tm.challenge_id = v_challenge.id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.team_matches tm
    SET
      origin_type = 'challenge',
      team_a_id = v_challenge.challenger_team_id,
      team_b_id = v_challenge.accepted_team_id,
      format = v_challenge.format,
      mode = v_challenge.mode,
      scheduled_at = v_challenge.scheduled_at,
      location = COALESCE(v_challenge.location, v_challenge.location_name),
      cancha_cost = COALESCE(v_challenge.cancha_cost, v_challenge.field_price),
      status = CASE
        WHEN tm.status IN ('played', 'cancelled') THEN tm.status
        ELSE 'pending'
      END,
      is_format_combined = v_is_format_combined,
      location_name = COALESCE(v_challenge.location, v_challenge.location_name),
      updated_at = now()
    WHERE tm.id = v_match.id
    RETURNING * INTO v_match;
  ELSE
    INSERT INTO public.team_matches (
      origin_type,
      challenge_id,
      team_a_id,
      team_b_id,
      format,
      mode,
      scheduled_at,
      location,
      cancha_cost,
      status,
      is_format_combined,
      location_name,
      updated_at
    ) VALUES (
      'challenge',
      v_challenge.id,
      v_challenge.challenger_team_id,
      v_challenge.accepted_team_id,
      v_challenge.format,
      v_challenge.mode,
      v_challenge.scheduled_at,
      COALESCE(v_challenge.location, v_challenge.location_name),
      COALESCE(v_challenge.cancha_cost, v_challenge.field_price),
      'pending',
      v_is_format_combined,
      COALESCE(v_challenge.location, v_challenge.location_name),
      now()
    )
    RETURNING * INTO v_match;
  END IF;

  PERFORM public.prepare_challenge_team_squad(v_challenge.id, true);

  BEGIN
    SELECT t.name INTO v_challenger_name FROM public.teams t WHERE t.id = v_challenge.challenger_team_id;
    SELECT t.name INTO v_accepted_name FROM public.teams t WHERE t.id = v_challenge.accepted_team_id;

    v_accept_message := format(
      'El desafio entre %s y %s fue aceptado. Ya pueden coordinar la cancha.',
      COALESCE(NULLIF(v_challenger_name, ''), 'Equipo A'),
      COALESCE(NULLIF(v_accepted_name, ''), 'Equipo B')
    );

    INSERT INTO public.notifications (user_id, type, title, message, data, read, created_at)
    SELECT
      recipients.user_id,
      notification_type.type,
      notification_type.title,
      CASE
        WHEN notification_type.type = 'challenge_accepted' THEN v_accept_message
        ELSE format('Se creo el partido para %s vs %s.', COALESCE(NULLIF(v_challenger_name, ''), 'Equipo A'), COALESCE(NULLIF(v_accepted_name, ''), 'Equipo B'))
      END,
      jsonb_build_object(
        'challenge_id', v_challenge.id,
        'team_match_id', v_match.id,
        'origin_type', 'challenge',
        'link', '/desafios/equipos/partidos/' || v_match.id::text
      ),
      false,
      now()
    FROM (
      SELECT DISTINCT user_id
      FROM (
        SELECT t.owner_user_id AS user_id
        FROM public.teams t
        WHERE t.id IN (v_challenge.challenger_team_id, v_challenge.accepted_team_id)

        UNION ALL

        SELECT tm.user_id
        FROM public.team_members tm
        WHERE tm.team_id IN (v_challenge.challenger_team_id, v_challenge.accepted_team_id)
          AND tm.user_id IS NOT NULL

        UNION ALL

        SELECT j.usuario_id
        FROM public.team_members tm
        JOIN public.jugadores j ON j.id = tm.jugador_id
        WHERE tm.team_id IN (v_challenge.challenger_team_id, v_challenge.accepted_team_id)
          AND j.usuario_id IS NOT NULL
      ) raw_members
      WHERE user_id IS NOT NULL
    ) recipients
    CROSS JOIN (
      VALUES
        ('challenge_accepted'::text, 'Desafio aceptado'::text),
        ('team_match_created'::text, 'Partido creado'::text)
    ) AS notification_type(type, title);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN QUERY SELECT v_challenge.id, v_match.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_accept_challenge(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_confirm_challenge(
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
  v_accepted_format smallint;
  v_is_format_combined boolean := false;
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

  IF v_challenge.status <> 'accepted' THEN
    RAISE EXCEPTION 'Solo se pueden confirmar challenges en estado accepted';
  END IF;

  IF NOT public.challenge_user_is_owner_or_captain(p_challenge_id, v_uid) THEN
    RAISE EXCEPTION 'Solo owner/capitan involucrado puede confirmar';
  END IF;

  IF v_challenge.accepted_team_id IS NULL THEN
    RAISE EXCEPTION 'Challenge sin equipo rival';
  END IF;

  SELECT t.format
  INTO v_accepted_format
  FROM public.teams t
  WHERE t.id = v_challenge.accepted_team_id;

  IF v_accepted_format IS NULL OR v_accepted_format <> v_challenge.format THEN
    RAISE EXCEPTION 'No se puede confirmar: ambos equipos deben compartir formato';
  END IF;

  v_is_format_combined := false;

  UPDATE public.challenges c
  SET
    status = 'confirmed',
    updated_at = now()
  WHERE c.id = p_challenge_id
  RETURNING * INTO v_challenge;

  INSERT INTO public.team_matches (
    origin_type,
    challenge_id,
    team_a_id,
    team_b_id,
    format,
    mode,
    scheduled_at,
    location,
    cancha_cost,
    status,
    is_format_combined,
    location_name,
    updated_at
  ) VALUES (
    'challenge',
    v_challenge.id,
    v_challenge.challenger_team_id,
    v_challenge.accepted_team_id,
    v_challenge.format,
    v_challenge.mode,
    v_challenge.scheduled_at,
    COALESCE(v_challenge.location, v_challenge.location_name),
    COALESCE(v_challenge.cancha_cost, v_challenge.field_price),
    'confirmed',
    v_is_format_combined,
    COALESCE(v_challenge.location, v_challenge.location_name),
    now()
  )
  ON CONFLICT (challenge_id) WHERE challenge_id IS NOT NULL
  DO UPDATE SET
    origin_type = 'challenge',
    team_a_id = EXCLUDED.team_a_id,
    team_b_id = EXCLUDED.team_b_id,
    format = EXCLUDED.format,
    mode = EXCLUDED.mode,
    scheduled_at = EXCLUDED.scheduled_at,
    location = EXCLUDED.location,
    cancha_cost = EXCLUDED.cancha_cost,
    status = CASE
      WHEN public.team_matches.status IN ('played', 'cancelled') THEN public.team_matches.status
      ELSE 'confirmed'
    END,
    is_format_combined = EXCLUDED.is_format_combined,
    location_name = EXCLUDED.location_name,
    updated_at = now();

  PERFORM public.prepare_challenge_team_squad(v_challenge.id, true);

  RETURN v_challenge;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_confirm_challenge(uuid) TO authenticated, service_role;

COMMIT;
