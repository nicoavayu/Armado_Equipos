-- SOCIAL-V1 lab fixture, on top of backend/torneos/season-scope-fix/lab/fixture.sql (identities U owner A+B, V owner C,
-- W collaborator of A assigned to season A1 only; Copa A in season A1).
--   • season A2 of org A is PREMIUM (manual grant) and holds "Copa A2";
--   • X is an admin of org A assigned to season A2 only (FREE A1 is already at its owner + 1 limit);
--   • org B (owner U) has "Copa B" in season B, FREE; org C (owner V) has "Copa C" in season C.
\set ON_ERROR_STOP 1
insert into public.torneos_identity(id,core_user_id) values
 ('44444444-4444-4444-8444-444444444444','a4444444-4444-4444-8444-444444444444'); -- X admin A, season A2 only
insert into public.tournament_organization_members(id,organization_id,user_id,role,joined_at) values
 ('aaaa0004-0000-4000-8000-000000000004','aaaaaaaa-0000-4000-8000-00000000000a','44444444-4444-4444-8444-444444444444','admin',now());
insert into public.tournament_season_member_assignments(organization_id,season_id,membership_id) values
 ('aaaaaaaa-0000-4000-8000-00000000000a','5a5a5a5a-0000-4000-8000-0000000000a2','aaaa0004-0000-4000-8000-000000000004');
insert into public.tournaments(id,organization_id,season_id,name,slug,sport_modality,competition_format,team_size,created_by,creation_key) values
 ('7a7a7a7a-0000-4000-8000-0000000000a2','aaaaaaaa-0000-4000-8000-00000000000a','5a5a5a5a-0000-4000-8000-0000000000a2','Copa A2','copa-a2','football_5','groups',5,'11111111-1111-4111-8111-111111111111',gen_random_uuid()),
 ('7b7b7b7b-0000-4000-8000-0000000000b1','bbbbbbbb-0000-4000-8000-00000000000b','5b5b5b5b-0000-4000-8000-0000000000b1','Copa B','copa-b','football_5','groups',5,'11111111-1111-4111-8111-111111111111',gen_random_uuid()),
 ('7c7c7c7c-0000-4000-8000-0000000000c1','cccccccc-0000-4000-8000-00000000000c','5c5c5c5c-0000-4000-8000-0000000000c1','Copa C','copa-c','football_5','groups',5,'22222222-2222-4222-8222-222222222222',gen_random_uuid());
insert into public.tournament_season_plan_grants(organization_id,season_id,plan_code,source,reason) values
 ('aaaaaaaa-0000-4000-8000-00000000000a','5a5a5a5a-0000-4000-8000-0000000000a2','PREMIUM','manual_legacy','SOCIAL-V1 lab: season A2 is PREMIUM');
