-- SEASON-SCOPE-FIX lab fixture: identities U (owner A,B), V (no membership), W (collaborator of A, assigned to season A only).
\set ON_ERROR_STOP 1
insert into public.torneos_identity(id,core_user_id) values
 ('11111111-1111-4111-8111-111111111111','a1111111-1111-4111-8111-111111111111'), -- U owner A,B
 ('22222222-2222-4222-8222-222222222222','a2222222-2222-4222-8222-222222222222'), -- V no membership
 ('33333333-3333-4333-8333-333333333333','a3333333-3333-4333-8333-333333333333'); -- W collaborator A, SA only
insert into public.tournament_organizations(id,name,slug,created_by,creation_key) values
 ('aaaaaaaa-0000-4000-8000-00000000000a','Lab Org A','lab-org-a','11111111-1111-4111-8111-111111111111',gen_random_uuid()),
 ('bbbbbbbb-0000-4000-8000-00000000000b','Lab Org B','lab-org-b','11111111-1111-4111-8111-111111111111',gen_random_uuid()),
 ('cccccccc-0000-4000-8000-00000000000c','Lab Org C','lab-org-c','22222222-2222-4222-8222-222222222222',gen_random_uuid());
insert into public.tournament_organization_members(id,organization_id,user_id,role,joined_at) values
 ('aaaa0001-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-00000000000a','11111111-1111-4111-8111-111111111111','owner',now()),
 ('bbbb0001-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-00000000000b','11111111-1111-4111-8111-111111111111','owner',now()),
 ('cccc0001-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-00000000000c','22222222-2222-4222-8222-222222222222','owner',now()),
 ('aaaa0003-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-00000000000a','33333333-3333-4333-8333-333333333333','collaborator',now());
insert into public.tournament_seasons(id,organization_id,name,slug,status,created_by,creation_key) values
 ('5a5a5a5a-0000-4000-8000-0000000000a1','aaaaaaaa-0000-4000-8000-00000000000a','Temporada A','temporada-a','active','11111111-1111-4111-8111-111111111111',gen_random_uuid()),
 ('5a5a5a5a-0000-4000-8000-0000000000a2','aaaaaaaa-0000-4000-8000-00000000000a','Temporada A2','temporada-a2','active','11111111-1111-4111-8111-111111111111',gen_random_uuid()),
 ('5b5b5b5b-0000-4000-8000-0000000000b1','bbbbbbbb-0000-4000-8000-00000000000b','Temporada B','temporada-b','active','11111111-1111-4111-8111-111111111111',gen_random_uuid()),
 ('5c5c5c5c-0000-4000-8000-0000000000c1','cccccccc-0000-4000-8000-00000000000c','Temporada C','temporada-c','active','22222222-2222-4222-8222-222222222222',gen_random_uuid());
insert into public.tournament_season_member_assignments(organization_id,season_id,membership_id) values
 ('aaaaaaaa-0000-4000-8000-00000000000a','5a5a5a5a-0000-4000-8000-0000000000a1','aaaa0003-0000-4000-8000-000000000003');
insert into public.tournaments(id,organization_id,season_id,name,slug,sport_modality,competition_format,team_size,created_by,creation_key) values
 ('7a7a7a7a-0000-4000-8000-0000000000a1','aaaaaaaa-0000-4000-8000-00000000000a','5a5a5a5a-0000-4000-8000-0000000000a1','Copa A','copa-a','football_5','groups',5,'11111111-1111-4111-8111-111111111111',gen_random_uuid());
