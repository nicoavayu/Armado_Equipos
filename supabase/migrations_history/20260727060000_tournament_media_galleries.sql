-- Arma2 Torneos: private media galleries, upload contracts and moderation.
-- Local/dedicated staging only. Never apply this migration to production.
-- The private bucket `tournament-media` is intentionally NOT created here.

create extension if not exists pgcrypto;

create table public.tournament_media_galleries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.tournament_organizations(id) on delete restrict,
  season_id uuid not null
    references public.tournament_seasons(id) on delete restrict,
  tournament_id uuid not null,
  category_id uuid references public.tournament_categories(id) on delete restrict,
  round_id uuid references public.tournament_rounds(id) on delete restrict,
  match_id uuid references public.tournament_matches(id) on delete restrict,
  title text not null,
  description text,
  status text not null default 'draft',
  visibility text not null default 'tournament_participants',
  cover_asset_id uuid,
  minor_restriction boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  published_by uuid references auth.users(id) on delete restrict,
  version integer not null default 1,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  published_at timestamptz,
  archived_at timestamptz,
  revoked_at timestamptz,
  constraint tournament_media_galleries_tournament_fk
    foreign key (organization_id, tournament_id, season_id)
    references public.tournaments(organization_id, id, season_id) on delete restrict,
  constraint tournament_media_galleries_title_check
    check (title = btrim(title) and char_length(title) between 3 and 120),
  constraint tournament_media_galleries_description_check
    check (description is null or (
      description = btrim(description) and char_length(description) <= 1200
    )),
  constraint tournament_media_galleries_status_check
    check (status in ('draft','under_review','published','archived','revoked')),
  constraint tournament_media_galleries_visibility_check
    check (visibility in (
      'organization','tournament_participants','match_participants',
      'related_teams','administrative_private'
    )),
  constraint tournament_media_galleries_version_check check (version > 0),
  constraint tournament_media_galleries_lifecycle_check check (
    (status = 'draft' and submitted_at is null and published_at is null
      and archived_at is null and revoked_at is null)
    or (status = 'under_review' and submitted_at is not null
      and published_at is null and archived_at is null and revoked_at is null)
    or (status = 'published' and submitted_at is not null
      and published_at is not null and published_by is not null
      and archived_at is null and revoked_at is null)
    or (status = 'archived' and archived_at is not null and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  ),
  constraint tournament_media_galleries_scope_unique
    unique (organization_id, tournament_id, id),
  constraint tournament_media_galleries_creation_unique
    unique (organization_id, created_by, idempotency_key)
);

create index tournament_media_galleries_admin_idx
  on public.tournament_media_galleries
  (organization_id, tournament_id, status, updated_at desc);
create index tournament_media_galleries_participant_idx
  on public.tournament_media_galleries
  (tournament_id, category_id, status, visibility, published_at desc)
  where status = 'published';
create index tournament_media_galleries_match_idx
  on public.tournament_media_galleries (match_id, status, published_at desc)
  where match_id is not null;

create table public.tournament_media_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  gallery_id uuid not null,
  provider text not null default 'supabase',
  bucket text not null default 'tournament-media',
  internal_path text not null,
  safe_name text not null,
  detected_mime text not null,
  byte_size bigint not null,
  width integer not null,
  height integer not null,
  checksum_sha256 text not null,
  status text not null default 'pending_review',
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  published_at timestamptz,
  hidden_at timestamptz,
  revoked_at timestamptz,
  failure_code text,
  constraint tournament_media_assets_gallery_fk
    foreign key (organization_id, tournament_id, gallery_id)
    references public.tournament_media_galleries
      (organization_id, tournament_id, id) on delete restrict,
  constraint tournament_media_assets_provider_check
    check (provider = 'supabase' and bucket = 'tournament-media'),
  constraint tournament_media_assets_path_check
    check (
      internal_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
      and internal_path not like '%..%'
    ),
  constraint tournament_media_assets_safe_name_check
    check (safe_name ~ '^foto-[0-9a-f]{12}\.(jpg|png|webp)$'),
  constraint tournament_media_assets_mime_check
    check (detected_mime in ('image/jpeg','image/png','image/webp')),
  constraint tournament_media_assets_size_check
    check (byte_size between 1 and 12582912),
  constraint tournament_media_assets_dimensions_check
    check (
      width between 1 and 12000 and height between 1 and 12000
      and width::bigint * height::bigint <= 36000000
    ),
  constraint tournament_media_assets_checksum_check
    check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  constraint tournament_media_assets_status_check
    check (status in (
      'uploading','processing','pending_review','approved','published',
      'rejected','hidden','revoked','failed'
    )),
  constraint tournament_media_assets_failure_check
    check (failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  constraint tournament_media_assets_gallery_id_unique unique (gallery_id, id),
  constraint tournament_media_assets_path_unique unique (bucket, internal_path)
);

create index tournament_media_assets_gallery_status_idx
  on public.tournament_media_assets (gallery_id, status, created_at desc);
create unique index tournament_media_assets_checksum_active_unique
  on public.tournament_media_assets (organization_id, checksum_sha256)
  where status <> 'revoked';
create index tournament_media_assets_review_idx
  on public.tournament_media_assets (organization_id, status, created_at)
  where status in ('pending_review','hidden');

alter table public.tournament_media_galleries
  add constraint tournament_media_galleries_cover_fk
  foreign key (cover_asset_id)
  references public.tournament_media_assets(id) on delete restrict;

create table public.tournament_media_gallery_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  gallery_id uuid not null,
  asset_id uuid not null,
  sort_order integer not null default 0,
  caption text,
  added_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_media_gallery_items_gallery_fk
    foreign key (organization_id, tournament_id, gallery_id)
    references public.tournament_media_galleries
      (organization_id, tournament_id, id) on delete restrict,
  constraint tournament_media_gallery_items_asset_fk
    foreign key (gallery_id, asset_id)
    references public.tournament_media_assets(gallery_id, id) on delete restrict,
  constraint tournament_media_gallery_items_order_check check (sort_order >= 0),
  constraint tournament_media_gallery_items_caption_check
    check (caption is null or (
      caption = btrim(caption) and char_length(caption) <= 500
    )),
  constraint tournament_media_gallery_items_unique unique (gallery_id, asset_id),
  constraint tournament_media_gallery_items_order_unique unique (gallery_id, sort_order)
);

create index tournament_media_gallery_items_order_idx
  on public.tournament_media_gallery_items (gallery_id, sort_order, created_at);

create table public.tournament_media_relations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  category_id uuid,
  asset_id uuid not null references public.tournament_media_assets(id) on delete restrict,
  relation_type text not null,
  match_id uuid references public.tournament_matches(id) on delete restrict,
  team_entry_id uuid references public.tournament_team_entries(id) on delete restrict,
  roster_player_id uuid references public.tournament_roster_players(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint tournament_media_relations_type_check
    check (relation_type in ('match','team','player')),
  constraint tournament_media_relations_exact_target_check check (
    (relation_type = 'match' and match_id is not null
      and team_entry_id is null and roster_player_id is null)
    or (relation_type = 'team' and match_id is null
      and team_entry_id is not null and roster_player_id is null)
    or (relation_type = 'player' and match_id is null
      and team_entry_id is not null and roster_player_id is not null)
  )
);

create unique index tournament_media_relations_unique
  on public.tournament_media_relations
  (asset_id, relation_type, coalesce(match_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(team_entry_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(roster_player_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index tournament_media_relations_scope_idx
  on public.tournament_media_relations
  (organization_id, tournament_id, category_id, relation_type);

create table public.tournament_media_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  asset_id uuid not null references public.tournament_media_assets(id) on delete restrict,
  kind text not null,
  provider text not null default 'supabase',
  bucket text not null default 'tournament-media',
  internal_path text not null,
  detected_mime text not null,
  byte_size bigint,
  width integer,
  height integer,
  checksum_sha256 text,
  metadata_stripped boolean not null default true,
  status text not null default 'ready',
  created_at timestamptz not null default now(),
  constraint tournament_media_variants_kind_check
    check (kind in ('thumbnail','grid','detail','original')),
  constraint tournament_media_variants_provider_check
    check (provider = 'supabase' and bucket = 'tournament-media'),
  constraint tournament_media_variants_path_check
    check (
      internal_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}-(thumbnail|grid|detail|original)\.(jpg|png|webp)$'
      and internal_path not like '%..%'
    ),
  constraint tournament_media_variants_mime_check
    check (detected_mime in ('image/jpeg','image/png','image/webp')),
  constraint tournament_media_variants_payload_check check (
    (
      status = 'processing'
      and byte_size is null and width is null and height is null
      and checksum_sha256 is null
    )
    or (
      status in ('ready','failed','revoked')
      and byte_size between 1 and 12582912
      and width > 0 and height > 0
      and width::bigint * height::bigint <= 36000000
      and checksum_sha256 ~ '^[0-9a-f]{64}$'
    )
  ),
  constraint tournament_media_variants_status_check
    check (status in ('processing','ready','failed','revoked')),
  constraint tournament_media_variants_unique unique (asset_id, kind),
  constraint tournament_media_variants_path_unique unique (bucket, internal_path)
);

create index tournament_media_variants_asset_idx
  on public.tournament_media_variants (asset_id, kind)
  where status = 'ready';

create table public.tournament_media_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  gallery_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  token_hash text not null,
  provider text not null default 'supabase',
  bucket text not null default 'tournament-media',
  internal_path text not null,
  safe_name text not null,
  requested_mime text not null,
  requested_size bigint not null,
  max_size bigint not null default 12582912,
  status text not null default 'issued',
  idempotency_key uuid not null,
  quota_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  asset_id uuid references public.tournament_media_assets(id) on delete restrict,
  constraint tournament_media_upload_sessions_gallery_fk
    foreign key (organization_id, tournament_id, gallery_id)
    references public.tournament_media_galleries
      (organization_id, tournament_id, id) on delete restrict,
  constraint tournament_media_upload_sessions_token_check
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint tournament_media_upload_sessions_provider_check
    check (provider = 'supabase' and bucket = 'tournament-media'),
  constraint tournament_media_upload_sessions_path_check
    check (
      internal_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
      and internal_path not like '%..%'
    ),
  constraint tournament_media_upload_sessions_safe_name_check
    check (safe_name ~ '^foto-[0-9a-f]{12}\.(jpg|png|webp)$'),
  constraint tournament_media_upload_sessions_mime_check
    check (requested_mime in ('image/jpeg','image/png','image/webp')),
  constraint tournament_media_upload_sessions_size_check
    check (requested_size between 1 and max_size and max_size <= 12582912),
  constraint tournament_media_upload_sessions_status_check
    check (status in ('issued','uploaded','consumed','expired','revoked','failed')),
  constraint tournament_media_upload_sessions_expiry_check
    check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
  constraint tournament_media_upload_sessions_consumption_check check (
    (status = 'consumed' and consumed_at is not null and asset_id is not null)
    or (status <> 'consumed' and consumed_at is null and asset_id is null)
  ),
  constraint tournament_media_upload_sessions_quota_check
    check (jsonb_typeof(quota_snapshot) = 'object' and pg_column_size(quota_snapshot) <= 4096),
  constraint tournament_media_upload_sessions_request_unique
    unique (organization_id, requested_by, idempotency_key),
  constraint tournament_media_upload_sessions_token_unique unique (token_hash)
);

create index tournament_media_upload_sessions_actor_idx
  on public.tournament_media_upload_sessions
  (requested_by, status, expires_at);
create index tournament_media_upload_sessions_gallery_idx
  on public.tournament_media_upload_sessions
  (gallery_id, status, created_at desc);

create table public.tournament_media_moderation_actions (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  tournament_id uuid not null,
  gallery_id uuid not null,
  asset_id uuid not null,
  action text not null,
  previous_status text not null,
  resulting_status text not null,
  reason text,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint tournament_media_moderation_actions_asset_fk
    foreign key (gallery_id, asset_id)
    references public.tournament_media_assets(gallery_id, id) on delete restrict,
  constraint tournament_media_moderation_actions_action_check
    check (action in (
      'approve','reject','hide','restore','revoke','request_deletion'
    )),
  constraint tournament_media_moderation_actions_status_check
    check (
      previous_status in (
        'pending_review','approved','published','rejected','hidden','revoked'
      )
      and resulting_status in (
        'approved','published','rejected','hidden','revoked'
      )
    ),
  constraint tournament_media_moderation_actions_reason_check
    check (reason is null or (
      reason = btrim(reason) and char_length(reason) between 3 and 1000
    ))
);

create index tournament_media_moderation_actions_asset_idx
  on public.tournament_media_moderation_actions (asset_id, created_at desc);

create table public.tournament_media_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  asset_id uuid not null references public.tournament_media_assets(id) on delete restrict,
  roster_player_id uuid references public.tournament_roster_players(id) on delete restrict,
  subject_user_id uuid references auth.users(id) on delete restrict,
  use_scope text not null,
  status text not null default 'unknown',
  legal_basis text,
  managed_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint tournament_media_consents_subject_check
    check (roster_player_id is not null or subject_user_id is not null),
  constraint tournament_media_consents_use_check
    check (use_scope in (
      'view_internal','share_internal','social_future',
      'promotion_future','commercial'
    )),
  constraint tournament_media_consents_status_check
    check (status in ('unknown','allowed','denied','revoked','not_required')),
  constraint tournament_media_consents_legal_basis_check check (
    (status = 'not_required' and legal_basis is not null
      and legal_basis = btrim(legal_basis)
      and char_length(legal_basis) between 10 and 1000)
    or (status <> 'not_required' and legal_basis is null)
  ),
  constraint tournament_media_consents_revocation_check check (
    (status = 'revoked' and revoked_at is not null)
    or (status <> 'revoked' and revoked_at is null)
  )
);

create unique index tournament_media_consents_subject_unique
  on public.tournament_media_consents (
    asset_id,
    coalesce(roster_player_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(subject_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    use_scope
  );
create index tournament_media_consents_asset_idx
  on public.tournament_media_consents (asset_id, use_scope, status);

create table public.tournament_media_consent_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  tournament_id uuid not null,
  consent_id uuid not null
    references public.tournament_media_consents(id) on delete restrict,
  asset_id uuid not null references public.tournament_media_assets(id) on delete restrict,
  roster_player_id uuid references public.tournament_roster_players(id) on delete restrict,
  subject_user_id uuid references auth.users(id) on delete restrict,
  use_scope text not null,
  previous_status text,
  resulting_status text not null,
  legal_basis text,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint tournament_media_consent_events_subject_check
    check (roster_player_id is not null or subject_user_id is not null),
  constraint tournament_media_consent_events_use_check
    check (use_scope in (
      'view_internal','share_internal','social_future',
      'promotion_future','commercial'
    )),
  constraint tournament_media_consent_events_status_check check (
    (previous_status is null or previous_status in (
      'unknown','allowed','denied','revoked','not_required'
    ))
    and resulting_status in ('unknown','allowed','denied','revoked','not_required')
  )
);

create index tournament_media_consent_events_consent_idx
  on public.tournament_media_consent_events (consent_id, created_at desc);

create table public.tournament_media_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  gallery_id uuid not null,
  asset_id uuid not null,
  reporter_user_id uuid not null references auth.users(id) on delete restrict,
  reason text not null,
  detail text,
  request_hide boolean not null default false,
  status text not null default 'open',
  idempotency_key uuid not null,
  handled_by uuid references auth.users(id) on delete restrict,
  resolution text,
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  constraint tournament_media_reports_asset_fk
    foreign key (gallery_id, asset_id)
    references public.tournament_media_assets(gallery_id, id) on delete restrict,
  constraint tournament_media_reports_reason_check
    check (reason in (
      'do_not_want_to_appear','incorrect_identification','privacy',
      'inappropriate_content','other'
    )),
  constraint tournament_media_reports_detail_check
    check (detail is null or (
      detail = btrim(detail) and char_length(detail) between 3 and 1000
    )),
  constraint tournament_media_reports_status_check
    check (status in ('open','under_review','resolved','dismissed')),
  constraint tournament_media_reports_resolution_check check (
    (status in ('resolved','dismissed') and handled_by is not null
      and handled_at is not null and resolution is not null
      and resolution = btrim(resolution)
      and char_length(resolution) between 3 and 1000)
    or (status in ('open','under_review') and handled_at is null)
  ),
  constraint tournament_media_reports_request_unique
    unique (reporter_user_id, idempotency_key)
);

create index tournament_media_reports_review_idx
  on public.tournament_media_reports
  (organization_id, status, created_at);
create index tournament_media_reports_rate_idx
  on public.tournament_media_reports (reporter_user_id, created_at desc);

create table public.tournament_media_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  gallery_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null default 'photographer',
  can_upload boolean not null default true,
  status text not null default 'active',
  assigned_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint tournament_media_assignments_gallery_fk
    foreign key (organization_id, tournament_id, gallery_id)
    references public.tournament_media_galleries
      (organization_id, tournament_id, id) on delete restrict,
  constraint tournament_media_assignments_role_check check (role = 'photographer'),
  constraint tournament_media_assignments_status_check
    check (status in ('active','revoked')),
  constraint tournament_media_assignments_revocation_check check (
    (status = 'revoked' and revoked_at is not null)
    or (status = 'active' and revoked_at is null)
  ),
  constraint tournament_media_assignments_unique unique (gallery_id, user_id)
);

create index tournament_media_assignments_user_idx
  on public.tournament_media_assignments (user_id, status, gallery_id);

alter table public.tournament_media_galleries enable row level security;
alter table public.tournament_media_assets enable row level security;
alter table public.tournament_media_gallery_items enable row level security;
alter table public.tournament_media_relations enable row level security;
alter table public.tournament_media_variants enable row level security;
alter table public.tournament_media_upload_sessions enable row level security;
alter table public.tournament_media_moderation_actions enable row level security;
alter table public.tournament_media_consents enable row level security;
alter table public.tournament_media_consent_events enable row level security;
alter table public.tournament_media_reports enable row level security;
alter table public.tournament_media_assignments enable row level security;

revoke all on table public.tournament_media_galleries from anon,authenticated;
revoke all on table public.tournament_media_assets from anon,authenticated;
revoke all on table public.tournament_media_gallery_items from anon,authenticated;
revoke all on table public.tournament_media_relations from anon,authenticated;
revoke all on table public.tournament_media_variants from anon,authenticated;
revoke all on table public.tournament_media_upload_sessions from anon,authenticated;
revoke all on table public.tournament_media_moderation_actions from anon,authenticated;
revoke all on table public.tournament_media_consents from anon,authenticated;
revoke all on table public.tournament_media_consent_events from anon,authenticated;
revoke all on table public.tournament_media_reports from anon,authenticated;
revoke all on table public.tournament_media_assignments from anon,authenticated;

create or replace function public.touch_tournament_media_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tournament_media_galleries_touch_updated_at
before update on public.tournament_media_galleries
for each row execute function public.touch_tournament_media_updated_at();
create trigger tournament_media_assets_touch_updated_at
before update on public.tournament_media_assets
for each row execute function public.touch_tournament_media_updated_at();
create trigger tournament_media_gallery_items_touch_updated_at
before update on public.tournament_media_gallery_items
for each row execute function public.touch_tournament_media_updated_at();
create trigger tournament_media_consents_touch_updated_at
before update on public.tournament_media_consents
for each row execute function public.touch_tournament_media_updated_at();

create or replace function public.tournament_media_role_capabilities(p_role text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'owner' then array[
      'media.read','media.create_gallery','media.update_gallery','media.upload',
      'media.review','media.publish','media.archive','media.revoke',
      'media.set_cover','media.tag_team','media.tag_player',
      'media.manage_consent','media.handle_reports'
    ]::text[]
    when 'admin' then array[
      'media.read','media.create_gallery','media.update_gallery','media.upload',
      'media.review','media.publish','media.archive','media.revoke',
      'media.set_cover','media.tag_team','media.tag_player',
      'media.manage_consent','media.handle_reports'
    ]::text[]
    when 'collaborator' then array['media.read']::text[]
    else array[]::text[]
  end;
$$;

create or replace function public.has_tournament_media_capability(
  p_organization_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.tournament_organization_members membership
    join public.tournament_organizations organization
      on organization.id = membership.organization_id
    where membership.organization_id = p_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and organization.status = 'active'
      and p_capability = any(public.tournament_media_role_capabilities(membership.role))
  );
$$;

create or replace function public.has_tournament_media_assignment(
  p_gallery_id uuid,
  p_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.tournament_media_assignments assignment
    join public.tournament_media_galleries gallery on gallery.id = assignment.gallery_id
    join public.tournament_organizations organization
      on organization.id = assignment.organization_id
    where assignment.gallery_id = p_gallery_id
      and assignment.user_id = auth.uid()
      and assignment.status = 'active'
      and gallery.status in ('draft','under_review')
      and organization.status = 'active'
      and p_action = 'upload'
      and assignment.can_upload
  );
$$;

create or replace function public.tournament_media_user_can_upload(
  p_user_id uuid,
  p_gallery_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from public.tournament_media_galleries gallery
    join public.tournament_organizations organization
      on organization.id = gallery.organization_id
    where gallery.id = p_gallery_id
      and gallery.status in ('draft','under_review')
      and organization.status = 'active'
      and (
        exists (
          select 1
          from public.tournament_organization_members membership
          where membership.organization_id = gallery.organization_id
            and membership.user_id = p_user_id
            and membership.status = 'active'
            and 'media.upload' = any(
              public.tournament_media_role_capabilities(membership.role)
            )
        )
        or exists (
          select 1
          from public.tournament_media_assignments assignment
          where assignment.gallery_id = gallery.id
            and assignment.user_id = p_user_id
            and assignment.status = 'active'
            and assignment.can_upload
        )
      )
  );
$$;

create or replace function public.current_user_has_media_team_relation(
  p_team_entry_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (
      select 1 from public.tournament_team_managers manager
      where manager.team_entry_id = p_team_entry_id
        and manager.user_id = auth.uid()
        and manager.status = 'active'
        and manager.role in ('captain','delegate')
    )
    or exists (
      select 1
      from public.get_my_current_tournament_roster_players() player
      where player.team_entry_id = p_team_entry_id
    )
  );
$$;

create or replace function public.tournament_media_asset_has_internal_consent(
  p_asset_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.tournament_media_relations relation
    join public.tournament_roster_players player
      on player.id = relation.roster_player_id
    where relation.asset_id = p_asset_id
      and relation.relation_type = 'player'
      and (
        not exists (
          select 1
          from public.tournament_media_consents consent
          where consent.asset_id = relation.asset_id
            and consent.use_scope = 'view_internal'
            and (
              consent.roster_player_id = relation.roster_player_id
              or (
                consent.roster_player_id is null
                and player.arma2_user_id is not null
                and consent.subject_user_id = player.arma2_user_id
              )
            )
            and consent.status in ('allowed','not_required')
        )
        or exists (
          select 1
          from public.tournament_media_consents consent
          where consent.asset_id = relation.asset_id
            and consent.use_scope = 'view_internal'
            and (
              consent.roster_player_id = relation.roster_player_id
              or (
                consent.roster_player_id is null
                and player.arma2_user_id is not null
                and consent.subject_user_id = player.arma2_user_id
              )
            )
            and consent.status not in ('allowed','not_required')
        )
      )
  );
$$;

create or replace function public.can_current_user_read_media_gallery(
  p_gallery_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.tournament_media_galleries gallery
    where gallery.id = p_gallery_id
      and gallery.status = 'published'
      and gallery.visibility <> 'administrative_private'
      and public.can_read_tournament_participant_hub(
        gallery.tournament_id,
        gallery.category_id
      )
      and (
        (
          gallery.visibility = 'organization'
          and public.is_tournament_organization_member(gallery.organization_id)
        )
        or gallery.visibility = 'tournament_participants'
        or (
          gallery.visibility = 'match_participants'
          and gallery.match_id is not null
          and exists (
            select 1
            from public.tournament_matches match
            join public.tournament_competition_participants participant
              on participant.participant_set_id = match.participant_set_id
             and participant.id in (match.home_participant_id,match.away_participant_id)
            where match.id = gallery.match_id
              and public.current_user_has_media_team_relation(participant.team_entry_id)
          )
        )
        or (
          gallery.visibility = 'related_teams'
          and exists (
            select 1
            from public.tournament_media_gallery_items item
            join public.tournament_media_relations relation
              on relation.asset_id = item.asset_id
             and relation.relation_type in ('team','player')
            where item.gallery_id = gallery.id
              and public.current_user_has_media_team_relation(relation.team_entry_id)
          )
        )
      )
  );
$$;

create or replace function public.create_tournament_media_gallery(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid,
  p_round_id uuid,
  p_match_id uuid,
  p_title text,
  p_description text,
  p_visibility text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope record;
  v_existing public.tournament_media_galleries%rowtype;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'TORNEOS_IDEMPOTENCY_REQUIRED';
  end if;

  if not public.has_tournament_media_capability(
    p_organization_id, 'media.create_gallery'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || auth.uid()::text || ':' || p_idempotency_key::text,
      3
    )
  );

  select tournament.season_id
  into v_scope
  from public.tournaments tournament
  where tournament.id = p_tournament_id
    and tournament.organization_id = p_organization_id
    and tournament.status <> 'archived';
  if v_scope.season_id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.tournament_categories category
    where category.id = p_category_id
      and category.organization_id = p_organization_id
      and category.tournament_id = p_tournament_id
      and category.status = 'active'
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_SCOPE_INVALID';
  end if;
  if p_round_id is not null and not exists (
    select 1
    from public.tournament_rounds round
    join public.tournament_fixture_versions fixture
      on fixture.id = round.fixture_version_id
    where round.id = p_round_id
      and round.organization_id = p_organization_id
      and round.tournament_id = p_tournament_id
      and (p_category_id is null or round.category_id = p_category_id)
      and fixture.status = 'published'
      and fixture.invalidated_at is null
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_SCOPE_INVALID';
  end if;
  if p_match_id is not null and not exists (
    select 1
    from public.tournament_matches match
    join public.tournament_fixture_versions fixture
      on fixture.id = match.fixture_version_id
    where match.id = p_match_id
      and match.organization_id = p_organization_id
      and match.tournament_id = p_tournament_id
      and (p_category_id is null or match.category_id = p_category_id)
      and (p_round_id is null or match.round_id = p_round_id)
      and fixture.status = 'published'
      and fixture.invalidated_at is null
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_SCOPE_INVALID';
  end if;
  if p_visibility = 'match_participants' and p_match_id is null then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_VISIBILITY_INVALID';
  end if;

  select * into v_existing
  from public.tournament_media_galleries gallery
  where gallery.organization_id = p_organization_id
    and gallery.created_by = auth.uid()
    and gallery.idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.tournament_id is distinct from p_tournament_id
      or v_existing.category_id is distinct from p_category_id
      or v_existing.round_id is distinct from p_round_id
      or v_existing.match_id is distinct from p_match_id
      or v_existing.title is distinct from btrim(p_title)
      or v_existing.description is distinct from nullif(btrim(p_description),'')
      or v_existing.visibility is distinct from p_visibility
    then
      raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_IDEMPOTENCY_CONFLICT';
    end if;
    return v_existing.id;
  end if;

  insert into public.tournament_media_galleries (
    organization_id,season_id,tournament_id,category_id,round_id,match_id,
    title,description,visibility,created_by,idempotency_key
  ) values (
    p_organization_id,v_scope.season_id,p_tournament_id,p_category_id,p_round_id,
    p_match_id,btrim(p_title),nullif(btrim(p_description),''),
    p_visibility,auth.uid(),p_idempotency_key
  ) returning id into v_id;
  perform public.append_tournament_audit(
    p_organization_id,'media.gallery.created','media_gallery',v_id,
    null,p_tournament_id,jsonb_build_object('visibility',p_visibility)
  );
  return v_id;
end;
$$;

create or replace function public.update_tournament_media_gallery(
  p_gallery_id uuid,
  p_title text,
  p_description text,
  p_visibility text,
  p_submit_for_review boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gallery public.tournament_media_galleries%rowtype;
begin
  select * into v_gallery
  from public.tournament_media_galleries
  where id = p_gallery_id;
  if v_gallery.id is null or not public.has_tournament_media_capability(
    v_gallery.organization_id,'media.update_gallery'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_gallery.organization_id::text,0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_gallery.id::text,1)
  );
  select * into v_gallery
  from public.tournament_media_galleries
  where id = p_gallery_id
  for update;
  if v_gallery.status not in ('draft','under_review') then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_GALLERY_IMMUTABLE';
  end if;
  if p_visibility = 'match_participants' and v_gallery.match_id is null then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_VISIBILITY_INVALID';
  end if;
  update public.tournament_media_galleries
  set title = btrim(p_title),
      description = nullif(btrim(p_description),''),
      visibility = p_visibility,
      status = case when p_submit_for_review then 'under_review' else status end,
      submitted_at = case when p_submit_for_review
        then coalesce(submitted_at,now()) else submitted_at end,
      version = version + 1
  where id = p_gallery_id;
  perform public.append_tournament_audit(
    v_gallery.organization_id,
    case when p_submit_for_review then 'media.gallery.submitted' else 'media.gallery.updated' end,
    'media_gallery',p_gallery_id,null,v_gallery.tournament_id,
    jsonb_build_object('visibility',p_visibility)
  );
  return jsonb_build_object(
    'galleryId',p_gallery_id,
    'status',case when p_submit_for_review then 'under_review' else v_gallery.status end
  );
end;
$$;

create or replace function public.request_tournament_media_upload_session(
  p_gallery_id uuid,
  p_file_name text,
  p_declared_mime text,
  p_byte_size bigint,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gallery public.tournament_media_galleries%rowtype;
  v_existing public.tournament_media_upload_sessions%rowtype;
  v_extension text;
  v_file_id uuid := gen_random_uuid();
  v_token text := encode(public.gen_random_bytes(32),'hex');
  v_safe_name text;
  v_path text;
  v_session_id uuid;
  v_org_bytes bigint;
  v_tournament_bytes bigint;
  v_gallery_bytes bigint;
  v_open_sessions integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_gallery
  from public.tournament_media_galleries
  where id = p_gallery_id;
  if v_gallery.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'TORNEOS_IDEMPOTENCY_REQUIRED';
  end if;

  -- Todas las reservas toman primero organización y luego galería.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_gallery.organization_id::text,0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_gallery_id::text,1)
  );
  select * into v_gallery
  from public.tournament_media_galleries
  where id = p_gallery_id
  for share;
  if not public.tournament_media_user_can_upload(auth.uid(),p_gallery_id) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;

  v_extension := case p_declared_mime
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    else null
  end;
  if v_extension is null
    or p_byte_size is null or p_byte_size < 1 or p_byte_size > 12582912
    or not (
      (p_declared_mime = 'image/jpeg' and lower(p_file_name) ~ '\.(jpe?g)$')
      or (p_declared_mime = 'image/png' and lower(p_file_name) ~ '\.png$')
      or (p_declared_mime = 'image/webp' and lower(p_file_name) ~ '\.webp$')
    )
  then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_FILE_INVALID';
  end if;
  select * into v_existing
  from public.tournament_media_upload_sessions session
  where session.organization_id = v_gallery.organization_id
    and session.requested_by = auth.uid()
    and session.idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.gallery_id is distinct from p_gallery_id
      or v_existing.requested_mime is distinct from p_declared_mime
      or v_existing.requested_size is distinct from p_byte_size
      or right(v_existing.safe_name,char_length(v_extension) + 1)
        is distinct from '.' || v_extension
    then
      raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object(
      'sessionId',v_existing.id,'safeName',v_existing.safe_name,
      'expiresAt',v_existing.expires_at,'token',null,'reused',true,
      'uploadReady',false,'requiresStagingStorageSigner',true
    );
  end if;

  select
    coalesce((
      select sum(asset.byte_size)
      from public.tournament_media_assets asset
      where asset.organization_id = v_gallery.organization_id
        and asset.status <> 'revoked'
    ),0) + coalesce((
      select sum(session.requested_size)
      from public.tournament_media_upload_sessions session
      where session.organization_id = v_gallery.organization_id
        and session.status = 'issued' and session.expires_at > now()
    ),0)
  into v_org_bytes;
  select
    coalesce((
      select sum(asset.byte_size)
      from public.tournament_media_assets asset
      where asset.tournament_id = v_gallery.tournament_id
        and asset.status <> 'revoked'
    ),0) + coalesce((
      select sum(session.requested_size)
      from public.tournament_media_upload_sessions session
      where session.tournament_id = v_gallery.tournament_id
        and session.status = 'issued' and session.expires_at > now()
    ),0)
  into v_tournament_bytes;
  select
    coalesce((
      select sum(asset.byte_size)
      from public.tournament_media_assets asset
      where asset.gallery_id = p_gallery_id
        and asset.status <> 'revoked'
    ),0) + coalesce((
      select sum(session.requested_size)
      from public.tournament_media_upload_sessions session
      where session.gallery_id = p_gallery_id
        and session.status = 'issued' and session.expires_at > now()
    ),0)
  into v_gallery_bytes;
  select count(*) into v_open_sessions
  from public.tournament_media_upload_sessions session
  where session.requested_by = auth.uid()
    and session.status = 'issued'
    and session.expires_at > now();
  if v_open_sessions >= 40
    or v_org_bytes + p_byte_size > 5368709120
    or v_tournament_bytes + p_byte_size > 2147483648
    or v_gallery_bytes + p_byte_size > 536870912
  then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_QUOTA_EXCEEDED';
  end if;

  v_safe_name := 'foto-' || substr(replace(v_file_id::text,'-',''),1,12) || '.' || v_extension;
  v_path := v_gallery.organization_id::text || '/' || v_gallery.tournament_id::text
    || '/' || v_gallery.id::text || '/' || v_file_id::text || '.' || v_extension;
  insert into public.tournament_media_upload_sessions (
    organization_id,tournament_id,gallery_id,requested_by,token_hash,
    internal_path,safe_name,requested_mime,requested_size,idempotency_key,
    quota_snapshot,expires_at
  ) values (
    v_gallery.organization_id,v_gallery.tournament_id,v_gallery.id,auth.uid(),
    encode(public.digest(v_token,'sha256'),'hex'),v_path,v_safe_name,
    p_declared_mime,p_byte_size,p_idempotency_key,
    jsonb_build_object(
      'organizationBytes',v_org_bytes,'tournamentBytes',v_tournament_bytes,
      'galleryBytes',v_gallery_bytes,'maxFileBytes',12582912
    ),
    now() + interval '10 minutes'
  ) returning id into v_session_id;
  perform public.append_tournament_audit(
    v_gallery.organization_id,'media.upload_session.issued',
    'media_upload_session',v_session_id,null,v_gallery.tournament_id,
    jsonb_build_object('galleryId',v_gallery.id,'byteSize',p_byte_size)
  );
  return jsonb_build_object(
    'sessionId',v_session_id,'safeName',v_safe_name,
    'expiresAt',now() + interval '10 minutes','token',v_token,'reused',false,
    'uploadReady',false,'requiresStagingStorageSigner',true
  );
end;
$$;

create or replace function public.complete_tournament_media_upload(
  p_session_id uuid,
  p_token text,
  p_detected_mime text,
  p_byte_size bigint,
  p_width integer,
  p_height integer,
  p_checksum_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.tournament_media_upload_sessions%rowtype;
  v_gallery public.tournament_media_galleries%rowtype;
  v_asset_id uuid;
  v_sort integer;
  v_extension text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_session
  from public.tournament_media_upload_sessions
  where id = p_session_id;
  if v_session.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_UPLOAD_SESSION_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_session.organization_id::text,0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_session.gallery_id::text,1)
  );
  select * into v_gallery
  from public.tournament_media_galleries
  where id = v_session.gallery_id
  for share;
  select * into v_session
  from public.tournament_media_upload_sessions
  where id = p_session_id
  for update;
  if v_session.id is null
    or v_session.status <> 'issued'
    or v_session.expires_at <= now()
    or encode(public.digest(coalesce(p_token,''),'sha256'),'hex') <> v_session.token_hash
    or auth.uid() <> v_session.requested_by
    or v_gallery.status not in ('draft','under_review')
    or not public.tournament_media_user_can_upload(
      v_session.requested_by,v_session.gallery_id
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_UPLOAD_SESSION_INVALID';
  end if;
  if p_detected_mime <> v_session.requested_mime
    or p_byte_size <> v_session.requested_size
    or p_detected_mime not in ('image/jpeg','image/png','image/webp')
    or p_width < 1 or p_height < 1
    or p_width > 12000 or p_height > 12000
    or p_width::bigint * p_height::bigint > 36000000
    or p_checksum_sha256 !~ '^[0-9a-f]{64}$'
  then
    update public.tournament_media_upload_sessions set status = 'failed'
    where id = p_session_id;
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_FILE_INVALID';
  end if;
  v_extension := case p_detected_mime
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
  if right(v_session.internal_path,char_length(v_extension) + 1) <> '.' || v_extension then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_FILE_INVALID';
  end if;
  if exists (
    select 1 from public.tournament_media_assets asset
    where asset.organization_id = v_session.organization_id
      and asset.checksum_sha256 = p_checksum_sha256
      and asset.status <> 'revoked'
  ) then
    raise exception using errcode = '23505', message = 'TORNEOS_MEDIA_DUPLICATE';
  end if;

  insert into public.tournament_media_assets (
    organization_id,tournament_id,gallery_id,internal_path,safe_name,
    detected_mime,byte_size,width,height,checksum_sha256,status,uploaded_by
  ) values (
    v_session.organization_id,v_session.tournament_id,v_session.gallery_id,
    v_session.internal_path,v_session.safe_name,p_detected_mime,p_byte_size,
    p_width,p_height,p_checksum_sha256,'pending_review',v_session.requested_by
  ) returning id into v_asset_id;
  select coalesce(max(sort_order),-1) + 1 into v_sort
  from public.tournament_media_gallery_items
  where gallery_id = v_session.gallery_id;
  insert into public.tournament_media_gallery_items (
    organization_id,tournament_id,gallery_id,asset_id,sort_order,added_by
  ) values (
    v_session.organization_id,v_session.tournament_id,v_session.gallery_id,
    v_asset_id,v_sort,v_session.requested_by
  );
  insert into public.tournament_media_variants (
    organization_id,tournament_id,asset_id,kind,internal_path,
    detected_mime,byte_size,width,height,checksum_sha256,status
  ) values (
    v_session.organization_id,v_session.tournament_id,v_asset_id,'original',
    regexp_replace(v_session.internal_path,'\.(jpg|png|webp)$','-original.' || v_extension),
    p_detected_mime,p_byte_size,p_width,p_height,p_checksum_sha256,'ready'
  );
  insert into public.tournament_media_variants (
    organization_id,tournament_id,asset_id,kind,internal_path,
    detected_mime,byte_size,width,height,checksum_sha256,status
  )
  select
    v_session.organization_id,v_session.tournament_id,v_asset_id,variant.kind,
    regexp_replace(
      v_session.internal_path,
      '\.(jpg|png|webp)$',
      '-' || variant.kind || '.' || v_extension
    ),
    p_detected_mime,null,null,null,null,'processing'
  from unnest(array['thumbnail','grid','detail']::text[]) variant(kind);
  update public.tournament_media_upload_sessions
  set status = 'consumed',consumed_at = now(),asset_id = v_asset_id
  where id = p_session_id;
  insert into public.tournament_audit_log (
    organization_id,actor_user_id,actor_type,action,resource_type,
    resource_id,tournament_id,metadata
  ) values (
    v_session.organization_id,v_session.requested_by,'system',
    'media.upload.verified','media_asset',v_asset_id,v_session.tournament_id,
    jsonb_build_object('galleryId',v_session.gallery_id,'byteSize',p_byte_size)
  );
  return jsonb_build_object(
    'assetId',v_asset_id,'galleryId',v_session.gallery_id,
    'safeName',v_session.safe_name,'status','pending_review'
  );
end;
$$;

create or replace function public.cancel_tournament_media_upload_session(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.tournament_media_upload_sessions%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_session
  from public.tournament_media_upload_sessions
  where id = p_session_id;
  if v_session.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_session.organization_id::text,0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_session.gallery_id::text,1)
  );
  select * into v_session
  from public.tournament_media_upload_sessions
  where id = p_session_id
  for update;
  if v_session.requested_by <> auth.uid()
    and not public.has_tournament_media_capability(
      v_session.organization_id,'media.update_gallery'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  if v_session.status = 'revoked' then
    return jsonb_build_object('sessionId',p_session_id,'status','revoked');
  end if;
  if v_session.status <> 'issued' then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_UPLOAD_SESSION_INVALID';
  end if;
  update public.tournament_media_upload_sessions
  set status = 'revoked'
  where id = p_session_id;
  perform public.append_tournament_audit(
    v_session.organization_id,'media.upload_session.cancelled',
    'media_upload_session',p_session_id,null,v_session.tournament_id,
    jsonb_build_object('galleryId',v_session.gallery_id)
  );
  return jsonb_build_object('sessionId',p_session_id,'status','revoked');
end;
$$;

create or replace function public.change_tournament_media_gallery_state(
  p_gallery_id uuid,
  p_action text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gallery public.tournament_media_galleries%rowtype;
  v_status text;
  v_capability text;
begin
  select * into v_gallery
  from public.tournament_media_galleries where id = p_gallery_id;
  if v_gallery.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_gallery.organization_id::text,0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_gallery_id::text,1)
  );
  select * into v_gallery
  from public.tournament_media_galleries where id = p_gallery_id for update;
  v_status := case p_action when 'archive' then 'archived' when 'revoke' then 'revoked' end;
  v_capability := case p_action when 'archive' then 'media.archive' when 'revoke' then 'media.revoke' end;
  if v_gallery.id is null or v_status is null
    or not public.has_tournament_media_capability(v_gallery.organization_id,v_capability)
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  if v_gallery.status in ('archived','revoked') then
    if v_gallery.status = v_status then
      return jsonb_build_object('galleryId',p_gallery_id,'status',v_status);
    end if;
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_TRANSITION_INVALID';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception using errcode = '22023', message = 'TORNEOS_REASON_REQUIRED';
  end if;
  update public.tournament_media_galleries
  set status = v_status,
      archived_at = case when v_status = 'archived' then now() else null end,
      revoked_at = case when v_status = 'revoked' then now() else null end,
      version = version + 1
  where id = p_gallery_id;
  update public.tournament_media_assets
  set status = case when v_status = 'revoked' then 'revoked' else 'hidden' end,
      hidden_at = case when v_status = 'archived' then now() else hidden_at end,
      revoked_at = case when v_status = 'revoked' then now() else revoked_at end
  where gallery_id = p_gallery_id
    and status in (
      'uploading','processing','pending_review','approved','published','hidden'
    );
  update public.tournament_media_upload_sessions
  set status = 'revoked'
  where gallery_id = p_gallery_id
    and status = 'issued';
  perform public.append_tournament_audit(
    v_gallery.organization_id,'media.gallery.' || p_action,'media_gallery',
    p_gallery_id,null,v_gallery.tournament_id,jsonb_build_object('reason',btrim(p_reason))
  );
  return jsonb_build_object('galleryId',p_gallery_id,'status',v_status);
end;
$$;

create or replace function public.transition_tournament_media_asset(
  p_asset_id uuid,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.tournament_media_assets%rowtype;
  v_gallery public.tournament_media_galleries%rowtype;
  v_next text;
  v_replacement uuid;
  v_capability text := 'media.review';
begin
  select * into v_asset
  from public.tournament_media_assets
  where id = p_asset_id;
  if v_asset.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_asset.organization_id::text,0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_asset.gallery_id::text,1)
  );
  select * into v_gallery
  from public.tournament_media_galleries
  where id = v_asset.gallery_id
  for update;
  select * into v_asset
  from public.tournament_media_assets
  where id = p_asset_id
  for update;
  if p_action in ('hide','revoke','request_deletion') then
    v_capability := 'media.revoke';
  end if;
  if not public.has_tournament_media_capability(
    v_asset.organization_id,v_capability
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  v_next := case
    when p_action = 'approve' and v_asset.status = 'pending_review' then 'approved'
    when p_action = 'reject' and v_asset.status = 'pending_review' then 'rejected'
    when p_action = 'hide' and v_asset.status in ('approved','published') then 'hidden'
    when p_action = 'restore' and v_asset.status = 'hidden'
      and v_gallery.status = 'published' and v_asset.published_at is not null
      then 'published'
    when p_action = 'restore' and v_asset.status = 'hidden' then 'approved'
    when p_action in ('revoke','request_deletion')
      and v_asset.status in ('pending_review','approved','published','hidden') then 'revoked'
    else null
  end;
  if v_next is null then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_TRANSITION_INVALID';
  end if;
  if p_action in ('reject','hide','revoke','request_deletion')
    and (p_reason is null or char_length(btrim(p_reason)) < 3)
  then
    raise exception using errcode = '22023', message = 'TORNEOS_REASON_REQUIRED';
  end if;
  if p_action in ('approve','restore') and (
    select count(*) <> 4
      or count(*) filter (
        where variant.status = 'ready' and variant.metadata_stripped
      ) <> 4
    from public.tournament_media_variants variant
    where variant.asset_id = p_asset_id
      and variant.kind in ('thumbnail','grid','detail','original')
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_PROCESSING_REQUIRED';
  end if;
  if v_next = 'published'
    and not public.tournament_media_asset_has_internal_consent(p_asset_id)
  then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_CONSENT_REQUIRED';
  end if;
  update public.tournament_media_assets
  set status = v_next,
      approved_by = case when v_next = 'approved' then auth.uid() else approved_by end,
      approved_at = case when v_next = 'approved' then now() else approved_at end,
      hidden_at = case when v_next = 'hidden' then now() else null end,
      revoked_at = case when v_next = 'revoked' then now() else revoked_at end
  where id = p_asset_id;
  if v_gallery.status in ('draft','under_review')
    and v_next in ('rejected','revoked')
  then
    delete from public.tournament_media_gallery_items
    where gallery_id = v_gallery.id and asset_id = p_asset_id;
    update public.tournament_media_galleries
    set cover_asset_id = case
          when cover_asset_id = p_asset_id then null else cover_asset_id end,
        version = version + 1
    where id = v_gallery.id;
  elsif v_gallery.status in ('draft','under_review')
    and v_next = 'hidden'
    and v_gallery.cover_asset_id = p_asset_id
  then
    update public.tournament_media_galleries
    set cover_asset_id = null,version = version + 1
    where id = v_gallery.id;
  end if;
  if v_gallery.status = 'published'
    and p_action in ('hide','revoke','request_deletion')
    and v_gallery.cover_asset_id = p_asset_id
  then
    select asset.id into v_replacement
    from public.tournament_media_gallery_items item
    join public.tournament_media_assets asset on asset.id = item.asset_id
    where item.gallery_id = v_gallery.id
      and asset.id <> p_asset_id
      and asset.status = 'published'
    order by item.sort_order,asset.created_at
    limit 1;
    if v_replacement is null then
      update public.tournament_media_galleries
      set status = 'archived',cover_asset_id = null,archived_at = now(),
          version = version + 1
      where id = v_gallery.id;
    else
      update public.tournament_media_galleries
      set cover_asset_id = v_replacement,version = version + 1
      where id = v_gallery.id;
    end if;
  end if;
  insert into public.tournament_media_moderation_actions (
    organization_id,tournament_id,gallery_id,asset_id,action,
    previous_status,resulting_status,reason,actor_user_id
  ) values (
    v_asset.organization_id,v_asset.tournament_id,v_asset.gallery_id,p_asset_id,
    p_action,v_asset.status,v_next,nullif(btrim(p_reason),''),auth.uid()
  );
  perform public.append_tournament_audit(
    v_asset.organization_id,'media.asset.' || p_action,'media_asset',p_asset_id,
    null,v_asset.tournament_id,jsonb_build_object(
      'galleryId',v_asset.gallery_id,'from',v_asset.status,'to',v_next
    )
  );
  return jsonb_build_object('assetId',p_asset_id,'status',v_next);
end;
$$;

create or replace function public.set_tournament_media_cover(
  p_gallery_id uuid,
  p_asset_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gallery public.tournament_media_galleries%rowtype;
begin
  select * into v_gallery
  from public.tournament_media_galleries where id = p_gallery_id;
  if v_gallery.id is null or not public.has_tournament_media_capability(
    v_gallery.organization_id,'media.set_cover'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_gallery.organization_id::text,0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_gallery.id::text,1)
  );
  select * into v_gallery
  from public.tournament_media_galleries
  where id = p_gallery_id
  for update;
  if v_gallery.status not in ('draft','under_review') then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_GALLERY_IMMUTABLE';
  end if;
  if not exists (
    select 1 from public.tournament_media_assets asset
    where asset.id = p_asset_id and asset.gallery_id = p_gallery_id
      and asset.status in ('approved','published')
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_COVER_INVALID';
  end if;
  update public.tournament_media_galleries
  set cover_asset_id = p_asset_id,version = version + 1
  where id = p_gallery_id;
  perform public.append_tournament_audit(
    v_gallery.organization_id,'media.gallery.cover_set','media_gallery',
    p_gallery_id,null,v_gallery.tournament_id,jsonb_build_object('assetId',p_asset_id)
  );
  return jsonb_build_object('galleryId',p_gallery_id,'coverAssetId',p_asset_id);
end;
$$;

create or replace function public.reorder_tournament_media_item(
  p_gallery_id uuid,
  p_asset_id uuid,
  p_target_order integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gallery public.tournament_media_galleries%rowtype;
  v_current integer;
  v_max integer;
begin
  select * into v_gallery
  from public.tournament_media_galleries where id = p_gallery_id for update;
  if v_gallery.id is null or not public.has_tournament_media_capability(
    v_gallery.organization_id,'media.update_gallery'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  if v_gallery.status not in ('draft','under_review') then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_GALLERY_IMMUTABLE';
  end if;
  select item.sort_order into v_current
  from public.tournament_media_gallery_items item
  where item.gallery_id = p_gallery_id and item.asset_id = p_asset_id
  for update;
  select coalesce(max(sort_order),0) into v_max
  from public.tournament_media_gallery_items where gallery_id = p_gallery_id;
  if v_current is null or p_target_order < 0 or p_target_order > v_max then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_ORDER_INVALID';
  end if;
  if v_current = p_target_order then
    return jsonb_build_object(
      'galleryId',p_gallery_id,'assetId',p_asset_id,'sortOrder',p_target_order
    );
  end if;
  update public.tournament_media_gallery_items
  set sort_order = sort_order + 1000000
  where gallery_id = p_gallery_id;
  if p_target_order < v_current then
    update public.tournament_media_gallery_items
    set sort_order = case
      when asset_id = p_asset_id then p_target_order
      when sort_order - 1000000 between p_target_order and v_current - 1
        then sort_order - 999999
      else sort_order - 1000000 end
    where gallery_id = p_gallery_id;
  else
    update public.tournament_media_gallery_items
    set sort_order = case
      when asset_id = p_asset_id then p_target_order
      when sort_order - 1000000 between v_current + 1 and p_target_order
        then sort_order - 1000001
      else sort_order - 1000000 end
    where gallery_id = p_gallery_id;
  end if;
  perform public.append_tournament_audit(
    v_gallery.organization_id,'media.gallery.reordered','media_gallery',
    p_gallery_id,null,v_gallery.tournament_id,
    jsonb_build_object('assetId',p_asset_id,'targetOrder',p_target_order)
  );
  return jsonb_build_object(
    'galleryId',p_gallery_id,'assetId',p_asset_id,'sortOrder',p_target_order
  );
end;
$$;

create or replace function public.tag_tournament_media_asset(
  p_asset_id uuid,
  p_relation_type text,
  p_match_id uuid,
  p_team_entry_id uuid,
  p_roster_player_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.tournament_media_assets%rowtype;
  v_gallery public.tournament_media_galleries%rowtype;
  v_category_id uuid;
  v_id uuid;
begin
  select * into v_asset from public.tournament_media_assets where id = p_asset_id;
  select * into v_gallery from public.tournament_media_galleries
  where id = v_asset.gallery_id;
  if v_asset.id is null or not public.has_tournament_media_capability(
    v_asset.organization_id,
    case when p_relation_type = 'player' then 'media.tag_player' else 'media.tag_team' end
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_asset.organization_id::text,0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_asset.gallery_id::text,1)
  );
  select * into v_gallery
  from public.tournament_media_galleries
  where id = v_asset.gallery_id
  for update;
  if v_gallery.status not in ('draft','under_review') then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_GALLERY_IMMUTABLE';
  end if;
  if p_relation_type = 'match' then
    select match.category_id into v_category_id from public.tournament_matches match
    where match.id = p_match_id
      and match.organization_id = v_asset.organization_id
      and match.tournament_id = v_asset.tournament_id;
  elsif p_relation_type in ('team','player') then
    select entry.category_id into v_category_id
    from public.tournament_team_entries entry
    where entry.id = p_team_entry_id
      and entry.organization_id = v_asset.organization_id
      and entry.tournament_id = v_asset.tournament_id
      and entry.status = 'approved'
      and (
        p_relation_type = 'team'
        or exists (
          select 1 from public.tournament_roster_players player
          join public.tournament_rosters roster on roster.id = player.roster_id
          where player.id = p_roster_player_id
            and player.team_entry_id = entry.id
            and player.status = 'active'
            and roster.status in ('approved','locked')
        )
      );
  end if;
  if v_category_id is null
    or (v_gallery.category_id is not null and v_gallery.category_id <> v_category_id)
  then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_SCOPE_INVALID';
  end if;
  insert into public.tournament_media_relations (
    organization_id,tournament_id,category_id,asset_id,relation_type,
    match_id,team_entry_id,roster_player_id,created_by
  ) values (
    v_asset.organization_id,v_asset.tournament_id,v_category_id,p_asset_id,
    p_relation_type,p_match_id,p_team_entry_id,p_roster_player_id,auth.uid()
  ) on conflict do nothing returning id into v_id;
  if v_id is null then
    select relation.id into v_id
    from public.tournament_media_relations relation
    where relation.asset_id = p_asset_id
      and relation.relation_type = p_relation_type
      and relation.match_id is not distinct from p_match_id
      and relation.team_entry_id is not distinct from p_team_entry_id
      and relation.roster_player_id is not distinct from p_roster_player_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.manage_tournament_media_consent(
  p_asset_id uuid,
  p_roster_player_id uuid,
  p_subject_user_id uuid,
  p_use_scope text,
  p_status text,
  p_legal_basis text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.tournament_media_assets%rowtype;
  v_gallery public.tournament_media_galleries%rowtype;
  v_existing public.tournament_media_consents%rowtype;
  v_consent_id uuid;
  v_replacement uuid;
  v_subject_user_id uuid;
begin
  select * into v_asset from public.tournament_media_assets where id = p_asset_id;
  if v_asset.id is null or not public.has_tournament_media_capability(
    v_asset.organization_id,'media.manage_consent'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_asset.organization_id::text,0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_asset.gallery_id::text,1)
  );
  select * into v_gallery
  from public.tournament_media_galleries
  where id = v_asset.gallery_id
  for update;
  select * into v_asset
  from public.tournament_media_assets
  where id = p_asset_id
  for update;
  if p_roster_player_id is null and p_subject_user_id is null then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_CONSENT_INVALID';
  end if;
  if p_roster_player_id is not null then
    select player.arma2_user_id
    into v_subject_user_id
    from public.tournament_media_relations relation
    join public.tournament_roster_players player
      on player.id = relation.roster_player_id
    join public.tournament_team_entries entry
      on entry.id = player.team_entry_id
    where relation.asset_id = p_asset_id
      and relation.relation_type = 'player'
      and relation.roster_player_id = p_roster_player_id
      and player.status = 'active'
      and entry.organization_id = v_asset.organization_id
      and entry.tournament_id = v_asset.tournament_id;
    if not found
      or (
        p_subject_user_id is not null
        and p_subject_user_id is distinct from v_subject_user_id
      )
    then
      raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_SCOPE_INVALID';
    end if;
  else
    v_subject_user_id := p_subject_user_id;
  end if;
  if p_roster_player_id is null and not exists (
    select 1
    from public.tournament_media_relations relation
    join public.tournament_roster_players player
      on player.id = relation.roster_player_id
    join public.tournament_team_entries entry
      on entry.id = player.team_entry_id
    where relation.asset_id = p_asset_id
      and relation.relation_type = 'player'
      and player.arma2_user_id = v_subject_user_id
      and player.status = 'active'
      and entry.organization_id = v_asset.organization_id
      and entry.tournament_id = v_asset.tournament_id
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_SCOPE_INVALID';
  end if;
  select * into v_existing
  from public.tournament_media_consents consent
  where consent.asset_id = p_asset_id
    and consent.roster_player_id is not distinct from p_roster_player_id
    and consent.subject_user_id is not distinct from v_subject_user_id
    and consent.use_scope = p_use_scope
  for update;
  if v_existing.id is not null
    and v_existing.status = p_status
    and v_existing.legal_basis is not distinct from (
      case when p_status = 'not_required'
        then nullif(btrim(p_legal_basis),'') else null end
    )
  then
    return jsonb_build_object(
      'assetId',p_asset_id,'useScope',p_use_scope,'status',p_status
    );
  end if;
  insert into public.tournament_media_consents (
    organization_id,tournament_id,asset_id,roster_player_id,subject_user_id,
    use_scope,status,legal_basis,managed_by,revoked_at
  ) values (
    v_asset.organization_id,v_asset.tournament_id,p_asset_id,p_roster_player_id,
    v_subject_user_id,p_use_scope,p_status,
    case when p_status = 'not_required' then nullif(btrim(p_legal_basis),'') else null end,
    auth.uid(),case when p_status = 'revoked' then now() else null end
  ) on conflict (
    asset_id,
    (coalesce(roster_player_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (coalesce(subject_user_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    use_scope
  ) do update set
    status = excluded.status,legal_basis = excluded.legal_basis,
    managed_by = excluded.managed_by,revoked_at = excluded.revoked_at,
    updated_at = now()
  returning id into v_consent_id;
  insert into public.tournament_media_consent_events (
    organization_id,tournament_id,consent_id,asset_id,roster_player_id,
    subject_user_id,use_scope,previous_status,resulting_status,legal_basis,
    actor_user_id
  ) values (
    v_asset.organization_id,v_asset.tournament_id,v_consent_id,p_asset_id,
    p_roster_player_id,v_subject_user_id,p_use_scope,v_existing.status,p_status,
    case when p_status = 'not_required' then nullif(btrim(p_legal_basis),'') else null end,
    auth.uid()
  );
  if p_use_scope = 'view_internal'
    and p_status in ('denied','revoked')
    and v_asset.status = 'published'
  then
    update public.tournament_media_assets
    set status = 'hidden',hidden_at = now()
    where id = p_asset_id;
    if v_gallery.cover_asset_id = p_asset_id then
      select asset.id into v_replacement
      from public.tournament_media_gallery_items item
      join public.tournament_media_assets asset on asset.id = item.asset_id
      where item.gallery_id = v_gallery.id
        and asset.id <> p_asset_id
        and asset.status = 'published'
      order by item.sort_order,asset.created_at
      limit 1;
      if v_replacement is null then
        update public.tournament_media_galleries
        set status = 'archived',cover_asset_id = null,archived_at = now(),
            version = version + 1
        where id = v_gallery.id;
      else
        update public.tournament_media_galleries
        set cover_asset_id = v_replacement,version = version + 1
        where id = v_gallery.id;
      end if;
    end if;
    insert into public.tournament_media_moderation_actions (
      organization_id,tournament_id,gallery_id,asset_id,action,
      previous_status,resulting_status,reason,actor_user_id
    ) values (
      v_asset.organization_id,v_asset.tournament_id,v_asset.gallery_id,p_asset_id,
      'hide','published','hidden','Consentimiento interno denegado o revocado.',
      auth.uid()
    );
  end if;
  perform public.append_tournament_audit(
    v_asset.organization_id,'media.consent.updated','media_asset',p_asset_id,
    null,v_asset.tournament_id,jsonb_build_object(
      'useScope',p_use_scope,'status',p_status
    )
  );
  return jsonb_build_object(
    'assetId',p_asset_id,'useScope',p_use_scope,'status',p_status
  );
end;
$$;

create or replace function public.publish_tournament_media_gallery(
  p_gallery_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gallery public.tournament_media_galleries%rowtype;
  v_count integer;
begin
  select * into v_gallery
  from public.tournament_media_galleries where id = p_gallery_id;
  if v_gallery.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_gallery.organization_id::text,0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_gallery_id::text,1)
  );
  select * into v_gallery
  from public.tournament_media_galleries where id = p_gallery_id for update;
  if v_gallery.id is null or not public.has_tournament_media_capability(
    v_gallery.organization_id,'media.publish'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  if v_gallery.status = 'published' then
    return jsonb_build_object(
      'galleryId',p_gallery_id,'status','published','publishedAt',v_gallery.published_at
    );
  end if;
  if v_gallery.status not in ('draft','under_review') then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_GALLERY_NOT_PUBLISHABLE';
  end if;
  select count(*) into v_count
  from public.tournament_media_gallery_items item
  join public.tournament_media_assets asset on asset.id = item.asset_id
  where item.gallery_id = p_gallery_id;
  if v_count < 1 or v_gallery.cover_asset_id is null or not exists (
    select 1 from public.tournament_media_assets asset
    where asset.id = v_gallery.cover_asset_id
      and asset.gallery_id = p_gallery_id and asset.status = 'approved'
  ) or exists (
    select 1
    from public.tournament_media_gallery_items item
    join public.tournament_media_assets asset on asset.id = item.asset_id
    where item.gallery_id = p_gallery_id
      and asset.status <> 'approved'
  ) or exists (
    select 1
    from public.tournament_media_gallery_items item
    where item.gallery_id = p_gallery_id
      and (
        select count(*)
        from public.tournament_media_variants variant
        where variant.asset_id = item.asset_id
          and variant.kind in ('thumbnail','grid','detail','original')
          and variant.status = 'ready'
          and variant.metadata_stripped
      ) <> 4
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_GALLERY_NOT_PUBLISHABLE';
  end if;
  if exists (
    select 1
    from public.tournament_media_gallery_items item
    where item.gallery_id = p_gallery_id
      and not public.tournament_media_asset_has_internal_consent(item.asset_id)
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_CONSENT_REQUIRED';
  end if;

  update public.tournament_media_assets asset
  set status = 'published',published_at = now()
  where asset.gallery_id = p_gallery_id and asset.status = 'approved';
  update public.tournament_media_galleries
  set status = 'published',submitted_at = coalesce(submitted_at,now()),
      published_by = auth.uid(),published_at = now(),version = version + 1
  where id = p_gallery_id;
  perform public.append_tournament_audit(
    v_gallery.organization_id,'media.gallery.published','media_gallery',
    p_gallery_id,null,v_gallery.tournament_id,jsonb_build_object('assetCount',v_count)
  );
  return jsonb_build_object(
    'galleryId',p_gallery_id,'status','published',
    'publishedAt',now(),'assetCount',v_count
  );
end;
$$;

create or replace function public.assign_tournament_media_photographer(
  p_gallery_id uuid,
  p_user_id uuid,
  p_revoke boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gallery public.tournament_media_galleries%rowtype;
begin
  select * into v_gallery from public.tournament_media_galleries where id = p_gallery_id;
  if v_gallery.id is null or not public.has_tournament_media_capability(
    v_gallery.organization_id,'media.update_gallery'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_gallery.organization_id::text,0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_gallery_id::text,1)
  );
  select * into v_gallery
  from public.tournament_media_galleries
  where id = p_gallery_id
  for update;
  if not p_revoke and v_gallery.status not in ('draft','under_review') then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_GALLERY_IMMUTABLE';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_ASSIGNMENT_INVALID';
  end if;
  insert into public.tournament_media_assignments (
    organization_id,tournament_id,gallery_id,user_id,status,
    assigned_by,revoked_at
  ) values (
    v_gallery.organization_id,v_gallery.tournament_id,p_gallery_id,p_user_id,
    case when p_revoke then 'revoked' else 'active' end,
    auth.uid(),case when p_revoke then now() else null end
  ) on conflict (gallery_id,user_id) do update set
    can_upload = not p_revoke,
    status = case when p_revoke then 'revoked' else 'active' end,
    revoked_at = case when p_revoke then now() else null end,
    assigned_by = auth.uid();
  perform public.append_tournament_audit(
    v_gallery.organization_id,
    case when p_revoke then 'media.photographer.revoked' else 'media.photographer.assigned' end,
    'media_gallery',p_gallery_id,null,v_gallery.tournament_id,
    jsonb_build_object('scope','upload_only')
  );
  if p_revoke then
    update public.tournament_media_upload_sessions
    set status = 'revoked'
    where gallery_id = p_gallery_id
      and requested_by = p_user_id
      and status = 'issued';
  end if;
  return jsonb_build_object(
    'galleryId',p_gallery_id,'status',case when p_revoke then 'revoked' else 'active' end
  );
end;
$$;

create or replace function public.get_tournament_media_admin_context(
  p_organization_id uuid,
  p_tournament_id uuid default null,
  p_status text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_can_handle_reports boolean;
begin
  if not public.has_tournament_media_capability(p_organization_id,'media.read') then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  if p_limit < 1 or p_limit > 100 or p_offset < 0 then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_FILTER_INVALID';
  end if;
  v_can_handle_reports := public.has_tournament_media_capability(
    p_organization_id,'media.handle_reports'
  );
  select jsonb_build_object(
    'storage',jsonb_build_object(
      'bucket','tournament-media','private',true,'certified',false,
      'uploadReady',false,'requiresStagingGate',true,
      'maxFileBytes',12582912,'maxPixels',36000000,
      'allowedMime',jsonb_build_array('image/jpeg','image/png','image/webp'),
      'maxBatchFiles',40
    ),
    'capabilities',to_jsonb(public.tournament_media_role_capabilities(membership.role)),
    'tournaments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',tournament.id,'name',tournament.name,'seasonId',tournament.season_id,
        'status',tournament.status,'categories',(
          select coalesce(jsonb_agg(jsonb_build_object(
            'id',category.id,'name',category.name
          ) order by category.sort_order,category.name),'[]'::jsonb)
          from public.tournament_categories category
          where category.tournament_id = tournament.id and category.status = 'active'
        ),
        'matches',(
          select coalesce(jsonb_agg(jsonb_build_object(
            'id',match.id,'categoryId',match.category_id,
            'roundId',match.round_id,'matchNumber',match.match_number,
            'scheduledAt',match.scheduled_at,'status',match.status
          ) order by match.scheduled_at nulls last,match.match_number),'[]'::jsonb)
          from public.tournament_matches match
          join public.tournament_fixture_versions fixture
            on fixture.id = match.fixture_version_id
          where match.tournament_id = tournament.id
            and match.status <> 'cancelled'
            and fixture.status = 'published'
            and fixture.invalidated_at is null
        )
      ) order by tournament.updated_at desc)
      from public.tournaments tournament
      where tournament.organization_id = p_organization_id
        and tournament.status <> 'archived'
        and (p_tournament_id is null or tournament.id = p_tournament_id)
    ),'[]'::jsonb),
    'galleries',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',gallery.id,'tournamentId',gallery.tournament_id,
        'categoryId',gallery.category_id,'roundId',gallery.round_id,
        'matchId',gallery.match_id,'title',gallery.title,
        'description',gallery.description,'status',gallery.status,
        'visibility',gallery.visibility,'coverAssetId',gallery.cover_asset_id,
        'minorRestriction',gallery.minor_restriction,'version',gallery.version,
        'createdAt',gallery.created_at,'updatedAt',gallery.updated_at,
        'publishedAt',gallery.published_at,
        'assets',(
          select coalesce(jsonb_agg(jsonb_build_object(
            'id',asset.id,'safeName',asset.safe_name,
            'mime',asset.detected_mime,'byteSize',asset.byte_size,
            'width',asset.width,'height',asset.height,'status',asset.status,
            'sortOrder',item.sort_order,'caption',item.caption,
            'uploadedAt',asset.created_at
          ) order by item.sort_order),'[]'::jsonb)
          from public.tournament_media_gallery_items item
          join public.tournament_media_assets asset on asset.id = item.asset_id
          where item.gallery_id = gallery.id
        ),
        'reportCount',case when v_can_handle_reports then (
          select count(*) from public.tournament_media_reports report
          where report.gallery_id = gallery.id and report.status in ('open','under_review')
        ) else 0 end
      ) order by gallery.updated_at desc)
      from (
        select *
        from public.tournament_media_galleries gallery_page
        where gallery_page.organization_id = p_organization_id
          and (p_tournament_id is null or gallery_page.tournament_id = p_tournament_id)
          and (p_status is null or gallery_page.status = p_status)
        order by gallery_page.updated_at desc
        limit p_limit offset p_offset
      ) gallery
    ),'[]'::jsonb),
    'reports',case when v_can_handle_reports then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',report.id,'galleryId',report.gallery_id,'assetId',report.asset_id,
        'reason',report.reason,'detail',report.detail,
        'requestHide',report.request_hide,'status',report.status,
        'createdAt',report.created_at
      ) order by report.created_at desc)
      from public.tournament_media_reports report
      where report.organization_id = p_organization_id
        and report.status in ('open','under_review')
        and (p_tournament_id is null or report.tournament_id = p_tournament_id)
    ),'[]'::jsonb) else '[]'::jsonb end
  ) into v_result
  from public.tournament_organization_members membership
  where membership.organization_id = p_organization_id
    and membership.user_id = auth.uid() and membership.status = 'active';
  return coalesce(v_result,'{}'::jsonb);
end;
$$;

create or replace function public.get_published_tournament_media(
  p_tournament_id uuid,
  p_category_id uuid default null,
  p_match_id uuid default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.can_read_tournament_participant_hub(
    p_tournament_id,p_category_id
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  if p_limit < 1 or p_limit > 50 or p_offset < 0 then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_FILTER_INVALID';
  end if;
  if p_match_id is not null and not exists (
    select 1 from public.tournament_matches match
    where match.id = p_match_id and match.tournament_id = p_tournament_id
      and (p_category_id is null or match.category_id = p_category_id)
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  select jsonb_build_object(
    'delivery',jsonb_build_object(
      'status','staging_required','signedUrlTtlSeconds',300,
      'originalsRestricted',true
    ),
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'id',gallery.id,'title',gallery.title,'description',gallery.description,
      'visibility',gallery.visibility,'matchId',gallery.match_id,
      'publishedAt',gallery.published_at,'coverAssetId',gallery.cover_asset_id,
      'assets',(
        select coalesce(jsonb_agg(jsonb_build_object(
          'id',asset.id,'safeName',asset.safe_name,
          'width',asset.width,'height',asset.height,
          'caption',item.caption,'sortOrder',item.sort_order,
          'thumbnailUrl',null,'gridUrl',null,'detailUrl',null,
          'originalAvailable',false
        ) order by item.sort_order),'[]'::jsonb)
        from public.tournament_media_gallery_items item
        join public.tournament_media_assets asset on asset.id = item.asset_id
        where item.gallery_id = gallery.id and asset.status = 'published'
      )
    ) order by gallery.published_at desc),'[]'::jsonb)
  ) into v_result
  from (
    select *
    from public.tournament_media_galleries gallery_page
    where gallery_page.tournament_id = p_tournament_id
      and gallery_page.status = 'published'
      and (p_category_id is null or gallery_page.category_id is null
        or gallery_page.category_id = p_category_id)
      and (p_match_id is null or gallery_page.match_id = p_match_id)
      and public.can_current_user_read_media_gallery(gallery_page.id)
    order by gallery_page.published_at desc
    limit p_limit offset p_offset
  ) gallery;
  return coalesce(v_result,jsonb_build_object(
    'delivery',jsonb_build_object(
      'status','staging_required','signedUrlTtlSeconds',300,
      'originalsRestricted',true
    ),
    'items','[]'::jsonb
  ));
end;
$$;

create or replace function public.report_tournament_media_asset(
  p_asset_id uuid,
  p_reason text,
  p_detail text,
  p_request_hide boolean,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.tournament_media_assets%rowtype;
  v_existing public.tournament_media_reports%rowtype;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_asset
  from public.tournament_media_assets where id = p_asset_id;
  if v_asset.id is null or v_asset.status <> 'published'
    or not public.can_current_user_read_media_gallery(v_asset.gallery_id)
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'TORNEOS_IDEMPOTENCY_REQUIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text,2)
  );
  select * into v_existing
  from public.tournament_media_reports report
  where report.reporter_user_id = auth.uid()
    and report.idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.asset_id is distinct from p_asset_id
      or v_existing.reason is distinct from p_reason
      or v_existing.detail is distinct from nullif(btrim(p_detail),'')
      or v_existing.request_hide is distinct from p_request_hide
    then
      raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object(
      'reportId',v_existing.id,'status',v_existing.status
    );
  end if;
  if (
    select count(*) from public.tournament_media_reports report
    where report.reporter_user_id = auth.uid()
      and report.created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_REPORT_RATE_LIMITED';
  end if;
  insert into public.tournament_media_reports (
    organization_id,tournament_id,gallery_id,asset_id,reporter_user_id,
    reason,detail,request_hide,idempotency_key
  ) values (
    v_asset.organization_id,v_asset.tournament_id,v_asset.gallery_id,p_asset_id,
    auth.uid(),p_reason,nullif(btrim(p_detail),''),p_request_hide,p_idempotency_key
  ) returning id into v_id;
  perform public.append_tournament_audit(
    v_asset.organization_id,'media.report.created','media_report',v_id,
    null,v_asset.tournament_id,jsonb_build_object(
      'galleryId',v_asset.gallery_id,'reason',p_reason,'requestHide',p_request_hide
    )
  );
  return jsonb_build_object('reportId',v_id,'status','open');
end;
$$;

create or replace function public.handle_tournament_media_report(
  p_report_id uuid,
  p_status text,
  p_resolution text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.tournament_media_reports%rowtype;
begin
  select * into v_report
  from public.tournament_media_reports where id = p_report_id for update;
  if v_report.id is null or not public.has_tournament_media_capability(
    v_report.organization_id,'media.handle_reports'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  if p_status not in ('under_review','resolved','dismissed') then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_REPORT_INVALID';
  end if;
  if v_report.status = p_status then
    return jsonb_build_object('reportId',p_report_id,'status',p_status);
  end if;
  if v_report.status not in ('open','under_review')
    or (v_report.status = 'under_review' and p_status = 'under_review')
  then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_REPORT_INVALID';
  end if;
  update public.tournament_media_reports
  set status = p_status,
      handled_by = case when p_status in ('resolved','dismissed') then auth.uid() else null end,
      handled_at = case when p_status in ('resolved','dismissed') then now() else null end,
      resolution = case when p_status in ('resolved','dismissed')
        then nullif(btrim(p_resolution),'') else resolution end
  where id = p_report_id;
  perform public.append_tournament_audit(
    v_report.organization_id,'media.report.' || p_status,'media_report',
    p_report_id,null,v_report.tournament_id,jsonb_build_object('status',p_status)
  );
  return jsonb_build_object('reportId',p_report_id,'status',p_status);
end;
$$;

revoke all on function public.touch_tournament_media_updated_at() from public;
revoke all on function public.tournament_media_role_capabilities(text) from public;
revoke all on function public.has_tournament_media_capability(uuid,text) from public,anon,authenticated;
revoke all on function public.has_tournament_media_assignment(uuid,text) from public,anon,authenticated;
revoke all on function public.tournament_media_user_can_upload(uuid,uuid)
  from public,anon,authenticated;
revoke all on function public.current_user_has_media_team_relation(uuid) from public,anon,authenticated;
revoke all on function public.tournament_media_asset_has_internal_consent(uuid)
  from public,anon,authenticated;
revoke all on function public.can_current_user_read_media_gallery(uuid) from public,anon,authenticated;
revoke all on function public.create_tournament_media_gallery(
  uuid,uuid,uuid,uuid,uuid,text,text,text,uuid
) from public,anon,authenticated;
revoke all on function public.update_tournament_media_gallery(
  uuid,text,text,text,boolean
) from public,anon,authenticated;
revoke all on function public.request_tournament_media_upload_session(
  uuid,text,text,bigint,uuid
) from public,anon,authenticated;
revoke all on function public.complete_tournament_media_upload(
  uuid,text,text,bigint,integer,integer,text
) from public,anon,authenticated,service_role;
revoke all on function public.cancel_tournament_media_upload_session(uuid)
  from public,anon,authenticated;
revoke all on function public.transition_tournament_media_asset(uuid,text,text)
  from public,anon,authenticated;
revoke all on function public.change_tournament_media_gallery_state(uuid,text,text)
  from public,anon,authenticated;
revoke all on function public.set_tournament_media_cover(uuid,uuid)
  from public,anon,authenticated;
revoke all on function public.reorder_tournament_media_item(uuid,uuid,integer)
  from public,anon,authenticated;
revoke all on function public.tag_tournament_media_asset(
  uuid,text,uuid,uuid,uuid
) from public,anon,authenticated;
revoke all on function public.manage_tournament_media_consent(
  uuid,uuid,uuid,text,text,text
) from public,anon,authenticated;
revoke all on function public.publish_tournament_media_gallery(uuid)
  from public,anon,authenticated;
revoke all on function public.assign_tournament_media_photographer(
  uuid,uuid,boolean
) from public,anon,authenticated;
revoke all on function public.get_tournament_media_admin_context(
  uuid,uuid,text,integer,integer
) from public,anon,authenticated;
revoke all on function public.get_published_tournament_media(
  uuid,uuid,uuid,integer,integer
) from public,anon,authenticated;
revoke all on function public.report_tournament_media_asset(
  uuid,text,text,boolean,uuid
) from public,anon,authenticated;
revoke all on function public.handle_tournament_media_report(uuid,text,text)
  from public,anon,authenticated;

grant execute on function public.create_tournament_media_gallery(
  uuid,uuid,uuid,uuid,uuid,text,text,text,uuid
) to authenticated;
grant execute on function public.update_tournament_media_gallery(
  uuid,text,text,text,boolean
) to authenticated;
grant execute on function public.request_tournament_media_upload_session(
  uuid,text,text,bigint,uuid
) to authenticated;
grant execute on function public.complete_tournament_media_upload(
  uuid,text,text,bigint,integer,integer,text
) to service_role;
grant execute on function public.cancel_tournament_media_upload_session(uuid)
  to authenticated;
grant execute on function public.transition_tournament_media_asset(uuid,text,text)
  to authenticated;
grant execute on function public.change_tournament_media_gallery_state(uuid,text,text)
  to authenticated;
grant execute on function public.set_tournament_media_cover(uuid,uuid)
  to authenticated;
grant execute on function public.reorder_tournament_media_item(uuid,uuid,integer)
  to authenticated;
grant execute on function public.tag_tournament_media_asset(
  uuid,text,uuid,uuid,uuid
) to authenticated;
grant execute on function public.manage_tournament_media_consent(
  uuid,uuid,uuid,text,text,text
) to authenticated;
grant execute on function public.publish_tournament_media_gallery(uuid)
  to authenticated;
grant execute on function public.assign_tournament_media_photographer(
  uuid,uuid,boolean
) to authenticated;
grant execute on function public.get_tournament_media_admin_context(
  uuid,uuid,text,integer,integer
) to authenticated;
grant execute on function public.get_published_tournament_media(
  uuid,uuid,uuid,integer,integer
) to authenticated;
grant execute on function public.report_tournament_media_asset(
  uuid,text,text,boolean,uuid
) to authenticated;
grant execute on function public.handle_tournament_media_report(uuid,text,text)
  to authenticated;

-- Storage policies are installed only where Supabase's storage schema exists.
-- They never create or alter the remote bucket. The signer must still be certified
-- in dedicated staging before `uploadReady` can become true.
do $storage_contract$
begin
  if to_regclass('storage.objects') is not null then
    execute $policy$
      create policy "tournament_media_service_insert"
      on storage.objects for insert to service_role
      with check (
        bucket_id = 'tournament-media'
        and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}(-(?:thumbnail|grid|detail|original))?\.(jpg|png|webp)$'
      )
    $policy$;
    execute $policy$
      create policy "tournament_media_service_read"
      on storage.objects for select to service_role
      using (bucket_id = 'tournament-media')
    $policy$;
    execute $policy$
      create policy "tournament_media_service_update"
      on storage.objects for update to service_role
      using (false) with check (false)
    $policy$;
    execute $policy$
      create policy "tournament_media_service_delete"
      on storage.objects for delete to service_role
      using (false)
    $policy$;
  end if;
end;
$storage_contract$;

comment on table public.tournament_media_galleries is
  'Editorial tournament galleries. Internal authenticated visibility only.';
comment on table public.tournament_media_assets is
  'Private verified image metadata. Paths, checksums and bucket are never participant payloads.';
comment on table public.tournament_media_upload_sessions is
  'Short-lived single-use upload intent. Persists only a SHA-256 token hash.';
comment on table public.tournament_media_variants is
  'Metadata-stripped thumbnail, grid, detail and restricted original variants.';
comment on table public.tournament_media_reports is
  'Private participant privacy reports; reporter identity is excluded from media read payloads.';
