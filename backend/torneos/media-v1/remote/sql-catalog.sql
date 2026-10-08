-- MEDIA-V1 0012 operator catalog (read only): one JSON row consumed by db-0012.mjs classify() / changedOutside().
with added(name) as (values
  -- 00000000000012_media_gallery_v1.sql (10 new functions)
  ('private.tournament_media_gateway_session'), ('public.tournament_media_thumbnail_path'),
  ('public.can_write_tournament_media_gateway_object'), ('public.can_delete_tournament_media_gateway_object'),
  ('public.can_read_tournament_media_object'), ('public.tournament_media_storage_budget_status'),
  ('public.begin_tournament_media_gallery_upload'), ('public.complete_tournament_media_gallery_upload'),
  ('public.fail_tournament_media_gallery_upload'), ('public.get_tournament_media_read_targets')),
moved(name) as (values
  -- bodies 0012 replaces (tracked by md5) and the three RPCs it grants to authenticated (tracked in media.grants)
  ('public.tournament_media_storage_contract_status'), ('public.tournament_media_effective_readiness'),
  ('public.get_published_tournament_media'), ('public.transition_tournament_media_asset'),
  ('public.change_tournament_media_gallery_state'), ('public.report_tournament_media_asset')),
fns as (select p.oid, n.nspname || '.' || p.proname as qname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')),
body(name, sig) as (values
  ('storage', 'public.tournament_media_storage_contract_status()'), ('readiness', 'public.tournament_media_effective_readiness()'),
  ('published', 'public.get_published_tournament_media(uuid,uuid,uuid,integer,integer)'))
select json_build_object(
 'db', current_database(), 'tx_read_only', current_setting('transaction_read_only'),
 'torneos_tables', to_regclass('public.tournament_seasons') is not null and to_regclass('public.tournament_media_galleries') is not null,
 'storage_ready', to_regclass('storage.objects') is not null and to_regclass('storage.buckets') is not null,
 'counts', (select json_build_object('authenticated', count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')),
     'anon', count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'),
 'roster_search', json_build_object(
   'search_md5', (select md5(prosrc) from pg_proc where oid = 'public.search_tournament_players(uuid,uuid,text,integer,uuid)'::regprocedure),
   'authorize_md5', (select md5(prosrc) from pg_proc where oid = 'private.authorize_core_contract(text,jsonb)'::regprocedure)),
 'mode', (select mode from public.tournament_media_pipeline_configuration where singleton),
 -- 0013 (COMMERCE-PRODUCTION) present as a whole: its public functions add 2 authenticated EXECUTE grants.
 'commerce', to_regprocedure('public.create_tournament_season_production_checkout_purchase(uuid,uuid,uuid)') is not null
   and to_regclass('public.tournament_commerce_production_settings') is not null,
 'media_objects', (select count(*) from storage.objects where bucket_id = 'tournament-media'),
 'media', json_build_object(
   'functions', (select coalesce(json_agg(qname order by qname), '[]'::json) from fns where qname in (select name from added)),
   'bodies', (select json_object_agg(name, (select md5(prosrc) from pg_proc where oid = to_regprocedure(sig))) from body),
   'bucket', (select json_build_object('public', b.public, 'file_size_limit', b.file_size_limit, 'allowed_mime_types', b.allowed_mime_types)
     from storage.buckets b where b.id = 'tournament-media'),
   'policies', (select coalesce(json_agg(policyname order by policyname), '[]'::json) from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname like 'tournament_media_%'),
   'budget_table', to_regclass('public.tournament_media_storage_budget') is not null,
   'grants', json_build_object(
     'transition', has_function_privilege('authenticated', 'public.transition_tournament_media_asset(uuid,text,text)', 'EXECUTE'),
     'change_state', has_function_privilege('authenticated', 'public.change_tournament_media_gallery_state(uuid,text,text)', 'EXECUTE'),
     'report', has_function_privilege('authenticated', 'public.report_tournament_media_asset(uuid,text,text,boolean,uuid)', 'EXECUTE'))),
 -- What 0012 must never move (same digests as #182's certified catalog): every other function (body, ACL, owner, security,
 -- config), relation, policy and bucket.
 'kept_fn', (select json_build_object('count', count(*), 'digest', md5(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, '-') || ':' || pg_get_userbyid(p.proowner) || ':' || p.prosecdef::text || ':' || coalesce(p.proconfig::text, '-'), ',' order by p.oid::regprocedure::text)))
   from fns f join pg_proc p on p.oid = f.oid where f.qname not in (select name from added) and f.qname not in (select name from moved)),
 'kept_relations', (select json_build_object('count', count(*), 'digest', md5(string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || coalesce(c.relacl::text, '-') || ':' || pg_get_userbyid(c.relowner), ',' order by n.nspname, c.relname)))
   from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private') and c.relkind in ('r', 'v', 'm', 'p', 'f', 'S')
   and c.relname not like 'tournament\_media\_storage\_budget%'),
 'kept_policies', (select json_build_object('count', count(*), 'digest', md5(string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '-') || ':' || coalesce(with_check, '-') || ':' || roles::text, ',' order by schemaname, tablename, policyname)))
   from pg_policies where (schemaname in ('public', 'private') and tablename <> 'tournament_media_storage_budget')
     or (schemaname = 'storage' and policyname not like 'tournament\_media\_%')),
 'other_buckets', (select json_build_object('count', count(*), 'digest', md5(coalesce(string_agg(b.id || ':' || b.public::text || ':' || coalesce(b.file_size_limit::text, '-') || ':' || coalesce(b.allowed_mime_types::text, '-'), ',' order by b.id), '')))
   from storage.buckets b where b.id <> 'tournament-media')
)::text;
