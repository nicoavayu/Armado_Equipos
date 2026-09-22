-- R4.2 run arma2-r42-20260918t224835z (stamp 20260918T224221Z) — removal of the rows THIS RUN left on R2 (local).
-- Inventory (read-only, 2026-09-19): 98 rows / 21 tables; every row references one of the 2 run orgs
-- (slugs r42-league-/r42-other-20260918t224835) or one of the 5 run identities (core_user_id of the QA users
-- already hard-deleted in Core); created_at within [22:48:47.94Z, 22:49:30.38Z]. Seed tables untouched.
-- Triggers bypassed by session_replication_role=replica (same mechanism as r42/fixtures.mjs cleanupFixtures).
-- Order: children first, parents last (pg_constraint graph read 2026-09-19); FK triggers are also off in replica mode.
BEGIN;
SET LOCAL session_replication_role = replica;

CREATE TEMP TABLE r42_scope AS
SELECT id AS org_id FROM public.tournament_organizations
 WHERE slug IN ('r42-league-20260918t224835', 'r42-other-20260918t224835')
   AND id IN ('6c3c5fce-0946-4531-b519-d885597309f9', '23bc7081-61f7-499e-a1b7-3562268f0217');
CREATE TEMP TABLE r42_ids AS
SELECT id AS identity_id, core_user_id FROM public.torneos_identity
 WHERE core_user_id IN ('a13a79b6-21a0-48e1-b968-0b308e461b1a', '256e7691-2c44-467a-a0d6-7c088df4c2fe',
                        '23e86711-bc57-46e9-a65a-6d3198f5ea7d', 'a2afe512-ebce-413c-b6ac-b0f865f3ce32',
                        'eb7e82e0-94e7-435b-aa5d-0b4b2d4f7f04')
   AND id IN ('16f61746-496f-4c3f-97ca-7b8c758505a1', '953ff9f7-8283-4a1a-9cc8-52066ed3a76e',
              '792556cf-731c-4342-bdcd-cd69c0ea9c34', 'b34a3e69-391d-490f-97dc-cf60a7f30130',
              '68cfbd44-ad73-436a-ac30-669e88b2b0cb');
DO $$ BEGIN
  IF (SELECT count(*) FROM r42_scope) <> 2 THEN RAISE EXCEPTION 'R42_SCOPE_ORGS_%', (SELECT count(*) FROM r42_scope); END IF;
  IF (SELECT count(*) FROM r42_ids)   <> 5 THEN RAISE EXCEPTION 'R42_SCOPE_IDENTITIES_%', (SELECT count(*) FROM r42_ids); END IF;
END $$;

CREATE TEMP TABLE r42_deleted (step int, t text, n bigint, expected bigint);
DO $$
DECLARE n bigint; step int := 0; item text[];
  PLAN text[][] := ARRAY[
    ['DELETE FROM private.core_contract_attestations WHERE identity_id IN (SELECT identity_id FROM r42_ids)', '2'],
    ['DELETE FROM public.tournament_audit_log WHERE organization_id IN (SELECT org_id FROM r42_scope)', '32'],
    ['DELETE FROM public.tournament_team_invitations WHERE organization_id IN (SELECT org_id FROM r42_scope)', '2'],
    ['DELETE FROM public.tournament_team_managers WHERE organization_id IN (SELECT org_id FROM r42_scope)', '2'],
    ['DELETE FROM public.tournament_roster_players WHERE organization_id IN (SELECT org_id FROM r42_scope)', '10'],
    ['DELETE FROM public.tournament_rosters WHERE organization_id IN (SELECT org_id FROM r42_scope)', '3'],
    ['DELETE FROM public.tournament_provisional_players WHERE organization_id IN (SELECT org_id FROM r42_scope)', '10'],
    ['DELETE FROM public.tournament_team_entries WHERE organization_id IN (SELECT org_id FROM r42_scope)', '3'],
    ['DELETE FROM public.user_tournament_context_preferences WHERE organization_id IN (SELECT org_id FROM r42_scope)', '1'],
    ['DELETE FROM public.tournament_roster_settings WHERE organization_id IN (SELECT org_id FROM r42_scope)', '1'],
    ['DELETE FROM public.tournament_categories WHERE organization_id IN (SELECT org_id FROM r42_scope)', '2'],
    ['DELETE FROM public.tournament_discipline_rules WHERE organization_id IN (SELECT org_id FROM r42_scope)', '2'],
    ['DELETE FROM public.tournament_scoring_rules WHERE organization_id IN (SELECT org_id FROM r42_scope)', '2'],
    ['DELETE FROM public.tournament_tiebreak_rules WHERE organization_id IN (SELECT org_id FROM r42_scope)', '8'],
    ['DELETE FROM public.tournaments WHERE organization_id IN (SELECT org_id FROM r42_scope)', '2'],
    ['DELETE FROM public.tournament_season_member_assignments WHERE organization_id IN (SELECT org_id FROM r42_scope)', '1'],
    ['DELETE FROM public.tournament_seasons WHERE organization_id IN (SELECT org_id FROM r42_scope)', '2'],
    ['DELETE FROM public.tournament_organization_members WHERE organization_id IN (SELECT org_id FROM r42_scope)', '4'],
    ['DELETE FROM public.user_workspace_preferences WHERE user_id IN (SELECT identity_id FROM r42_ids)', '2'],
    ['DELETE FROM public.tournament_organizations WHERE id IN (SELECT org_id FROM r42_scope)', '2'],
    ['DELETE FROM public.torneos_identity WHERE id IN (SELECT identity_id FROM r42_ids)', '5']
  ];
BEGIN
  FOR i IN 1..array_length(PLAN, 1) LOOP
    step := step + 1;
    EXECUTE PLAN[i][1];
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO r42_deleted VALUES (step, regexp_replace(PLAN[i][1], '^DELETE FROM (\S+).*$', '\1'), n, PLAN[i][2]::bigint);
    IF n <> PLAN[i][2]::bigint THEN RAISE EXCEPTION 'R42_CLEANUP_STEP_%_%: deleted % expected %', step, regexp_replace(PLAN[i][1], '^DELETE FROM (\S+).*$', '\1'), n, PLAN[i][2]; END IF;
  END LOOP;
END $$;

-- Verification BEFORE any commit: every non-seed table at 0; seed tables at their known counts; 98 rows removed.
DO $$
DECLARE bad text; total bigint;
BEGIN
  SELECT string_agg(t || '=' || n, ',') INTO bad FROM (
    SELECT n.nspname||'.'||c.relname AS t,
           (xpath('/row/c/text()', query_to_xml('select count(*) as c from '||quote_ident(n.nspname)||'.'||quote_ident(c.relname), false, true, '')))[1]::text::bigint AS n
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND n.nspname IN ('public','private')
      AND n.nspname||'.'||c.relname NOT IN ('public.tournament_commercial_offers','public.tournament_commercial_products','public.tournament_competition_formats','public.tournament_entitlement_capabilities','public.tournament_legacy_subscription_plans','public.tournament_media_pipeline_configuration','public.tournament_organization_role_capabilities','public.tournament_plan_catalog','public.tournament_pricing_config','public.tournament_sport_modalities')
  ) x WHERE n <> 0;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'R42_CLEANUP_RESIDUE: %', bad; END IF;
  SELECT string_agg(t || '=' || n, ',') INTO bad FROM (VALUES
    ('public.tournament_commercial_offers', (SELECT count(*) FROM public.tournament_commercial_offers), 1),
    ('public.tournament_commercial_products', (SELECT count(*) FROM public.tournament_commercial_products), 1),
    ('public.tournament_competition_formats', (SELECT count(*) FROM public.tournament_competition_formats), 5),
    ('public.tournament_entitlement_capabilities', (SELECT count(*) FROM public.tournament_entitlement_capabilities), 28),
    ('public.tournament_legacy_subscription_plans', (SELECT count(*) FROM public.tournament_legacy_subscription_plans), 2),
    ('public.tournament_media_pipeline_configuration', (SELECT count(*) FROM public.tournament_media_pipeline_configuration), 1),
    ('public.tournament_organization_role_capabilities', (SELECT count(*) FROM public.tournament_organization_role_capabilities), 285),
    ('public.tournament_plan_catalog', (SELECT count(*) FROM public.tournament_plan_catalog), 2),
    ('public.tournament_pricing_config', (SELECT count(*) FROM public.tournament_pricing_config), 1),
    ('public.tournament_sport_modalities', (SELECT count(*) FROM public.tournament_sport_modalities), 6)
  ) s(t, n, expected) WHERE n <> expected;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'R42_CLEANUP_SEED_DRIFT: %', bad; END IF;
  SELECT sum(n) INTO total FROM r42_deleted;
  IF total <> 98 THEN RAISE EXCEPTION 'R42_CLEANUP_TOTAL_%', total; END IF;
END $$;

SELECT step, t, n, expected FROM r42_deleted ORDER BY step;
SELECT sum(n) AS total_deleted FROM r42_deleted;
COMMIT;
