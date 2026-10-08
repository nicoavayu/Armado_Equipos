with production_functions(sig) as (values
  ('public.create_tournament_season_production_checkout_purchase(uuid,uuid,uuid)'),
  ('public.get_tournament_season_purchases(uuid,uuid)'),
  ('public.get_production_provider_tournament_purchase(text)'),
  ('public.record_production_tournament_purchase_preference(uuid,text,timestamp with time zone)'),
  ('public.apply_production_tournament_payment_status(uuid,text,text,text,text,timestamp with time zone)'),
  ('public.apply_production_tournament_payment_reversal(uuid,text,text,text,text,timestamp with time zone)'),
  ('public.list_production_tournament_purchases_to_reconcile(integer)'),
  ('public.claim_production_tournament_purchase_check(uuid,integer)'),
  ('public.complete_production_tournament_purchase_check(uuid,text)'),
  ('private.activate_production_tournament_purchase(uuid,text,text,text)'),
  ('private.unordered_production_tournament_payment_status(uuid,text,text,text,text)'),
  ('private.unordered_production_tournament_payment_reversal(uuid,text,text,text,text)'),
  ('private.order_production_tournament_payment(uuid,text,text,text,text,text,timestamp with time zone)'),
  ('private.enforce_tournament_purchase_payment_environment()')),
test_chain(sig) as (values
  ('public.create_tournament_season_checkout_purchase(uuid,uuid,uuid)'),
  ('public.get_provider_tournament_purchase(text,text,text)'),
  ('public.record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone)'),
  ('public.order_verified_tournament_payment(uuid,text,text,text,text,text,text,text,timestamp with time zone)'),
  ('public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text,timestamp with time zone)'),
  ('public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text,timestamp with time zone)'),
  ('public.activate_verified_tournament_purchase(uuid,text,text,text,text,text,text)')),
production_names(name) as (select split_part(split_part(sig, '(', 1), '.', 2) from production_functions),
outside as (select p.oid::regprocedure::text || ' ' || md5(p.prosrc) || ' ' || coalesce(p.proacl::text, '') as line
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.proname not in (select name from production_names))
select json_build_object(
 'db', current_database(), 'tx_read_only', current_setting('transaction_read_only'),
 'torneos_tables', to_regclass('public.tournament_purchases') is not null and to_regclass('public.tournament_seasons') is not null,
 'production_functions', (select count(*) from production_functions where to_regprocedure(sig) is not null),
 'environment_check', (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.tournament_purchases'::regclass and conname = 'tournament_purchases_environment_check'),
 'production_role', exists (select 1 from pg_roles where rolname = 'torneos_payment_production_service'),
 'production_tables', (select count(*) from unnest(array['public.tournament_commerce_production_settings', 'public.tournament_commerce_production_allowlist',
   'public.tournament_purchase_provider_checks']) t where to_regclass(t) is not null),
 'isolation_trigger', exists (select 1 from pg_trigger where tgrelid = 'public.tournament_purchases'::regclass and tgname = 'tournament_purchases_payment_environment' and tgenabled = 'O'),
 'test_chain', (select json_object_agg(sig, (select md5(prosrc) from pg_proc where oid = to_regprocedure(sig))) from test_chain),
 -- query_to_xml runs only when the table exists (a plain sub-select would fail to parse on PRE_0013).
 'scope', case when to_regclass('public.tournament_commerce_production_settings') is null then null
   else (xpath('//checkout_scope/text()', query_to_xml('select checkout_scope from public.tournament_commerce_production_settings where singleton', false, false, '')))[1]::text end,
 'allowlist', case when to_regclass('public.tournament_commerce_production_allowlist') is null then '[]'::json
   else (select coalesce(json_agg(x::text order by x::text), '[]'::json) from unnest(xpath('//organization_id/text()',
     query_to_xml('select organization_id from public.tournament_commerce_production_allowlist', false, false, ''))) x) end,
 'production_purchases', (select json_build_object('total', count(*), 'open', count(*) filter (where status in ('created','preference_created','pending')),
   'approved', count(*) filter (where status = 'approved'), 'refunded', count(*) filter (where status = 'refunded'),
   'charged_back', count(*) filter (where status = 'charged_back'))
   from public.tournament_purchases where provider = 'MERCADO_PAGO' and provider_environment = 'production'),
 'production_logins', (select coalesce(json_agg(json_build_object('name', l.rolname, 'login', l.rolcanlogin, 'inherit', l.rolinherit, 'super', l.rolsuper,
   'bypassrls', l.rolbypassrls) order by l.rolname), '[]'::json)
   from pg_auth_members m join pg_roles r on r.oid = m.roleid join pg_roles l on l.oid = m.member where r.rolname = 'torneos_payment_production_service'),
 'test_logins', (select coalesce(json_agg(l.rolname order by l.rolname), '[]'::json)
   from pg_auth_members m join pg_roles r on r.oid = m.roleid join pg_roles l on l.oid = m.member where r.rolname = 'torneos_payment_service'),
 'outside', json_build_object('count', (select count(*) from outside), 'digest', (select md5(string_agg(line, E'\n' order by line)) from outside)),
 'counts', (select json_build_object('authenticated', count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')),
     'anon', count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f')
)
