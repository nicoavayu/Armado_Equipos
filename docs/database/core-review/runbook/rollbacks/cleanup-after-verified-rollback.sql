-- OPTIONAL, only after a rollback of 20261010133000…142000 has been verified (postcheck of the
-- previous state + the app working). The rollbacks keep these objects on purpose so that no data
-- is lost while deciding; this removes them. Run as postgres, in one transaction.
--   * app_private.usuarios_private: the private values (email, phone, birth date, exact
--     location) — they are back in public.usuarios after the 135000 rollback;
--   * app_private.jugadores_added_by: who added each roster row — back in jugadores.added_by;
--   * app_private.match_link_access: which accounts opened a valid invite link (24 h grants);
--   * the two indexes of 20261010136000.
-- Data lost: the private table copies (the shared rows hold the same values after the rollback).
drop table if exists app_private.usuarios_private;
drop table if exists app_private.jugadores_added_by;
drop table if exists app_private.match_link_access;
drop index if exists public.match_join_requests_match_user_idx;
drop index if exists public.notifications_user_partido_idx;
