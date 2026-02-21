-- ============================================================================
-- Equipos & Desafios data-integrity hardening
-- Date: 2026-02-21
-- Purpose:
--   - Enforce non-empty team name at DB level
--   - Ensure one match per challenge (strict finalize semantics)
--   - Keep challenge/team format consistency validation in team_matches trigger
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) teams.name must be non-empty (not just NOT NULL)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.teams') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = 'public.teams'::regclass
         AND conname = 'teams_name_not_blank_check'
     )
  THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_name_not_blank_check
      CHECK (char_length(btrim(name)) > 0)
      NOT VALID;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.teams') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = 'public.teams'::regclass
         AND conname = 'teams_name_not_blank_check'
         AND convalidated = false
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.teams
       WHERE char_length(btrim(COALESCE(name, ''))) = 0
     )
  THEN
    ALTER TABLE public.teams VALIDATE CONSTRAINT teams_name_not_blank_check;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2) team_matches payload validation hardening
-- ---------------------------------------------------------------------------
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

    IF v_challenge.status NOT IN ('confirmed', 'completed') THEN
      RAISE EXCEPTION 'challenge_id debe estar confirmado para registrar team_match';
    END IF;

    IF NEW.team_a_id <> v_challenge.challenger_team_id
       OR NEW.team_b_id <> v_challenge.accepted_team_id THEN
      RAISE EXCEPTION 'team_matches debe usar los equipos del challenge';
    END IF;

    IF NEW.format <> v_challenge.format THEN
      RAISE EXCEPTION 'team_matches.format debe coincidir con challenges.format';
    END IF;

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

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) strict finalize RPC: exactly one match creation, no upsert
-- ---------------------------------------------------------------------------
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

  IF EXISTS (
    SELECT 1
    FROM public.team_matches tm
    WHERE tm.challenge_id = p_challenge_id
  ) THEN
    RAISE EXCEPTION 'El challenge ya fue finalizado';
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
  RETURNING * INTO v_match;

  UPDATE public.challenges c
  SET
    status = 'completed',
    updated_at = now()
  WHERE c.id = p_challenge_id;

  RETURN v_match;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_complete_challenge(uuid, smallint, smallint, timestamptz)
TO authenticated, service_role;

COMMIT;
