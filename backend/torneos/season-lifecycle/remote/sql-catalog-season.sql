with tracked(name, sig) as (values
  -- SEASON 0018 / 0019 / runner operator catalog (read only): one JSON row consumed by db-season.mjs classify() /
  -- changedOutside(). The bodies 0018 and 0019 replace (tracked by md5), and the objects they add.
  ('enforce', 'public.enforce_tournament_media_gallery_limit()'),
  ('season9', 'public.update_tournament_season(uuid,uuid,text,text,date,date,text,boolean,boolean)'),
  ('season10', 'public.update_tournament_season(uuid,uuid,text,text,date,date,text,boolean,boolean,boolean)'),
  ('can_read', 'public.can_read_tournament_media_object(text)'),
  ('usage', 'public.get_tournament_season_media_usage(uuid,uuid)'),
  ('entitlements', 'public.get_effective_tournament_season_entitlements(uuid,uuid)'),
  ('checkout', 'public.create_tournament_season_production_checkout_purchase(uuid,uuid,uuid)'),
  ('activation', 'private.activate_production_tournament_purchase(uuid,text,text,text)'),
  ('status_policy', 'private.unordered_production_tournament_payment_status(uuid,text,text,text,text)'),
  ('reversal_policy', 'private.unordered_production_tournament_payment_reversal(uuid,text,text,text,text)'),
  ('purchases', 'public.get_tournament_season_purchases(uuid,uuid)'),
  ('lifecycle', 'public.run_tournament_season_media_lifecycle()'),
  ('purge_claim', 'public.claim_tournament_media_purge(integer)'),
  ('purge_complete', 'public.complete_tournament_media_purge(uuid)'),
  ('purge_request', 'private.request_tournament_media_purge(integer)')),
added(sig) as (values
  -- helper functions 0018 brings (excluded from the "kept" digest, the others are tracked above)
  ('private.tournament_season_media_deadline(timestamp with time zone)'), ('private.tournament_season_media_open(uuid,uuid)'),
  ('private.tournament_season_media_readable(uuid,uuid)'), ('private.tournament_season_lifecycle_json(uuid,uuid)'),
  ('private.mark_tournament_season_media_for_deletion(uuid,uuid)'), ('private.notify_tournament_season_media_deletion()')),
fns as (select p.oid, p.oid::regprocedure::text as sig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private'))
select json_build_object(
 'db', current_database(), 'tx_read_only', current_setting('transaction_read_only'),
 'torneos_tables', to_regclass('public.tournament_seasons') is not null
   and to_regclass('public.tournament_media_assets') is not null
   and to_regclass('public.tournament_media_storage_budget') is not null,
 'counts', (select json_build_object('authenticated', count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')),
     'anon', count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'),
 'bodies', (select json_object_agg(t.name, (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure(t.sig))) from tracked t),
 'acl', (select json_object_agg(t.name, (select json_build_object(
     'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
     'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
     'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE'))
   from pg_proc p where p.oid = to_regprocedure(t.sig))) from tracked t),
 'season', json_build_object(
   'columns', (select coalesce(json_agg(column_name::text order by column_name), '[]'::json) from information_schema.columns
     where table_schema = 'public' and table_name = 'tournament_seasons'
       and column_name in ('activated_at', 'media_deadline_at', 'activation_basis')),
   'not_activated', (select count(*) from public.tournament_seasons where status <> 'draft'
     and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tournament_seasons'
       and column_name = 'activated_at') = 1 and to_jsonb(tournament_seasons)->>'activated_at' is null),
   'premium_limit', (select gallery_asset_limit from public.tournament_plan_catalog where plan_code = 'PREMIUM'),
   'free_limit', (select gallery_asset_limit from public.tournament_plan_catalog where plan_code = 'FREE')),
 'offer', (select json_build_object('amount', offer.amount, 'list', offer.list_amount, 'label', offer.offer_label)
   from public.tournament_commercial_offers offer
   where offer.product_code = 'torneos_premium' and offer.availability = 'available'
     and offer.valid_from <= statement_timestamp() and (offer.valid_until is null or offer.valid_until > statement_timestamp())
   order by offer.valid_from desc, offer.offer_version desc limit 1),
 'budget', (select json_build_object('project', project_max_bytes, 'gallery', gallery_max_bytes, 'inflight', max_inflight_uploads)
   from public.tournament_media_storage_budget where singleton),
 'storage_bytes', (select json_build_object(
     'project', coalesce(sum((o.metadata->>'size')::bigint), 0),
     'media', coalesce(sum((o.metadata->>'size')::bigint) filter (where o.bucket_id = 'tournament-media'), 0),
     'branding', coalesce(sum((o.metadata->>'size')::bigint) filter (where o.bucket_id = 'tournament-branding'), 0))
   from storage.objects o),
 'cron', json_build_object(
   'extension', exists (select 1 from pg_extension where extname = 'pg_cron'),
   -- cron.job only exists with pg_cron: read through query_to_xml only when it does (Production has no pg_cron today).
   'jobs', case when to_regclass('cron.job') is null then null else ((xpath('//j/text()', query_to_xml(
     'select string_agg(jobname || '' '' || schedule || '' '' || active::text, ''|'' order by jobname) as j from cron.job where jobname like ''torneos-season-media-%''',
     false, false, '')))[1])::text end),
 'kept_fn', (select json_build_object('count', count(*), 'digest', md5(string_agg(f.sig || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, '-') || ':' || pg_get_userbyid(p.proowner) || ':' || p.prosecdef::text || ':' || coalesce(p.proconfig::text, '-'), ',' order by f.sig)))
   from fns f join pg_proc p on p.oid = f.oid
   where f.oid not in (select to_regprocedure(t.sig) from tracked t where to_regprocedure(t.sig) is not null)
     and f.sig not in (select a.sig from added a)),
 'kept_relations', (select json_build_object('count', count(*), 'digest', md5(string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || coalesce(c.relacl::text, '-') || ':' || pg_get_userbyid(c.relowner), ',' order by n.nspname, c.relname)))
   from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private') and c.relkind in ('r', 'v', 'm', 'p', 'f', 'S')),
 'kept_policies', (select json_build_object('count', count(*), 'digest', md5(coalesce(string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '-') || ':' || coalesce(with_check, '-') || ':' || roles::text, ',' order by schemaname, tablename, policyname), '')))
   from pg_policies where schemaname in ('public', 'private', 'storage'))
)::text
