-- Core Storage inventory for the account-deletion Storage step (supabase/functions/_shared/coreAccountStorageErasure.ts).
-- READ ONLY. Run BEFORE deploying delete-account with the Storage step, by Nico (SQL Editor of the Core project, or psql
-- with the read-only login), never by an automated job. It only SELECTs storage.buckets, storage.objects, auth.users,
-- public.teams and public.team_members (no partidos, no usuarios). Nothing here deletes or changes anything: the
-- transaction is READ ONLY and ends in ROLLBACK. It prints counts and bucket settings only (no object names, no URLs, no
-- ids, no emails).
--
-- Last run: 2026-10-16 on Core Production, by the coordinator through a connector Nico authorized (counts only). The
-- results are in docs/superpowers/specs/2026-10-15-torneos-account-deletion-design.md §2.6.
--
-- What to look at:
--   0. bucket settings              → every bucket must be classified in CORE_STORAGE_BUCKETS (the step never touches
--                                     an unclassified one); public / size limit / MIME allowlist (SVG)
--   1. shape per bucket             → how many objects the step can attribute (`<uid>/…`, `<uid>_…`) vs never touches
--                                     (guest/…, partido_…, anything else); owner_id is NOT a criterion of the step
--   2. largest / deepest per user   → the step lists up to 5000 objects per call and folders up to depth 8
--                                     (above that it answers `incomplete` and a retry continues)
--   3. orphans of deleted accounts  → leftovers of deletions made before this step existed (a one-off cleanup needs its
--                                     own dry-run script, a check that nothing references them, and its own GO; no cron)
--   4. team-crests referenced       → what the step KEEPS (used by teams.crest_url / team_members.photo_url)
--   5. tournament-* buckets in Core → legacy, out of scope; should be empty
--   6. file types per bucket        → legacy SVG objects (the step removes them by path; it never opens one)
--   7. owner_id null vs shape       → which «without owner» objects are still attributable by name

begin transaction read only;
set local statement_timeout = '30s';

-- 0. Bucket settings (configuration, not personal data)
select b.id as bucket_id,
       b.public,
       b.file_size_limit,
       coalesce('image/svg+xml' = any(b.allowed_mime_types), false) as allows_svg,
       coalesce(array_length(b.allowed_mime_types, 1), 0)           as allowed_mime_count,
       (select count(*) from storage.objects o where o.bucket_id = b.id) as objects
from storage.buckets b
order by b.id;

-- 1. Shape of each bucket
select bucket_id,
       count(*)                                                          as total,
       count(*) filter (where name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/') as uid_folder,
       count(*) filter (where name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_') as uid_underscore,
       count(*) filter (where name like 'guest/%')                       as guest,
       count(*) filter (where name like 'partido\_%')                    as partido_flat,
       count(*) filter (where name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[^/_]') as uid_other_separator,
       count(*) filter (where name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[/_]'
                          and name not like 'guest/%' and name not like 'partido\_%') as other_names,
       count(*) filter (where owner_id is null)                          as without_owner,
       max(array_length(string_to_array(name, '/'), 1) - 1)              as max_folder_depth
from storage.objects
group by bucket_id
order by bucket_id;

-- 2. Largest and deepest per user prefix (the buckets the step erases from)
select bucket_id,
       max(per_user)  as max_objects_one_user,
       percentile_disc(0.99) within group (order by per_user) as p99_objects_one_user,
       max(max_depth) as max_folder_depth
from (
  select bucket_id, left(name, 36) as uid, count(*) as per_user,
         max(array_length(string_to_array(name, '/'), 1) - 1) as max_depth
  from storage.objects
  where bucket_id in ('jugadores-fotos', 'avatars', 'team-crests')
    and left(name, 36) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  group by bucket_id, left(name, 36)
) per_user
group by bucket_id
order by bucket_id;

-- 3. Orphans of accounts that no longer exist (left by deletions before this step). Counts only: deleting them is a
-- separate proposal with its own GO (and a check that no row still references them).
select o.bucket_id, count(*) as orphan_objects, count(distinct left(o.name, 36)) as orphan_users
from storage.objects o
where o.bucket_id in ('jugadores-fotos', 'avatars', 'team-crests')
  and left(o.name, 36) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and not exists (select 1 from auth.users u where u.id::text = left(o.name, 36))
group by o.bucket_id
order by o.bucket_id;

-- 4. team-crests: referenced (kept by the step) vs not referenced (removed when its owner deletes the account).
-- Known limitation: the URL is compared WITHOUT decoding, so URL-encoded names (spaces etc.) may show as not referenced
-- here; the function decodes them before comparing. SVG references are counted too (expected 0).
with refs as (
  select substring(crest_url from '/team-crests/([^?#]+)') as path from public.teams where crest_url like '%/team-crests/%'
  union
  select substring(photo_url from '/team-crests/([^?#]+)') from public.team_members where photo_url like '%/team-crests/%'
)
select count(*) filter (where r.path is not null) as referenced,
       count(*) filter (where r.path is null)     as not_referenced,
       (select count(*) from refs where lower(refs.path) like '%.svg') as svg_references
from storage.objects o
left join refs r on r.path = o.name
where o.bucket_id = 'team-crests';

-- 5. Legacy Torneos-in-Core buckets (out of scope of the step; expected empty)
select bucket_id, count(*) as objects
from storage.objects
where bucket_id like 'tournament-%'
group by bucket_id
order by bucket_id;

-- 6. File types per bucket (from the stored metadata; the extension when there is none)
select bucket_id,
       coalesce(nullif(metadata->>'mimetype', ''), 'ext:' || lower(substring(name from '\.([A-Za-z0-9]+)$')), 'unknown') as file_type,
       count(*) as objects
from storage.objects
where bucket_id in ('jugadores-fotos', 'avatars', 'team-crests')
group by 1, 2
order by 1, 2;

-- 7. owner_id null vs shape: which «without owner» objects the step still attributes by name (`<uid>/…`, `<uid>_…`:
-- removed with that account) and which it never touches (guest/…, partido_…, anything else)
select bucket_id,
       count(*) filter (where name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[/_]') as without_owner_uid_named,
       count(*) filter (where name like 'guest/%')                                                          as without_owner_guest,
       count(*) filter (where name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[/_]'
                          and name not like 'guest/%')                                                      as without_owner_other
from storage.objects
where owner_id is null
group by bucket_id
order by bucket_id;

rollback;
