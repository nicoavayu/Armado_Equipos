-- Rollback of 00000000000009_connected_product_v1.sql (documented, never automatic). Run only with an explicit go,
-- AFTER the gateway runs with TORNEOS_CONNECTED_MODE absent/off and the frontend without
-- REACT_APP_TORNEOS_CONNECTED_MODE=on, so nothing can call the RPCs it drops.
--
-- It removes ONLY what 0009 created: the triggers it added on existing tables, its functions (including the
-- applicant authorizer) and its five tables. No existing function body, grant or row is touched by 0009, so none is
-- restored here. Team entries created by registration requests are ordinary team entries and stay (their
-- tournament_team_applications marker rows are dropped with the table).
BEGIN;

DROP TRIGGER IF EXISTS tournament_team_entries_connected_guard ON public.tournament_team_entries;
DROP TRIGGER IF EXISTS tournament_team_entries_notify_submitted ON public.tournament_team_entries;
DROP TRIGGER IF EXISTS tournament_team_reviews_notify ON public.tournament_team_reviews;

DROP FUNCTION IF EXISTS private.authorize_applicant_core_contract(text, jsonb);
DROP FUNCTION IF EXISTS public.platform_remove_tournament_catalog_listing(uuid, text);
DROP FUNCTION IF EXISTS public.get_my_tournament_registrations(integer, integer);
DROP FUNCTION IF EXISTS public.start_tournament_application(text, text, uuid, text, text, boolean, uuid);
DROP FUNCTION IF EXISTS public.get_my_tournament_participations(integer, integer);
DROP FUNCTION IF EXISTS public.list_my_core_teams_for_application(text);
DROP FUNCTION IF EXISTS public.search_my_applicable_core_teams(text, text, integer);
DROP FUNCTION IF EXISTS public.tournament_application_team_registrations(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_tournament_application_inbox(uuid, uuid, text, integer, integer);
DROP FUNCTION IF EXISTS public.save_tournament_category_capacity(uuid, uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.set_tournament_applications_state(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.set_tournament_catalog_listing_status(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.save_tournament_catalog_listing(uuid, uuid, text, text, uuid, integer, text, text, text, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.assert_tournament_catalog_manager(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_tournament_catalog_listing_settings(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_tournament_catalog_entry(text);
DROP FUNCTION IF EXISTS public.get_tournament_catalog_facets();
DROP FUNCTION IF EXISTS public.search_tournament_catalog(text, text, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.get_my_torneos_inbox_summary();
DROP FUNCTION IF EXISTS public.mark_my_torneos_notifications_read(uuid[]);
DROP FUNCTION IF EXISTS public.get_my_torneos_notifications(boolean, integer, integer);
DROP FUNCTION IF EXISTS public.update_my_torneos_profile(text, boolean);
DROP FUNCTION IF EXISTS public.get_my_torneos_profile();
DROP FUNCTION IF EXISTS public.notify_tournament_team_entry_reviewed();
DROP FUNCTION IF EXISTS public.notify_tournament_team_entry_submitted();
DROP FUNCTION IF EXISTS public.guard_tournament_team_entry_connected_transition();
DROP FUNCTION IF EXISTS public.tournament_notification_visible(text, uuid, uuid);
DROP FUNCTION IF EXISTS public.tournament_registration_reviewer_ids(uuid, uuid);
DROP FUNCTION IF EXISTS public.tournament_catalog_categories(uuid);
DROP FUNCTION IF EXISTS public.tournament_catalog_state(uuid);
DROP FUNCTION IF EXISTS public.tournament_catalog_is_visible(uuid);
DROP FUNCTION IF EXISTS public.tournament_catalog_block_reason(uuid, uuid);
DROP FUNCTION IF EXISTS public.tournament_catalog_normalize(text);

DROP TABLE IF EXISTS public.tournament_user_notifications;
DROP TABLE IF EXISTS public.tournament_team_applications;
DROP TABLE IF EXISTS public.tournament_category_capacities;
DROP TABLE IF EXISTS public.tournament_catalog_listings;
DROP TABLE IF EXISTS public.tournament_user_profiles;

-- The certified closed list of attestation contracts (no `my_teams` attestation can outlive its 10 s TTL, but any
-- unconsumed row is removed first so the restored check holds).
DELETE FROM private.core_contract_attestations WHERE contract = 'my_teams';
ALTER TABLE private.core_contract_attestations DROP CONSTRAINT IF EXISTS core_contract_attestations_contract_check;
ALTER TABLE private.core_contract_attestations ADD CONSTRAINT core_contract_attestations_contract_check
  CHECK (contract IN ('verified_email', 'directory_players', 'directory_teams', 'team_snapshot'));

COMMIT;
