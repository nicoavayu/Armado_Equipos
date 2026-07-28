-- ============================================================================
-- Equipos & Desafios module (additive)
-- Date: 2026-02-21
-- Scope:
--   - New tables: teams, team_members, challenges, team_matches
--   - New RLS policies (only on new tables)
--   - New RPCs for state transitions
--   - Storage bucket for team crests
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) Base tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  format smallint NOT NULL,
  base_zone text NULL,
  skill_level text NOT NULL DEFAULT 'normal',
  crest_url text NULL,
  color_primary text NULL,
  color_secondary text NULL,
  color_accent text NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teams_format_check CHECK (format IN (5, 6, 7, 8, 9, 11)),
  CONSTRAINT teams_skill_level_check CHECK (skill_level IN ('easy', 'normal', 'hard')),
  CONSTRAINT teams_color_primary_hex_check CHECK (
    color_primary IS NULL OR color_primary ~* '^#([0-9a-f]{6})$'
  ),
  CONSTRAINT teams_color_secondary_hex_check CHECK (
    color_secondary IS NULL OR color_secondary ~* '^#([0-9a-f]{6})$'
  ),
  CONSTRAINT teams_color_accent_hex_check CHECK (
    color_accent IS NULL OR color_accent ~* '^#([0-9a-f]{6})$'
  )
);

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
    RAISE EXCEPTION 'No se encontro public.jugadores.id para team_members.jugador_id';
  END IF;

  EXECUTE format($fmt$
    CREATE TABLE IF NOT EXISTS public.team_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
      jugador_id %s NOT NULL REFERENCES public.jugadores(id) ON DELETE CASCADE,
      role text NOT NULL DEFAULT 'player',
      is_captain boolean NOT NULL DEFAULT false,
      shirt_number smallint NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT team_members_role_check CHECK (role IN ('captain', 'gk', 'defender', 'mid', 'forward', 'player')),
      CONSTRAINT team_members_shirt_number_check CHECK (shirt_number IS NULL OR shirt_number BETWEEN 0 AND 99),
      UNIQUE(team_id, jugador_id)
    )
  $fmt$, v_jugador_id_type);
END
$$;

CREATE TABLE IF NOT EXISTS public.challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenger_team_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open',
  accepted_team_id uuid NULL,
  accepted_by_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  scheduled_at timestamptz NULL,
  location_name text NULL,
  location_place_id text NULL,
  format smallint NOT NULL,
  skill_level text NOT NULL DEFAULT 'normal',
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT challenges_status_check CHECK (status IN ('open', 'accepted', 'confirmed', 'completed', 'canceled')),
  CONSTRAINT challenges_format_check CHECK (format IN (5, 6, 7, 8, 9, 11)),
  CONSTRAINT challenges_skill_level_check CHECK (skill_level IN ('easy', 'normal', 'hard')),
  CONSTRAINT challenges_distinct_teams_check CHECK (
    accepted_team_id IS NULL OR accepted_team_id <> challenger_team_id
  ),
  CONSTRAINT challenges_challenger_team_id_fkey
    FOREIGN KEY (challenger_team_id)
    REFERENCES public.teams(id)
    ON DELETE CASCADE,
  CONSTRAINT challenges_accepted_team_id_fkey
    FOREIGN KEY (accepted_team_id)
    REFERENCES public.teams(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.team_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NULL,
  team_a_id uuid NOT NULL,
  team_b_id uuid NOT NULL,
  played_at timestamptz NOT NULL,
  format smallint NOT NULL,
  location_name text NULL,
  score_a smallint NOT NULL DEFAULT 0,
  score_b smallint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'played',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_matches_format_check CHECK (format IN (5, 6, 7, 8, 9, 11)),
  CONSTRAINT team_matches_status_check CHECK (status IN ('played', 'canceled')),
  CONSTRAINT team_matches_distinct_teams_check CHECK (team_a_id <> team_b_id),
  CONSTRAINT team_matches_score_a_check CHECK (score_a >= 0),
  CONSTRAINT team_matches_score_b_check CHECK (score_b >= 0),
  CONSTRAINT team_matches_challenge_id_fkey
    FOREIGN KEY (challenge_id)
    REFERENCES public.challenges(id)
    ON DELETE SET NULL,
  CONSTRAINT team_matches_team_a_id_fkey
    FOREIGN KEY (team_a_id)
    REFERENCES public.teams(id)
    ON DELETE RESTRICT,
  CONSTRAINT team_matches_team_b_id_fkey
    FOREIGN KEY (team_b_id)
    REFERENCES public.teams(id)
    ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------------
-- 2) Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS teams_owner_user_id_idx
  ON public.teams(owner_user_id);

CREATE INDEX IF NOT EXISTS teams_format_skill_zone_idx
  ON public.teams(format, skill_level, base_zone)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS team_members_team_id_idx
  ON public.team_members(team_id);

CREATE INDEX IF NOT EXISTS team_members_jugador_id_idx
  ON public.team_members(jugador_id);

CREATE UNIQUE INDEX IF NOT EXISTS team_members_single_captain_idx
  ON public.team_members(team_id)
  WHERE is_captain = true;

CREATE INDEX IF NOT EXISTS challenges_open_feed_idx
  ON public.challenges(status, format, skill_level, created_at DESC);

CREATE INDEX IF NOT EXISTS challenges_challenger_team_id_idx
  ON public.challenges(challenger_team_id);

CREATE INDEX IF NOT EXISTS challenges_accepted_team_id_idx
  ON public.challenges(accepted_team_id);

CREATE INDEX IF NOT EXISTS challenges_created_by_user_id_idx
  ON public.challenges(created_by_user_id);

CREATE INDEX IF NOT EXISTS challenges_accepted_by_user_id_idx
  ON public.challenges(accepted_by_user_id);

CREATE INDEX IF NOT EXISTS challenges_scheduled_at_idx
  ON public.challenges(scheduled_at);

CREATE UNIQUE INDEX IF NOT EXISTS team_matches_challenge_uidx
  ON public.team_matches(challenge_id)
  WHERE challenge_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS team_matches_team_a_played_idx
  ON public.team_matches(team_a_id, played_at DESC);

CREATE INDEX IF NOT EXISTS team_matches_team_b_played_idx
  ON public.team_matches(team_b_id, played_at DESC);

-- ---------------------------------------------------------------------------
-- 3) Timestamp helpers / validation triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_teams_module_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_teams_set_updated_at ON public.teams;
CREATE TRIGGER trg_teams_set_updated_at
BEFORE UPDATE ON public.teams
FOR EACH ROW
EXECUTE FUNCTION public.set_teams_module_updated_at();

DROP TRIGGER IF EXISTS trg_challenges_set_updated_at ON public.challenges;
CREATE TRIGGER trg_challenges_set_updated_at
BEFORE UPDATE ON public.challenges
FOR EACH ROW
EXECUTE FUNCTION public.set_teams_module_updated_at();

CREATE OR REPLACE FUNCTION public.validate_challenge_payload()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
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

    IF NEW.format <> v_accepted_format THEN
      RAISE EXCEPTION 'challenge.format debe coincidir con teams.format del accepted_team';
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

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IN ('completed', 'canceled') AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'no se puede cambiar estado desde %', OLD.status;
    END IF;

    IF OLD.status <> NEW.status THEN
      IF NOT (
        (OLD.status = 'open' AND NEW.status IN ('accepted', 'canceled')) OR
        (OLD.status = 'accepted' AND NEW.status IN ('confirmed', 'canceled')) OR
        (OLD.status = 'confirmed' AND NEW.status IN ('completed', 'canceled'))
      ) THEN
        RAISE EXCEPTION 'transicion de estado invalida: % -> %', OLD.status, NEW.status;
      END IF;
    END IF;

    IF OLD.accepted_team_id IS NOT NULL
       AND NEW.accepted_team_id IS DISTINCT FROM OLD.accepted_team_id THEN
      RAISE EXCEPTION 'accepted_team_id no puede cambiar una vez asignado';
    END IF;

    IF OLD.accepted_by_user_id IS NOT NULL
       AND NEW.accepted_by_user_id IS DISTINCT FROM OLD.accepted_by_user_id THEN
      RAISE EXCEPTION 'accepted_by_user_id no puede cambiar una vez asignado';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_challenges_validate_payload ON public.challenges;
CREATE TRIGGER trg_challenges_validate_payload
BEFORE INSERT OR UPDATE ON public.challenges
FOR EACH ROW
EXECUTE FUNCTION public.validate_challenge_payload();

CREATE OR REPLACE FUNCTION public.validate_team_match_payload()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_challenge public.challenges%ROWTYPE;
  v_team_a_format smallint;
  v_team_b_format smallint;
BEGIN
  SELECT t.format INTO v_team_a_format FROM public.teams t WHERE t.id = NEW.team_a_id;
  SELECT t.format INTO v_team_b_format FROM public.teams t WHERE t.id = NEW.team_b_id;

  IF v_team_a_format IS NULL OR v_team_b_format IS NULL THEN
    RAISE EXCEPTION 'team_a_id/team_b_id invalidos';
  END IF;

  IF NEW.format <> v_team_a_format OR NEW.format <> v_team_b_format THEN
    RAISE EXCEPTION 'team_matches.format debe coincidir con formato de ambos equipos';
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

    IF NEW.team_a_id <> v_challenge.challenger_team_id
       OR NEW.team_b_id <> v_challenge.accepted_team_id THEN
      RAISE EXCEPTION 'team_matches debe usar los equipos del challenge';
    END IF;

    IF NEW.format <> v_challenge.format THEN
      RAISE EXCEPTION 'team_matches.format debe coincidir con challenges.format';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_matches_validate_payload ON public.team_matches;
CREATE TRIGGER trg_team_matches_validate_payload
BEFORE INSERT OR UPDATE ON public.team_matches
FOR EACH ROW
EXECUTE FUNCTION public.validate_team_match_payload();

-- ---------------------------------------------------------------------------
-- 4) Authorization helper functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_user_is_owner(p_team_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teams t
    WHERE t.id = p_team_id
      AND t.owner_user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.team_user_is_member(p_team_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.team_user_is_owner(p_team_id, p_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.team_members tm
      JOIN public.jugadores j ON j.id = tm.jugador_id
      WHERE tm.team_id = p_team_id
        AND j.usuario_id = p_user_id
    );
$$;

CREATE OR REPLACE FUNCTION public.team_user_is_captain_or_owner(p_team_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.team_user_is_owner(p_team_id, p_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.team_members tm
      JOIN public.jugadores j ON j.id = tm.jugador_id
      WHERE tm.team_id = p_team_id
        AND j.usuario_id = p_user_id
        AND (tm.is_captain = true OR tm.role = 'captain')
    );
$$;

CREATE OR REPLACE FUNCTION public.challenge_user_is_owner_or_captain(p_challenge_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.challenges c
    WHERE c.id = p_challenge_id
      AND (
        public.team_user_is_captain_or_owner(c.challenger_team_id, p_user_id)
        OR (
          c.accepted_team_id IS NOT NULL
          AND public.team_user_is_captain_or_owner(c.accepted_team_id, p_user_id)
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.team_user_is_owner(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.team_user_is_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.team_user_is_captain_or_owner(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.challenge_user_is_owner_or_captain(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) RLS policies (new tables only)
-- ---------------------------------------------------------------------------
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_matches ENABLE ROW LEVEL SECURITY;

-- teams
DROP POLICY IF EXISTS teams_select_owner_and_open_feed ON public.teams;
CREATE POLICY teams_select_owner_and_open_feed
ON public.teams
FOR SELECT
TO authenticated
USING (
  owner_user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.challenges c
    WHERE c.status = 'open'
      AND (c.challenger_team_id = teams.id OR c.accepted_team_id = teams.id)
  )
  OR EXISTS (
    SELECT 1
    FROM public.challenges c
    WHERE (c.challenger_team_id = teams.id OR c.accepted_team_id = teams.id)
      AND (c.created_by_user_id = auth.uid() OR c.accepted_by_user_id = auth.uid())
  )
);

DROP POLICY IF EXISTS teams_insert_owner_only ON public.teams;
CREATE POLICY teams_insert_owner_only
ON public.teams
FOR INSERT
TO authenticated
WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS teams_update_owner_only ON public.teams;
CREATE POLICY teams_update_owner_only
ON public.teams
FOR UPDATE
TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS teams_delete_owner_only ON public.teams;
CREATE POLICY teams_delete_owner_only
ON public.teams
FOR DELETE
TO authenticated
USING (owner_user_id = auth.uid());

-- team_members
DROP POLICY IF EXISTS team_members_select_owner_only ON public.team_members;
CREATE POLICY team_members_select_owner_only
ON public.team_members
FOR SELECT
TO authenticated
USING (public.team_user_is_owner(team_id, auth.uid()));

DROP POLICY IF EXISTS team_members_insert_owner_only ON public.team_members;
CREATE POLICY team_members_insert_owner_only
ON public.team_members
FOR INSERT
TO authenticated
WITH CHECK (public.team_user_is_owner(team_id, auth.uid()));

DROP POLICY IF EXISTS team_members_update_owner_only ON public.team_members;
CREATE POLICY team_members_update_owner_only
ON public.team_members
FOR UPDATE
TO authenticated
USING (public.team_user_is_owner(team_id, auth.uid()))
WITH CHECK (public.team_user_is_owner(team_id, auth.uid()));

DROP POLICY IF EXISTS team_members_delete_owner_only ON public.team_members;
CREATE POLICY team_members_delete_owner_only
ON public.team_members
FOR DELETE
TO authenticated
USING (public.team_user_is_owner(team_id, auth.uid()));

-- challenges
DROP POLICY IF EXISTS challenges_select_open_or_involved ON public.challenges;
CREATE POLICY challenges_select_open_or_involved
ON public.challenges
FOR SELECT
TO authenticated
USING (
  status = 'open'
  OR public.team_user_is_member(challenger_team_id, auth.uid())
  OR (
    accepted_team_id IS NOT NULL
    AND public.team_user_is_member(accepted_team_id, auth.uid())
  )
);

DROP POLICY IF EXISTS challenges_insert_owner_of_challenger ON public.challenges;
CREATE POLICY challenges_insert_owner_of_challenger
ON public.challenges
FOR INSERT
TO authenticated
WITH CHECK (
  public.team_user_is_owner(challenger_team_id, auth.uid())
  AND status = 'open'
  AND accepted_team_id IS NULL
  AND accepted_by_user_id IS NULL
);

DROP POLICY IF EXISTS challenges_update_owner_or_captain_involved ON public.challenges;
CREATE POLICY challenges_update_owner_or_captain_involved
ON public.challenges
FOR UPDATE
TO authenticated
USING (
  public.team_user_is_captain_or_owner(challenger_team_id, auth.uid())
  OR (
    accepted_team_id IS NOT NULL
    AND public.team_user_is_captain_or_owner(accepted_team_id, auth.uid())
  )
)
WITH CHECK (
  public.team_user_is_captain_or_owner(challenger_team_id, auth.uid())
  OR (
    accepted_team_id IS NOT NULL
    AND public.team_user_is_captain_or_owner(accepted_team_id, auth.uid())
  )
);

DROP POLICY IF EXISTS challenges_delete_owner_or_captain_involved ON public.challenges;
CREATE POLICY challenges_delete_owner_or_captain_involved
ON public.challenges
FOR DELETE
TO authenticated
USING (
  public.team_user_is_captain_or_owner(challenger_team_id, auth.uid())
  OR (
    accepted_team_id IS NOT NULL
    AND public.team_user_is_captain_or_owner(accepted_team_id, auth.uid())
  )
);

-- team_matches
DROP POLICY IF EXISTS team_matches_select_involved_members_only ON public.team_matches;
CREATE POLICY team_matches_select_involved_members_only
ON public.team_matches
FOR SELECT
TO authenticated
USING (
  public.team_user_is_member(team_a_id, auth.uid())
  OR public.team_user_is_member(team_b_id, auth.uid())
);

-- Grants for authenticated usage (RLS still applies)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.challenges TO authenticated;
GRANT SELECT ON public.team_matches TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) RPCs for challenge transitions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_accept_challenge(
  p_challenge_id uuid,
  p_accepted_team_id uuid
)
RETURNS public.challenges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenge public.challenges%ROWTYPE;
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

  IF v_challenge.status <> 'open' THEN
    RAISE EXCEPTION 'Solo se pueden aceptar challenges en estado open';
  END IF;

  IF v_challenge.challenger_team_id = p_accepted_team_id THEN
    RAISE EXCEPTION 'Un equipo no puede aceptarse a si mismo';
  END IF;

  IF public.team_user_is_captain_or_owner(v_challenge.challenger_team_id, v_uid) THEN
    RAISE EXCEPTION 'No podes aceptar un challenge propio';
  END IF;

  IF NOT public.team_user_is_captain_or_owner(p_accepted_team_id, v_uid) THEN
    RAISE EXCEPTION 'Solo owner/capitan del equipo rival puede aceptar';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.teams t
    WHERE t.id = p_accepted_team_id
      AND t.is_active = true
      AND t.format = v_challenge.format
  ) THEN
    RAISE EXCEPTION 'Formato invalido o equipo inactivo para aceptar challenge';
  END IF;

  UPDATE public.challenges c
  SET
    status = 'accepted',
    accepted_team_id = p_accepted_team_id,
    accepted_by_user_id = v_uid,
    updated_at = now()
  WHERE c.id = p_challenge_id
  RETURNING * INTO v_challenge;

  RETURN v_challenge;
END;
$$;

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

  UPDATE public.challenges c
  SET
    status = 'confirmed',
    updated_at = now()
  WHERE c.id = p_challenge_id
  RETURNING * INTO v_challenge;

  RETURN v_challenge;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_complete_challenge(
  p_challenge_id uuid,
  p_score_a smallint,
  p_score_b smallint,
  p_played_at timestamptz
)
RETURNS public.team_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenge public.challenges%ROWTYPE;
  v_match public.team_matches%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a < 0 OR p_score_b < 0 THEN
    RAISE EXCEPTION 'Scores invalidos';
  END IF;

  SELECT *
  INTO v_challenge
  FROM public.challenges c
  WHERE c.id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge no encontrado';
  END IF;

  IF v_challenge.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Solo se pueden finalizar challenges en estado confirmed';
  END IF;

  IF v_challenge.accepted_team_id IS NULL THEN
    RAISE EXCEPTION 'Challenge sin equipo rival';
  END IF;

  IF NOT public.challenge_user_is_owner_or_captain(p_challenge_id, v_uid) THEN
    RAISE EXCEPTION 'Solo owner/capitan involucrado puede finalizar';
  END IF;

  INSERT INTO public.team_matches (
    challenge_id,
    team_a_id,
    team_b_id,
    played_at,
    format,
    location_name,
    score_a,
    score_b,
    status
  ) VALUES (
    v_challenge.id,
    v_challenge.challenger_team_id,
    v_challenge.accepted_team_id,
    COALESCE(p_played_at, now()),
    v_challenge.format,
    v_challenge.location_name,
    p_score_a,
    p_score_b,
    'played'
  )
  ON CONFLICT (challenge_id) WHERE challenge_id IS NOT NULL
  DO UPDATE SET
    played_at = EXCLUDED.played_at,
    format = EXCLUDED.format,
    location_name = EXCLUDED.location_name,
    score_a = EXCLUDED.score_a,
    score_b = EXCLUDED.score_b,
    status = EXCLUDED.status
  RETURNING * INTO v_match;

  UPDATE public.challenges c
  SET
    status = 'completed',
    updated_at = now()
  WHERE c.id = p_challenge_id;

  RETURN v_match;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_accept_challenge(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_confirm_challenge(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_complete_challenge(uuid, smallint, smallint, timestamptz) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) Storage bucket + policies (team crests)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'team-crests',
  'team-crests',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id)
DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS team_crests_public_read ON storage.objects;
CREATE POLICY team_crests_public_read
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'team-crests');

DROP POLICY IF EXISTS team_crests_insert_owner_folder ON storage.objects;
CREATE POLICY team_crests_insert_owner_folder
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'team-crests'
  AND split_part(name, '/', 1) = auth.uid()::text
);

DROP POLICY IF EXISTS team_crests_update_owner_folder ON storage.objects;
CREATE POLICY team_crests_update_owner_folder
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'team-crests'
  AND split_part(name, '/', 1) = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'team-crests'
  AND split_part(name, '/', 1) = auth.uid()::text
);

DROP POLICY IF EXISTS team_crests_delete_owner_folder ON storage.objects;
CREATE POLICY team_crests_delete_owner_folder
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'team-crests'
  AND split_part(name, '/', 1) = auth.uid()::text
);

COMMIT;
