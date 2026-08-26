-- Arma2 Torneos · commercial checkout foundation (provider FAKE only).
--
-- Purchases are payment workflow records. Effective access continues to be
-- derived exclusively from tournament_plan_grants plus append-only grant
-- events. No browser role receives direct table writes in this domain.

set check_function_bodies = off;

begin;

-- -------------------------------------------------------------------------
-- 1. Versioned, server-authoritative commercial catalog.
-- -------------------------------------------------------------------------

create table public.tournament_commercial_products (
  product_code text primary key,
  product_name text not null,
  plan_code text not null references public.tournament_plan_catalog(plan_code),
  scope text not null,
  billing_model text not null,
  status text not null default 'active',
  public_capabilities jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_commercial_products_code_check
    check (product_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  constraint tournament_commercial_products_name_check
    check (product_name = btrim(product_name) and char_length(product_name) between 3 and 100),
  constraint tournament_commercial_products_scope_check check (scope = 'tournament'),
  constraint tournament_commercial_products_billing_check check (billing_model = 'one_time'),
  constraint tournament_commercial_products_status_check check (status in ('active','retired')),
  constraint tournament_commercial_products_capabilities_check check (
    jsonb_typeof(public_capabilities) = 'array'
    and pg_column_size(public_capabilities) <= 8192
  )
);

create table public.tournament_commercial_offers (
  product_code text not null references public.tournament_commercial_products(product_code) on delete restrict,
  offer_code text not null,
  offer_version integer not null,
  offer_label text not null,
  currency text not null,
  list_amount integer not null,
  amount integer not null,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  availability text not null default 'available',
  created_at timestamptz not null default now(),
  primary key (product_code,offer_code,offer_version),
  constraint tournament_commercial_offers_code_check
    check (offer_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  constraint tournament_commercial_offers_version_check check (offer_version > 0),
  constraint tournament_commercial_offers_label_check
    check (offer_label = btrim(offer_label) and char_length(offer_label) between 3 and 100),
  constraint tournament_commercial_offers_currency_check check (currency = 'ARS'),
  constraint tournament_commercial_offers_amount_check
    check (list_amount > 0 and amount > 0 and amount <= list_amount),
  constraint tournament_commercial_offers_validity_check
    check (valid_until is null or valid_until > valid_from),
  constraint tournament_commercial_offers_availability_check
    check (availability in ('available','coming_soon','unavailable'))
);

create index tournament_commercial_offers_resolution_idx
  on public.tournament_commercial_offers
  (product_code,availability,valid_from desc,offer_version desc);
create index tournament_commercial_products_plan_idx
  on public.tournament_commercial_products(plan_code);

insert into public.tournament_commercial_products (
  product_code,product_name,plan_code,scope,billing_model,public_capabilities
) values (
  'torneos_premium','Arma2 Torneos Premium','PREMIUM','tournament','one_time',
  '[
    {"code":"statistics.advanced","label":"Estadisticas avanzadas","availability":"available"},
    {"code":"branding.advanced","label":"Identidad visual avanzada","availability":"available"},
    {"code":"social_studio.premium","label":"Estilos Premium para resultados","availability":"available"},
    {"code":"sponsors","label":"Sponsors","availability":"coming_soon"},
    {"code":"exports.professional","label":"Exportaciones profesionales","availability":"coming_soon"}
  ]'::jsonb
);

insert into public.tournament_commercial_offers (
  product_code,offer_code,offer_version,offer_label,currency,
  list_amount,amount,valid_from,valid_until,availability
) values (
  'torneos_premium','launch',1,'Precio lanzamiento','ARS',49900,39900,
  statement_timestamp(),null,'available'
);

create trigger tournament_commercial_products_touch
before update on public.tournament_commercial_products
for each row execute function public.touch_tournament_workspace_updated_at();

-- -------------------------------------------------------------------------
-- 2. Purchases and append-only workflow history.
-- -------------------------------------------------------------------------

create table public.tournament_purchases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  buyer_user_id uuid not null references auth.users(id) on delete restrict,
  product_code text not null,
  offer_code text not null,
  offer_version integer not null,
  list_amount_snapshot integer not null,
  amount_snapshot integer not null,
  currency text not null,
  provider text not null,
  provider_environment text not null,
  provider_preference_id text,
  approved_provider_payment_id text,
  external_reference text not null,
  idempotency_key uuid not null,
  status text not null default 'created',
  provider_status text,
  provider_status_detail text,
  preference_expires_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  charged_back_at timestamptz,
  activation_attempts integer not null default 0,
  activation_error_code text,
  entitlement_activated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint tournament_purchases_tournament_fk
    foreign key (organization_id,tournament_id)
    references public.tournaments(organization_id,id) on delete restrict,
  constraint tournament_purchases_offer_fk
    foreign key (product_code,offer_code,offer_version)
    references public.tournament_commercial_offers(product_code,offer_code,offer_version)
    on delete restrict,
  constraint tournament_purchases_amount_check check (
    list_amount_snapshot > 0 and amount_snapshot > 0
    and amount_snapshot <= list_amount_snapshot
  ),
  constraint tournament_purchases_currency_check check (currency = 'ARS'),
  constraint tournament_purchases_provider_check check (provider = 'FAKE'),
  constraint tournament_purchases_environment_check
    check (provider_environment in ('local','qa')),
  constraint tournament_purchases_status_check check (status in (
    'created','preference_created','pending','approved','rejected',
    'cancelled','expired','refunded','charged_back'
  )),
  constraint tournament_purchases_external_reference_check check (
    external_reference ~ '^arma2:tournament:purchase:[0-9a-f-]{36}$'
  ),
  constraint tournament_purchases_provider_detail_check check (
    provider_status is null or char_length(provider_status) between 2 and 80
  ),
  constraint tournament_purchases_activation_attempts_check check (activation_attempts >= 0),
  constraint tournament_purchases_metadata_check check (
    jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 2048
  ),
  constraint tournament_purchases_buyer_idempotency_unique
    unique (buyer_user_id,idempotency_key)
);

create unique index tournament_purchases_open_product_unique
  on public.tournament_purchases (organization_id,tournament_id,product_code)
  where status in ('created','preference_created','pending');
create unique index tournament_purchases_provider_preference_unique
  on public.tournament_purchases (provider,provider_environment,provider_preference_id)
  where provider_preference_id is not null;
create unique index tournament_purchases_provider_payment_unique
  on public.tournament_purchases (provider,provider_environment,approved_provider_payment_id)
  where approved_provider_payment_id is not null;
create index tournament_purchases_buyer_created_idx
  on public.tournament_purchases (buyer_user_id,created_at desc);
create index tournament_purchases_tournament_created_idx
  on public.tournament_purchases (organization_id,tournament_id,created_at desc);
create index tournament_purchases_offer_idx
  on public.tournament_purchases (product_code,offer_code,offer_version);

create table public.tournament_purchase_events (
  id bigint generated always as identity primary key,
  purchase_id uuid not null references public.tournament_purchases(id) on delete restrict,
  organization_id uuid not null,
  event_type text not null,
  from_status text,
  to_status text,
  provider_status text,
  provider_status_detail text,
  actor_type text not null,
  actor_user_id uuid references auth.users(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint tournament_purchase_events_type_check
    check (event_type ~ '^[a-z][a-z0-9_.]{2,80}$'),
  constraint tournament_purchase_events_actor_check check (actor_type in ('user','service','provider')),
  constraint tournament_purchase_events_metadata_check check (
    jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096
  )
);

create index tournament_purchase_events_purchase_idx
  on public.tournament_purchase_events (purchase_id,id);
create index tournament_purchase_events_organization_idx
  on public.tournament_purchase_events (organization_id,created_at desc);

alter table public.tournament_plan_grants
  add column origin_purchase_id uuid
    references public.tournament_purchases(id) on delete restrict;
create unique index tournament_plan_grants_origin_purchase_unique
  on public.tournament_plan_grants(origin_purchase_id)
  where origin_purchase_id is not null;

create table public.tournament_plan_grant_events (
  id bigint generated always as identity primary key,
  grant_id uuid not null references public.tournament_plan_grants(id) on delete restrict,
  purchase_id uuid references public.tournament_purchases(id) on delete restrict,
  event_type text not null,
  reason_code text not null,
  reason text not null,
  actor_type text not null,
  actor_user_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint tournament_plan_grant_events_type_check
    check (event_type in ('granted','suspended','restored','revoked')),
  constraint tournament_plan_grant_events_reason_code_check
    check (reason_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  constraint tournament_plan_grant_events_reason_check
    check (reason = btrim(reason) and char_length(reason) between 8 and 500),
  constraint tournament_plan_grant_events_actor_check
    check (actor_type in ('service','provider'))
);

create index tournament_plan_grant_events_current_idx
  on public.tournament_plan_grant_events (grant_id,id desc);
create index tournament_plan_grant_events_purchase_idx
  on public.tournament_plan_grant_events (purchase_id,id desc)
  where purchase_id is not null;

-- Materialize the already-established role capability arrays before replacing
-- the resolver. This adds billing.manage without copying or drifting the large
-- sporting capability matrix from prior migrations.
create table public.tournament_organization_role_capabilities (
  role text not null,
  capability text not null,
  created_at timestamptz not null default now(),
  primary key (role,capability),
  constraint tournament_organization_role_capabilities_role_check
    check (role in ('owner','admin','collaborator')),
  constraint tournament_organization_role_capabilities_capability_check
    check (capability ~ '^[a-z][a-z0-9_.]{2,80}$')
);

insert into public.tournament_organization_role_capabilities(role,capability)
select source.role,capability
from (values ('owner'),('admin'),('collaborator')) source(role)
cross join lateral unnest(public.tournament_role_capabilities(source.role)) capability;
insert into public.tournament_organization_role_capabilities(role,capability)
values ('owner','billing.manage'),('admin','billing.manage');

-- Every exposed table is explicitly closed. Reads happen through projections.
alter table public.tournament_commercial_products enable row level security;
alter table public.tournament_commercial_offers enable row level security;
alter table public.tournament_purchases enable row level security;
alter table public.tournament_purchase_events enable row level security;
alter table public.tournament_plan_grant_events enable row level security;
alter table public.tournament_organization_role_capabilities enable row level security;

revoke all on table public.tournament_commercial_products from public,anon,authenticated,service_role;
revoke all on table public.tournament_commercial_offers from public,anon,authenticated,service_role;
revoke all on table public.tournament_purchases from public,anon,authenticated,service_role;
revoke all on table public.tournament_purchase_events from public,anon,authenticated,service_role;
revoke all on table public.tournament_plan_grant_events from public,anon,authenticated,service_role;
revoke all on table public.tournament_organization_role_capabilities from public,anon,authenticated,service_role;
-- The plans foundation granted service_role its schema defaults. Commercial
-- activation must go through the verified purchase functions, never through a
-- direct grant insert/update/truncate.
revoke all on table public.tournament_plan_grants from service_role;
grant select on table public.tournament_commercial_products to service_role;
grant select on table public.tournament_commercial_offers to service_role;
grant select on table public.tournament_purchases to service_role;
grant select on table public.tournament_purchase_events to service_role;
grant select on table public.tournament_plan_grant_events to service_role;
grant select on table public.tournament_organization_role_capabilities to service_role;
grant select on table public.tournament_plan_grants to service_role;

create or replace function public.reject_append_only_tournament_commercial_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'TORNEOS_APPEND_ONLY_RESOURCE';
end;
$$;

create trigger tournament_purchase_events_append_only
before update or delete on public.tournament_purchase_events
for each row execute function public.reject_append_only_tournament_commercial_mutation();
create trigger tournament_plan_grant_events_append_only
before update or delete on public.tournament_plan_grant_events
for each row execute function public.reject_append_only_tournament_commercial_mutation();

create or replace function public.protect_referenced_tournament_offer()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.tournament_purchases purchase
    where purchase.product_code = old.product_code
      and purchase.offer_code = old.offer_code
      and purchase.offer_version = old.offer_version
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_REFERENCED_OFFER_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger tournament_commercial_offers_immutable_when_referenced
before update or delete on public.tournament_commercial_offers
for each row execute function public.protect_referenced_tournament_offer();

create or replace function public.protect_tournament_purchase_snapshots()
returns trigger language plpgsql set search_path = '' as $$
begin
  if row(
    new.organization_id,new.tournament_id,new.buyer_user_id,new.product_code,
    new.offer_code,new.offer_version,new.list_amount_snapshot,new.amount_snapshot,
    new.currency,new.provider,new.provider_environment,new.external_reference,new.idempotency_key
  ) is distinct from row(
    old.organization_id,old.tournament_id,old.buyer_user_id,old.product_code,
    old.offer_code,old.offer_version,old.list_amount_snapshot,old.amount_snapshot,
    old.currency,old.provider,old.provider_environment,old.external_reference,old.idempotency_key
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_PURCHASE_SNAPSHOT_IMMUTABLE';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger tournament_purchases_protect_snapshots
before update on public.tournament_purchases
for each row execute function public.protect_tournament_purchase_snapshots();

create or replace function public.enforce_tournament_purchase_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'created' and new.status in ('preference_created','cancelled'))
    or (old.status = 'preference_created' and new.status in ('pending','approved','rejected','cancelled','expired'))
    or (old.status = 'pending' and new.status in ('approved','rejected','cancelled','expired'))
    or (old.status = 'approved' and new.status in ('refunded','charged_back'))
    or (old.status = 'charged_back' and new.status = 'approved')
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_PURCHASE_TRANSITION_INVALID';
  end if;
  return new;
end;
$$;

create trigger tournament_purchases_state_machine
before update of status on public.tournament_purchases
for each row execute function public.enforce_tournament_purchase_transition();

-- -------------------------------------------------------------------------
-- 3. billing.manage and effective grant helpers.
-- -------------------------------------------------------------------------

create or replace function public.tournament_role_capabilities(p_role text)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(matrix.capability order by matrix.capability),'{}'::text[])
  from public.tournament_organization_role_capabilities matrix
  where matrix.role = p_role;
$$;

revoke all on function public.tournament_role_capabilities(text) from public,anon;
grant execute on function public.tournament_role_capabilities(text) to authenticated,service_role;

create or replace function public.has_tournament_organization_capability(
  p_organization_id uuid,
  p_capability text
) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1
    from public.tournament_organization_members membership
    join public.tournament_organizations organization
      on organization.id = membership.organization_id
    where membership.organization_id = p_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and organization.status = 'active'
      and p_capability = any(public.tournament_role_capabilities(membership.role))
  );
$$;

create or replace function public.is_tournament_plan_grant_effective(p_grant_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select event.event_type not in ('suspended','revoked')
    from public.tournament_plan_grant_events event
    where event.grant_id = p_grant_id
    order by event.id desc
    limit 1
  ),true);
$$;

create or replace function public.tournament_requires_premium(
  p_organization_id uuid,
  p_tournament_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.tournament_plan_grants grant_row
    where grant_row.organization_id = p_organization_id
      and grant_row.tournament_id = p_tournament_id
      and public.is_tournament_plan_grant_effective(grant_row.id)
  );
$$;

-- -------------------------------------------------------------------------
-- 4. Public projection and authenticated purchase projections.
-- -------------------------------------------------------------------------

create or replace function public.get_public_tournament_commercial_catalog(p_version integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_version <> 1 then
    raise exception using errcode = '22023', message = 'TORNEOS_CATALOG_VERSION_UNSUPPORTED';
  end if;
  select jsonb_build_object(
    'schemaVersion',1,
    'productCode',product.product_code,
    'productName',product.product_name,
    'scope',product.scope,
    'billingModel',product.billing_model,
    'currency',offer.currency,
    'listPrice',offer.list_amount,
    'effectivePrice',offer.amount,
    'offerCode',offer.offer_code,
    'offerVersion',offer.offer_version,
    'offerLabel',offer.offer_label,
    'offerValidUntil',offer.valid_until,
    'availability',offer.availability,
    'capabilities',product.public_capabilities
  ) into v_result
  from public.tournament_commercial_products product
  join lateral (
    select candidate.*
    from public.tournament_commercial_offers candidate
    where candidate.product_code = product.product_code
      and candidate.valid_from <= statement_timestamp()
      and (candidate.valid_until is null or candidate.valid_until > statement_timestamp())
    order by (candidate.availability = 'available') desc,
      candidate.valid_from desc,candidate.offer_version desc
    limit 1
  ) offer on true
  where product.product_code = 'torneos_premium' and product.status = 'active';
  return v_result;
end;
$$;

create or replace function public.tournament_purchase_projection(p_purchase public.tournament_purchases)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'schemaVersion',1,
    'id',p_purchase.id,
    'organizationId',p_purchase.organization_id,
    'tournamentId',p_purchase.tournament_id,
    'productCode',p_purchase.product_code,
    'offerCode',p_purchase.offer_code,
    'offerVersion',p_purchase.offer_version,
    'listAmount',p_purchase.list_amount_snapshot,
    'amount',p_purchase.amount_snapshot,
    'currency',p_purchase.currency,
    'provider',p_purchase.provider,
    'status',p_purchase.status,
    'providerStatus',p_purchase.provider_status,
    'preferenceExpiresAt',p_purchase.preference_expires_at,
    'approvedAt',p_purchase.approved_at,
    'entitlementActivatedAt',p_purchase.entitlement_activated_at,
    'activationErrorCode',p_purchase.activation_error_code,
    'createdAt',p_purchase.created_at,
    'updatedAt',p_purchase.updated_at
  );
$$;

create or replace function public.get_tournament_purchase(p_purchase_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_purchase public.tournament_purchases%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_purchase from public.tournament_purchases where id = p_purchase_id;
  if v_purchase.id is null or not (
    v_purchase.buyer_user_id = auth.uid()
    or public.has_tournament_organization_capability(v_purchase.organization_id,'billing.manage')
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_PURCHASE_FORBIDDEN';
  end if;
  return public.tournament_purchase_projection(v_purchase);
end;
$$;

-- -------------------------------------------------------------------------
-- 5. Purchase creation. Price and offer are never accepted from the client.
-- -------------------------------------------------------------------------

create or replace function public.create_fake_tournament_purchase(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_product_code text,
  p_idempotency_key uuid,
  p_provider_environment text default 'local'
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
  if p_idempotency_key is null or p_provider_environment not in ('local','qa') then
    raise exception using errcode = '22023', message = 'TORNEOS_PURCHASE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_tournament_id::text || ':' || p_product_code,79
  ));

  if not exists (
    select 1 from public.tournaments tournament
    where tournament.organization_id = p_organization_id and tournament.id = p_tournament_id
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_PURCHASE_FORBIDDEN';
  end if;
  if exists (
    select 1 from public.tournament_plan_grants grant_row
    where grant_row.organization_id = p_organization_id
      and grant_row.tournament_id = p_tournament_id
      and grant_row.plan_code = 'PREMIUM'
      and public.is_tournament_plan_grant_effective(grant_row.id)
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_ALREADY_PREMIUM';
  end if;

  select * into v_purchase from public.tournament_purchases
  where buyer_user_id = auth.uid() and idempotency_key = p_idempotency_key;
  if v_purchase.id is not null then
    return public.tournament_purchase_projection(v_purchase)
      || jsonb_build_object('idempotentReplay',true,'existingOpenPurchase',false);
  end if;

  select * into v_purchase from public.tournament_purchases
  where organization_id = p_organization_id and tournament_id = p_tournament_id
    and product_code = p_product_code
    and status in ('created','preference_created','pending')
  order by created_at limit 1 for update;
  if v_purchase.id is not null then
    return public.tournament_purchase_projection(v_purchase)
      || jsonb_build_object('idempotentReplay',false,'existingOpenPurchase',true);
  end if;

  select * into v_product from public.tournament_commercial_products
  where product_code = p_product_code and status = 'active';
  if v_product.product_code is null or v_product.plan_code <> 'PREMIUM'
    or v_product.scope <> 'tournament' or v_product.billing_model <> 'one_time' then
    raise exception using errcode = '22023', message = 'TORNEOS_PRODUCT_UNAVAILABLE';
  end if;
  select * into v_offer from public.tournament_commercial_offers offer
  where offer.product_code = p_product_code
    and offer.availability = 'available'
    and offer.valid_from <= statement_timestamp()
    and (offer.valid_until is null or offer.valid_until > statement_timestamp())
  order by offer.valid_from desc,offer.offer_version desc limit 1;
  if v_offer.product_code is null then
    raise exception using errcode = '22023', message = 'TORNEOS_OFFER_UNAVAILABLE';
  end if;

  insert into public.tournament_purchases (
    id,organization_id,tournament_id,buyer_user_id,product_code,offer_code,offer_version,
    list_amount_snapshot,amount_snapshot,currency,provider,provider_environment,
    provider_preference_id,external_reference,idempotency_key,status,provider_status,
    preference_expires_at
  ) values (
    v_id,p_organization_id,p_tournament_id,auth.uid(),p_product_code,
    v_offer.offer_code,v_offer.offer_version,v_offer.list_amount,v_offer.amount,
    v_offer.currency,'FAKE',p_provider_environment,null,
    'arma2:tournament:purchase:' || v_id::text,p_idempotency_key,
    'created',null,now() + interval '30 minutes'
  ) returning * into v_purchase;

  insert into public.tournament_purchase_events (
    purchase_id,organization_id,event_type,from_status,to_status,provider_status,
    actor_type,actor_user_id
  ) values
    (v_purchase.id,p_organization_id,'purchase.created',null,'created',null,'user',auth.uid());

  update public.tournament_purchases set
    status = 'preference_created',provider_status = 'created',
    provider_preference_id = 'fake_pref_' || v_id::text
  where id = v_id returning * into v_purchase;
  insert into public.tournament_purchase_events (
    purchase_id,organization_id,event_type,from_status,to_status,provider_status,
    actor_type,actor_user_id
  ) values (
    v_purchase.id,p_organization_id,'preference.created','created','preference_created',
    'created','service',auth.uid()
  );

  return public.tournament_purchase_projection(v_purchase)
    || jsonb_build_object('idempotentReplay',false,'existingOpenPurchase',false);
end;
$$;

-- -------------------------------------------------------------------------
-- 6. Verified FAKE transitions and atomic entitlement activation.
-- -------------------------------------------------------------------------

create or replace function public.activate_verified_fake_tournament_purchase(
  p_purchase_id uuid,
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
  select * into v_purchase from public.tournament_purchases
  where id = p_purchase_id for update;
  if v_purchase.id is null or v_purchase.provider <> 'FAKE' then
    raise exception using errcode = '22023', message = 'TORNEOS_PURCHASE_INVALID';
  end if;
  if v_purchase.status = 'approved' and v_purchase.entitlement_activated_at is not null then
    return public.tournament_purchase_projection(v_purchase) || jsonb_build_object('idempotentReplay',true);
  end if;
  if v_purchase.status not in ('preference_created','pending','approved') then
    raise exception using errcode = '55000', message = 'TORNEOS_PURCHASE_TRANSITION_INVALID';
  end if;
  v_from_status := v_purchase.status;

  update public.tournament_purchases set
    activation_attempts = activation_attempts + 1,
    last_verified_at = now()
  where id = v_purchase.id returning * into v_purchase;

  if p_simulated_activation_error_code is not null then
    update public.tournament_purchases
    set activation_error_code = left(p_simulated_activation_error_code,80)
    where id = v_purchase.id returning * into v_purchase;
    insert into public.tournament_purchase_events (
      purchase_id,organization_id,event_type,from_status,to_status,provider_status,
      actor_type,metadata
    ) values (
      v_purchase.id,v_purchase.organization_id,'activation.failed',v_purchase.status,
      v_purchase.status,'approved','service',
      jsonb_build_object('errorCode',v_purchase.activation_error_code)
    );
    return public.tournament_purchase_projection(v_purchase);
  end if;

  select * into v_offer from public.tournament_commercial_offers
  where product_code = v_purchase.product_code and offer_code = v_purchase.offer_code
    and offer_version = v_purchase.offer_version;
  select * into v_product from public.tournament_commercial_products
  where product_code = v_purchase.product_code;
  if v_offer.product_code is null or v_product.plan_code <> 'PREMIUM'
    or v_product.scope <> 'tournament' or v_product.billing_model <> 'one_time'
    or v_offer.list_amount <> v_purchase.list_amount_snapshot
    or v_offer.amount <> v_purchase.amount_snapshot or v_offer.currency <> v_purchase.currency then
    update public.tournament_purchases set activation_error_code = 'snapshot_mismatch'
    where id = v_purchase.id returning * into v_purchase;
    insert into public.tournament_purchase_events (
      purchase_id,organization_id,event_type,from_status,to_status,provider_status,
      actor_type,metadata
    ) values (
      v_purchase.id,v_purchase.organization_id,'activation.failed',v_purchase.status,
      v_purchase.status,'approved','service','{"errorCode":"snapshot_mismatch"}'::jsonb
    );
    return public.tournament_purchase_projection(v_purchase);
  end if;

  v_grant_id := public.grant_tournament_premium(
    v_purchase.organization_id,v_purchase.tournament_id,'purchase',
    'Pago FAKE verificado para la compra ' || v_purchase.id::text
  );
  update public.tournament_plan_grants set origin_purchase_id = v_purchase.id
  where id = v_grant_id and origin_purchase_id is null;
  insert into public.tournament_plan_grant_events (
    grant_id,purchase_id,event_type,reason_code,reason,actor_type
  ) select v_grant_id,v_purchase.id,'granted','payment_approved',
    'Premium activado por pago FAKE verificado','provider'
  where not exists (
    select 1 from public.tournament_plan_grant_events event
    where event.grant_id = v_grant_id and event.event_type = 'granted'
  );

  update public.tournament_purchases set
    status = 'approved',provider_status = 'approved',provider_status_detail = null,
    approved_provider_payment_id = coalesce(
      approved_provider_payment_id,p_provider_payment_id,'fake_pay_' || id::text
    ),
    approved_at = coalesce(approved_at,now()),activation_error_code = null,
    entitlement_activated_at = coalesce(entitlement_activated_at,now()),last_verified_at = now()
  where id = v_purchase.id returning * into v_purchase;

  insert into public.tournament_purchase_events (
    purchase_id,organization_id,event_type,from_status,to_status,provider_status,actor_type
  ) values (
    v_purchase.id,v_purchase.organization_id,'payment.approved',v_from_status,'approved',
    'approved','provider'
  );
  insert into public.tournament_audit_log (
    organization_id,actor_user_id,actor_type,action,resource_type,resource_id,
    tournament_id,metadata
  ) values (
    v_purchase.organization_id,null,'system','billing.purchase_activated','tournament_purchase',
    v_purchase.id,v_purchase.tournament_id,jsonb_build_object('grantId',v_grant_id)
  );
  return public.tournament_purchase_projection(v_purchase) || jsonb_build_object('idempotentReplay',false);
end;
$$;

create or replace function public.apply_fake_tournament_payment_status(
  p_purchase_id uuid,
  p_status text,
  p_provider_status_detail text default null,
  p_provider_payment_id text default null,
  p_simulated_activation_error_code text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_purchase public.tournament_purchases%rowtype; v_target text; v_from_status text;
begin
  if p_status = 'approved' then
    return public.activate_verified_fake_tournament_purchase(
      p_purchase_id,p_provider_payment_id,p_simulated_activation_error_code
    );
  end if;
  if p_status not in ('pending','rejected','expired') then
    raise exception using errcode = '22023', message = 'TORNEOS_FAKE_STATUS_INVALID';
  end if;
  select * into v_purchase from public.tournament_purchases where id = p_purchase_id for update;
  if v_purchase.id is null or v_purchase.provider <> 'FAKE'
    or v_purchase.status not in ('preference_created','pending') then
    raise exception using errcode = '55000', message = 'TORNEOS_PURCHASE_TRANSITION_INVALID';
  end if;
  v_from_status := v_purchase.status;
  v_target := p_status;
  update public.tournament_purchases set
    status = v_target,provider_status = p_status,
    provider_status_detail = nullif(left(btrim(p_provider_status_detail),120),''),
    last_verified_at = now(),
    cancelled_at = case when v_target = 'rejected' then now() else cancelled_at end
  where id = v_purchase.id returning * into v_purchase;
  insert into public.tournament_purchase_events (
    purchase_id,organization_id,event_type,from_status,to_status,provider_status,
    provider_status_detail,actor_type
  ) values (
    v_purchase.id,v_purchase.organization_id,'payment.' || v_target,
    v_from_status,
    v_target,p_status,v_purchase.provider_status_detail,'provider'
  );
  return public.tournament_purchase_projection(v_purchase);
end;
$$;

create or replace function public.apply_tournament_purchase_reversal(
  p_purchase_id uuid,
  p_action text,
  p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_purchase public.tournament_purchases%rowtype;
  v_grant public.tournament_plan_grants%rowtype;
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
  select * into v_grant from public.tournament_plan_grants
  where origin_purchase_id = v_purchase.id for update;
  if v_grant.id is null then
    raise exception using errcode = '55000', message = 'TORNEOS_PURCHASE_GRANT_MISSING';
  end if;
  v_event_type := case p_action
    when 'chargeback_disputed' then 'suspended'
    when 'chargeback_restored' then 'restored'
    else 'revoked' end;
  v_reason_code := case p_action
    when 'refund' then 'total_refund'
    when 'chargeback_disputed' then 'chargeback_disputed'
    when 'chargeback_restored' then 'chargeback_restored'
    else 'chargeback_buyer_won' end;
  if (select event_type from public.tournament_plan_grant_events
      where grant_id = v_grant.id order by id desc limit 1) = v_event_type then
    return public.tournament_purchase_projection(v_purchase) || jsonb_build_object('idempotentReplay',true);
  end if;
  insert into public.tournament_plan_grant_events (
    grant_id,purchase_id,event_type,reason_code,reason,actor_type
  ) values (v_grant.id,v_purchase.id,v_event_type,v_reason_code,btrim(p_reason),'provider');
  update public.tournament_purchases set
    status = case p_action
      when 'refund' then 'refunded'
      when 'chargeback_restored' then 'approved'
      else 'charged_back' end,
    provider_status = p_action,
    refunded_at = case when p_action = 'refund' then now() else refunded_at end,
    charged_back_at = case when p_action in ('chargeback_disputed','chargeback_buyer_won')
      then coalesce(charged_back_at,now()) else charged_back_at end,
    last_verified_at = now()
  where id = v_purchase.id returning * into v_purchase;
  insert into public.tournament_purchase_events (
    purchase_id,organization_id,event_type,from_status,to_status,provider_status,
    actor_type,metadata
  ) values (
    v_purchase.id,v_purchase.organization_id,'payment.' || p_action,v_from_status,
    v_purchase.status,p_action,'provider',jsonb_build_object('grantEvent',v_event_type)
  );
  insert into public.tournament_audit_log (
    organization_id,actor_user_id,actor_type,action,resource_type,resource_id,
    tournament_id,metadata
  ) values (
    v_purchase.organization_id,null,'system','billing.' || p_action,'tournament_purchase',
    v_purchase.id,v_purchase.tournament_id,jsonb_build_object('grantId',v_grant.id)
  );
  return public.tournament_purchase_projection(v_purchase) || jsonb_build_object('idempotentReplay',false);
end;
$$;

create or replace function public.cancel_tournament_purchase(p_purchase_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_purchase public.tournament_purchases%rowtype; v_from_status text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_purchase from public.tournament_purchases
  where id = p_purchase_id for update;
  if v_purchase.id is null or not (
    v_purchase.buyer_user_id = auth.uid()
    or public.has_tournament_organization_capability(v_purchase.organization_id,'billing.manage')
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_PURCHASE_FORBIDDEN';
  end if;
  if v_purchase.status = 'cancelled' then
    return public.tournament_purchase_projection(v_purchase) || jsonb_build_object('idempotentReplay',true);
  end if;
  if v_purchase.status not in ('created','preference_created','pending') then
    raise exception using errcode = '55000', message = 'TORNEOS_PURCHASE_TRANSITION_INVALID';
  end if;
  v_from_status := v_purchase.status;
  update public.tournament_purchases set
    status = 'cancelled',provider_status = 'cancelled',cancelled_at = now()
  where id = v_purchase.id returning * into v_purchase;
  insert into public.tournament_purchase_events (
    purchase_id,organization_id,event_type,from_status,to_status,provider_status,
    actor_type,actor_user_id
  ) values (
    v_purchase.id,v_purchase.organization_id,'purchase.cancelled',v_from_status,
    'cancelled','cancelled','user',auth.uid()
  );
  return public.tournament_purchase_projection(v_purchase) || jsonb_build_object('idempotentReplay',false);
end;
$$;

-- -------------------------------------------------------------------------
-- 7. Effective projection: unassigned is not FREE; suspended/revoked purchase
-- grants do not grant Premium. First-Free and legacy grants remain untouched.
-- -------------------------------------------------------------------------

create or replace function public.resolve_effective_tournament_entitlements_at(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_as_of timestamptz,
  p_participant_only boolean default false
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_plan text := 'PREMIUM_REQUIRED';
  v_source text := 'unassigned';
  v_policy public.tournament_plan_catalog%rowtype;
  v_offer public.tournament_commercial_offers%rowtype;
  v_capabilities jsonb := '{}'::jsonb;
  v_admin_usage integer := 0;
begin
  if p_organization_id is null or p_as_of is null then return null; end if;
  if p_tournament_id is not null and not exists (
    select 1 from public.tournaments tournament
    where tournament.organization_id = p_organization_id and tournament.id = p_tournament_id
  ) then return null; end if;
  if p_tournament_id is not null then
    select grant_row.plan_code,grant_row.source into v_plan,v_source
    from public.tournament_plan_grants grant_row
    where grant_row.organization_id = p_organization_id
      and grant_row.tournament_id = p_tournament_id
      and public.is_tournament_plan_grant_effective(grant_row.id)
    order by case grant_row.plan_code when 'PREMIUM' then 0 else 1 end,
      case grant_row.source when 'purchase' then 0 when 'legacy_grant' then 1 else 2 end,
      grant_row.granted_at,grant_row.id limit 1;
    if not found then v_plan := 'PREMIUM_REQUIRED'; v_source := 'unassigned'; end if;
  end if;
  select * into v_policy from public.tournament_plan_catalog
  where plan_code = case when v_plan = 'PREMIUM_REQUIRED' then 'FREE' else v_plan end;
  select offer.* into v_offer from public.tournament_commercial_offers offer
  where offer.product_code = 'torneos_premium'
    and offer.valid_from <= p_as_of and (offer.valid_until is null or offer.valid_until > p_as_of)
  order by (offer.availability = 'available') desc,offer.valid_from desc,offer.offer_version desc limit 1;
  select coalesce(jsonb_object_agg(catalog.capability,
    case when v_plan = 'PREMIUM_REQUIRED' then false
      when p_participant_only and not catalog.participant_enabled then false
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
    'schemaVersion',3,'plan',v_plan,'assignmentSource',v_source,
    'requiresPremium',v_plan = 'PREMIUM_REQUIRED',
    'scope',jsonb_build_object('type','tournament_edition','organizationId',p_organization_id,
      'tournamentId',p_tournament_id,'audience',case when p_participant_only then 'participant' else 'organization_member' end),
    'pricing',jsonb_build_object('currency',v_offer.currency,'listPrice',v_offer.list_amount,
      'launchPrice',v_offer.amount,'billingModel','one_time','scope','tournament'),
    'offer',jsonb_build_object('code',v_offer.offer_code,'version',v_offer.offer_version,
      'label',v_offer.offer_label,'validUntil',v_offer.valid_until,'availability',v_offer.availability),
    'capabilities',v_capabilities,
    'limits',jsonb_build_object('galleryAssetLimit',case when v_plan = 'PREMIUM_REQUIRED' then 0 else v_policy.gallery_asset_limit end,
      'administrativeCollaboratorLimit',case when v_plan = 'PREMIUM_REQUIRED' then 0 else v_policy.administrative_collaborator_limit end),
    'media',jsonb_build_object('galleryAssetLimit',case when v_plan = 'PREMIUM_REQUIRED' then 0 else v_policy.gallery_asset_limit end,
      'essentialAssetsCountTowardLimit',false),
    'administration',jsonb_build_object('currentAdministrativeSeatUsage',v_admin_usage,
      'administrativeSeatLimit',case when v_plan = 'PREMIUM_REQUIRED' then 0 else v_policy.administrative_collaborator_limit end,
      'ownerIncluded',true,'ownerCountsTowardLimit',false),
    'branding',jsonb_build_object('mode',case when v_plan = 'PREMIUM_REQUIRED' then 'locked' else v_policy.branding_mode end,
      'arma2Visible',true,'label',case when v_plan = 'PREMIUM' then 'Powered by Arma2' else 'Arma2 Torneos' end)
  );
end;
$$;

-- -------------------------------------------------------------------------
-- 8. Second-edition gate. Basic tournament/category configuration stays
-- available in draft; registration and competitive data require a real grant.
-- -------------------------------------------------------------------------

create or replace function public.enforce_tournament_premium_gate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_organization_id uuid; v_tournament_id uuid;
begin
  v_organization_id := new.organization_id;
  v_tournament_id := new.tournament_id;
  if public.tournament_requires_premium(v_organization_id,v_tournament_id) then
    raise exception using errcode = '42501', message = 'TORNEOS_PREMIUM_REQUIRED';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_tournament_status_premium_gate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status not in ('draft','archived')
    and public.tournament_requires_premium(new.organization_id,new.id) then
    raise exception using errcode = '42501', message = 'TORNEOS_PREMIUM_REQUIRED';
  end if;
  return new;
end;
$$;

create trigger tournaments_premium_status_gate
before update of status on public.tournaments
for each row when (new.status is distinct from old.status)
execute function public.enforce_tournament_status_premium_gate();
create trigger tournament_team_entries_premium_gate
before insert or update on public.tournament_team_entries
for each row execute function public.enforce_tournament_premium_gate();

-- -------------------------------------------------------------------------
-- 9. Exact function privileges.
-- -------------------------------------------------------------------------

revoke all on function public.reject_append_only_tournament_commercial_mutation() from public,anon,authenticated,service_role;
revoke all on function public.protect_referenced_tournament_offer() from public,anon,authenticated,service_role;
revoke all on function public.protect_tournament_purchase_snapshots() from public,anon,authenticated,service_role;
revoke all on function public.enforce_tournament_purchase_transition() from public,anon,authenticated,service_role;
revoke all on function public.is_tournament_plan_grant_effective(uuid) from public,anon,authenticated;
revoke all on function public.tournament_requires_premium(uuid,uuid) from public,anon,authenticated;
revoke all on function public.tournament_purchase_projection(public.tournament_purchases) from public,anon,authenticated;
revoke all on function public.enforce_tournament_premium_gate() from public,anon,authenticated,service_role;
revoke all on function public.enforce_tournament_status_premium_gate() from public,anon,authenticated,service_role;
revoke all on function public.get_public_tournament_commercial_catalog(integer) from public;
revoke all on function public.get_tournament_purchase(uuid) from public,anon;
revoke all on function public.create_fake_tournament_purchase(uuid,uuid,text,uuid,text) from public,anon;
revoke all on function public.activate_verified_fake_tournament_purchase(uuid,text,text) from public,anon,authenticated;
revoke all on function public.apply_fake_tournament_payment_status(uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.apply_tournament_purchase_reversal(uuid,text,text) from public,anon,authenticated;
revoke all on function public.cancel_tournament_purchase(uuid) from public,anon;
revoke all on function public.grant_tournament_premium(uuid,uuid,text,text) from service_role;

grant execute on function public.get_public_tournament_commercial_catalog(integer) to anon,authenticated,service_role;
grant execute on function public.get_tournament_purchase(uuid) to authenticated,service_role;
grant execute on function public.create_fake_tournament_purchase(uuid,uuid,text,uuid,text) to authenticated,service_role;
grant execute on function public.is_tournament_plan_grant_effective(uuid) to service_role;
grant execute on function public.tournament_requires_premium(uuid,uuid) to service_role;
grant execute on function public.tournament_purchase_projection(public.tournament_purchases) to service_role;
grant execute on function public.activate_verified_fake_tournament_purchase(uuid,text,text) to service_role;
grant execute on function public.apply_fake_tournament_payment_status(uuid,text,text,text,text) to service_role;
grant execute on function public.apply_tournament_purchase_reversal(uuid,text,text) to service_role;
grant execute on function public.cancel_tournament_purchase(uuid) to authenticated,service_role;

comment on table public.tournament_purchases is
  'Private payment workflow. Snapshots are immutable; effective Premium is resolved from grants, never this table.';
comment on table public.tournament_purchase_events is
  'Append-only payment state history with limited provider metadata.';
comment on table public.tournament_plan_grant_events is
  'Append-only lifecycle for purchase grants. Suspension and revocation never delete the original grant.';

commit;
