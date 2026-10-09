-- COMMERCE-PRODUCTION — daily SELECT-only health read of production commerce (Supabase SQL editor of the Torneos project,
-- or `db-0013.mjs observe` for the switch). Reads only: no row is changed. One JSON document; `alerts` must be empty.
with production as (
  select * from public.tournament_purchases where provider = 'MERCADO_PAGO' and provider_environment = 'production'
), flagged as (
  select w.purchase_id, w.provider_payment_id, w.requires_manual_refund, w.requires_manual_review, w.date_last_updated
  from public.tournament_payment_provider_watermarks w join production p on p.id = w.purchase_id
  where w.requires_manual_refund or w.requires_manual_review
), events as (
  select e.event_type, count(*) as n from public.tournament_purchase_events e join production p on p.id = e.purchase_id
  where e.created_at > now() - interval '7 days' group by e.event_type
), checks as (
  select c.* from public.tournament_purchase_provider_checks c join production p on p.id = c.purchase_id
)
select jsonb_build_object(
  'at', now(),
  'switch', (select jsonb_build_object('scope', checkout_scope, 'reason', reason, 'updated_at', updated_at) from public.tournament_commerce_production_settings),
  'allowlist', (select count(*) from public.tournament_commerce_production_allowlist),
  'purchases', (select jsonb_object_agg(status, n) from (select status, count(*) n from production group by status) s),
  'open_older_than_1h', (select count(*) from production where status in ('created','preference_created','pending') and created_at < now() - interval '1 hour'),
  'pending_older_than_3d', (select count(*) from production where status = 'pending' and updated_at < now() - interval '3 days'),
  'approved_without_grant', (select count(*) from production p where p.status = 'approved' and not exists (
    select 1 from public.tournament_season_plan_grants g where g.origin_purchase_id = p.id and public.is_tournament_season_plan_grant_effective(g.id))),
  'manual_refund', (select count(*) from flagged where requires_manual_refund),
  'manual_review', (select count(*) from flagged where requires_manual_review),
  'activation_errors', (select count(*) from production where activation_error_code is not null),
  'last_check', (select max(last_completed_at) from checks),
  'events_7d', (select coalesce(jsonb_object_agg(event_type, n), '{}'::jsonb) from events),
  'alerts', (select coalesce(jsonb_agg(a), '[]'::jsonb) from (
    select 'manual refund needed (approved after close / second payment): refund it in the Mercado Pago panel' a where exists (select 1 from flagged where requires_manual_refund)
    union all select 'manual review: conflicting provider snapshots' where exists (select 1 from flagged where requires_manual_review)
    union all select 'approved purchase without an effective grant (refund/chargeback in course or activation error)' where exists (
      select 1 from production p where p.status = 'approved' and not exists (
        select 1 from public.tournament_season_plan_grants g where g.origin_purchase_id = p.id and public.is_tournament_season_plan_grant_effective(g.id)))
    union all select 'reconciliation silent for more than 1 hour while purchases are open' where exists (
      select 1 from production where status in ('preference_created','pending') and created_at < now() - interval '1 hour')
      and coalesce((select max(last_completed_at) from checks), '-infinity'::timestamptz) < now() - interval '1 hour'
  ) alerts)
) as health;
