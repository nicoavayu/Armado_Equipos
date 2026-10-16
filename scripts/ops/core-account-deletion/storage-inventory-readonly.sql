-- Core Storage inventory for the account-deletion Storage step (supabase/functions/_shared/coreAccountStorageErasure.ts).
-- READ ONLY. Run BEFORE deploying delete-account with the Storage step, by Nico (SQL Editor of the Core project, or psql
-- with the read-only login), never by an automated job. It only SELECTs storage.objects, auth.users, public.teams and
-- public.team_members (no partidos, no usuarios). Nothing here deletes or changes anything: the transaction is READ ONLY
-- and ends in ROLLBACK. It prints counts only (no names, no URLs, no ids).
--
-- What to look at:
--   1. shape per bucket            → how many objects the step can attribute (`<uid>/…`, `<uid>_…`) vs never touches
--   2. largest / deepest per user  → the step lists up to 5000 objects per call and folders up to depth 8
--                                    (above that it answers `incomplete` and a retry continues)
--   3. orphans of deleted accounts → leftovers of deletions made before this step existed (a one-off cleanup would need
--                                    its own dry-run script and its own GO; there is no cron)
--   4. team-crests referenced      → what the step KEEPS (used by teams.crest_url / team_members.photo_url)
--   5. tournament-* buckets in Core → legacy, out of scope; should be empty

begin transaction read only;
set local statement_timeout = '30s';

-- 1. Shape of each bucket
select bucket_id,
       count(*)                                                          as total,
       count(*) filter (where name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/') as uid_folder,
       count(*) filter (where name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_') as uid_underscore,
       count(*) filter (where name like 'guest/%')                       as guest,
       count(*) filter (where name like 'partido\_%')                    as partido_flat,
       count(*) filter (where name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[^/_]') as uid_other_separator,
       count(*) filter (where owner_id is null)                          as without_owner
from storage.objects
group by bucket_id
order by bucket_id;

-- 2. Largest and deepest per user prefix (jugadores-fotos + team-crests)
select bucket_id,
       max(per_user)  as max_objects_one_user,
       percentile_disc(0.99) within group (order by per_user) as p99_objects_one_user,
       max(max_depth) as max_folder_depth
from (
  select bucket_id, left(name, 36) as uid, count(*) as per_user,
         max(array_length(string_to_array(name, '/'), 1) - 1) as max_depth
  from storage.objects
  where bucket_id in ('jugadores-fotos', 'team-crests')
    and left(name, 36) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  group by bucket_id, left(name, 36)
) per_user
group by bucket_id
order by bucket_id;

-- 3. Orphans of accounts that no longer exist (left by deletions before this step)
select o.bucket_id, count(*) as orphan_objects, count(distinct left(o.name, 36)) as orphan_users
from storage.objects o
where o.bucket_id in ('jugadores-fotos', 'team-crests')
  and left(o.name, 36) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and not exists (select 1 from auth.users u where u.id::text = left(o.name, 36))
group by o.bucket_id
order by o.bucket_id;

-- 4. team-crests: referenced (kept by the step) vs not referenced (removed when its owner deletes the account).
-- URL-encoded names (spaces etc.) may show as not referenced here; the function decodes them before comparing.
with refs as (
  select substring(crest_url from '/team-crests/([^?#]+)') as path from public.teams where crest_url like '%/team-crests/%'
  union
  select substring(photo_url from '/team-crests/([^?#]+)') from public.team_members where photo_url like '%/team-crests/%'
)
select count(*) filter (where r.path is not null) as referenced,
       count(*) filter (where r.path is null)     as not_referenced
from storage.objects o
left join refs r on r.path = o.name
where o.bucket_id = 'team-crests';

-- 5. Legacy Torneos-in-Core buckets (out of scope of the step; expected empty)
select bucket_id, count(*) as objects
from storage.objects
where bucket_id like 'tournament-%'
group by bucket_id
order by bucket_id;

rollback;
