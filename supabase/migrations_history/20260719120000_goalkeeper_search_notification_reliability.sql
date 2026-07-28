-- Reliable "buscan arquero" notifications (forward fix for PR #87 smoke findings).
--
-- Two independent breaks found in physical smoke:
--   A) NO PUSH. notify_available_goalkeepers inserts a `notifications` row of type
--      'match_needs_goalkeeper', but that type was NOT mapped in
--      notification_event_channel → it fell through to 'INFO', and
--      notification_channel_allows_push('INFO') = false. The push enqueue trigger
--      (trg_notifications_queue_remote_push) therefore logged it as
--      'skipped: in_app_only_channel' and never dispatched a device push.
--   B) NEVER FIRED ON CREATION / FRAGILE ON TOGGLE. The fan-out RPC was only ever
--      invoked from one frontend effect (the admin "buscar arquero" toggle). A
--      match CREATED with busca_arquero=true never called it at all, and even the
--      toggle path was a fire-and-forget client call that could silently no-op.
--
-- This migration is FORWARD-ONLY and additive. It does NOT modify the already
-- applied migrations 20260718120000 / 20260718121000. It:
--   1) Maps 'match_needs_goalkeeper' to a dedicated, push-allowed channel
--      'GOALKEEPER_SEARCH' (CREATE OR REPLACE of the two channel helpers, each
--      reproduced verbatim + one added entry).
--   2) Extracts the fan-out core into an internal helper _notify_goalkeepers_for_match
--      (actor passed in, no auth.uid() dependency) so it can run from a DB trigger.
--   3) Re-points notify_available_goalkeepers (same signature/grants) to delegate to
--      that helper after its owner/auth checks — the RPC keeps working unchanged.
--   4) Adds an AFTER INSERT/UPDATE trigger on partidos that fans out reliably when a
--      match is created with busca_arquero=true, or transitions false→true. The
--      fan-out is best-effort: a failure can never block the match write.
--
-- Invariants preserved (unchanged from 20260718120000): only ARQ + disponible_arquero
-- users, within radius (when the match has coordinates), future match, organizer and
-- current participants excluded, deduped exactly once per (user, match) via the
-- existing partial unique index notifications_match_needs_goalkeeper_unique — so
-- toggling off and on again never spams.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Channel mapping so the notification actually pushes.
--    Reproduced verbatim from 20260620140000_payment_reminder_push_channel with a
--    single added branch for 'match_needs_goalkeeper'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notification_event_channel(p_type text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_type text := lower(trim(COALESCE(p_type, '')));
BEGIN
  CASE v_type
    WHEN 'match_invite' THEN RETURN 'INVITATION';
    WHEN 'match_cancelled' THEN RETURN 'CANCELLATION';
    WHEN 'match_deleted' THEN RETURN 'CANCELLATION';
    WHEN 'match_kicked' THEN RETURN 'CANCELLATION';
    WHEN 'survey_start' THEN RETURN 'SURVEY';
    WHEN 'post_match_survey' THEN RETURN 'SURVEY';
    WHEN 'survey_reminder' THEN RETURN 'SURVEY';
    WHEN 'survey_reminder_12h' THEN RETURN 'SURVEY';
    WHEN 'match_join_approved' THEN RETURN 'ACCEPTED';
    WHEN 'match_join_request' THEN RETURN 'JOIN_REQUEST';
    WHEN 'call_to_vote' THEN RETURN 'VOTE_REQUEST';
    WHEN 'match_reminder_1h' THEN RETURN 'REMINDER';
    WHEN 'substitute_promoted' THEN RETURN 'REMINDER';
    WHEN 'award_won' THEN RETURN 'REMINDER';
    WHEN 'no_show_penalty_applied' THEN RETURN 'REMINDER';
    WHEN 'no_show_recovery_applied' THEN RETURN 'REMINDER';
    WHEN 'awards_ready' THEN RETURN 'AWARDS_READY';
    WHEN 'survey_results_ready' THEN RETURN 'SURVEY_RESULTS';
    WHEN 'survey_finished' THEN RETURN 'SURVEY_RESULTS';
    WHEN 'friend_request' THEN RETURN 'INVITATION';
    WHEN 'friend_accepted' THEN RETURN 'SOCIAL';
    WHEN 'friend_rejected' THEN RETURN 'SOCIAL';
    WHEN 'admin_transfer' THEN RETURN 'ADMIN_TRANSFER';
    WHEN 'team_captain_transfer' THEN RETURN 'ADMIN_TRANSFER';
    WHEN 'team_challenge_received' THEN RETURN 'INVITATION';
    WHEN 'team_challenge_accepted' THEN RETURN 'ACCEPTED';
    WHEN 'team_challenge_rejected' THEN RETURN 'SOCIAL';
    WHEN 'payment_reminder' THEN RETURN 'REMINDER';
    WHEN 'match_needs_goalkeeper' THEN RETURN 'GOALKEEPER_SEARCH';
    WHEN 'match_update' THEN RETURN 'MATCH_UPDATE';
    ELSE
      RETURN 'INFO';
  END CASE;
END;
$$;

-- Reproduced verbatim from 20260603184500_enable_push_for_in_app_important_events
-- with 'GOALKEEPER_SEARCH' added to the push-allowed set. A brand-new channel has
-- no prior delivery-log rows, so the generic 30m cooldown never suppresses the very
-- first (and, by the unique index, only) goalkeeper notification per (user, match).
CREATE OR REPLACE FUNCTION public.notification_channel_allows_push(p_channel text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(upper($1), '') = ANY (
    ARRAY[
      'INVITATION',
      'CANCELLATION',
      'SURVEY',
      'ACCEPTED',
      'JOIN_REQUEST',
      'VOTE_REQUEST',
      'REMINDER',
      'SURVEY_RESULTS',
      'AWARDS_READY',
      'SOCIAL',
      'ADMIN_TRANSFER',
      'MATCH_UPDATE',
      'GOALKEEPER_SEARCH'
    ]
  );
$$;

-- ---------------------------------------------------------------------------
-- 2) Internal fan-out core. Same query and invariants as the original
--    notify_available_goalkeepers, but the actor (organizer to exclude) is passed
--    in instead of read from auth.uid(), so it can run inside a table trigger.
--    Never raises on "no candidates"; returns a summary.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._notify_goalkeepers_for_match(
  p_match_id bigint,
  p_actor uuid,
  p_max_distance_km integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match public.partidos%ROWTYPE;
  v_kickoff timestamptz;
  v_max int := GREATEST(1, LEAST(COALESCE(p_max_distance_km, 30), 30));
  v_match_has_coords boolean;
  v_notified int := 0;
BEGIN
  SELECT * INTO v_match
  FROM public.partidos
  WHERE id = p_match_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'notified', 0, 'reason', 'match_not_found');
  END IF;

  -- Only fan out for a match actively searching a goalkeeper and still in the future.
  IF COALESCE(v_match.busca_arquero, false) <> true THEN
    RETURN jsonb_build_object('ok', true, 'notified', 0, 'reason', 'not_searching_goalkeeper');
  END IF;

  v_kickoff := public.partido_kickoff_at(v_match.fecha, v_match.hora);
  IF v_kickoff IS NULL OR v_kickoff <= now() THEN
    RETURN jsonb_build_object('ok', true, 'notified', 0, 'reason', 'match_not_future');
  END IF;

  v_match_has_coords := public.coordinates_are_valid(v_match.sede_latitud, v_match.sede_longitud);

  WITH eligible AS (
    SELECT
      u.id,
      CASE
        WHEN v_match_has_coords AND public.coordinates_are_valid(u.latitud, u.longitud)
          THEN public.haversine_km(v_match.sede_latitud, v_match.sede_longitud, u.latitud, u.longitud)
        ELSE NULL
      END AS dist
    FROM public.usuarios u
    WHERE u.disponible_arquero = true
      AND 'ARQ' = ANY(COALESCE(u.posiciones, '{}'::text[]))
      AND u.id IS DISTINCT FROM p_actor
      AND NOT EXISTS (
        SELECT 1 FROM public.jugadores j
        WHERE j.partido_id = p_match_id AND j.usuario_id = u.id
      )
  ),
  recipients AS (
    SELECT id
    FROM eligible
    WHERE
      NOT v_match_has_coords
      OR (dist IS NOT NULL AND dist <= v_max)
  ),
  inserted AS (
    INSERT INTO public.notifications (
      user_id, type, title, message, partido_id, data, read, created_at
    )
    SELECT
      r.id,
      'match_needs_goalkeeper',
      'Buscan arquero cerca tuyo',
      trim(both ' ·' FROM concat_ws(' · ',
        NULLIF(
          concat_ws(' ',
            to_char(v_match.fecha, 'DD/MM'),
            NULLIF(left(COALESCE(v_match.hora, ''), 5), '')
          ), ''),
        NULLIF(v_match.modalidad, ''),
        NULLIF(btrim(COALESCE(v_match.sede_direccion_normalizada, v_match.sede, '')), '')
      )),
      p_match_id,
      jsonb_build_object(
        'match_id', p_match_id,
        'matchId', p_match_id,
        'type', 'match_needs_goalkeeper',
        'link', '/partido-publico/' || p_match_id
      ),
      false,
      now()
    FROM recipients r
    ON CONFLICT (user_id, partido_id) WHERE (type = 'match_needs_goalkeeper')
    DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_notified FROM inserted;

  RETURN jsonb_build_object('ok', true, 'notified', v_notified);
END;
$$;

REVOKE ALL ON FUNCTION public._notify_goalkeepers_for_match(bigint, uuid, integer) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Keep the RPC working (backward compatible): same signature, same grants,
--    same owner/auth checks — it now delegates the fan-out to the shared helper.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_available_goalkeepers(
  p_match_id bigint,
  p_max_distance_km integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT creado_por INTO v_owner FROM public.partidos WHERE id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido no encontrado';
  END IF;
  IF v_owner IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN public._notify_goalkeepers_for_match(p_match_id, v_actor, p_max_distance_km);
END;
$$;

REVOKE ALL ON FUNCTION public.notify_available_goalkeepers(bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_available_goalkeepers(bigint, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) The reliable trigger: fan out on creation with busca_arquero=true and on the
--    false→true transition, independent of any frontend call. Best-effort: a
--    fan-out error is swallowed so it can never roll back the match write.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_partido_goalkeeper_search_fanout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.busca_arquero, false) = true
     AND (TG_OP = 'INSERT' OR OLD.busca_arquero IS DISTINCT FROM true)
     AND NEW.creado_por IS NOT NULL
  THEN
    BEGIN
      PERFORM public._notify_goalkeepers_for_match(NEW.id, NEW.creado_por);
    EXCEPTION WHEN OTHERS THEN
      -- Notification fan-out must never block creating/updating the match.
      RAISE WARNING 'goalkeeper fan-out failed for match %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_partido_goalkeeper_search_fanout ON public.partidos;
CREATE TRIGGER trg_partido_goalkeeper_search_fanout
AFTER INSERT OR UPDATE OF busca_arquero ON public.partidos
FOR EACH ROW EXECUTE FUNCTION public.tg_partido_goalkeeper_search_fanout();

COMMIT;

-- ---------------------------------------------------------------------------
-- DOWN (manual rollback reference — not executed):
--   DROP TRIGGER IF EXISTS trg_partido_goalkeeper_search_fanout ON public.partidos;
--   DROP FUNCTION IF EXISTS public.tg_partido_goalkeeper_search_fanout();
--   DROP FUNCTION IF EXISTS public._notify_goalkeepers_for_match(bigint, uuid, integer);
--   -- notify_available_goalkeepers reverts to its 20260718120000 body;
--   -- notification_event_channel reverts to 20260620140000;
--   -- notification_channel_allows_push reverts to 20260603184500.
-- ---------------------------------------------------------------------------
