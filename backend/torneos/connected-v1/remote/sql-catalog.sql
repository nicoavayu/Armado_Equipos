with added(name) as (values
  -- 00000000000009_connected_product_v1.sql (33)
  ('private.authorize_applicant_core_contract'), ('public.assert_tournament_catalog_manager'), ('public.get_my_torneos_inbox_summary'),
  ('public.get_my_torneos_notifications'), ('public.get_my_torneos_profile'), ('public.get_my_tournament_participations'),
  ('public.get_my_tournament_registrations'), ('public.get_tournament_application_inbox'), ('public.get_tournament_catalog_entry'),
  ('public.get_tournament_catalog_facets'), ('public.get_tournament_catalog_listing_settings'), ('public.guard_tournament_team_entry_connected_transition'),
  ('public.list_my_core_teams_for_application'), ('public.mark_my_torneos_notifications_read'), ('public.notify_tournament_team_entry_reviewed'),
  ('public.notify_tournament_team_entry_submitted'), ('public.platform_remove_tournament_catalog_listing'), ('public.save_tournament_catalog_listing'),
  ('public.save_tournament_category_capacity'), ('public.search_my_applicable_core_teams'), ('public.search_tournament_catalog'),
  ('public.set_tournament_applications_state'), ('public.set_tournament_catalog_listing_status'), ('public.start_tournament_application'),
  ('public.tournament_application_team_registrations'), ('public.tournament_catalog_block_reason'), ('public.tournament_catalog_categories'),
  ('public.tournament_catalog_is_visible'), ('public.tournament_catalog_normalize'), ('public.tournament_catalog_state'),
  ('public.tournament_notification_visible'), ('public.tournament_registration_reviewer_ids'), ('public.update_my_torneos_profile'),
  -- 00000000000010_branding_v1.sql (2)
  ('public.can_read_tournament_branding_object'), ('public.is_public_tournament_branding_object'),
  -- 00000000000011_connected_roster_search.sql replaces these two certified bodies (tracked by md5 in roster_search)
  ('public.search_tournament_players'), ('private.authorize_core_contract')),
new_tables(name) as (values ('tournament_user_profiles'), ('tournament_catalog_listings'), ('tournament_category_capacities'),
  ('tournament_team_applications'), ('tournament_user_notifications')),
fns as (select p.oid, n.nspname, p.proname, (n.nspname || '.' || p.proname) as qname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private'))
select json_build_object(
 'db', current_database(), 'user', current_user, 'tx_read_only', current_setting('transaction_read_only'),
 'torneos_tables', to_regclass('public.tournament_seasons') is not null and to_regclass('public.tournament_organizations') is not null,
 'storage_ready', to_regclass('storage.objects') is not null and to_regclass('storage.buckets') is not null,
 'counts', (select json_build_object('authenticated', count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')),
     'anon', count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'),
 'roster_search', json_build_object(
   'search_md5', (select md5(prosrc) from pg_proc where oid = 'public.search_tournament_players(uuid,uuid,text,integer,uuid)'::regprocedure),
   'authorize_md5', (select md5(prosrc) from pg_proc where oid = 'private.authorize_core_contract(text,jsonb)'::regprocedure)),
 'connected', json_build_object(
   'tables', (select coalesce(json_agg(t.name order by t.name), '[]'::json) from new_tables t where to_regclass('public.' || t.name) is not null),
   'triggers', (select coalesce(json_agg(tg.tgname::text order by tg.tgname), '[]'::json) from pg_trigger tg
     where not tg.tgisinternal and tg.tgname in ('tournament_team_entries_connected_guard', 'tournament_team_entries_notify_submitted', 'tournament_team_reviews_notify')),
   'attestation_my_teams', coalesce((select pg_get_constraintdef(c.oid) like '%my_teams%' from pg_constraint c
     where c.conname = 'core_contract_attestations_contract_check'), false),
   'functions', (select count(*) from fns f join added a on a.name = f.qname where a.name not in ('public.can_read_tournament_branding_object', 'public.is_public_tournament_branding_object',
     'public.search_tournament_players', 'private.authorize_core_contract'))),
 'branding', json_build_object(
   'bucket', (case when to_regclass('storage.buckets') is null then null else
     (select json_build_object('public', b.public, 'file_size_limit', b.file_size_limit, 'allowed_mime_types', b.allowed_mime_types)
      from storage.buckets b where b.id = 'tournament-branding') end),
   'policies', (select coalesce(json_agg(policyname::text order by policyname), '[]'::json) from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname like 'tournament_branding_%'),
   'functions', (select count(*) from fns f where f.qname in ('public.can_read_tournament_branding_object', 'public.is_public_tournament_branding_object'))),
 -- Everything that existed before 0009 must stay byte-identical (bodies, ACL, owner, security, config).
 'kept_fn', (select json_build_object('count', count(*), 'digest', md5(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, '-') || ':' || pg_get_userbyid(p.proowner) || ':' || p.prosecdef::text || ':' || coalesce(p.proconfig::text, '-'), ',' order by p.oid::regprocedure::text)))
   from fns f join pg_proc p on p.oid = f.oid where f.qname not in (select name from added)),
 'kept_relations', (select json_build_object('count', count(*), 'digest', md5(string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || coalesce(c.relacl::text, '-') || ':' || pg_get_userbyid(c.relowner), ',' order by n.nspname, c.relname)))
   from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private') and c.relkind in ('r', 'v', 'm', 'p', 'f', 'S')
   and not exists (select 1 from new_tables t where c.relname = t.name or c.relname like t.name || '\_%')),
 'kept_policies', (select json_build_object('count', count(*), 'digest', md5(string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '-') || ':' || coalesce(with_check, '-'), ',' order by schemaname, tablename, policyname)))
   from pg_policies where (schemaname in ('public', 'private') and tablename not in (select name from new_tables))
     or (schemaname = 'storage' and policyname not like 'tournament_branding_%')),
 'other_buckets', (case when to_regclass('storage.buckets') is null then null else
   (select json_build_object('count', count(*), 'digest', md5(coalesce(string_agg(b.id || ':' || b.public::text || ':' || coalesce(b.file_size_limit::text, '-') || ':' || coalesce(b.allowed_mime_types::text, '-'), ',' order by b.id), '')))
    from storage.buckets b where b.id <> 'tournament-branding') end)
)
