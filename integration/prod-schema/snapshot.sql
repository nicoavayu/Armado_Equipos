-- State the rollbacks must restore: policies, the functions 135000–138000 replace, the match
-- views (definition, owner, options), the privacy-relevant data and the ledger.
select json_build_object(
  'policies', (select json_object_agg(tablename || '.' || policyname, json_build_array(roles::text, cmd, qual) order by tablename, policyname)
               from pg_policies where schemaname = 'public' and tablename in ('partidos', 'jugadores')),
  'functions', (select json_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) order by p.oid::regprocedure::text)
                from pg_proc p
                where p.oid::regprocedure::text in ('get_my_profile()', 'get_match_contact_phone(bigint,uuid)', 'search_usuarios(text,integer)',
                  'sync_my_auto_match_location_from_profile()', '_notify_goalkeepers_for_match(bigint)', 'bind_voting_photo_slot(bigint,text,bigint)')
                   or p.proname in ('search_usuarios', '_notify_goalkeepers_for_match', 'clear_my_profile_fields')),
  'triggers', (select coalesce(json_agg(tgname order by tgname), '[]') from pg_trigger where not tgisinternal and tgrelid in ('public.usuarios'::regclass, 'public.profiles'::regclass)),
  'views', (select json_object_agg(c.relname, json_build_array(pg_get_userbyid(c.relowner), c.reloptions, md5(pg_get_viewdef(c.oid))) order by c.relname)
            from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('partidos_view', 'partidos_abiertos_operativos', 'partidos_abiertos_operativos_v2')),
  'usuarios_digest', (select md5(string_agg(u.id::text || '|' || coalesce(u.email, '') || '|' || coalesce(u.telefono, '') || '|' || coalesce(u.fecha_nacimiento::text, '') || '|'
                       || coalesce(u.latitud::text, '') || '|' || coalesce(u.longitud::text, '') || '|' || coalesce(u.location_accuracy_m::text, ''), ',' order by u.id)) from public.usuarios u),
  'profiles_digest', (select md5(string_agg(p.id::text || '|' || coalesce(to_jsonb(p) ->> 'telefono', ''), ',' order by p.id)) from public.profiles p),
  'partidos_template_id', (select json_build_array(format_type(a.atttypid, a.atttypmod), col_description(a.attrelid, a.attnum)) from pg_attribute a
                           where a.attrelid = 'public.partidos'::regclass and a.attname = 'template_id' and not a.attisdropped),
  'profiles_columns', (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'profiles'),
  'claims', (select count(*) from public.voting_photo_slot_claims),
  'jugadores_columns', (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'jugadores'),
  'added_by_digest', (select md5(coalesce(string_agg(j.id::text || '|' || coalesce(to_jsonb(j) ->> 'added_by', ''), ',' order by j.id), '')) from public.jugadores j),
  'added_by_rows', (select count(*) from public.jugadores j where to_jsonb(j) ->> 'added_by' is not null),
  'added_by_trigger', (select json_agg(json_build_array(tgname, tgtype, pg_get_userbyid(p.proowner), p.prosecdef, md5(p.prosrc))) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                       where t.tgrelid = 'public.jugadores'::regclass and t.tgname = 'trg_jugadores_added_by'),
  'contact_phone_fn', (select md5(pg_get_functiondef(f)) from to_regprocedure('public.get_match_contact_phone(bigint,uuid)') f where f is not null),
  'code_and_invite_fns', (select json_object_agg(f::text, md5(pg_get_functiondef(f))) from unnest(array[
      to_regprocedure('public.public_get_match_by_code(text,bigint)'), to_regprocedure('public.validate_guest_match_invite(bigint,text,text)')]) f where f is not null),
  'roster_triggers', (select coalesce(json_agg(tgrelid::regclass::text || '.' || tgname order by tgrelid::regclass::text, tgname), '[]') from pg_trigger
                      where not tgisinternal and tgrelid in ('public.jugadores'::regclass, 'public.match_join_requests'::regclass)),
  'request_policies', (select json_object_agg(policyname, json_build_array(cmd, qual, with_check) order by policyname) from pg_policies where schemaname = 'public' and tablename = 'match_join_requests'),
  'jugadores_with_check', (select json_object_agg(policyname, with_check order by policyname) from pg_policies where schemaname = 'public' and tablename = 'jugadores' and cmd = 'INSERT'),
  'roster_helpers', (select coalesce(json_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '[]') from pg_proc p where p.proname in ('roster_entry', 'get_public_match_roster', 'may_self_join_match', 'match_accepts_requests')),
  'approve_exec', json_build_object('authenticated', has_function_privilege('authenticated', 'public.approve_join_request(bigint)', 'execute'), 'anon', has_function_privilege('anon', 'public.approve_join_request(bigint)', 'execute')),
  'roles', (select coalesce(json_agg(rolname), '[]') from pg_roles where rolname = 'core_match_public_reader')
)::text;
