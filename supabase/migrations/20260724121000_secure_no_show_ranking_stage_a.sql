-- ===========================================================================
-- Security patch M1 — No-show ranking (Stage A)
-- ---------------------------------------------------------------------------
-- Closes the confirmed hole where any `authenticated` user could forge rows in
-- `rating_adjustments` / `no_show_recovery_state` (SELECT/INSERT/UPDATE `true`).
--
-- Stage A (this migration) is ADDITIVE and NON-BREAKING for pre-patch clients:
--   * Adds the single authoritative, transactional, idempotent RPC
--     `process_match_no_show_ranking(p_partido_id, p_emit_notifications)` that
--     recomputes penalties/recoveries EXCLUSIVELY from post_match_surveys, never
--     trusts client-supplied amounts and never lets the client pick who to
--     penalize. Writes rating_adjustments + no_show_recovery_state + usuarios
--     aggregates in ONE transaction; safe to retry (ON CONFLICT / recompute).
--   * Tightens SELECT on both tables (own rows, or a match shared with the row's
--     user for the results view). This is safe: StatsView reads own rows and the
--     survey-results view reads co-players.
--   * Adds NOT VALID domain CHECK constraints as an immediate mitigation for the
--     window where legacy clients still hold direct INSERT.
--
-- The direct INSERT/UPDATE/DELETE grants for `authenticated` are intentionally
-- LEFT IN PLACE here; they are revoked in Stage B
-- (20260724131000_revoke_direct_rating_writes_stage_b.sql) once the secure app
-- build (1.1.19/40) is live. Rollback SQL is documented at the bottom.
--
-- Behaviour parity: constants and formulas mirror src/services/db/penalties.js
-- exactly (threshold 2 confirmations, penalty -0.5, recovery step 0.2, cycle
-- every 3 assists, rating clamp 1..10). No formula/value/behaviour change.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Rating clamp helper (mirrors utils/playerRating: min 1, max 10, 2 dp).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._clamp_player_rating(p_value numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT round(LEAST(10::numeric, GREATEST(1::numeric, COALESCE(p_value, 1))), 2);
$$;

REVOKE ALL ON FUNCTION public._clamp_player_rating(numeric) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Internal helpers — confirmed absentees and eligibility for a match.
--    Derived ONLY from post_match_surveys. Kept out of PostgREST (no grants).
-- ---------------------------------------------------------------------------

-- A match is eligible for no-show processing when at least one survey row says
-- the match was played (se_jugo=true) OR was not played due to a confirmed
-- absence-without-notice reason.
CREATE OR REPLACE FUNCTION public._match_no_show_eligible(p_partido_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.post_match_surveys s
    WHERE s.partido_id = p_partido_id
      AND (
        s.se_jugo IS TRUE
        OR (
          s.se_jugo IS FALSE
          AND lower(btrim(COALESCE(s.motivo_no_jugado, ''))) IN
              ('absence_without_notice', 'ausencia_sin_aviso')
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public._match_no_show_eligible(bigint) FROM PUBLIC, anon, authenticated;

-- Player ids confirmed absent for a match: absentee referenced by >=2 DISTINCT
-- voters (a voter cannot confirm their own absence). Only counts eligible
-- survey rows. Mirrors buildAbsentConfirmMap + ABSENCE_CONFIRMATION_THRESHOLD.
CREATE OR REPLACE FUNCTION public._no_show_confirmed_absent_player_ids(p_partido_id bigint)
RETURNS bigint[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH eligible AS (
    SELECT s.votante_id, s.jugadores_ausentes
    FROM public.post_match_surveys s
    WHERE s.partido_id = p_partido_id
      AND (
        s.se_jugo IS TRUE
        OR (
          s.se_jugo IS FALSE
          AND lower(btrim(COALESCE(s.motivo_no_jugado, ''))) IN
              ('absence_without_notice', 'ausencia_sin_aviso')
        )
      )
      AND s.votante_id IS NOT NULL
  ),
  expanded AS (
    SELECT e.votante_id::text AS voter,
           (absent_elem)::bigint AS absent_player_id
    FROM eligible e
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(to_jsonb(e.jugadores_ausentes), '[]'::jsonb)) AS absent_elem
    WHERE absent_elem ~ '^[0-9]+$'
  ),
  filtered AS (
    -- a voter cannot confirm their own absence
    SELECT absent_player_id, voter
    FROM expanded
    WHERE voter <> absent_player_id::text
  )
  SELECT COALESCE(array_agg(absent_player_id ORDER BY absent_player_id), ARRAY[]::bigint[])
  FROM (
    SELECT absent_player_id
    FROM filtered
    GROUP BY absent_player_id
    HAVING COUNT(DISTINCT voter) >= 2
  ) confirmed;
$$;

REVOKE ALL ON FUNCTION public._no_show_confirmed_absent_player_ids(bigint) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Authoritative, transactional, idempotent no-show processor.
--    Authorization equivalent to legitimate survey closure
--    (creator or participant of the match; see finalize_match_survey_closure).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_match_no_show_ranking(
  p_partido_id bigint,
  p_emit_notifications boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_authorized boolean := false;
  v_match_name text;
  v_confirmed bigint[];
  v_penalized uuid[] := ARRAY[]::uuid[];
  v_recovered uuid[] := ARRAY[]::uuid[];
  r record;
  v_uid_user uuid;
  v_debt numeric;
  v_streak int;
  v_new_streak int;
  v_current_rating numeric;
  v_headroom numeric;
  v_recover numeric;
  v_inserted bigint;
  v_base_ranking numeric;
  v_base_abandoned int;
  v_sum_amount numeric;
  v_penalty_count int;
  v_final_streak int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_partido_id IS NULL OR p_partido_id <= 0 THEN
    RAISE EXCEPTION 'invalid_match_id' USING ERRCODE = '22023';
  END IF;

  SELECT
    (p.creado_por = v_uid
     OR EXISTS (SELECT 1 FROM public.jugadores j
                WHERE j.partido_id = p.id AND j.usuario_id = v_uid)),
    p.nombre
  INTO v_authorized, v_match_name
  FROM public.partidos p
  WHERE p.id = p_partido_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_match_name := COALESCE(NULLIF(btrim(v_match_name), ''), 'partido ' || p_partido_id::text);

  -- Nothing to do if the match is not eligible for no-show processing.
  IF NOT public._match_no_show_eligible(p_partido_id) THEN
    RETURN jsonb_build_object('success', true, 'penalized', '[]'::jsonb, 'recovered', '[]'::jsonb);
  END IF;

  v_confirmed := public._no_show_confirmed_absent_player_ids(p_partido_id);

  -- --- Capture aggregate bases BEFORE inserting this run's adjustments -------
  -- Tracked users = every registered player of this match. base = current value
  -- with all existing no-show effects stripped out (idempotent reconcile).
  CREATE TEMP TABLE _ns_base ON COMMIT DROP AS
  WITH tracked AS (
    SELECT DISTINCT j.usuario_id AS uid
    FROM public.jugadores j
    WHERE j.partido_id = p_partido_id
      AND j.usuario_id IS NOT NULL
  ),
  adj AS (
    SELECT ra.user_id AS uid,
           COALESCE(SUM(ra.amount), 0)::numeric AS sum_amount,
           COUNT(*) FILTER (WHERE ra.type = 'no_show_penalty')::int AS penalty_count
    FROM public.rating_adjustments ra
    JOIN tracked t ON t.uid = ra.user_id
    WHERE ra.type IN ('no_show_penalty', 'no_show_recovery')
    GROUP BY ra.user_id
  )
  SELECT
    t.uid,
    public._clamp_player_rating(COALESCE(u.ranking, 0) - COALESCE(a.sum_amount, 0)) AS base_ranking,
    GREATEST(0, COALESCE(u.partidos_abandonados, 0) - COALESCE(a.penalty_count, 0)) AS base_abandoned
  FROM tracked t
  JOIN public.usuarios u ON u.id = t.uid
  LEFT JOIN adj a ON a.uid = t.uid;

  -- --- Penalties: confirmed absentees mapped to their usuario_id -------------
  IF array_length(v_confirmed, 1) IS NOT NULL THEN
    FOR r IN
      SELECT DISTINCT j.usuario_id AS uid
      FROM public.jugadores j
      WHERE j.partido_id = p_partido_id
        AND j.usuario_id IS NOT NULL
        AND j.id = ANY (v_confirmed)
    LOOP
      INSERT INTO public.rating_adjustments (user_id, partido_id, type, amount, meta, created_at)
      VALUES (
        r.uid, p_partido_id, 'no_show_penalty', -0.5,
        jsonb_build_object('reason', 'absence_without_notice'),
        now()
      )
      ON CONFLICT (user_id, partido_id, type) DO NOTHING;

      IF FOUND THEN
        v_penalized := array_append(v_penalized, r.uid);
      END IF;
    END LOOP;
  END IF;

  -- --- Recoveries: attendees with outstanding debt at a 3-assist cycle -------
  FOR r IN
    SELECT DISTINCT j.id AS player_id, j.usuario_id AS uid
    FROM public.jugadores j
    WHERE j.partido_id = p_partido_id
      AND j.usuario_id IS NOT NULL
  LOOP
    v_uid_user := r.uid;

    -- attended = NOT confirmed absent
    IF v_confirmed IS NOT NULL AND r.player_id = ANY (v_confirmed) THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(CASE WHEN ra.type = 'no_show_penalty' THEN abs(ra.amount) ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN ra.type = 'no_show_recovery' THEN GREATEST(0, ra.amount) ELSE 0 END), 0)
    INTO v_debt
    FROM public.rating_adjustments ra
    WHERE ra.user_id = v_uid_user
      AND ra.type IN ('no_show_penalty', 'no_show_recovery');

    IF v_debt <= 0 THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(s.current_streak, 0) INTO v_streak
    FROM public.no_show_recovery_state s
    WHERE s.user_id = v_uid_user;
    v_streak := COALESCE(v_streak, 0);
    v_new_streak := v_streak + 1;

    IF v_new_streak % 3 <> 0 THEN
      CONTINUE;
    END IF;

    -- Skip if a recovery for this match already exists (idempotent).
    IF EXISTS (
      SELECT 1 FROM public.rating_adjustments ra
      WHERE ra.user_id = v_uid_user
        AND ra.partido_id = p_partido_id
        AND ra.type = 'no_show_recovery'
    ) THEN
      CONTINUE;
    END IF;

    SELECT public._clamp_player_rating(u.ranking) INTO v_current_rating
    FROM public.usuarios u WHERE u.id = v_uid_user;
    v_headroom := GREATEST(0, 10::numeric - COALESCE(v_current_rating, 1));
    v_recover := round(LEAST(0.2::numeric, v_debt, v_headroom), 2);

    IF v_recover <= 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.rating_adjustments (user_id, partido_id, type, amount, meta, created_at)
    VALUES (
      v_uid_user, p_partido_id, 'no_show_recovery', v_recover,
      jsonb_build_object('cycle_index', v_new_streak / 3, 'source_partido_id', p_partido_id),
      now()
    )
    ON CONFLICT (user_id, partido_id, type) DO NOTHING;

    IF FOUND THEN
      v_recovered := array_append(v_recovered, v_uid_user);
    END IF;
  END LOOP;

  -- --- Reconcile aggregates from base + all adjustments (idempotent) ---------
  FOR r IN SELECT uid, base_ranking, base_abandoned FROM _ns_base LOOP
    SELECT COALESCE(SUM(ra.amount), 0)::numeric,
           COUNT(*) FILTER (WHERE ra.type = 'no_show_penalty')::int
    INTO v_sum_amount, v_penalty_count
    FROM public.rating_adjustments ra
    WHERE ra.user_id = r.uid
      AND ra.type IN ('no_show_penalty', 'no_show_recovery');

    UPDATE public.usuarios u
    SET ranking = public._clamp_player_rating(r.base_ranking + COALESCE(v_sum_amount, 0)),
        partidos_abandonados = GREATEST(0, r.base_abandoned + COALESCE(v_penalty_count, 0))
    WHERE u.id = r.uid;

    -- Streak derived by replaying the user's closed, eligible match history.
    v_final_streak := public._derive_no_show_streak(r.uid);

    INSERT INTO public.no_show_recovery_state (user_id, current_streak, updated_at)
    VALUES (r.uid, v_final_streak, now())
    ON CONFLICT (user_id) DO UPDATE
      SET current_streak = EXCLUDED.current_streak,
          updated_at = now();
  END LOOP;

  -- --- Notifications for newly applied penalties/recoveries (server content) -
  IF p_emit_notifications THEN
    IF array_length(v_penalized, 1) IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, message, data, read, partido_id, created_at)
      SELECT uid, 'no_show_penalty',
             'Perdiste ranking por inasistencia',
             'Perdiste 0,5 puntos de ranking por faltar al partido "' || v_match_name || '".',
             jsonb_build_object('match_name', v_match_name, 'ranking_delta', -0.5),
             false, p_partido_id, now()
      FROM unnest(v_penalized) AS uid;
    END IF;

    IF array_length(v_recovered, 1) IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, message, data, read, partido_id, created_at)
      SELECT ra.user_id, 'no_show_recovery',
             'Recuperaste ranking',
             'Recuperaste puntos de ranking por cumplir 3 partidos sin faltar. Último partido contabilizado: "' || v_match_name || '".',
             jsonb_build_object('match_name', v_match_name, 'ranking_delta', ra.amount),
             false, p_partido_id, now()
      FROM public.rating_adjustments ra
      WHERE ra.partido_id = p_partido_id
        AND ra.type = 'no_show_recovery'
        AND ra.user_id = ANY (v_recovered);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'penalized', to_jsonb(v_penalized),
    'recovered', to_jsonb(v_recovered)
  );
END;
$$;

-- Streak derivation (buildCurrentRecoveryStates): replays the user's closed,
-- eligible matches chronologically. Split out so the reconcile loop stays
-- readable and so tests can target it directly.
CREATE OR REPLACE FUNCTION public._derive_no_show_streak(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debt numeric := 0;
  v_streak int := 0;
  m record;
  v_absent boolean;
  v_penalty numeric;
  v_recovery numeric;
BEGIN
  FOR m IN
    SELECT j.partido_id,
           j.id AS player_id,
           COALESCE(sr.encuesta_cerrada_at, sr.finished_at, sr.updated_at, sr.created_at) AS closed_at
    FROM public.jugadores j
    JOIN public.survey_results sr
      ON sr.partido_id = j.partido_id AND sr.results_ready IS TRUE
    WHERE j.usuario_id = p_user_id
      AND public._match_no_show_eligible(j.partido_id)
    ORDER BY COALESCE(sr.encuesta_cerrada_at, sr.finished_at, sr.updated_at, sr.created_at) NULLS FIRST,
             j.partido_id
  LOOP
    v_absent := (m.player_id = ANY (public._no_show_confirmed_absent_player_ids(m.partido_id)));

    SELECT COALESCE(SUM(CASE WHEN ra.type = 'no_show_penalty' THEN abs(ra.amount) ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN ra.type = 'no_show_recovery' THEN GREATEST(0, ra.amount) ELSE 0 END), 0)
    INTO v_penalty, v_recovery
    FROM public.rating_adjustments ra
    WHERE ra.user_id = p_user_id AND ra.partido_id = m.partido_id;

    IF v_absent THEN
      v_debt := round(v_debt + v_penalty, 2);
      v_streak := 0;
    ELSIF v_debt <= 0 THEN
      v_debt := round(GREATEST(0, v_debt - v_recovery), 2);
      v_streak := 0;
    ELSE
      v_debt := round(GREATEST(0, v_debt - v_recovery), 2);
      v_streak := v_streak + 1;
    END IF;
  END LOOP;

  RETURN v_streak;
END;
$$;

REVOKE ALL ON FUNCTION public._derive_no_show_streak(uuid) FROM PUBLIC, anon, authenticated;

-- The authoritative RPC is callable only by authenticated + service_role.
REVOKE ALL ON FUNCTION public.process_match_no_show_ranking(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_match_no_show_ranking(bigint, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Tighten SELECT (own rows, or a match shared with the row's user).
--    NON-BREAKING: StatsView reads own; results view reads co-players.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS rating_adjustments_select_authenticated ON public.rating_adjustments;
CREATE POLICY rating_adjustments_select_scoped
ON public.rating_adjustments
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.jugadores j_self
    JOIN public.jugadores j_row
      ON j_row.partido_id = j_self.partido_id
    WHERE j_self.usuario_id = auth.uid()
      AND j_row.usuario_id = public.rating_adjustments.user_id
  )
);

DROP POLICY IF EXISTS no_show_recovery_state_select_authenticated ON public.no_show_recovery_state;
CREATE POLICY no_show_recovery_state_select_own
ON public.no_show_recovery_state
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Immediate mitigation while legacy clients still hold direct INSERT:
--    bound amounts/types so a forged row cannot inflate ranking arbitrarily.
--    NOT VALID => applies to new rows only; does not scan/lock existing data.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.rating_adjustments'::regclass
      AND conname = 'rating_adjustments_amount_domain_check'
  ) THEN
    ALTER TABLE public.rating_adjustments
      ADD CONSTRAINT rating_adjustments_amount_domain_check
      CHECK (
        (type = 'no_show_penalty' AND amount < 0 AND amount >= -0.5)
        OR (type = 'no_show_recovery' AND amount > 0 AND amount <= 0.2)
      ) NOT VALID;
  END IF;
END
$$;

COMMIT;

-- ===========================================================================
-- ROLLBACK (Stage A)
-- ===========================================================================
-- BEGIN;
-- ALTER TABLE public.rating_adjustments DROP CONSTRAINT IF EXISTS rating_adjustments_amount_domain_check;
-- DROP POLICY IF EXISTS no_show_recovery_state_select_own ON public.no_show_recovery_state;
-- CREATE POLICY no_show_recovery_state_select_authenticated ON public.no_show_recovery_state
--   FOR SELECT TO authenticated USING (true);
-- DROP POLICY IF EXISTS rating_adjustments_select_scoped ON public.rating_adjustments;
-- CREATE POLICY rating_adjustments_select_authenticated ON public.rating_adjustments
--   FOR SELECT TO authenticated USING (true);
-- DROP FUNCTION IF EXISTS public.process_match_no_show_ranking(bigint, boolean);
-- DROP FUNCTION IF EXISTS public._derive_no_show_streak(uuid);
-- DROP FUNCTION IF EXISTS public._no_show_confirmed_absent_player_ids(bigint);
-- DROP FUNCTION IF EXISTS public._match_no_show_eligible(bigint);
-- DROP FUNCTION IF EXISTS public._clamp_player_rating(numeric);
-- COMMIT;
