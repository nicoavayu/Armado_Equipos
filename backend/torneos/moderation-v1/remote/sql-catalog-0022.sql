with tracked(name, sig) as (values
  -- CONTENT MODERATION 0022 operator catalog (read only): one JSON row consumed by db-0022.mjs classify() / changedOutside().
  ('report', 'public.report_tournament_content(text,text,uuid,text,text,text,uuid)'),
  ('list', 'public.get_tournament_content_reports(uuid,text)'),
  ('handle', 'public.handle_tournament_content_report(uuid,text,text,text)'),
  ('block', 'public.block_tournament_applicant(uuid,uuid,text)'),
  ('unblock', 'public.unblock_tournament_applicant(uuid,uuid)'),
  ('mute', 'public.set_tournament_communications_muted(uuid,uuid,boolean)'),
  ('mutes', 'public.get_my_tournament_communication_mutes()'),
  ('platform_list', 'public.platform_list_tournament_content_reports(text,integer)'),
  ('platform_handle', 'public.platform_handle_tournament_content_report(uuid,text,text,text)'),
  ('is_manager', 'private.tournament_moderation_is_manager(uuid)'),
  ('engine', 'private.tournament_moderation_handle(uuid,text,text,text,boolean)'),
  ('page_hold', 'private.tournament_moderation_public_page_hold()'),
  ('application_block', 'private.tournament_moderation_application_block()'),
  ('delivery_mute', 'private.tournament_moderation_delivery_mute()')),
owned(rel) as (values ('public.tournament_content_reports'), ('public.tournament_content_report_events'),
  ('public.tournament_communication_mutes'), ('public.tournament_applicant_blocks'), ('private.tournament_moderation_holds'),
  ('public.tournament_content_report_events_id_seq')),
moderation_triggers(tg) as (values ('tournament_public_pages_moderation_hold'), ('tournament_team_applications_moderation_block'),
  ('tournament_announcement_deliveries_moderation_mute')),
fns as (select p.oid, n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private'))
select json_build_object(
 'db', current_database(), 'tx_read_only', current_setting('transaction_read_only'),
 'torneos_tables', to_regclass('public.tournament_seasons') is not null,
 'prerequisites', json_build_object(
   'connected', to_regclass('public.tournament_team_applications') is not null,
   'season_lifecycle', to_regprocedure('private.tournament_season_media_open(uuid,uuid)') is not null,
   'platform_remove', (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.platform_remove_tournament_catalog_listing(uuid,text)'))),
 'counts', (select json_build_object('authenticated', count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')),
     'anon', count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')),
     'service_role', count(*) filter (where has_function_privilege('service_role', p.oid, 'EXECUTE')))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'),
 'bodies', (select json_object_agg(t.name, (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure(t.sig))) from tracked t),
 'acl', (select json_object_agg(t.name, (select json_build_object(
     'secdef', p.prosecdef, 'config', p.proconfig,
     'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
     'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
     'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE'))
   from pg_proc p where p.oid = to_regprocedure(t.sig))) from tracked t),
 'tables', (select json_object_agg(o.rel, (select json_build_object(
     'rls', c.relrowsecurity,
     'api_grants', has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
     'policies', (select count(*) from pg_policies where schemaname || '.' || tablename = o.rel))
   from pg_class c where c.oid = to_regclass(o.rel))) from owned o where o.rel not like '%_seq'),
 'triggers', (select json_object_agg(m.tg, (select t.tgenabled::text from pg_trigger t where t.tgname = m.tg and not t.tgisinternal))
   from moderation_triggers m),
 -- Row counts only (never content): undoing 0022 is refused while any row exists.
 'rows', case when to_regclass('public.tournament_content_reports') is null then null
   else (xpath('/row/c/text()', query_to_xml('select (select count(*) from public.tournament_content_reports)
     + (select count(*) from public.tournament_content_report_events) + (select count(*) from public.tournament_communication_mutes)
     + (select count(*) from public.tournament_applicant_blocks) + (select count(*) from private.tournament_moderation_holds) as c',
     false, true, '')))[1]::text::bigint end,
 'pending', case when to_regclass('public.tournament_content_reports') is null then null
   else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.tournament_content_reports
     where status in (''open'', ''under_review'') and review_scope = ''platform''', false, true, '')))[1]::text::bigint end,
 -- What 0022 must never move: every other function (body, ACL, owner, secdef flag, config), relation, trigger and policy.
 'kept_fn', (select json_build_object('count', count(*), 'digest', md5(string_agg(f.sig || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, '-') || ':' || pg_get_userbyid(p.proowner) || ':' || p.prosecdef::text || ':' || coalesce(p.proconfig::text, '-'), ',' order by f.sig)))
   from fns f join pg_proc p on p.oid = f.oid
   where f.oid not in (select to_regprocedure(t.sig) from tracked t where to_regprocedure(t.sig) is not null)),
 'kept_relations', (select json_build_object('count', count(*), 'digest', md5(string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || coalesce(c.relacl::text, '-') || ':' || pg_get_userbyid(c.relowner), ',' order by n.nspname, c.relname)))
   from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private', 'storage') and c.relkind in ('r', 'v', 'm', 'p', 'f', 'S')
     and (n.nspname || '.' || c.relname) not in (select rel from owned)),
 'kept_triggers', (select json_build_object('count', count(*), 'digest', md5(coalesce(string_agg(t.tgrelid::regclass::text || '.' || t.tgname || ':' || t.tgenabled::text || ':' || t.tgfoid::regprocedure::text, ',' order by t.tgrelid::regclass::text, t.tgname), '')))
   from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal and n.nspname in ('public', 'private') and t.tgname not in (select tg from moderation_triggers)
     and (n.nspname || '.' || c.relname) not in (select rel from owned)),
 'kept_policies', (select json_build_object('count', count(*), 'digest', md5(coalesce(string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '-') || ':' || coalesce(with_check, '-') || ':' || roles::text, ',' order by schemaname, tablename, policyname), '')))
   from pg_policies where schemaname in ('public', 'private', 'storage'))
)::text
