-- Atomically demote an approved join request when the player is removed from the
-- roster (forward fix for PR #87 smoke finding #3: "Aprobado - sincronizando…"
-- forever after an admin ejects the player).
--
-- ROOT CAUSE: on eject the client deletes the `jugadores` row and then, in a
-- SEPARATE best-effort statement, tries to update the requester's
-- match_join_requests row from 'approved' to 'rejected'. That second write is not
-- atomic with the delete and can silently no-op or lose the race against the public
-- screen's realtime refresh, which then re-derives 'approved_pending_sync'
-- (member gone + request still 'approved') indefinitely.
--
-- FIX: move the demotion into the database, atomically, as an AFTER DELETE trigger
-- on jugadores. Whenever a roster row is removed, any still-'approved' join request
-- for that (match, user) is demoted to 'rejected' in the SAME transaction as the
-- delete. Running as the table owner it bypasses RLS (which is exactly why the
-- client update was unreliable), and it covers EVERY removal path (admin eject,
-- self-leave, promotions that delete-and-reinsert, etc.), not just the admin UI.
--
-- 'rejected' is the existing terminal status already understood everywhere:
--   * REOPENABLE_JOIN_REQUEST_STATUSES on the client = {cancelled, rejected}, so the
--     user can request again later (the unique/duplicate path reopens it).
--   * approve_join_request refuses to approve a non-pending request, so an old
--     'approved' row can never silently re-add someone — and after demotion it is
--     'rejected', so it never re-appears in the roster on its own.
--
-- Forward-only and additive; does not touch the applied migrations.

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_demote_join_request_on_player_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Manually-added players carry no usuario_id and therefore no join request.
  IF OLD.usuario_id IS NULL THEN
    RETURN OLD;
  END IF;

  UPDATE public.match_join_requests
  SET status = 'rejected',
      decided_at = now()
  WHERE match_id = OLD.partido_id
    AND user_id = OLD.usuario_id
    AND status = 'approved';

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_demote_join_request_on_player_removal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_demote_join_request_on_player_removal ON public.jugadores;
CREATE TRIGGER trg_demote_join_request_on_player_removal
AFTER DELETE ON public.jugadores
FOR EACH ROW EXECUTE FUNCTION public.tg_demote_join_request_on_player_removal();

COMMIT;

-- ---------------------------------------------------------------------------
-- DOWN (manual rollback reference — not executed):
--   DROP TRIGGER IF EXISTS trg_demote_join_request_on_player_removal ON public.jugadores;
--   DROP FUNCTION IF EXISTS public.tg_demote_join_request_on_player_removal();
-- ---------------------------------------------------------------------------
