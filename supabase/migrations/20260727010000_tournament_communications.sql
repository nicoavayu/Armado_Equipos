-- Arma2 Torneos: official announcements, documents and internal deliveries.
-- Local/dedicated staging only. Never apply this migration to production.

create extension if not exists pgcrypto;

create table public.tournament_announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  season_id uuid not null,
  tournament_id uuid not null,
  category_id uuid,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'draft',
  announcement_type text not null,
  title text not null,
  summary text not null,
  body text not null,
  priority text not null default 'normal',
  acknowledgement_mode text not null default 'none',
  published_at timestamptz,
  scheduled_for timestamptz,
  archived_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  supersedes_id uuid,
  correction_reason text,
  published_recipient_count integer,
  audience_snapshot jsonb,
  idempotency_key uuid not null,
  constraint tournament_announcements_tournament_fk
    foreign key (organization_id,tournament_id,season_id)
    references public.tournaments(organization_id,id,season_id) on delete restrict,
  constraint tournament_announcements_category_fk
    foreign key (organization_id,tournament_id,category_id)
    references public.tournament_categories(organization_id,tournament_id,id) on delete restrict,
  constraint tournament_announcements_supersedes_fk
    foreign key (supersedes_id) references public.tournament_announcements(id) on delete restrict,
  constraint tournament_announcements_status_check check (
    status in ('draft','scheduled','published','superseded','archived','cancelled','revoked')
  ),
  constraint tournament_announcements_type_check check (
    announcement_type in (
      'general','registration','schedule_change','match_update',
      'discipline','regulation','administrative','emergency'
    )
  ),
  constraint tournament_announcements_priority_check
    check (priority in ('normal','important','urgent')),
  constraint tournament_announcements_ack_check
    check (acknowledgement_mode in ('none','read','explicit')),
  constraint tournament_announcements_content_check check (
    title = btrim(title) and char_length(title) between 4 and 120
    and summary = btrim(summary) and char_length(summary) between 4 and 280
    and body = btrim(body) and char_length(body) between 4 and 12000
    and title !~ '[<>]' and summary !~ '[<>]' and body !~ '[<>]'
  ),
  constraint tournament_announcements_schedule_check check (
    (status <> 'scheduled' or scheduled_for is not null)
    and (published_at is null or status in ('published','superseded','archived','revoked'))
    and (archived_at is null or status = 'archived')
    and (revoked_at is null or status = 'revoked')
    and (revoked_reason is null or char_length(btrim(revoked_reason)) between 4 and 500)
  ),
  constraint tournament_announcements_version_check check (version > 0),
  constraint tournament_announcements_recipient_count_check
    check (published_recipient_count is null or published_recipient_count between 0 and 5000),
  constraint tournament_announcements_audience_snapshot_check check (
    audience_snapshot is null
    or (
      jsonb_typeof(audience_snapshot) = 'object'
      and pg_column_size(audience_snapshot) <= 16384
    )
  ),
  constraint tournament_announcements_idempotency_unique
    unique (organization_id,author_user_id,idempotency_key),
  constraint tournament_announcements_org_id_unique unique (organization_id,id),
  constraint tournament_announcements_org_tournament_id_unique
    unique (organization_id,tournament_id,id)
);

create index tournament_announcements_scope_status_idx
  on public.tournament_announcements
  (organization_id,tournament_id,status,published_at desc,created_at desc);
create index tournament_announcements_category_published_idx
  on public.tournament_announcements
  (category_id,published_at desc)
  where status = 'published' and category_id is not null;
create index tournament_announcements_author_drafts_idx
  on public.tournament_announcements
  (organization_id,author_user_id,updated_at desc)
  where status in ('draft','scheduled');

create table public.tournament_announcement_audiences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  announcement_id uuid not null,
  audience_type text not null,
  category_id uuid,
  team_entry_id uuid,
  match_id uuid,
  specific_user_id uuid references auth.users(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint tournament_announcement_audiences_announcement_fk
    foreign key (organization_id,announcement_id)
    references public.tournament_announcements(organization_id,id) on delete restrict,
  constraint tournament_announcement_audiences_category_fk
    foreign key (organization_id,category_id)
    references public.tournament_categories(organization_id,id) on delete restrict,
  constraint tournament_announcement_audiences_team_fk
    foreign key (organization_id,team_entry_id)
    references public.tournament_team_entries(organization_id,id) on delete restrict,
  constraint tournament_announcement_audiences_match_fk
    foreign key (organization_id,match_id)
    references public.tournament_matches(organization_id,id) on delete restrict,
  constraint tournament_announcement_audiences_type_check check (
    audience_type in (
      'organization','tournament','category','team','captains','players',
      'match','home_team','away_team','specific_user'
    )
  ),
  constraint tournament_announcement_audiences_shape_check check (
    (audience_type = 'category' and category_id is not null
      and team_entry_id is null and match_id is null and specific_user_id is null)
    or (audience_type = 'team' and team_entry_id is not null
      and category_id is null and match_id is null and specific_user_id is null)
    or (audience_type in ('match','home_team','away_team') and match_id is not null
      and category_id is null and team_entry_id is null and specific_user_id is null)
    or (audience_type = 'specific_user' and specific_user_id is not null
      and category_id is null and team_entry_id is null and match_id is null)
    or (audience_type in ('organization','tournament','captains','players')
      and category_id is null and team_entry_id is null
      and match_id is null and specific_user_id is null)
  ),
  constraint tournament_announcement_audiences_unique
    unique nulls not distinct (
      announcement_id,audience_type,category_id,team_entry_id,match_id,specific_user_id
    ),
  constraint tournament_announcement_audiences_org_id_unique unique (organization_id,id)
);

create index tournament_announcement_audiences_announcement_idx
  on public.tournament_announcement_audiences (announcement_id,created_at,id);

create table public.tournament_announcement_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  announcement_id uuid not null,
  link_type text not null,
  resource_id uuid,
  external_url text,
  label text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint tournament_announcement_links_announcement_fk
    foreign key (organization_id,announcement_id)
    references public.tournament_announcements(organization_id,id) on delete restrict,
  constraint tournament_announcement_links_type_check check (
    link_type in (
      'tournament','category','match','round','standings','discipline','document','external'
    )
  ),
  constraint tournament_announcement_links_shape_check check (
    (link_type = 'external' and resource_id is null
      and external_url ~ '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:/[^[:space:]]*)?$')
    or (link_type <> 'external' and resource_id is not null and external_url is null)
  ),
  constraint tournament_announcement_links_label_check
    check (label = btrim(label) and char_length(label) between 2 and 80),
  constraint tournament_announcement_links_sort_check check (sort_order between 0 and 20),
  constraint tournament_announcement_links_count_unique
    unique (announcement_id,sort_order),
  constraint tournament_announcement_links_org_id_unique unique (organization_id,id)
);

create index tournament_announcement_links_announcement_idx
  on public.tournament_announcement_links (announcement_id,sort_order,id);

create table public.tournament_announcement_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  announcement_id uuid not null,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  recipient_relation_type text not null,
  status text not null default 'available',
  created_at timestamptz not null default now(),
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  confirmed_at timestamptz,
  archived_at timestamptz,
  revoked_at timestamptz,
  constraint tournament_announcement_deliveries_announcement_fk
    foreign key (organization_id,announcement_id)
    references public.tournament_announcements(organization_id,id) on delete restrict,
  constraint tournament_announcement_deliveries_relation_check check (
    recipient_relation_type in (
      'organization_member','player','captain','delegate','match_participant','specific'
    )
  ),
  constraint tournament_announcement_deliveries_status_check
    check (status in ('available','read','confirmed','archived','revoked')),
  constraint tournament_announcement_deliveries_state_check check (
    (read_at is null or status in ('read','confirmed','archived','revoked'))
    and (confirmed_at is null or status in ('confirmed','archived','revoked'))
    and (archived_at is null or status = 'archived')
    and (revoked_at is null or status = 'revoked')
  ),
  constraint tournament_announcement_deliveries_recipient_unique
    unique (announcement_id,recipient_user_id),
  constraint tournament_announcement_deliveries_org_id_unique unique (organization_id,id)
);

create index tournament_announcement_deliveries_recipient_inbox_idx
  on public.tournament_announcement_deliveries
  (recipient_user_id,status,delivered_at desc,announcement_id);
create index tournament_announcement_deliveries_announcement_summary_idx
  on public.tournament_announcement_deliveries (announcement_id,status);

create table public.tournament_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  season_id uuid not null,
  tournament_id uuid not null,
  category_id uuid,
  document_type text not null,
  title text not null,
  status text not null default 'draft',
  active_version_id uuid,
  acknowledgement_mode text not null default 'none',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  idempotency_key uuid not null,
  constraint tournament_documents_tournament_fk
    foreign key (organization_id,tournament_id,season_id)
    references public.tournaments(organization_id,id,season_id) on delete restrict,
  constraint tournament_documents_category_fk
    foreign key (organization_id,tournament_id,category_id)
    references public.tournament_categories(organization_id,tournament_id,id) on delete restrict,
  constraint tournament_documents_type_check check (
    document_type in ('regulation','discipline','terms','requirements','policy','other')
  ),
  constraint tournament_documents_title_check check (
    title = btrim(title) and char_length(title) between 4 and 120 and title !~ '[<>]'
  ),
  constraint tournament_documents_status_check
    check (status in ('draft','published','archived')),
  constraint tournament_documents_ack_check
    check (acknowledgement_mode in ('none','read','explicit')),
  constraint tournament_documents_archive_check
    check ((status = 'archived') = (archived_at is not null)),
  constraint tournament_documents_idempotency_unique
    unique (organization_id,created_by,idempotency_key),
  constraint tournament_documents_org_id_unique unique (organization_id,id),
  constraint tournament_documents_org_tournament_id_unique
    unique (organization_id,tournament_id,id)
);

create index tournament_documents_scope_status_idx
  on public.tournament_documents
  (organization_id,tournament_id,status,updated_at desc,id);

create table public.tournament_document_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  document_id uuid not null,
  version integer not null,
  status text not null default 'draft',
  summary text not null,
  body text not null,
  effective_at timestamptz,
  correction_reason text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  published_by uuid references auth.users(id) on delete restrict,
  published_at timestamptz,
  superseded_at timestamptz,
  source_version_id uuid,
  constraint tournament_document_versions_document_fk
    foreign key (organization_id,document_id)
    references public.tournament_documents(organization_id,id) on delete restrict,
  constraint tournament_document_versions_source_fk
    foreign key (source_version_id)
    references public.tournament_document_versions(id) on delete restrict,
  constraint tournament_document_versions_status_check
    check (status in ('draft','published','superseded','cancelled')),
  constraint tournament_document_versions_content_check check (
    version > 0
    and summary = btrim(summary) and char_length(summary) between 4 and 280
    and body = btrim(body) and char_length(body) between 4 and 20000
    and summary !~ '[<>]' and body !~ '[<>]'
    and (correction_reason is null
      or char_length(btrim(correction_reason)) between 4 and 500)
  ),
  constraint tournament_document_versions_publish_check check (
    (status not in ('published','superseded') or published_at is not null)
    and (status <> 'superseded' or superseded_at is not null)
  ),
  constraint tournament_document_versions_number_unique unique (document_id,version),
  constraint tournament_document_versions_org_id_unique unique (organization_id,id)
);

alter table public.tournament_documents
  add constraint tournament_documents_active_version_fk
  foreign key (active_version_id)
  references public.tournament_document_versions(id) on delete restrict;

create index tournament_document_versions_document_idx
  on public.tournament_document_versions (document_id,version desc);

create table public.tournament_document_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  document_id uuid not null,
  version_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null,
  read_at timestamptz not null default now(),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_document_acknowledgements_document_fk
    foreign key (organization_id,document_id)
    references public.tournament_documents(organization_id,id) on delete restrict,
  constraint tournament_document_acknowledgements_version_fk
    foreign key (organization_id,version_id)
    references public.tournament_document_versions(organization_id,id) on delete restrict,
  constraint tournament_document_acknowledgements_status_check
    check (status in ('read','confirmed')),
  constraint tournament_document_acknowledgements_confirm_check
    check ((status = 'confirmed') = (confirmed_at is not null)),
  constraint tournament_document_acknowledgements_unique unique (version_id,user_id),
  constraint tournament_document_acknowledgements_org_id_unique unique (organization_id,id)
);

create index tournament_document_acknowledgements_user_idx
  on public.tournament_document_acknowledgements (user_id,updated_at desc);

create table public.tournament_notification_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  general_enabled boolean not null default true,
  match_changes_enabled boolean not null default true,
  callups_enabled boolean not null default true,
  discipline_enabled boolean not null default true,
  documents_enabled boolean not null default true,
  summaries_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_notification_preferences_tournament_fk
    foreign key (organization_id,tournament_id)
    references public.tournaments(organization_id,id) on delete cascade,
  constraint tournament_notification_preferences_unique
    unique (tournament_id,user_id),
  constraint tournament_notification_preferences_org_id_unique unique (organization_id,id)
);

create index tournament_notification_preferences_user_idx
  on public.tournament_notification_preferences (user_id,tournament_id);

create or replace function public.touch_tournament_communications_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tournament_announcements_touch_updated_at
before update on public.tournament_announcements
for each row execute function public.touch_tournament_communications_updated_at();
create trigger tournament_documents_touch_updated_at
before update on public.tournament_documents
for each row execute function public.touch_tournament_communications_updated_at();
create trigger tournament_document_acknowledgements_touch_updated_at
before update on public.tournament_document_acknowledgements
for each row execute function public.touch_tournament_communications_updated_at();
create trigger tournament_notification_preferences_touch_updated_at
before update on public.tournament_notification_preferences
for each row execute function public.touch_tournament_communications_updated_at();

create or replace function public.protect_published_tournament_communication()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('published','superseded','archived','revoked')
    and (
      new.title is distinct from old.title
      or new.summary is distinct from old.summary
      or new.body is distinct from old.body
      or new.priority is distinct from old.priority
      or new.announcement_type is distinct from old.announcement_type
      or new.acknowledgement_mode is distinct from old.acknowledgement_mode
    )
  then
    raise exception using errcode = '23514',
      message = 'TORNEOS_COMMUNICATION_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger tournament_announcements_protect_published
before update on public.tournament_announcements
for each row execute function public.protect_published_tournament_communication();

create or replace function public.protect_published_tournament_document_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('published','superseded')
    and (
      new.summary is distinct from old.summary
      or new.body is distinct from old.body
      or new.effective_at is distinct from old.effective_at
    )
  then
    raise exception using errcode = '23514',
      message = 'TORNEOS_DOCUMENT_VERSION_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger tournament_document_versions_protect_published
before update on public.tournament_document_versions
for each row execute function public.protect_published_tournament_document_version();

alter table public.tournament_announcements enable row level security;
alter table public.tournament_announcement_audiences enable row level security;
alter table public.tournament_announcement_links enable row level security;
alter table public.tournament_announcement_deliveries enable row level security;
alter table public.tournament_documents enable row level security;
alter table public.tournament_document_versions enable row level security;
alter table public.tournament_document_acknowledgements enable row level security;
alter table public.tournament_notification_preferences enable row level security;

revoke all on table public.tournament_announcements from anon,authenticated;
revoke all on table public.tournament_announcement_audiences from anon,authenticated;
revoke all on table public.tournament_announcement_links from anon,authenticated;
revoke all on table public.tournament_announcement_deliveries from anon,authenticated;
revoke all on table public.tournament_documents from anon,authenticated;
revoke all on table public.tournament_document_versions from anon,authenticated;
revoke all on table public.tournament_document_acknowledgements from anon,authenticated;
revoke all on table public.tournament_notification_preferences from anon,authenticated;

create or replace function public.tournament_communications_role_capabilities(p_role text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'owner' then array[
      'announcements.read','announcements.create','announcements.update_draft',
      'announcements.publish','announcements.schedule','announcements.archive',
      'announcements.revoke','documents.read','documents.create',
      'documents.update_draft','documents.publish','documents.archive',
      'audiences.preview','deliveries.read_summary',
      'notification_preferences.manage_self'
    ]::text[]
    when 'admin' then array[
      'announcements.read','announcements.create','announcements.update_draft',
      'announcements.publish','announcements.schedule','announcements.archive',
      'announcements.revoke','documents.read','documents.create',
      'documents.update_draft','documents.publish','documents.archive',
      'audiences.preview','deliveries.read_summary',
      'notification_preferences.manage_self'
    ]::text[]
    when 'collaborator' then array[
      'announcements.read','announcements.create','announcements.update_draft',
      'documents.read','documents.create','documents.update_draft',
      'audiences.preview','notification_preferences.manage_self'
    ]::text[]
    else array['notification_preferences.manage_self']::text[]
  end;
$$;

create or replace function public.has_tournament_communications_capability(
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
      and p_capability = any(
        public.tournament_communications_role_capabilities(membership.role)
      )
  );
$$;

revoke all on function public.has_tournament_communications_capability(uuid,text)
  from public,anon,authenticated;

create or replace function public.resolve_tournament_announcement_recipients(
  p_announcement_id uuid
)
returns table(user_id uuid, relation_type text)
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select announcement.*
    from public.tournament_announcements announcement
    where announcement.id = p_announcement_id
  ),
  audience as (
    select definition.*
    from public.tournament_announcement_audiences definition
    join target on target.id = definition.announcement_id
      and target.organization_id = definition.organization_id
  ),
  resolved as (
    select membership.user_id, 'organization_member'::text relation_type
    from target
    join audience on audience.audience_type = 'organization'
    join public.tournament_organization_members membership
      on membership.organization_id = target.organization_id
     and membership.status = 'active'

    union all

    select
      coalesce(player.arma2_user_id, provisional.claimed_by_user_id),
      'player'::text
    from target
    join audience on audience.audience_type in ('tournament','category','team','players')
    join public.tournament_team_entries entry
      on entry.organization_id = target.organization_id
     and entry.tournament_id = target.tournament_id
     and entry.status = 'approved'
     and (audience.category_id is null or entry.category_id = audience.category_id)
     and (audience.team_entry_id is null or entry.id = audience.team_entry_id)
    join public.tournament_rosters roster
      on roster.organization_id = entry.organization_id
     and roster.team_entry_id = entry.id
     and roster.status in ('approved','locked')
    join public.tournament_roster_players player
      on player.organization_id = roster.organization_id
     and player.team_entry_id = roster.team_entry_id
     and player.roster_id = roster.id
     and player.status = 'active'
    left join public.tournament_provisional_players provisional
      on provisional.organization_id = player.organization_id
     and provisional.id = player.provisional_player_id
     and provisional.claim_status = 'claimed'
    where coalesce(player.arma2_user_id, provisional.claimed_by_user_id) is not null

    union all

    select manager.user_id, manager.role::text
    from target
    join audience
      on audience.audience_type in ('tournament','category','team','captains')
    join public.tournament_team_entries entry
      on entry.organization_id = target.organization_id
     and entry.tournament_id = target.tournament_id
     and entry.status = 'approved'
     and (audience.category_id is null or entry.category_id = audience.category_id)
     and (audience.team_entry_id is null or entry.id = audience.team_entry_id)
    join public.tournament_team_managers manager
      on manager.organization_id = entry.organization_id
     and manager.team_entry_id = entry.id
     and manager.status = 'active'
     and manager.role in ('captain','delegate')

    union all

    select
      coalesce(player.arma2_user_id, provisional.claimed_by_user_id),
      'match_participant'::text
    from target
    join audience on audience.audience_type in ('match','home_team','away_team')
    join public.tournament_matches match
      on match.organization_id = target.organization_id
     and match.tournament_id = target.tournament_id
     and match.id = audience.match_id
    join public.tournament_competition_participants participant
      on participant.organization_id = match.organization_id
     and participant.tournament_id = match.tournament_id
     and participant.category_id = match.category_id
     and participant.participant_set_id = match.participant_set_id
     and participant.id = case
       when audience.audience_type = 'home_team' then match.home_participant_id
       when audience.audience_type = 'away_team' then match.away_participant_id
       else participant.id
     end
     and (
       audience.audience_type <> 'match'
       or participant.id in (match.home_participant_id,match.away_participant_id)
     )
    join public.tournament_rosters roster
      on roster.organization_id = participant.organization_id
     and roster.team_entry_id = participant.team_entry_id
     and roster.status in ('approved','locked')
    join public.tournament_roster_players player
      on player.organization_id = roster.organization_id
     and player.team_entry_id = roster.team_entry_id
     and player.roster_id = roster.id
     and player.status = 'active'
    left join public.tournament_provisional_players provisional
      on provisional.organization_id = player.organization_id
     and provisional.id = player.provisional_player_id
     and provisional.claim_status = 'claimed'
    where coalesce(player.arma2_user_id, provisional.claimed_by_user_id) is not null

    union all

    select audience.specific_user_id, 'specific'::text
    from target
    join audience on audience.audience_type = 'specific_user'
    where exists (
      select 1
      from public.tournament_organization_members membership
      where membership.organization_id = target.organization_id
        and membership.user_id = audience.specific_user_id
        and membership.status = 'active'
    ) or exists (
      select 1
      from public.tournament_team_entries entry
      join public.tournament_rosters roster
        on roster.organization_id = entry.organization_id
       and roster.team_entry_id = entry.id
       and roster.status in ('approved','locked')
      join public.tournament_roster_players player
        on player.organization_id = roster.organization_id
       and player.team_entry_id = roster.team_entry_id
       and player.roster_id = roster.id
       and player.status = 'active'
      left join public.tournament_provisional_players provisional
        on provisional.organization_id = player.organization_id
       and provisional.id = player.provisional_player_id
       and provisional.claim_status = 'claimed'
      where entry.organization_id = target.organization_id
        and entry.tournament_id = target.tournament_id
        and entry.status = 'approved'
        and coalesce(player.arma2_user_id, provisional.claimed_by_user_id)
          = audience.specific_user_id
    )
  )
  select distinct on (resolved.user_id)
    resolved.user_id,
    resolved.relation_type
  from resolved
  where resolved.user_id is not null
  order by resolved.user_id, resolved.relation_type;
$$;

revoke all on function public.resolve_tournament_announcement_recipients(uuid)
  from public,anon,authenticated;

create or replace function public.create_tournament_announcement_draft(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid,
  p_announcement_type text,
  p_title text,
  p_summary text,
  p_body text,
  p_priority text,
  p_acknowledgement_mode text,
  p_scheduled_for timestamptz,
  p_supersedes_id uuid,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_existing public.tournament_announcements%rowtype;
  v_id uuid;
  v_version integer := 1;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'TORNEOS_IDEMPOTENCY_REQUIRED';
  end if;
  if not public.has_tournament_communications_capability(
    p_organization_id,'announcements.create'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_COMMUNICATION_FORBIDDEN';
  end if;
  select * into v_tournament
  from public.tournaments tournament
  where tournament.id = p_tournament_id
    and tournament.organization_id = p_organization_id
    and tournament.status <> 'archived';
  if v_tournament.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_COMMUNICATION_FORBIDDEN';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.tournament_categories category
    where category.id = p_category_id
      and category.organization_id = p_organization_id
      and category.tournament_id = p_tournament_id
      and category.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_COMMUNICATION_FORBIDDEN';
  end if;
  if p_scheduled_for is not null
    and not public.has_tournament_communications_capability(
      p_organization_id,'announcements.schedule'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_COMMUNICATION_FORBIDDEN';
  end if;
  if (select count(*) from public.tournament_announcements announcement
      where announcement.organization_id = p_organization_id
        and announcement.author_user_id = auth.uid()
        and announcement.status in ('draft','scheduled')) >= 100
  then
    raise exception using errcode = '54000', message = 'TORNEOS_DRAFT_LIMIT_REACHED';
  end if;

  select * into v_existing
  from public.tournament_announcements announcement
  where announcement.organization_id = p_organization_id
    and announcement.author_user_id = auth.uid()
    and announcement.idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.tournament_id <> p_tournament_id
      or v_existing.title <> btrim(p_title)
      or v_existing.body <> btrim(p_body)
    then
      raise exception using errcode = '23514', message = 'TORNEOS_IDEMPOTENCY_CONFLICT';
    end if;
    return v_existing.id;
  end if;

  if p_supersedes_id is not null then
    select coalesce(max(announcement.version),0) + 1 into v_version
    from public.tournament_announcements announcement
    where announcement.id = p_supersedes_id
      and announcement.organization_id = p_organization_id
      and announcement.tournament_id = p_tournament_id
      and announcement.status = 'published';
    if v_version = 1
      or p_correction_reason is null
      or char_length(btrim(p_correction_reason)) < 4
    then
      raise exception using errcode = '22023', message = 'TORNEOS_INVALID_CORRECTION';
    end if;
  end if;

  insert into public.tournament_announcements (
    organization_id,season_id,tournament_id,category_id,author_user_id,status,
    announcement_type,title,summary,body,priority,acknowledgement_mode,
    scheduled_for,version,supersedes_id,correction_reason,idempotency_key
  ) values (
    p_organization_id,v_tournament.season_id,p_tournament_id,p_category_id,
    auth.uid(),case when p_scheduled_for is null then 'draft' else 'scheduled' end,
    p_announcement_type,btrim(p_title),btrim(p_summary),btrim(p_body),
    coalesce(p_priority,'normal'),coalesce(p_acknowledgement_mode,'none'),
    p_scheduled_for,v_version,p_supersedes_id,
    nullif(btrim(coalesce(p_correction_reason,'')),''),p_idempotency_key
  ) returning id into v_id;

  perform public.append_tournament_audit(
    p_organization_id,'communications.announcement_create','announcement',
    v_id,null,p_tournament_id,
    jsonb_build_object(
      'type',p_announcement_type,'scheduled',p_scheduled_for is not null,
      'supersedesId',p_supersedes_id
    )
  );
  return v_id;
end;
$$;

create or replace function public.update_tournament_announcement_draft(
  p_announcement_id uuid,
  p_title text,
  p_summary text,
  p_body text,
  p_priority text,
  p_acknowledgement_mode text,
  p_scheduled_for timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_announcement public.tournament_announcements%rowtype;
begin
  select * into v_announcement
  from public.tournament_announcements announcement
  where announcement.id = p_announcement_id
  for update;
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if v_announcement.id is null
    or v_announcement.status not in ('draft','scheduled')
    or not public.has_tournament_communications_capability(
      v_announcement.organization_id,'announcements.update_draft'
    )
    or (
      v_announcement.author_user_id <> auth.uid()
      and not public.has_tournament_communications_capability(
        v_announcement.organization_id,'announcements.publish'
      )
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_COMMUNICATION_FORBIDDEN';
  end if;
  if p_scheduled_for is not null
    and not public.has_tournament_communications_capability(
      v_announcement.organization_id,'announcements.schedule'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_COMMUNICATION_FORBIDDEN';
  end if;

  update public.tournament_announcements
  set title = btrim(p_title),summary = btrim(p_summary),body = btrim(p_body),
    priority = coalesce(p_priority,'normal'),
    acknowledgement_mode = coalesce(p_acknowledgement_mode,'none'),
    scheduled_for = p_scheduled_for,
    status = case when p_scheduled_for is null then 'draft' else 'scheduled' end
  where id = p_announcement_id;
  perform public.append_tournament_audit(
    v_announcement.organization_id,'communications.announcement_update','announcement',
    p_announcement_id,null,v_announcement.tournament_id,'{}'::jsonb
  );
  return p_announcement_id;
end;
$$;

create or replace function public.set_tournament_announcement_audience(
  p_announcement_id uuid,
  p_audience_type text,
  p_category_id uuid default null,
  p_team_entry_id uuid default null,
  p_match_id uuid default null,
  p_specific_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_announcement public.tournament_announcements%rowtype;
  v_id uuid;
begin
  select * into v_announcement
  from public.tournament_announcements announcement
  where announcement.id = p_announcement_id
  for update;
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if v_announcement.id is null
    or v_announcement.status not in ('draft','scheduled')
    or not public.has_tournament_communications_capability(
      v_announcement.organization_id,'announcements.update_draft'
    )
    or (
      v_announcement.author_user_id <> auth.uid()
      and not public.has_tournament_communications_capability(
        v_announcement.organization_id,'announcements.publish'
      )
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_COMMUNICATION_FORBIDDEN';
  end if;
  if (select count(*) from public.tournament_announcement_audiences audience
      where audience.announcement_id = p_announcement_id) >= 12
  then
    raise exception using errcode = '54000', message = 'TORNEOS_AUDIENCE_LIMIT_REACHED';
  end if;
  if p_audience_type = 'category' and not exists (
    select 1 from public.tournament_categories category
    where category.id = p_category_id
      and category.organization_id = v_announcement.organization_id
      and category.tournament_id = v_announcement.tournament_id
      and category.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_INVALID_AUDIENCE';
  elsif p_audience_type = 'team' and not exists (
    select 1 from public.tournament_team_entries entry
    where entry.id = p_team_entry_id
      and entry.organization_id = v_announcement.organization_id
      and entry.tournament_id = v_announcement.tournament_id
      and entry.status = 'approved'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_INVALID_AUDIENCE';
  elsif p_audience_type in ('match','home_team','away_team') and not exists (
    select 1 from public.tournament_matches match
    join public.tournament_fixture_versions fixture
      on fixture.id = match.fixture_version_id
     and fixture.organization_id = match.organization_id
     and fixture.status = 'published'
    where match.id = p_match_id
      and match.organization_id = v_announcement.organization_id
      and match.tournament_id = v_announcement.tournament_id
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_INVALID_AUDIENCE';
  end if;

  insert into public.tournament_announcement_audiences (
    organization_id,announcement_id,audience_type,category_id,team_entry_id,
    match_id,specific_user_id,created_by
  ) values (
    v_announcement.organization_id,p_announcement_id,p_audience_type,
    p_category_id,p_team_entry_id,p_match_id,p_specific_user_id,auth.uid()
  )
  on conflict on constraint tournament_announcement_audiences_unique
  do update set created_by = excluded.created_by
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.preview_tournament_announcement_audience(
  p_announcement_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_announcement public.tournament_announcements%rowtype;
  v_count integer;
  v_teams jsonb;
  v_roles jsonb;
begin
  select * into v_announcement
  from public.tournament_announcements announcement
  where announcement.id = p_announcement_id;
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if v_announcement.id is null
    or not public.has_tournament_communications_capability(
      v_announcement.organization_id,'audiences.preview'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_COMMUNICATION_FORBIDDEN';
  end if;
  select count(*),coalesce(jsonb_agg(distinct relation_type),'[]'::jsonb)
    into v_count,v_roles
  from public.resolve_tournament_announcement_recipients(p_announcement_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',entry.id,'name',entry.name
  ) order by entry.name),'[]'::jsonb) into v_teams
  from public.tournament_announcement_audiences audience
  join public.tournament_team_entries entry on entry.id = audience.team_entry_id
  where audience.announcement_id = p_announcement_id;
  return jsonb_build_object(
    'announcementId',p_announcement_id,
    'estimatedRecipients',v_count,
    'roles',v_roles,
    'teams',v_teams,
    'channel','internal_only',
    'revalidatedAt',now()
  );
end;
$$;

create or replace function public.publish_tournament_announcement(
  p_announcement_id uuid,
  p_expected_recipient_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_announcement public.tournament_announcements%rowtype;
  v_count integer;
  v_snapshot jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_announcement
  from public.tournament_announcements announcement
  where announcement.id = p_announcement_id
  for update;
  if v_announcement.id is null
    or not public.has_tournament_communications_capability(
      v_announcement.organization_id,'announcements.publish'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_COMMUNICATION_FORBIDDEN';
  end if;
  if v_announcement.status = 'published' then
    return jsonb_build_object(
      'announcementId',v_announcement.id,
      'status','published',
      'recipientCount',v_announcement.published_recipient_count,
      'audienceChanged',false
    );
  end if;
  if v_announcement.status not in ('draft','scheduled') then
    raise exception using errcode = '23514', message = 'TORNEOS_COMMUNICATION_NOT_PUBLISHABLE';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_announcement.organization_id::text,731)
  );
  if (select count(*) from public.tournament_announcements announcement
      where announcement.organization_id = v_announcement.organization_id
        and announcement.status in ('published','superseded','archived','revoked')
        and announcement.published_at >= now() - interval '1 hour') >= 20
  then
    raise exception using errcode = '54000', message = 'TORNEOS_PUBLISH_RATE_LIMITED';
  end if;
  if not exists (
    select 1 from public.tournament_announcement_audiences audience
    where audience.announcement_id = p_announcement_id
  ) then
    raise exception using errcode = '23514', message = 'TORNEOS_AUDIENCE_REQUIRED';
  end if;

  select count(*) into v_count
  from public.resolve_tournament_announcement_recipients(p_announcement_id);
  if v_count = 0 then
    raise exception using errcode = '23514', message = 'TORNEOS_AUDIENCE_EMPTY';
  end if;
  if v_count > 5000 then
    raise exception using errcode = '54000', message = 'TORNEOS_RECIPIENT_LIMIT_REACHED';
  end if;
  select jsonb_build_object(
    'criteria',coalesce(jsonb_agg(jsonb_build_object(
      'type',audience.audience_type,
      'categoryId',audience.category_id,
      'teamEntryId',audience.team_entry_id,
      'matchId',audience.match_id
    ) order by audience.created_at,audience.id),'[]'::jsonb),
    'recipientCount',v_count,
    'resolvedAt',now()
  ) into v_snapshot
  from public.tournament_announcement_audiences audience
  where audience.announcement_id = p_announcement_id;

  insert into public.tournament_announcement_deliveries (
    organization_id,announcement_id,recipient_user_id,recipient_relation_type
  )
  select v_announcement.organization_id,p_announcement_id,user_id,relation_type
  from public.resolve_tournament_announcement_recipients(p_announcement_id)
  on conflict (announcement_id,recipient_user_id) do nothing;

  if v_announcement.supersedes_id is not null then
    update public.tournament_announcements
    set status = 'superseded'
    where id = v_announcement.supersedes_id and status = 'published';
  end if;
  update public.tournament_announcements
  set status = 'published',published_at = now(),scheduled_for = null,
    published_recipient_count = v_count,audience_snapshot = v_snapshot
  where id = p_announcement_id;

  perform public.append_tournament_audit(
    v_announcement.organization_id,'communications.announcement_publish','announcement',
    p_announcement_id,null,v_announcement.tournament_id,
    jsonb_build_object(
      'recipientCount',v_count,
      'previewCount',p_expected_recipient_count,
      'audienceChanged',p_expected_recipient_count is not null
        and p_expected_recipient_count <> v_count,
      'channel','internal_only'
    )
  );
  return jsonb_build_object(
    'announcementId',p_announcement_id,'status','published',
    'recipientCount',v_count,
    'audienceChanged',p_expected_recipient_count is not null
      and p_expected_recipient_count <> v_count
  );
end;
$$;

create or replace function public.can_access_tournament_communications(
  p_tournament_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.tournaments tournament
    join public.tournament_organizations organization
      on organization.id = tournament.organization_id
    where tournament.id = p_tournament_id
      and organization.status = 'active'
      and (
        exists (
          select 1
          from public.tournament_organization_members membership
          where membership.organization_id = tournament.organization_id
            and membership.user_id = auth.uid()
            and membership.status = 'active'
        )
        or exists (
          select 1
          from public.tournament_categories category
          where category.organization_id = tournament.organization_id
            and category.tournament_id = tournament.id
            and category.status = 'active'
            and public.can_read_tournament_participant_hub(
              tournament.id,category.id
            )
        )
      )
  );
$$;

revoke all on function public.can_access_tournament_communications(uuid)
  from public,anon,authenticated;

create or replace function public.set_tournament_announcement_link(
  p_announcement_id uuid,
  p_link_type text,
  p_resource_id uuid,
  p_external_url text,
  p_label text,
  p_sort_order integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_announcement public.tournament_announcements%rowtype;
  v_id uuid;
  v_valid boolean := false;
begin
  select * into v_announcement
  from public.tournament_announcements announcement
  where announcement.id = p_announcement_id
  for update;
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if v_announcement.id is null
    or v_announcement.status not in ('draft','scheduled')
    or not public.has_tournament_communications_capability(
      v_announcement.organization_id,'announcements.update_draft'
    )
    or (
      v_announcement.author_user_id <> auth.uid()
      and not public.has_tournament_communications_capability(
        v_announcement.organization_id,'announcements.publish'
      )
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_COMMUNICATION_FORBIDDEN';
  end if;
  if (select count(*) from public.tournament_announcement_links link
      where link.announcement_id = p_announcement_id) >= 5
  then
    raise exception using errcode = '54000', message = 'TORNEOS_LINK_LIMIT_REACHED';
  end if;
  if p_link_type = 'external' then
    v_valid := p_external_url ~
      '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:/[^[:space:]]*)?$';
  elsif p_link_type = 'tournament' then
    v_valid := p_resource_id = v_announcement.tournament_id;
  elsif p_link_type = 'category' then
    v_valid := exists (
      select 1 from public.tournament_categories category
      where category.id = p_resource_id
        and category.organization_id = v_announcement.organization_id
        and category.tournament_id = v_announcement.tournament_id
    );
  elsif p_link_type = 'match' then
    v_valid := exists (
      select 1 from public.tournament_matches match
      where match.id = p_resource_id
        and match.organization_id = v_announcement.organization_id
        and match.tournament_id = v_announcement.tournament_id
    );
  elsif p_link_type in ('round','standings','discipline') then
    v_valid := p_resource_id = v_announcement.tournament_id;
  elsif p_link_type = 'document' then
    v_valid := exists (
      select 1 from public.tournament_documents document
      where document.id = p_resource_id
        and document.organization_id = v_announcement.organization_id
        and document.tournament_id = v_announcement.tournament_id
    );
  end if;
  if not v_valid then
    raise exception using errcode = '42501', message = 'TORNEOS_INVALID_COMMUNICATION_LINK';
  end if;

  insert into public.tournament_announcement_links (
    organization_id,announcement_id,link_type,resource_id,external_url,label,sort_order
  ) values (
    v_announcement.organization_id,p_announcement_id,p_link_type,p_resource_id,
    nullif(btrim(coalesce(p_external_url,'')),''),btrim(p_label),p_sort_order
  )
  on conflict (announcement_id,sort_order) do update
  set link_type = excluded.link_type,resource_id = excluded.resource_id,
    external_url = excluded.external_url,label = excluded.label
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.get_tournament_communications_inbox(
  p_tournament_id uuid default null,
  p_filter text default 'all',
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
  v_limit integer := least(greatest(coalesce(p_limit,20),1),50);
  v_offset integer := least(greatest(coalesce(p_offset,0),0),5000);
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_filter not in ('all','unread','important','documents') then
    raise exception using errcode = '22023', message = 'TORNEOS_COMMUNICATION_INVALID_FILTER';
  end if;
  return (
    with eligible as (
      select
        delivery.id delivery_id,
        delivery.status delivery_status,
        delivery.read_at,
        delivery.confirmed_at,
        announcement.id,
        announcement.tournament_id,
        announcement.category_id,
        announcement.status,
        announcement.announcement_type,
        announcement.title,
        announcement.summary,
        announcement.priority,
        announcement.acknowledgement_mode,
        announcement.published_at,
        announcement.version,
        announcement.supersedes_id,
        tournament.name tournament_name,
        season.name season_name,
        organization.name organization_name,
        category.name category_name,
        exists (
          select 1
          from public.tournament_announcements update_announcement
          join public.tournament_announcement_deliveries update_delivery
            on update_delivery.announcement_id = update_announcement.id
           and update_delivery.recipient_user_id = auth.uid()
          where update_announcement.supersedes_id = announcement.id
            and update_announcement.status = 'published'
        ) has_update
      from public.tournament_announcement_deliveries delivery
      join public.tournament_announcements announcement
        on announcement.id = delivery.announcement_id
       and announcement.organization_id = delivery.organization_id
      join public.tournaments tournament on tournament.id = announcement.tournament_id
      join public.tournament_seasons season on season.id = announcement.season_id
      join public.tournament_organizations organization
        on organization.id = announcement.organization_id
      left join public.tournament_categories category
        on category.id = announcement.category_id
      where delivery.recipient_user_id = auth.uid()
        and delivery.status <> 'archived'
        and public.can_access_tournament_communications(announcement.tournament_id)
        and (p_tournament_id is null or announcement.tournament_id = p_tournament_id)
        and (
          p_filter = 'all'
          or (p_filter = 'unread' and delivery.read_at is null)
          or (p_filter = 'important' and announcement.priority in ('important','urgent'))
          or (p_filter = 'documents' and announcement.announcement_type = 'regulation')
        )
    ),
    page as (
      select * from eligible
      order by
        case priority when 'urgent' then 0 when 'important' then 1 else 2 end,
        published_at desc,id desc
      limit v_limit offset v_offset
    )
    select jsonb_build_object(
      'items',coalesce(jsonb_agg(jsonb_build_object(
        'deliveryId',page.delivery_id,
        'deliveryStatus',page.delivery_status,
        'readAt',page.read_at,
        'confirmedAt',page.confirmed_at,
        'id',page.id,
        'tournamentId',page.tournament_id,
        'categoryId',page.category_id,
        'status',page.status,
        'type',page.announcement_type,
        'title',page.title,
        'summary',page.summary,
        'priority',page.priority,
        'acknowledgementMode',page.acknowledgement_mode,
        'publishedAt',page.published_at,
        'version',page.version,
        'updated',page.has_update,
        'tournamentName',page.tournament_name,
        'seasonName',page.season_name,
        'organizationName',page.organization_name,
        'categoryName',page.category_name
      ) order by
        case page.priority when 'urgent' then 0 when 'important' then 1 else 2 end,
        page.published_at desc,page.id desc),'[]'::jsonb),
      'pagination',jsonb_build_object(
        'limit',v_limit,'offset',v_offset,
        'total',(select count(*) from eligible)
      ),
      'unreadCount',(
        select count(*)
        from public.tournament_announcement_deliveries unread
        join public.tournament_announcements unread_announcement
          on unread_announcement.id = unread.announcement_id
        where unread.recipient_user_id = auth.uid()
          and unread.read_at is null
          and unread.status = 'available'
          and public.can_access_tournament_communications(
            unread_announcement.tournament_id
          )
          and (p_tournament_id is null
            or unread_announcement.tournament_id = p_tournament_id)
      )
    )
    from page
  );
end;
$$;

create or replace function public.get_tournament_announcement(
  p_announcement_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_delivery public.tournament_announcement_deliveries%rowtype;
  v_announcement public.tournament_announcements%rowtype;
  v_can_manage boolean;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_announcement
  from public.tournament_announcements announcement
  where announcement.id = p_announcement_id;
  v_can_manage := v_announcement.id is not null
    and public.has_tournament_communications_capability(
      v_announcement.organization_id,'announcements.read'
    );
  select * into v_delivery
  from public.tournament_announcement_deliveries delivery
  where delivery.announcement_id = p_announcement_id
    and delivery.recipient_user_id = auth.uid()
    and delivery.status <> 'archived';
  if v_announcement.id is null
    or (
      v_delivery.id is not null
      and not v_can_manage
      and not public.can_access_tournament_communications(v_announcement.tournament_id)
    )
    or (v_delivery.id is null and not v_can_manage)
  then
    raise exception using errcode = '42501', message = 'TORNEOS_COMMUNICATION_FORBIDDEN';
  end if;
  return (
    select jsonb_build_object(
      'id',announcement.id,
      'status',announcement.status,
      'type',announcement.announcement_type,
      'title',announcement.title,
      'summary',announcement.summary,
      'body',announcement.body,
      'priority',announcement.priority,
      'acknowledgementMode',announcement.acknowledgement_mode,
      'publishedAt',announcement.published_at,
      'scheduledFor',case when v_can_manage then announcement.scheduled_for else null end,
      'version',announcement.version,
      'updatedFromId',announcement.supersedes_id,
      'correctionReason',announcement.correction_reason,
      'tournament',jsonb_build_object('id',tournament.id,'name',tournament.name),
      'category',case when category.id is null then null else
        jsonb_build_object('id',category.id,'name',category.name) end,
      'organization',jsonb_build_object('id',organization.id,'name',organization.name),
      'delivery',case when v_delivery.id is null then null else jsonb_build_object(
        'status',v_delivery.status,'readAt',v_delivery.read_at,
        'confirmedAt',v_delivery.confirmed_at
      ) end,
      'links',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',link.id,'type',link.link_type,'label',link.label,
          'resourceId',link.resource_id,'externalUrl',link.external_url,
          'externalDomain',case when link.external_url is null then null
            else split_part(split_part(link.external_url,'//',2),'/',1) end
        ) order by link.sort_order,link.id)
        from public.tournament_announcement_links link
        where link.announcement_id = announcement.id
      ),'[]'::jsonb),
      'canManage',v_can_manage
    )
    from public.tournament_announcements announcement
    join public.tournaments tournament on tournament.id = announcement.tournament_id
    join public.tournament_organizations organization
      on organization.id = announcement.organization_id
    left join public.tournament_categories category
      on category.id = announcement.category_id
    where announcement.id = p_announcement_id
  );
end;
$$;

create or replace function public.mark_tournament_announcement_read(
  p_announcement_id uuid,
  p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.tournament_announcement_deliveries%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select delivery.* into v_delivery
  from public.tournament_announcement_deliveries delivery
  join public.tournament_announcements announcement
    on announcement.id = delivery.announcement_id
  where delivery.announcement_id = p_announcement_id
    and delivery.recipient_user_id = auth.uid()
    and delivery.status not in ('archived','revoked')
    and public.can_access_tournament_communications(announcement.tournament_id)
  for update of delivery;
  if v_delivery.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_COMMUNICATION_FORBIDDEN';
  end if;
  update public.tournament_announcement_deliveries
  set read_at = coalesce(read_at,now()),
    confirmed_at = case when p_confirm then coalesce(confirmed_at,now()) else confirmed_at end,
    status = case when p_confirm then 'confirmed' else
      case when status = 'confirmed' then status else 'read' end end
  where id = v_delivery.id;
  return jsonb_build_object(
    'announcementId',p_announcement_id,
    'status',case when p_confirm then 'confirmed' else 'read' end,
    'confirmationIsLegalAcceptance',false
  );
end;
$$;

create or replace function public.archive_tournament_announcement(
  p_announcement_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_announcement public.tournament_announcements%rowtype;
begin
  select * into v_announcement
  from public.tournament_announcements announcement
  where announcement.id = p_announcement_id
  for update;
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if v_announcement.id is null
    or not public.has_tournament_communications_capability(
      v_announcement.organization_id,'announcements.archive'
    )
    or v_announcement.status not in ('published','superseded')
  then
    raise exception using errcode = '42501', message = 'TORNEOS_COMMUNICATION_FORBIDDEN';
  end if;
  update public.tournament_announcements
  set status = 'archived',archived_at = now()
  where id = p_announcement_id;
  perform public.append_tournament_audit(
    v_announcement.organization_id,'communications.announcement_archive','announcement',
    p_announcement_id,null,v_announcement.tournament_id,'{}'::jsonb
  );
  return p_announcement_id;
end;
$$;

create or replace function public.revoke_tournament_announcement(
  p_announcement_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_announcement public.tournament_announcements%rowtype;
begin
  select * into v_announcement
  from public.tournament_announcements announcement
  where announcement.id = p_announcement_id
  for update;
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if v_announcement.id is null
    or not public.has_tournament_communications_capability(
      v_announcement.organization_id,'announcements.revoke'
    )
    or v_announcement.status <> 'published'
    or p_reason is null or char_length(btrim(p_reason)) < 4
  then
    raise exception using errcode = '42501', message = 'TORNEOS_COMMUNICATION_FORBIDDEN';
  end if;
  update public.tournament_announcements
  set status = 'revoked',revoked_at = now(),revoked_reason = btrim(p_reason)
  where id = p_announcement_id;
  update public.tournament_announcement_deliveries
  set status = 'revoked',revoked_at = now()
  where announcement_id = p_announcement_id
    and status <> 'archived';
  perform public.append_tournament_audit(
    v_announcement.organization_id,'communications.announcement_revoke','announcement',
    p_announcement_id,null,v_announcement.tournament_id,
    jsonb_build_object('reason',btrim(p_reason))
  );
  return p_announcement_id;
end;
$$;

create or replace function public.get_my_tournament_notification_preferences(
  p_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_preference public.tournament_notification_preferences%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.can_access_tournament_communications(p_tournament_id) then
    raise exception using errcode = '42501', message = 'TORNEOS_COMMUNICATION_FORBIDDEN';
  end if;
  select * into v_tournament from public.tournaments where id = p_tournament_id;
  select * into v_preference
  from public.tournament_notification_preferences preference
  where preference.tournament_id = p_tournament_id
    and preference.user_id = auth.uid();
  return jsonb_build_object(
    'tournamentId',p_tournament_id,
    'general',coalesce(v_preference.general_enabled,true),
    'matchChanges',coalesce(v_preference.match_changes_enabled,true),
    'callups',coalesce(v_preference.callups_enabled,true),
    'discipline',coalesce(v_preference.discipline_enabled,true),
    'documents',coalesce(v_preference.documents_enabled,true),
    'summaries',coalesce(v_preference.summaries_enabled,true),
    'mandatoryInbox',jsonb_build_array('own_match_urgent','own_discipline','required_document'),
    'channels',jsonb_build_object('internal',true,'push',false,'email',false)
  );
end;
$$;

create or replace function public.update_my_tournament_notification_preferences(
  p_tournament_id uuid,
  p_general boolean,
  p_match_changes boolean,
  p_callups boolean,
  p_discipline boolean,
  p_documents boolean,
  p_summaries boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament public.tournaments%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.can_access_tournament_communications(p_tournament_id) then
    raise exception using errcode = '42501', message = 'TORNEOS_COMMUNICATION_FORBIDDEN';
  end if;
  select * into v_tournament from public.tournaments where id = p_tournament_id;
  insert into public.tournament_notification_preferences (
    organization_id,tournament_id,user_id,general_enabled,match_changes_enabled,
    callups_enabled,discipline_enabled,documents_enabled,summaries_enabled
  ) values (
    v_tournament.organization_id,p_tournament_id,auth.uid(),
    coalesce(p_general,true),coalesce(p_match_changes,true),
    coalesce(p_callups,true),coalesce(p_discipline,true),
    coalesce(p_documents,true),coalesce(p_summaries,true)
  )
  on conflict (tournament_id,user_id) do update set
    general_enabled = excluded.general_enabled,
    match_changes_enabled = excluded.match_changes_enabled,
    callups_enabled = excluded.callups_enabled,
    discipline_enabled = excluded.discipline_enabled,
    documents_enabled = excluded.documents_enabled,
    summaries_enabled = excluded.summaries_enabled;
  return public.get_my_tournament_notification_preferences(p_tournament_id);
end;
$$;

create or replace function public.create_tournament_document(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid,
  p_document_type text,
  p_title text,
  p_summary text,
  p_body text,
  p_acknowledgement_mode text,
  p_effective_at timestamptz,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_document_id uuid;
  v_version_id uuid;
  v_existing public.tournament_documents%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'TORNEOS_IDEMPOTENCY_REQUIRED';
  end if;
  if not public.has_tournament_communications_capability(
    p_organization_id,'documents.create'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_DOCUMENT_FORBIDDEN';
  end if;
  select * into v_tournament
  from public.tournaments tournament
  where tournament.id = p_tournament_id
    and tournament.organization_id = p_organization_id
    and tournament.status <> 'archived';
  if v_tournament.id is null
    or (p_category_id is not null and not exists (
      select 1 from public.tournament_categories category
      where category.id = p_category_id
        and category.organization_id = p_organization_id
        and category.tournament_id = p_tournament_id
        and category.status = 'active'
    ))
  then
    raise exception using errcode = '42501', message = 'TORNEOS_DOCUMENT_FORBIDDEN';
  end if;
  select * into v_existing
  from public.tournament_documents document
  where document.organization_id = p_organization_id
    and document.created_by = auth.uid()
    and document.idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    return jsonb_build_object(
      'documentId',v_existing.id,'versionId',v_existing.active_version_id
    );
  end if;

  insert into public.tournament_documents (
    organization_id,season_id,tournament_id,category_id,document_type,title,
    acknowledgement_mode,created_by,idempotency_key
  ) values (
    p_organization_id,v_tournament.season_id,p_tournament_id,p_category_id,
    p_document_type,btrim(p_title),coalesce(p_acknowledgement_mode,'none'),
    auth.uid(),p_idempotency_key
  ) returning id into v_document_id;
  insert into public.tournament_document_versions (
    organization_id,document_id,version,status,summary,body,effective_at,created_by
  ) values (
    p_organization_id,v_document_id,1,'draft',btrim(p_summary),btrim(p_body),
    p_effective_at,auth.uid()
  ) returning id into v_version_id;
  perform public.append_tournament_audit(
    p_organization_id,'communications.document_create','tournament_document',
    v_document_id,null,p_tournament_id,
    jsonb_build_object('versionId',v_version_id,'type',p_document_type)
  );
  return jsonb_build_object('documentId',v_document_id,'versionId',v_version_id);
end;
$$;

create or replace function public.create_tournament_document_version(
  p_document_id uuid,
  p_summary text,
  p_body text,
  p_effective_at timestamptz,
  p_correction_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.tournament_documents%rowtype;
  v_version integer;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_document
  from public.tournament_documents document
  where document.id = p_document_id
  for update;
  if v_document.id is null
    or v_document.status = 'archived'
    or not public.has_tournament_communications_capability(
      v_document.organization_id,'documents.update_draft'
    )
    or p_correction_reason is null
    or char_length(btrim(p_correction_reason)) < 4
  then
    raise exception using errcode = '42501', message = 'TORNEOS_DOCUMENT_FORBIDDEN';
  end if;
  if exists (
    select 1 from public.tournament_document_versions version
    where version.document_id = p_document_id and version.status = 'draft'
  ) then
    raise exception using errcode = '23514', message = 'TORNEOS_DOCUMENT_DRAFT_EXISTS';
  end if;
  select coalesce(max(version),0) + 1 into v_version
  from public.tournament_document_versions
  where document_id = p_document_id;
  insert into public.tournament_document_versions (
    organization_id,document_id,version,status,summary,body,effective_at,
    correction_reason,created_by,source_version_id
  ) values (
    v_document.organization_id,p_document_id,v_version,'draft',
    btrim(p_summary),btrim(p_body),p_effective_at,btrim(p_correction_reason),
    auth.uid(),v_document.active_version_id
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_tournament_document_draft(
  p_version_id uuid,
  p_summary text,
  p_body text,
  p_effective_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.tournament_document_versions%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_version
  from public.tournament_document_versions version
  where version.id = p_version_id
  for update;
  if v_version.id is null
    or v_version.status <> 'draft'
    or not public.has_tournament_communications_capability(
      v_version.organization_id,'documents.update_draft'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_DOCUMENT_FORBIDDEN';
  end if;
  update public.tournament_document_versions
  set summary = btrim(p_summary),body = btrim(p_body),effective_at = p_effective_at
  where id = p_version_id;
  return p_version_id;
end;
$$;

create or replace function public.publish_tournament_document_version(
  p_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.tournament_document_versions%rowtype;
  v_document public.tournament_documents%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_version
  from public.tournament_document_versions version
  where version.id = p_version_id
  for update;
  if v_version.status = 'published' then
    return jsonb_build_object(
      'documentId',v_version.document_id,'versionId',v_version.id,'status','published'
    );
  end if;
  select * into v_document
  from public.tournament_documents document
  where document.id = v_version.document_id
  for update;
  if v_version.id is null or v_version.status <> 'draft'
    or v_document.status = 'archived'
    or not public.has_tournament_communications_capability(
      v_version.organization_id,'documents.publish'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_DOCUMENT_FORBIDDEN';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_document.id::text,733));
  update public.tournament_document_versions
  set status = 'superseded',superseded_at = now()
  where document_id = v_document.id and status = 'published';
  update public.tournament_document_versions
  set status = 'published',published_by = auth.uid(),published_at = now()
  where id = p_version_id;
  update public.tournament_documents
  set status = 'published',active_version_id = p_version_id
  where id = v_document.id;
  perform public.append_tournament_audit(
    v_document.organization_id,'communications.document_publish','tournament_document',
    v_document.id,null,v_document.tournament_id,
    jsonb_build_object('versionId',p_version_id,'version',v_version.version)
  );
  return jsonb_build_object(
    'documentId',v_document.id,'versionId',p_version_id,'status','published'
  );
end;
$$;

create or replace function public.archive_tournament_document(
  p_document_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.tournament_documents%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_document
  from public.tournament_documents document
  where document.id = p_document_id
  for update;
  if v_document.id is null
    or not public.has_tournament_communications_capability(
      v_document.organization_id,'documents.archive'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_DOCUMENT_FORBIDDEN';
  end if;
  update public.tournament_documents
  set status = 'archived',archived_at = now()
  where id = p_document_id;
  perform public.append_tournament_audit(
    v_document.organization_id,'communications.document_archive','tournament_document',
    p_document_id,null,v_document.tournament_id,'{}'::jsonb
  );
  return p_document_id;
end;
$$;

create or replace function public.get_published_tournament_documents(
  p_tournament_id uuid,
  p_category_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_can_manage boolean := false;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select public.has_tournament_communications_capability(
    tournament.organization_id,'documents.read'
  ) into v_can_manage
  from public.tournaments tournament where tournament.id = p_tournament_id;
  if not v_can_manage and not public.can_access_tournament_communications(p_tournament_id) then
    raise exception using errcode = '42501', message = 'TORNEOS_DOCUMENT_FORBIDDEN';
  end if;
  return (
    select jsonb_build_object(
      'items',coalesce(jsonb_agg(jsonb_build_object(
        'id',document.id,
        'type',document.document_type,
        'title',document.title,
        'acknowledgementMode',document.acknowledgement_mode,
        'categoryId',document.category_id,
        'categoryName',category.name,
        'version',version.version,
        'versionId',version.id,
        'summary',version.summary,
        'body',version.body,
        'effectiveAt',version.effective_at,
        'publishedAt',version.published_at,
        'correctionReason',version.correction_reason,
        'acknowledgement',case when acknowledgement.id is null then null else
          jsonb_build_object(
            'status',acknowledgement.status,
            'readAt',acknowledgement.read_at,
            'confirmedAt',acknowledgement.confirmed_at
          ) end
      ) order by version.published_at desc,document.id),'[]'::jsonb),
      'canManage',v_can_manage
    )
    from public.tournament_documents document
    join public.tournament_document_versions version
      on version.id = document.active_version_id
     and version.status = 'published'
    left join public.tournament_categories category
      on category.id = document.category_id
    left join public.tournament_document_acknowledgements acknowledgement
      on acknowledgement.document_id = document.id
     and acknowledgement.version_id = version.id
     and acknowledgement.user_id = auth.uid()
    where document.tournament_id = p_tournament_id
      and document.status = 'published'
      and (document.category_id is null or document.category_id = p_category_id)
      and (
        v_can_manage
        or document.category_id is null
        or public.can_read_tournament_participant_hub(
          document.tournament_id,document.category_id
        )
      )
  );
end;
$$;

create or replace function public.acknowledge_tournament_document(
  p_version_id uuid,
  p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.tournament_documents%rowtype;
  v_version public.tournament_document_versions%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select version.* into v_version
  from public.tournament_document_versions version
  where version.id = p_version_id and version.status = 'published';
  select * into v_document
  from public.tournament_documents document
  where document.id = v_version.document_id
    and document.active_version_id = p_version_id
    and document.status = 'published';
  if v_document.id is null
    or not public.can_access_tournament_communications(v_document.tournament_id)
    or (
      v_document.category_id is not null
      and not public.can_read_tournament_participant_hub(
        v_document.tournament_id,v_document.category_id
      )
      and not public.has_tournament_communications_capability(
        v_document.organization_id,'documents.read'
      )
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_DOCUMENT_FORBIDDEN';
  end if;
  insert into public.tournament_document_acknowledgements (
    organization_id,document_id,version_id,user_id,status,confirmed_at
  ) values (
    v_document.organization_id,v_document.id,p_version_id,auth.uid(),
    case when p_confirm then 'confirmed' else 'read' end,
    case when p_confirm then now() else null end
  )
  on conflict (version_id,user_id) do update set
    status = case when p_confirm then 'confirmed'
      else public.tournament_document_acknowledgements.status end,
    confirmed_at = case when p_confirm then
      coalesce(public.tournament_document_acknowledgements.confirmed_at,now())
      else public.tournament_document_acknowledgements.confirmed_at end;
  return jsonb_build_object(
    'documentId',v_document.id,'versionId',p_version_id,
    'status',case when p_confirm then 'confirmed' else 'read' end,
    'confirmationIsLegalAcceptance',false
  );
end;
$$;

create or replace function public.get_tournament_communications_admin_context(
  p_organization_id uuid,
  p_tournament_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_capabilities text[];
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select public.tournament_communications_role_capabilities(membership.role)
    into v_capabilities
  from public.tournament_organization_members membership
  join public.tournament_organizations organization
    on organization.id = membership.organization_id
  where membership.organization_id = p_organization_id
    and membership.user_id = auth.uid()
    and membership.status = 'active'
    and organization.status = 'active';
  if v_capabilities is null or not ('announcements.read' = any(v_capabilities)) then
    raise exception using errcode = '42501', message = 'TORNEOS_COMMUNICATION_FORBIDDEN';
  end if;
  return jsonb_build_object(
    'organizationId',p_organization_id,
    'capabilities',to_jsonb(v_capabilities),
    'scheduledPublishingEnabled',false,
    'channels',jsonb_build_object('internal',true,'push',false,'email',false),
    'tournaments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',tournament.id,'name',tournament.name,'seasonId',tournament.season_id,
        'seasonName',season.name,'status',tournament.status,
        'categories',coalesce((
          select jsonb_agg(jsonb_build_object('id',category.id,'name',category.name)
            order by category.sort_order,category.name)
          from public.tournament_categories category
          where category.tournament_id = tournament.id and category.status = 'active'
        ),'[]'::jsonb),
        'teams',coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',entry.id,'name',entry.name,'categoryId',entry.category_id
          ) order by entry.name)
          from (
            select *
            from public.tournament_team_entries
            where tournament_id = tournament.id and status = 'approved'
            order by name
            limit 100
          ) entry
        ),'[]'::jsonb),
        'matches',coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',match.id,'categoryId',match.category_id,
            'matchNumber',match.match_number,'scheduledAt',match.scheduled_at
          ) order by match.scheduled_at nulls last,match.match_number)
          from (
            select match.*
            from public.tournament_matches match
            join public.tournament_fixture_versions fixture
              on fixture.id = match.fixture_version_id
             and fixture.organization_id = match.organization_id
             and fixture.status = 'published'
            where match.tournament_id = tournament.id
            order by match.scheduled_at nulls last,match.match_number
            limit 100
          ) match
        ),'[]'::jsonb)
      ) order by season.start_date desc nulls last,tournament.name)
      from public.tournaments tournament
      join public.tournament_seasons season on season.id = tournament.season_id
      where tournament.organization_id = p_organization_id
        and tournament.status <> 'archived'
        and (p_tournament_id is null or tournament.id = p_tournament_id)
    ),'[]'::jsonb),
    'announcements',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',announcement.id,'tournamentId',announcement.tournament_id,
        'categoryId',announcement.category_id,'status',announcement.status,
        'type',announcement.announcement_type,'title',announcement.title,
        'summary',announcement.summary,'priority',announcement.priority,
        'scheduledFor',announcement.scheduled_for,
        'publishedAt',announcement.published_at,
        'recipientCount',announcement.published_recipient_count,
        'version',announcement.version
      ) order by announcement.updated_at desc)
      from (
        select *
        from public.tournament_announcements
        where organization_id = p_organization_id
          and (p_tournament_id is null or tournament_id = p_tournament_id)
        order by updated_at desc
        limit 100
      ) announcement
    ),'[]'::jsonb),
    'documents',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',document.id,'tournamentId',document.tournament_id,
        'categoryId',document.category_id,'status',document.status,
        'type',document.document_type,'title',document.title,
        'acknowledgementMode',document.acknowledgement_mode,
        'activeVersionId',document.active_version_id
      ) order by document.updated_at desc)
      from public.tournament_documents document
      where document.organization_id = p_organization_id
        and (p_tournament_id is null or document.tournament_id = p_tournament_id)
    ),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.create_tournament_announcement_draft(
  uuid,uuid,uuid,text,text,text,text,text,text,timestamptz,uuid,text,uuid
) from public,anon;
revoke all on function public.update_tournament_announcement_draft(
  uuid,text,text,text,text,text,timestamptz
) from public,anon;
revoke all on function public.set_tournament_announcement_audience(
  uuid,text,uuid,uuid,uuid,uuid
) from public,anon;
revoke all on function public.set_tournament_announcement_link(
  uuid,text,uuid,text,text,integer
) from public,anon;
revoke all on function public.preview_tournament_announcement_audience(uuid)
  from public,anon;
revoke all on function public.publish_tournament_announcement(uuid,integer)
  from public,anon;
revoke all on function public.get_tournament_communications_inbox(
  uuid,text,integer,integer
) from public,anon;
revoke all on function public.get_tournament_announcement(uuid)
  from public,anon;
revoke all on function public.mark_tournament_announcement_read(uuid,boolean)
  from public,anon;
revoke all on function public.archive_tournament_announcement(uuid)
  from public,anon;
revoke all on function public.revoke_tournament_announcement(uuid,text)
  from public,anon;
revoke all on function public.get_my_tournament_notification_preferences(uuid)
  from public,anon;
revoke all on function public.update_my_tournament_notification_preferences(
  uuid,boolean,boolean,boolean,boolean,boolean,boolean
) from public,anon;
revoke all on function public.create_tournament_document(
  uuid,uuid,uuid,text,text,text,text,text,timestamptz,uuid
) from public,anon;
revoke all on function public.create_tournament_document_version(
  uuid,text,text,timestamptz,text
) from public,anon;
revoke all on function public.update_tournament_document_draft(
  uuid,text,text,timestamptz
) from public,anon;
revoke all on function public.publish_tournament_document_version(uuid)
  from public,anon;
revoke all on function public.archive_tournament_document(uuid)
  from public,anon;
revoke all on function public.get_published_tournament_documents(uuid,uuid)
  from public,anon;
revoke all on function public.acknowledge_tournament_document(uuid,boolean)
  from public,anon;
revoke all on function public.get_tournament_communications_admin_context(uuid,uuid)
  from public,anon;

grant execute on function public.create_tournament_announcement_draft(
  uuid,uuid,uuid,text,text,text,text,text,text,timestamptz,uuid,text,uuid
) to authenticated;
grant execute on function public.update_tournament_announcement_draft(
  uuid,text,text,text,text,text,timestamptz
) to authenticated;
grant execute on function public.set_tournament_announcement_audience(
  uuid,text,uuid,uuid,uuid,uuid
) to authenticated;
grant execute on function public.set_tournament_announcement_link(
  uuid,text,uuid,text,text,integer
) to authenticated;
grant execute on function public.preview_tournament_announcement_audience(uuid)
  to authenticated;
grant execute on function public.publish_tournament_announcement(uuid,integer)
  to authenticated;
grant execute on function public.get_tournament_communications_inbox(
  uuid,text,integer,integer
) to authenticated;
grant execute on function public.get_tournament_announcement(uuid)
  to authenticated;
grant execute on function public.mark_tournament_announcement_read(uuid,boolean)
  to authenticated;
grant execute on function public.archive_tournament_announcement(uuid)
  to authenticated;
grant execute on function public.revoke_tournament_announcement(uuid,text)
  to authenticated;
grant execute on function public.get_my_tournament_notification_preferences(uuid)
  to authenticated;
grant execute on function public.update_my_tournament_notification_preferences(
  uuid,boolean,boolean,boolean,boolean,boolean,boolean
) to authenticated;
grant execute on function public.create_tournament_document(
  uuid,uuid,uuid,text,text,text,text,text,timestamptz,uuid
) to authenticated;
grant execute on function public.create_tournament_document_version(
  uuid,text,text,timestamptz,text
) to authenticated;
grant execute on function public.update_tournament_document_draft(
  uuid,text,text,timestamptz
) to authenticated;
grant execute on function public.publish_tournament_document_version(uuid)
  to authenticated;
grant execute on function public.archive_tournament_document(uuid)
  to authenticated;
grant execute on function public.get_published_tournament_documents(uuid,uuid)
  to authenticated;
grant execute on function public.acknowledge_tournament_document(uuid,boolean)
  to authenticated;
grant execute on function public.get_tournament_communications_admin_context(uuid,uuid)
  to authenticated;

comment on table public.tournament_announcements is
  'Versioned official messages. Published content is immutable and delivered internally only.';
comment on table public.tournament_announcement_audiences is
  'Structured, server-validated audience criteria. Never an arbitrary client recipient list.';
comment on table public.tournament_announcement_deliveries is
  'Deduplicated internal inbox snapshot; no email, push, SMS or external provider side effect.';
comment on table public.tournament_documents is
  'Official structured document identity with one active published version.';
comment on table public.tournament_document_versions is
  'Immutable published document versions; corrections create a new version.';
comment on table public.tournament_document_acknowledgements is
  'Read or explicit-read confirmation only; it is not represented as legal acceptance.';
comment on table public.tournament_notification_preferences is
  'Self-managed preferences for future channels; never an authorization boundary.';
