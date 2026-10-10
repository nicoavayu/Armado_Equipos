-- Do the functions that 20261010120000…132000 define still run? Calls each one with NULL
-- arguments as a seeded account, each in its own subtransaction, inside a transaction the
-- caller rolls back. A broken reference shows up as 42703 (column), 42883 (function), 42P01
-- (table) or 42704 (object); permission or business errors are not breakage. Also lists
-- app_private functions named by a function body that do not exist.
-- Input: psql variable fn_names, a comma-separated list of schema.name.
create temp table pg_temp.fn_run_result (fn text, sqlstate text, message text);
grant all on pg_temp.fn_run_result to public;
select set_config('rehearsal.fn_names', :'fn_names', true) is not null as stashed \gset
do $run$
declare
  r record;
  v_state text;
  v_msg text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', md5('reh-1')::uuid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', md5('reh-1')::uuid::text, true);
  for r in
    select n.nspname, p.proname, p.pronargs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname || '.' || p.proname) = any (string_to_array(current_setting('rehearsal.fn_names'), ','))
      and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
    order by 1, 2
  loop
    begin
      execute 'set local role authenticated';
      execute format('select %I.%I(%s)', r.nspname, r.proname,
        coalesce((select string_agg('null', ', ') from generate_series(1, r.pronargs)), ''));
      raise exception using errcode = 'P0099', message = 'ran';
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      insert into pg_temp.fn_run_result values (r.nspname || '.' || r.proname, case when v_state = 'P0099' then 'ok' else v_state end, left(v_msg, 200));
    end;
  end loop;
end
$run$;
select json_build_object(
  'called', (select count(*) from pg_temp.fn_run_result),
  'broken', (select coalesce(json_agg(json_build_object('fn', fn, 'sqlstate', sqlstate, 'message', message) order by fn), '[]')
             from pg_temp.fn_run_result where sqlstate in ('42703', '42883', '42P01', '42704')),
  'missing_app_private_functions', (select coalesce(json_agg(distinct m[1]), '[]')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace, regexp_matches(p.prosrc, 'app_private\.([a-z_0-9]+)\(', 'g') m
      where n.nspname in ('public', 'app_private')
        and not exists (select 1 from pg_proc q where q.pronamespace = 'app_private'::regnamespace and q.proname = m[1])),
  'partidos_admin_id', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partidos' and column_name = 'admin_id'))::text;
