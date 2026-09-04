-- LOCAL ONLY: exact copy of 20260828163326 except one optional REVOKE.
-- No provider objects installed; FAKE-only table constraints remain in force.
-- Arma2 Torneos · commercial plans and one-time Premium purchases by season.
--
-- This is an append-only evolution. Historical tournament grants, purchases
-- and events stay in place and are linked to an effective season grant. New
-- commercial writes target public.tournament_seasons.id exclusively.

set check_function_bodies = off;

begin;

-- -------------------------------------------------------------------------
-- 1. Authoritative season catalog. Every season is FREE unless it has an
-- effective PREMIUM season grant. first_free stays as non-authoritative legacy.
-- -------------------------------------------------------------------------

alter table public.tournament_plan_catalog
  drop constraint tournament_plan_catalog_branding_check;

update public.tournament_plan_catalog
set gallery_asset_limit = case plan_code when 'FREE' then 25 else 1000 end,
    administrative_collaborator_limit = case plan_code when 'FREE' then 1 else 10 end,
    branding_mode = case plan_code when 'FREE' then 'arma2_visible' else 'branding_optional' end,
    updated_at = statement_timestamp()
where plan_code in ('FREE','PREMIUM');

alter table public.tournament_plan_catalog
  add constraint tournament_plan_catalog_branding_check
  check (branding_mode in ('arma2_visible','branding_optional'));

alter table public.tournament_pricing_config
  drop constraint tournament_pricing_config_scope_check;
update public.tournament_pricing_config
set scope = 'season', launch_price_minor = 39900, updated_at = statement_timestamp()
where config_key = 'v1';
alter table public.tournament_pricing_config
  add constraint tournament_pricing_config_scope_check check (scope = 'season');

alter table public.tournament_commercial_products
  drop constraint tournament_commercial_products_scope_check;
update public.tournament_commercial_products
set scope = 'season',
    public_capabilities = '[
      {"code":"media.season_1000","label":"Hasta 1.000 archivos multimedia por temporada","availability":"available"},
      {"code":"members.season_10","label":"Owner + hasta 10 colaboradores por temporada","availability":"available"},
      {"code":"social.base_full","label":"11 familias Base para placas","availability":"available"},
      {"code":"social.results_styles","label":"Street y Editorial para Resultados","availability":"available"},
      {"code":"branding.remove_arma2","label":"Exportaciones Base sin branding Arma2","availability":"available"}
    ]'::jsonb,
    updated_at = statement_timestamp()
where product_code = 'torneos_premium';
alter table public.tournament_commercial_products
  add constraint tournament_commercial_products_scope_check check (scope = 'season');

comment on table public.tournament_plan_catalog is
  'Authoritative FREE/PREMIUM limits per tournament_seasons.id: media 25/1000, collaborators 1/10, optional branding only in PREMIUM.';
comment on table public.tournament_pricing_config is
  'Authoritative price: ARS 39,900, one-time per tournament season.';
comment on table public.tournament_organization_plan_state is
  'Legacy first_free audit only. It does not gate season creation, FREE access or checkout.';

-- The former tournament insert trigger created first_free/premium_required
-- behavior. Keep its historical rows, but stop producing new ones.
drop trigger if exists tournaments_assign_first_free_plan on public.tournaments;

create or replace function public.get_tournament_creation_eligibility(
  p_organization_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.is_tournament_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'TORNEOS_PLAN_FORBIDDEN';
  end if;
  return jsonb_build_object(
    'schemaVersion',2,
    'organizationId',p_organization_id,
    'status','free_available',
    'commercialUnit','season',
    'hasConsumedFreeTournament',false
  );
end;
$$;

-- Old premium gates are neutralized: FREE is a complete permanent plan, not a
-- temporary allowance and not a draft-only state.
create or replace function public.tournament_requires_premium(
  p_organization_id uuid,
  p_tournament_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select false;
$$;

-- -------------------------------------------------------------------------
-- 2. Effective grants by season, with a lossless link to historical grants.
-- -------------------------------------------------------------------------

create table public.tournament_season_plan_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  season_id uuid not null,
  plan_code text not null references public.tournament_plan_catalog(plan_code) on delete restrict,
  source text not null,
  origin_tournament_grant_id uuid references public.tournament_plan_grants(id) on delete restrict,
  origin_purchase_id uuid references public.tournament_purchases(id) on delete restrict,
  granted_at timestamptz not null default now(),
  reason text not null,
  created_at timestamptz not null default now(),
  constraint tournament_season_plan_grants_season_fk
    foreign key (organization_id,season_id)
    references public.tournament_seasons(organization_id,id) on delete restrict,
  constraint tournament_season_plan_grants_plan_check check (plan_code = 'PREMIUM'),
  constraint tournament_season_plan_grants_source_check
    check (source in ('historical_tournament_grant','purchase','manual_legacy')),
  constraint tournament_season_plan_grants_origin_check check (
    (source = 'historical_tournament_grant' and origin_tournament_grant_id is not null)
    or (source = 'purchase' and origin_purchase_id is not null)
    or (source = 'manual_legacy')
  ),
  constraint tournament_season_plan_grants_reason_check
    check (reason = btrim(reason) and char_length(reason) between 8 and 500),
  constraint tournament_season_plan_grants_origin_tournament_unique
    unique (origin_tournament_grant_id),
  constraint tournament_season_plan_grants_origin_purchase_unique
    unique (origin_purchase_id)
);

create index tournament_season_plan_grants_resolution_idx
  on public.tournament_season_plan_grants
  (organization_id,season_id,granted_at,id);
create index tournament_season_plan_grants_season_fk_idx
  on public.tournament_season_plan_grants(season_id);

create table public.tournament_season_plan_grant_events (
  id bigint generated always as identity primary key,
  season_grant_id uuid not null
    references public.tournament_season_plan_grants(id) on delete restrict,
  purchase_id uuid references public.tournament_purchases(id) on delete restrict,
  origin_tournament_grant_event_id bigint
    references public.tournament_plan_grant_events(id) on delete restrict,
  event_type text not null,
  reason_code text not null,
  reason text not null,
  actor_type text not null,
  actor_user_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint tournament_season_plan_grant_events_type_check
    check (event_type in ('granted','suspended','restored','revoked')),
  constraint tournament_season_plan_grant_events_reason_code_check
    check (reason_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  constraint tournament_season_plan_grant_events_reason_check
    check (reason = btrim(reason) and char_length(reason) between 8 and 500),
  constraint tournament_season_plan_grant_events_actor_check
    check (actor_type in ('service','provider','migration')),
  constraint tournament_season_plan_grant_events_origin_unique
    unique (origin_tournament_grant_event_id)
);

create index tournament_season_plan_grant_events_current_idx
  on public.tournament_season_plan_grant_events(season_grant_id,id desc);
create index tournament_season_plan_grant_events_purchase_idx
  on public.tournament_season_plan_grant_events(purchase_id,id desc)
  where purchase_id is not null;

alter table public.tournament_season_plan_grants enable row level security;
alter table public.tournament_season_plan_grant_events enable row level security;
revoke all on table public.tournament_season_plan_grants,
  public.tournament_season_plan_grant_events from public,anon,authenticated;
grant select on table public.tournament_season_plan_grants,
  public.tournament_season_plan_grant_events to service_role;

insert into public.tournament_season_plan_grants (
  organization_id,season_id,plan_code,source,origin_tournament_grant_id,
  origin_purchase_id,granted_at,reason
)
select grant_row.organization_id,tournament.season_id,'PREMIUM',
  'historical_tournament_grant',grant_row.id,grant_row.origin_purchase_id,
  grant_row.granted_at,
  'Premium de competencia histórica promovido a su temporada sin borrar el grant original'
from public.tournament_plan_grants grant_row
join public.tournaments tournament
  on tournament.organization_id = grant_row.organization_id
 and tournament.id = grant_row.tournament_id
where grant_row.plan_code = 'PREMIUM'
on conflict (origin_tournament_grant_id) do nothing;

insert into public.tournament_season_plan_grant_events (
  season_grant_id,purchase_id,origin_tournament_grant_event_id,event_type,
  reason_code,reason,actor_type,actor_user_id,created_at
)
select season_grant.id,event.purchase_id,event.id,event.event_type,event.reason_code,
  event.reason,'migration',event.actor_user_id,event.created_at
from public.tournament_plan_grant_events event
join public.tournament_season_plan_grants season_grant
  on season_grant.origin_tournament_grant_id = event.grant_id
on conflict (origin_tournament_grant_event_id) do nothing;

-- Old legacy grants can predate grant events. Materialize a baseline event so
-- every season grant has one deterministic effective state.
insert into public.tournament_season_plan_grant_events (
  season_grant_id,purchase_id,event_type,reason_code,reason,actor_type,created_at
)
select season_grant.id,season_grant.origin_purchase_id,'granted',
  'historical_grant_backfill','Grant histórico vigente al migrar la unidad comercial','migration',
  season_grant.granted_at
from public.tournament_season_plan_grants season_grant
where not exists (
  select 1 from public.tournament_season_plan_grant_events event
  where event.season_grant_id = season_grant.id
);

create or replace function public.is_tournament_season_plan_grant_effective(
  p_grant_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select event.event_type not in ('suspended','revoked')
    from public.tournament_season_plan_grant_events event
    where event.season_grant_id = p_grant_id
    order by event.id desc limit 1
  ),true);
$$;

create or replace function public.grant_tournament_season_premium(
  p_organization_id uuid,
  p_season_id uuid,
  p_purchase_id uuid,
  p_reason text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_grant_id uuid;
begin
  if p_purchase_id is null or p_reason is null or p_reason <> btrim(p_reason)
    or char_length(p_reason) not between 8 and 500
    or not exists (
      select 1 from public.tournament_seasons season
      where season.organization_id = p_organization_id and season.id = p_season_id
    ) then
    raise exception using errcode = '22023', message = 'TORNEOS_SEASON_PLAN_GRANT_INVALID';
  end if;
  insert into public.tournament_season_plan_grants (
    organization_id,season_id,plan_code,source,origin_purchase_id,reason
  ) values (
    p_organization_id,p_season_id,'PREMIUM','purchase',p_purchase_id,p_reason
  )
  on conflict (origin_purchase_id) do update set reason = public.tournament_season_plan_grants.reason
  returning id into v_grant_id;
  return v_grant_id;
end;
$$;

-- -------------------------------------------------------------------------
-- 3. Purchases gain a mandatory season target. Historical tournament_id is
-- retained for audit; it is NULL for every new season purchase.
-- -------------------------------------------------------------------------

alter table public.tournament_purchases add column season_id uuid;
update public.tournament_purchases purchase
set season_id = tournament.season_id
from public.tournaments tournament
where tournament.organization_id = purchase.organization_id
  and tournament.id = purchase.tournament_id;
alter table public.tournament_purchases alter column season_id set not null;
alter table public.tournament_purchases
  add constraint tournament_purchases_season_fk
  foreign key (organization_id,season_id)
  references public.tournament_seasons(organization_id,id) on delete restrict;
alter table public.tournament_purchases alter column tournament_id drop not null;

drop index public.tournament_purchases_open_product_unique;
create unique index tournament_purchases_open_season_product_unique
  on public.tournament_purchases(organization_id,season_id,product_code)
  where status in ('created','preference_created','pending');
create index tournament_purchases_season_created_idx
  on public.tournament_purchases(organization_id,season_id,created_at desc);
create index tournament_purchases_season_fk_idx
  on public.tournament_purchases(season_id);

alter table public.tournament_purchases
  drop constraint tournament_purchases_external_reference_check;
alter table public.tournament_purchases
  add constraint tournament_purchases_external_reference_check check (
    external_reference ~ '^arma2:(tournament|season):purchase:[0-9a-f-]{36}$'
  );

comment on column public.tournament_purchases.season_id is
  'Commercial target. Mandatory for historical and new purchases.';
comment on column public.tournament_purchases.tournament_id is
  'Historical competition target only. NULL for purchases created after season billing.';

create or replace function public.tournament_purchase_projection(
  p_purchase public.tournament_purchases
) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'schemaVersion',3,'id',p_purchase.id,
    'organizationId',p_purchase.organization_id,'seasonId',p_purchase.season_id,
    'tournamentId',p_purchase.tournament_id,'productCode',p_purchase.product_code,
    'offerCode',p_purchase.offer_code,'offerVersion',p_purchase.offer_version,
    'listAmount',p_purchase.list_amount_snapshot,'amount',p_purchase.amount_snapshot,
    'currency',p_purchase.currency,'provider',p_purchase.provider,
    'providerEnvironment',p_purchase.provider_environment,
    'providerPreferenceId',p_purchase.provider_preference_id,
    'externalReference',p_purchase.external_reference,'status',p_purchase.status,
    'providerStatus',p_purchase.provider_status,
    'providerStatusDetail',p_purchase.provider_status_detail,
    'preferenceExpiresAt',p_purchase.preference_expires_at,
    'approvedAt',p_purchase.approved_at,
    'entitlementActivatedAt',p_purchase.entitlement_activated_at,
    'activationErrorCode',p_purchase.activation_error_code,
    'createdAt',p_purchase.created_at,'updatedAt',p_purchase.updated_at
  );
$$;

create or replace function public.create_tournament_season_purchase(
  p_organization_id uuid,
  p_season_id uuid,
  p_product_code text,
  p_idempotency_key uuid,
  p_provider text,
  p_provider_environment text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_offer public.tournament_commercial_offers%rowtype;
  v_purchase public.tournament_purchases%rowtype;
  v_product public.tournament_commercial_products%rowtype;
  v_id uuid := gen_random_uuid();
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(p_organization_id,'billing.manage') then
    raise exception using errcode = '42501', message = 'TORNEOS_BILLING_FORBIDDEN';
  end if;
  if p_idempotency_key is null or not (
    (p_provider = 'FAKE' and p_provider_environment in ('local','qa'))
    or (p_provider = 'MERCADO_PAGO' and p_provider_environment = 'test')
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_PURCHASE_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || p_season_id::text || ':' || p_product_code,79)
  );
  if not exists (
    select 1 from public.tournament_seasons season
    where season.organization_id = p_organization_id and season.id = p_season_id
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_PURCHASE_FORBIDDEN';
  end if;
  if exists (
    select 1 from public.tournament_season_plan_grants grant_row
    where grant_row.organization_id = p_organization_id
      and grant_row.season_id = p_season_id
      and public.is_tournament_season_plan_grant_effective(grant_row.id)
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_SEASON_ALREADY_PREMIUM';
  end if;
  select * into v_purchase from public.tournament_purchases
  where buyer_user_id = auth.uid() and idempotency_key = p_idempotency_key;
  if v_purchase.id is not null then
    if v_purchase.organization_id <> p_organization_id
      or v_purchase.season_id <> p_season_id
      or v_purchase.product_code <> p_product_code
      or v_purchase.provider <> p_provider
      or v_purchase.provider_environment <> p_provider_environment then
      raise exception using errcode = '22023', message = 'TORNEOS_IDEMPOTENCY_CONFLICT';
    end if;
    return public.tournament_purchase_projection(v_purchase)
      || jsonb_build_object('idempotentReplay',true,'existingOpenPurchase',false);
  end if;
  select * into v_purchase from public.tournament_purchases
  where organization_id = p_organization_id and season_id = p_season_id
    and product_code = p_product_code and status in ('created','preference_created','pending')
  order by created_at limit 1 for update;
  if v_purchase.id is not null then
    if v_purchase.provider <> p_provider
      or v_purchase.provider_environment <> p_provider_environment then
      raise exception using errcode = '55000', message = 'TORNEOS_OPEN_PURCHASE_PROVIDER_CONFLICT';
    end if;
    return public.tournament_purchase_projection(v_purchase)
      || jsonb_build_object('idempotentReplay',false,'existingOpenPurchase',true);
  end if;
  select * into v_product from public.tournament_commercial_products
  where product_code = p_product_code and status = 'active';
  if v_product.product_code is null or v_product.plan_code <> 'PREMIUM'
    or v_product.scope <> 'season' or v_product.billing_model <> 'one_time' then
    raise exception using errcode = '22023', message = 'TORNEOS_PRODUCT_UNAVAILABLE';
  end if;
  select * into v_offer from public.tournament_commercial_offers offer
  where offer.product_code = p_product_code and offer.availability = 'available'
    and offer.valid_from <= statement_timestamp()
    and (offer.valid_until is null or offer.valid_until > statement_timestamp())
  order by offer.valid_from desc,offer.offer_version desc limit 1;
  if v_offer.product_code is null then
    raise exception using errcode = '22023', message = 'TORNEOS_OFFER_UNAVAILABLE';
  end if;
  insert into public.tournament_purchases (
    id,organization_id,season_id,tournament_id,buyer_user_id,product_code,
    offer_code,offer_version,list_amount_snapshot,amount_snapshot,currency,
    provider,provider_environment,external_reference,idempotency_key,status,
    preference_expires_at
  ) values (
    v_id,p_organization_id,p_season_id,null,auth.uid(),p_product_code,
    v_offer.offer_code,v_offer.offer_version,v_offer.list_amount,v_offer.amount,
    v_offer.currency,p_provider,p_provider_environment,
    'arma2:season:purchase:' || v_id::text,p_idempotency_key,'created',
    now() + interval '30 minutes'
  ) returning * into v_purchase;
  insert into public.tournament_purchase_events (
    purchase_id,organization_id,event_type,from_status,to_status,actor_type,actor_user_id,
    metadata
  ) values (
    v_purchase.id,p_organization_id,'purchase.created',null,'created','user',auth.uid(),
    jsonb_build_object('seasonId',p_season_id)
  );
  return public.tournament_purchase_projection(v_purchase)
    || jsonb_build_object('idempotentReplay',false,'existingOpenPurchase',false);
end;
$$;

create or replace function public.create_fake_tournament_season_purchase(
  p_organization_id uuid,
  p_season_id uuid,
  p_product_code text,
  p_idempotency_key uuid,
  p_provider_environment text default 'local'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_purchase jsonb;
begin
  v_purchase := public.create_tournament_season_purchase(
    p_organization_id,p_season_id,p_product_code,p_idempotency_key,
    'FAKE',p_provider_environment
  );
  if v_purchase->>'status' = 'created' then
    v_purchase := public.record_tournament_purchase_preference(
      (v_purchase->>'id')::uuid,'FAKE',p_provider_environment,
      'fake_pref_' || (v_purchase->>'id'),
      (v_purchase->>'preferenceExpiresAt')::timestamptz
    ) || jsonb_build_object(
      'existingOpenPurchase',coalesce((v_purchase->>'existingOpenPurchase')::boolean,false),
      'idempotentReplay',coalesce((v_purchase->>'idempotentReplay')::boolean,false)
    );
  end if;
  return v_purchase;
end;
$$;

-- Provider activation now creates a season grant. Payment and purchase history
-- continue using their existing immutable tables.
create or replace function public.activate_verified_tournament_purchase(
  p_purchase_id uuid,
  p_provider text,
  p_provider_environment text,
  p_provider_status text,
  p_provider_status_detail text default null,
  p_provider_payment_id text default null,
  p_simulated_activation_error_code text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_purchase public.tournament_purchases%rowtype;
  v_offer public.tournament_commercial_offers%rowtype;
  v_product public.tournament_commercial_products%rowtype;
  v_grant_id uuid;
  v_from_status text;
begin
  select * into v_purchase from public.tournament_purchases where id = p_purchase_id for update;
  if v_purchase.id is null or v_purchase.provider <> p_provider
    or v_purchase.provider_environment <> p_provider_environment
    or v_purchase.provider_preference_id is null
    or (p_provider = 'MERCADO_PAGO' and (p_provider_environment <> 'test' or p_provider_payment_id is null)) then
    raise exception using errcode = '22023', message = 'TORNEOS_PURCHASE_INVALID';
  end if;
  if v_purchase.status = 'approved' and v_purchase.entitlement_activated_at is not null then
    if p_provider_payment_id is not null
      and v_purchase.approved_provider_payment_id is distinct from p_provider_payment_id then
      raise exception using errcode = '55000', message = 'TORNEOS_PAYMENT_CONFLICT';
    end if;
    return public.tournament_purchase_projection(v_purchase) || jsonb_build_object('idempotentReplay',true);
  end if;
  if v_purchase.status not in ('preference_created','pending','approved') then
    raise exception using errcode = '55000', message = 'TORNEOS_PURCHASE_TRANSITION_INVALID';
  end if;
  v_from_status := v_purchase.status;
  update public.tournament_purchases
  set activation_attempts = activation_attempts + 1,last_verified_at = now()
  where id = v_purchase.id returning * into v_purchase;
  if p_simulated_activation_error_code is not null then
    update public.tournament_purchases
    set activation_error_code = left(p_simulated_activation_error_code,80)
    where id = v_purchase.id returning * into v_purchase;
    insert into public.tournament_purchase_events (
      purchase_id,organization_id,event_type,from_status,to_status,provider_status,actor_type,metadata
    ) values (
      v_purchase.id,v_purchase.organization_id,'activation.failed',v_purchase.status,
      v_purchase.status,p_provider_status,'service',
      jsonb_build_object('errorCode',v_purchase.activation_error_code,'seasonId',v_purchase.season_id)
    );
    return public.tournament_purchase_projection(v_purchase);
  end if;
  select * into v_offer from public.tournament_commercial_offers
  where product_code = v_purchase.product_code and offer_code = v_purchase.offer_code
    and offer_version = v_purchase.offer_version;
  select * into v_product from public.tournament_commercial_products
  where product_code = v_purchase.product_code;
  if v_offer.product_code is null or v_product.plan_code <> 'PREMIUM'
    or v_product.scope <> 'season' or v_product.billing_model <> 'one_time'
    or v_offer.list_amount <> v_purchase.list_amount_snapshot
    or v_offer.amount <> v_purchase.amount_snapshot
    or v_offer.currency <> v_purchase.currency then
    update public.tournament_purchases set activation_error_code = 'snapshot_mismatch'
    where id = v_purchase.id returning * into v_purchase;
    return public.tournament_purchase_projection(v_purchase);
  end if;
  v_grant_id := public.grant_tournament_season_premium(
    v_purchase.organization_id,v_purchase.season_id,v_purchase.id,
    'Pago ' || v_purchase.provider || ' verificado para la temporada y compra ' || v_purchase.id::text
  );
  insert into public.tournament_season_plan_grant_events (
    season_grant_id,purchase_id,event_type,reason_code,reason,actor_type
  ) select v_grant_id,v_purchase.id,'granted','payment_approved',
    'Premium de temporada activado por pago verificado','provider'
  where not exists (
    select 1 from public.tournament_season_plan_grant_events event
    where event.season_grant_id = v_grant_id and event.event_type = 'granted'
  );
  update public.tournament_purchases set
    status = 'approved',provider_status = left(btrim(p_provider_status),80),
    provider_status_detail = nullif(left(btrim(p_provider_status_detail),120),''),
    approved_provider_payment_id = coalesce(approved_provider_payment_id,p_provider_payment_id,'fake_pay_' || id::text),
    approved_at = coalesce(approved_at,now()),activation_error_code = null,
    entitlement_activated_at = coalesce(entitlement_activated_at,now()),last_verified_at = now()
  where id = v_purchase.id returning * into v_purchase;
  insert into public.tournament_purchase_events (
    purchase_id,organization_id,event_type,from_status,to_status,provider_status,
    provider_status_detail,actor_type,metadata
  ) values (
    v_purchase.id,v_purchase.organization_id,'payment.approved',v_from_status,'approved',
    v_purchase.provider_status,v_purchase.provider_status_detail,'provider',
    jsonb_build_object('providerPaymentId',v_purchase.approved_provider_payment_id,
      'seasonGrantId',v_grant_id,'seasonId',v_purchase.season_id)
  );
  insert into public.tournament_audit_log (
    organization_id,actor_user_id,actor_type,action,resource_type,resource_id,
    tournament_id,metadata
  ) values (
    v_purchase.organization_id,null,'system','billing.season_purchase_activated',
    'tournament_purchase',v_purchase.id,v_purchase.tournament_id,
    jsonb_build_object('seasonGrantId',v_grant_id,'seasonId',v_purchase.season_id)
  );
  return public.tournament_purchase_projection(v_purchase) || jsonb_build_object('idempotentReplay',false);
end;
$$;

create or replace function public.apply_tournament_purchase_reversal(
  p_purchase_id uuid,
  p_action text,
  p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_purchase public.tournament_purchases%rowtype;
  v_grant public.tournament_season_plan_grants%rowtype;
  v_event_type text;
  v_reason_code text;
  v_from_status text;
begin
  if p_action not in ('refund','chargeback_disputed','chargeback_restored','chargeback_buyer_won')
    or p_reason is null or char_length(btrim(p_reason)) not between 8 and 500 then
    raise exception using errcode = '22023', message = 'TORNEOS_REVERSAL_INVALID';
  end if;
  select * into v_purchase from public.tournament_purchases where id = p_purchase_id for update;
  if v_purchase.id is null or v_purchase.entitlement_activated_at is null then
    raise exception using errcode = '22023', message = 'TORNEOS_PURCHASE_INVALID';
  end if;
  v_from_status := v_purchase.status;
  select * into v_grant from public.tournament_season_plan_grants
  where origin_purchase_id = v_purchase.id for update;
  if v_grant.id is null then
    raise exception using errcode = '55000', message = 'TORNEOS_PURCHASE_GRANT_MISSING';
  end if;
  v_event_type := case p_action
    when 'chargeback_disputed' then 'suspended'
    when 'chargeback_restored' then 'restored' else 'revoked' end;
  v_reason_code := case p_action
    when 'refund' then 'total_refund'
    when 'chargeback_disputed' then 'chargeback_disputed'
    when 'chargeback_restored' then 'chargeback_restored'
    else 'chargeback_buyer_won' end;
  if (select event_type from public.tournament_season_plan_grant_events
      where season_grant_id = v_grant.id order by id desc limit 1) = v_event_type then
    return public.tournament_purchase_projection(v_purchase) || jsonb_build_object('idempotentReplay',true);
  end if;
  insert into public.tournament_season_plan_grant_events (
    season_grant_id,purchase_id,event_type,reason_code,reason,actor_type
  ) values (v_grant.id,v_purchase.id,v_event_type,v_reason_code,btrim(p_reason),'provider');
  update public.tournament_purchases set
    status = case p_action when 'refund' then 'refunded'
      when 'chargeback_restored' then 'approved' else 'charged_back' end,
    provider_status = p_action,
    refunded_at = case when p_action = 'refund' then now() else refunded_at end,
    charged_back_at = case when p_action in ('chargeback_disputed','chargeback_buyer_won')
      then coalesce(charged_back_at,now()) else charged_back_at end,
    last_verified_at = now()
  where id = v_purchase.id returning * into v_purchase;
  insert into public.tournament_purchase_events (
    purchase_id,organization_id,event_type,from_status,to_status,provider_status,actor_type,metadata
  ) values (
    v_purchase.id,v_purchase.organization_id,'payment.' || p_action,v_from_status,
    v_purchase.status,p_action,'provider',
    jsonb_build_object('seasonGrantEvent',v_event_type,'seasonId',v_purchase.season_id)
  );
  return public.tournament_purchase_projection(v_purchase) || jsonb_build_object('idempotentReplay',false);
end;
$$;

-- -------------------------------------------------------------------------
-- 4. Season entitlement projection; tournament functions remain compatible
-- but now resolve and inherit their parent season.
-- -------------------------------------------------------------------------

create or replace function public.resolve_effective_tournament_season_entitlements_at(
  p_organization_id uuid,
  p_season_id uuid,
  p_as_of timestamptz,
  p_participant_only boolean default false,
  p_tournament_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_plan text := 'FREE';
  v_source text := 'default_free';
  v_policy public.tournament_plan_catalog%rowtype;
  v_offer public.tournament_commercial_offers%rowtype;
  v_capabilities jsonb := '{}'::jsonb;
  v_admin_usage integer := 0;
begin
  if p_organization_id is null or p_season_id is null or p_as_of is null then return null; end if;
  if not exists (
    select 1 from public.tournament_seasons season
    where season.organization_id = p_organization_id and season.id = p_season_id
  ) then return null; end if;
  if p_tournament_id is not null and not exists (
    select 1 from public.tournaments tournament
    where tournament.organization_id = p_organization_id
      and tournament.season_id = p_season_id and tournament.id = p_tournament_id
  ) then return null; end if;
  select 'PREMIUM',grant_row.source into v_plan,v_source
  from public.tournament_season_plan_grants grant_row
  where grant_row.organization_id = p_organization_id and grant_row.season_id = p_season_id
    and public.is_tournament_season_plan_grant_effective(grant_row.id)
  order by case grant_row.source when 'purchase' then 0 else 1 end,
    grant_row.granted_at,grant_row.id limit 1;
  if not found then v_plan := 'FREE'; v_source := 'default_free'; end if;
  select * into v_policy from public.tournament_plan_catalog where plan_code = v_plan;
  select * into v_offer from public.tournament_commercial_offers offer
  where offer.product_code = 'torneos_premium' and offer.valid_from <= p_as_of
    and (offer.valid_until is null or offer.valid_until > p_as_of)
  order by (offer.availability = 'available') desc,offer.valid_from desc,offer.offer_version desc limit 1;
  select coalesce(jsonb_object_agg(catalog.capability,
    case when p_participant_only and not catalog.participant_enabled then false
      else coalesce(tournament_override.enabled,
        case when v_plan = 'PREMIUM' then catalog.premium_enabled else catalog.free_enabled end,false)
    end order by catalog.capability),'{}'::jsonb)
  into v_capabilities
  from public.tournament_entitlement_capabilities catalog
  left join public.tournament_entitlement_overrides tournament_override
    on p_tournament_id is not null
   and tournament_override.organization_id = p_organization_id
   and tournament_override.tournament_id = p_tournament_id
   and tournament_override.capability = catalog.capability
   and (tournament_override.expires_at is null or tournament_override.expires_at > p_as_of);
  select count(*)::integer into v_admin_usage
  from public.tournament_organization_members membership
  where membership.organization_id = p_organization_id and membership.status = 'active'
    and membership.role in ('admin','collaborator');
  return jsonb_build_object(
    'schemaVersion',4,'plan',v_plan,'assignmentSource',v_source,'requiresPremium',false,
    'scope',jsonb_build_object('type','season','organizationId',p_organization_id,
      'seasonId',p_season_id,'tournamentId',p_tournament_id,
      'audience',case when p_participant_only then 'participant' else 'organization_member' end),
    'pricing',jsonb_build_object('currency',v_offer.currency,'listPrice',v_offer.list_amount,
      'launchPrice',v_offer.amount,'billingModel','one_time','scope','season'),
    'offer',jsonb_build_object('code',v_offer.offer_code,'version',v_offer.offer_version,
      'label',v_offer.offer_label,'validUntil',v_offer.valid_until,'availability',v_offer.availability),
    'capabilities',v_capabilities,
    'limits',jsonb_build_object('galleryAssetLimit',v_policy.gallery_asset_limit,
      'administrativeCollaboratorLimit',v_policy.administrative_collaborator_limit),
    'media',jsonb_build_object('galleryAssetLimit',v_policy.gallery_asset_limit,
      'essentialAssetsCountTowardLimit',false),
    'administration',jsonb_build_object('currentAdministrativeSeatUsage',v_admin_usage,
      'administrativeSeatLimit',v_policy.administrative_collaborator_limit,
      'ownerIncluded',true,'ownerCountsTowardLimit',false),
    'social',jsonb_build_object('baseFamilyLimit',case when v_plan = 'PREMIUM' then 11 else 3 end,
      'premiumResultStyles',v_plan = 'PREMIUM'),
    'branding',jsonb_build_object('mode',v_policy.branding_mode,
      'arma2Visible',true,'canRemoveArma2',v_plan = 'PREMIUM',
      'label','Arma2 Torneos')
  );
end;
$$;

create or replace function public.resolve_effective_tournament_entitlements_at(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_as_of timestamptz,
  p_participant_only boolean default false
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_season_id uuid;
begin
  if p_tournament_id is null then return null; end if;
  select season_id into v_season_id from public.tournaments
  where organization_id = p_organization_id and id = p_tournament_id;
  if v_season_id is null then return null; end if;
  return public.resolve_effective_tournament_season_entitlements_at(
    p_organization_id,v_season_id,p_as_of,p_participant_only,p_tournament_id
  );
end;
$$;

create or replace function public.get_effective_tournament_season_entitlements(
  p_organization_id uuid,
  p_season_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.is_tournament_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'TORNEOS_ENTITLEMENTS_FORBIDDEN';
  end if;
  v_result := public.resolve_effective_tournament_season_entitlements_at(
    p_organization_id,p_season_id,now(),false,null
  );
  if v_result is null then
    raise exception using errcode = '42501', message = 'TORNEOS_ENTITLEMENTS_FORBIDDEN';
  end if;
  return v_result;
end;
$$;

create or replace function public.get_effective_tournament_entitlements(
  p_organization_id uuid,
  p_tournament_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_season_id uuid;
begin
  if auth.uid() is null or p_tournament_id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_ENTITLEMENTS_FORBIDDEN';
  end if;
  select season_id into v_season_id from public.tournaments
  where organization_id = p_organization_id and id = p_tournament_id;
  if v_season_id is null or not public.is_tournament_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'TORNEOS_ENTITLEMENTS_FORBIDDEN';
  end if;
  return public.resolve_effective_tournament_season_entitlements_at(
    p_organization_id,v_season_id,now(),false,p_tournament_id
  );
end;
$$;

-- Disable browser access to tournament-target purchase creation. History and
-- provider-side processing functions remain available for audit/reversals.
do $production_optional_revoke$
begin
  if to_regprocedure('public.create_tournament_purchase(uuid,uuid,text,uuid,text,text)') is not null then
    revoke execute on function public.create_tournament_purchase(uuid,uuid,text,uuid,text,text) from authenticated;
  end if;
end
$production_optional_revoke$;
revoke execute on function public.create_fake_tournament_purchase(uuid,uuid,text,uuid,text)
  from authenticated;

revoke all on function public.is_tournament_season_plan_grant_effective(uuid)
  from public,anon,authenticated;
revoke all on function public.grant_tournament_season_premium(uuid,uuid,uuid,text)
  from public,anon,authenticated;
revoke all on function public.resolve_effective_tournament_season_entitlements_at(
  uuid,uuid,timestamptz,boolean,uuid
) from public,anon;
revoke all on function public.get_effective_tournament_season_entitlements(uuid,uuid)
  from public,anon;
revoke all on function public.create_tournament_season_purchase(uuid,uuid,text,uuid,text,text)
  from public,anon;
revoke all on function public.create_fake_tournament_season_purchase(uuid,uuid,text,uuid,text)
  from public,anon;

grant execute on function public.is_tournament_season_plan_grant_effective(uuid) to service_role;
grant execute on function public.grant_tournament_season_premium(uuid,uuid,uuid,text) to service_role;
grant execute on function public.resolve_effective_tournament_season_entitlements_at(
  uuid,uuid,timestamptz,boolean,uuid
) to authenticated,service_role;
grant execute on function public.get_effective_tournament_season_entitlements(uuid,uuid)
  to authenticated,service_role;
grant execute on function public.create_tournament_season_purchase(uuid,uuid,text,uuid,text,text)
  to authenticated,service_role;
grant execute on function public.create_fake_tournament_season_purchase(uuid,uuid,text,uuid,text)
  to authenticated,service_role;

comment on table public.tournament_season_plan_grants is
  'Permanent PREMIUM grants scoped to tournament_seasons.id. Historical tournament grants remain immutable and auditable.';
comment on table public.tournament_season_plan_grant_events is
  'Append-only lifecycle for season grants, including copied historical grant events.';

commit;
