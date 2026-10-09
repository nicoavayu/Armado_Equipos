-- PILOT 0015 + 0016 operator catalog (read only): one JSON row consumed by db-0015-0016.mjs classify() / changedOutside().
with tracked(name, sig) as (values
  -- the bodies 0015 / 0016 replace (tracked by md5) and the trigger function 0016 adds
  ('player', 'public.get_player_tournament_matches()'),
  ('managed', 'public.get_managed_tournament_matches()'),
  ('reschedule', 'public.reschedule_tournament_match(uuid,uuid,timestamp with time zone,uuid,uuid,integer,text,boolean)'),
  ('notifications', 'public.get_my_torneos_notifications(boolean,integer,integer)'),
  ('notify', 'public.notify_tournament_match_schedule_change()')),
fns as (select p.oid, n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')),
notif_cols(name) as (values ('match_id'), ('source_reschedule_id'), ('previous_scheduled_at'), ('scheduled_at'))
select json_build_object(
 'db', current_database(), 'tx_read_only', current_setting('transaction_read_only'),
 'torneos_tables', to_regclass('public.tournament_seasons') is not null
   and to_regclass('public.tournament_user_notifications') is not null
   and to_regclass('public.tournament_match_reschedules') is not null,
 'counts', (select json_build_object('authenticated', count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')),
     'anon', count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'),
 'bodies', (select json_object_agg(t.name, (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure(t.sig))) from tracked t),
 'acl', (select json_object_agg(t.name, (select json_build_object(
     'secdef', p.prosecdef, 'config', p.proconfig,
     'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
     'anon', has_function_privilege('anon', p.oid, 'EXECUTE'))
   from pg_proc p where p.oid = to_regprocedure(t.sig))) from tracked t),
 'notice', json_build_object(
   'columns', (select coalesce(json_agg(column_name::text order by column_name), '[]'::json) from information_schema.columns
     where table_schema = 'public' and table_name = 'tournament_user_notifications' and column_name in (select name from notif_cols)),
   'kind_check', (select pg_get_constraintdef(oid) from pg_constraint
     where conrelid = 'public.tournament_user_notifications'::regclass and conname = 'tournament_user_notifications_kind_check'),
   'shape_check', exists (select 1 from pg_constraint
     where conrelid = 'public.tournament_user_notifications'::regclass and conname = 'tournament_user_notifications_match_shape_check'),
   'unique_index', to_regclass('public.tournament_user_notifications_reschedule_recipient_key') is not null,
   'trigger', exists (select 1 from pg_trigger where tgrelid = 'public.tournament_match_reschedules'::regclass
     and tgname = 'tournament_match_reschedules_notify' and not tgisinternal and tgenabled = 'O'),
   'rows', (select count(*) from public.tournament_user_notifications where kind like 'match.%')),
 -- What 0015 / 0016 must never move: every other function (body, ACL, owner, security, config), relation, policy and the
 -- other constraints and triggers of the two tables they touch.
 'kept_fn', (select json_build_object('count', count(*), 'digest', md5(string_agg(f.sig || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, '-') || ':' || pg_get_userbyid(p.proowner) || ':' || p.prosecdef::text || ':' || coalesce(p.proconfig::text, '-'), ',' order by f.sig)))
   from fns f join pg_proc p on p.oid = f.oid
   where f.oid not in (select to_regprocedure(t.sig) from tracked t where to_regprocedure(t.sig) is not null)),
 'kept_relations', (select json_build_object('count', count(*), 'digest', md5(string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || coalesce(c.relacl::text, '-') || ':' || pg_get_userbyid(c.relowner), ',' order by n.nspname, c.relname)))
   from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private') and c.relkind in ('r', 'v', 'm', 'p', 'f', 'S')),
 'kept_policies', (select json_build_object('count', count(*), 'digest', md5(coalesce(string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '-') || ':' || coalesce(with_check, '-') || ':' || roles::text, ',' order by schemaname, tablename, policyname), '')))
   from pg_policies where schemaname in ('public', 'private', 'storage')),
 'kept_constraints', (select json_build_object('count', count(*), 'digest', md5(coalesce(string_agg(conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname), '')))
   from pg_constraint where conrelid in ('public.tournament_user_notifications'::regclass, 'public.tournament_match_reschedules'::regclass)
     and conname not in ('tournament_user_notifications_kind_check', 'tournament_user_notifications_match_shape_check',
       'tournament_user_notifications_match_fk', 'tournament_user_notifications_reschedule_fk')),
 'kept_triggers', (select json_build_object('count', count(*), 'digest', md5(coalesce(string_agg(tgrelid::regclass::text || '.' || tgname || ':' || tgfoid::regprocedure::text || ':' || tgenabled::text, ',' order by tgrelid::regclass::text, tgname), '')))
   from pg_trigger where not tgisinternal
     and tgrelid in ('public.tournament_user_notifications'::regclass, 'public.tournament_match_reschedules'::regclass)
     and tgname <> 'tournament_match_reschedules_notify')
)::text;
