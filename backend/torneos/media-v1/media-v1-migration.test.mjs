// MEDIA-V1 migration and rollback, read as text (no database). The behaviour against real Storage + Postgres is
// certified in the lab (backend/torneos/media-v1/REPORT.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const CONTRACT = JSON.parse(fs.readFileSync('backend/torneos/media-v1/contract.json', 'utf8'));
const SQL = fs.readFileSync(CONTRACT.migration, 'utf8');
const ROLLBACK = fs.readFileSync(CONTRACT.rollback, 'utf8');
const BASELINE = fs.readFileSync('backend/torneos/supabase/migrations/00000000000000_torneos_baseline_v1.sql', 'utf8');
const code = (text) => text.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
const body = code(SQL);
const rollback = code(ROLLBACK);
const same = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
const fnText = (text, start) => {
  const i = text.indexOf(start);
  assert.ok(i >= 0, start);
  const tag = /\n\s*(?:AS|as) (\$[A-Za-z_]*\$)\n/.exec(text.slice(i))[1];
  const open = text.indexOf(`${tag}\n`, i) + tag.length;
  return text.slice(i, text.indexOf(`\n${tag};`, open) + tag.length + 2);
};

test('one transaction after 0011, fail-closed preconditions and postconditions; numbering follows 0011 (0013 is Premium MP)', () => {
  assert.match(CONTRACT.migration, /\/00000000000012_media_gallery_v1\.sql$/);
  assert.match(body, /^BEGIN;/m);
  assert.match(body, /^COMMIT;/m);
  assert.match(body, /TORNEOS_MEDIA_V1_PRECONDITION_FAILED: 00000000000011 is not in force/);
  assert.match(body, /to_regclass\('storage\.objects'\) IS NULL/);
  for (const reused of ['public.request_tournament_media_upload_session(uuid,text,text,bigint,uuid)',
    'public.complete_tournament_media_simple_upload(uuid,uuid,text,text,bigint,integer,integer,text,boolean)',
    'public.authorize_tournament_media_read(uuid,uuid,text)', 'public.tournament_media_mvp_user_can_upload(uuid,uuid)']) {
    assert.ok(body.includes(`to_regprocedure('${reused}')`), reused);
  }
  assert.match(body, /TORNEOS_MEDIA_V1_POSTCONDITION_FAILED: the media bucket must be private/);
  assert.match(body, /TORNEOS_MEDIA_V1_POSTCONDITION_FAILED: storage contract/);
  assert.doesNotMatch(body, /tournament_media_pipeline_configuration\s+set|update public\.tournament_media_pipeline_configuration/i,
    'the pipeline mode is an operator step, never a migration side effect');
  assert.doesNotMatch(body, /tournament_plan_catalog|gallery_asset_limit\s*=/, 'no commercial limit is changed');
});

test('the bucket is PRIVATE with the MVP_SIMPLE object ceiling; nothing makes it public', () => {
  assert.match(body, /values \('tournament-media', 'tournament-media', false, 4194304, array\['image\/jpeg', 'image\/png', 'image\/webp'\]::text\[\]\)/);
  assert.match(body, /on conflict \(id\) do update\s+set name = excluded\.name,\s+public = false,/);
  assert.doesNotMatch(body, /public\s*=\s*true/i);
  assert.deepEqual(CONTRACT.bucket, { id: 'tournament-media', public: false, file_size_limit: 4194304, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] });
});

test('exactly eight policies: client writes only under the gateway claim, reads only through the baseline authorization, no anon', () => {
  const created = [...body.matchAll(/create policy ([a-z_]+)\s+on storage\.objects for (select|insert|update|delete)\s+to (anon|authenticated|service_role)/g)]
    .map(([, name, cmd, role]) => `${name}:${cmd}:${role}`).sort();
  assert.deepEqual(created, [
    'tournament_media_client_update_denied:update:authenticated',
    'tournament_media_gateway_delete:delete:authenticated',
    'tournament_media_gateway_insert:insert:authenticated',
    'tournament_media_reader_select:select:authenticated',
    'tournament_media_service_delete:delete:service_role',
    'tournament_media_service_insert:insert:service_role',
    'tournament_media_service_read:select:service_role',
    'tournament_media_service_update:update:service_role',
  ]);
  assert.deepEqual(created.map((x) => x.split(':')[0]), CONTRACT.storage_policies);
  assert.ok(!created.some((x) => x.endsWith(':anon')), 'visitors read nothing');
  assert.match(body, /for insert\s+to authenticated\s+with check \(bucket_id = 'tournament-media' and public\.can_write_tournament_media_gateway_object\(name\)\)/);
  assert.match(body, /for delete\s+to authenticated\s+using \(bucket_id = 'tournament-media' and public\.can_delete_tournament_media_gateway_object\(name\)\)/);
  assert.match(body, /for select\s+to authenticated\s+using \(bucket_id = 'tournament-media' and public\.can_read_tournament_media_object\(name\)\)/);
  assert.match(body, /tournament_media_client_update_denied\s+on storage\.objects for update\s+to authenticated\s+using \(false\)\s+with check \(false\)/);
  for (const policy of CONTRACT.storage_policies) assert.match(body, new RegExp(`drop policy if exists ${policy} on storage\\.objects`));
});

test('the gateway claim: a valid bridge identity first, a strict uuid, never callable by a client role', () => {
  const claim = fnText(SQL, 'create or replace function private.tournament_media_gateway_session()');
  assert.match(claim, /if private\.current_identity_id\(\) is null then\s+return null;/);
  assert.ok(claim.includes("v_claims->>'torneos_media_upload_session'"));
  assert.match(claim, /security invoker/);
  assert.match(body, /revoke all on function private\.tournament_media_gateway_session\(\) from public, anon, authenticated, service_role;/);
  const write = fnText(SQL, 'create or replace function public.can_write_tournament_media_gateway_object(p_name text)');
  for (const gate of ['session.id = private.tournament_media_gateway_session()', 'session.internal_path = p_name',
    'session.requested_by = private.current_identity_id()', "session.status = 'issued'", 'session.expires_at > now()',
    "session.processing_tier = 'mvp_simple'", 'public.tournament_media_mvp_user_can_upload(session.requested_by, session.gallery_id)',
    'asset.internal_path = session.internal_path', "session.quota_snapshot ? 'thumbnailBytes'",
    'public.tournament_media_thumbnail_path(session.internal_path) = p_name', 'variant.internal_path = p_name']) assert.ok(write.includes(gate), gate);
  const remove = fnText(SQL, 'create or replace function public.can_delete_tournament_media_gateway_object(p_name text)');
  assert.ok(remove.includes("session.status in ('issued', 'failed')") && remove.includes('session.asset_id is null'),
    'an asset is never deleted through the gateway claim');
  const read = fnText(SQL, 'create or replace function public.can_read_tournament_media_object(p_name text)');
  assert.ok(read.includes("perform public.authorize_tournament_media_read(v_identity, v_asset_id, 'detail');"), 'the baseline decides reads');
  assert.ok(read.includes("variant.internal_path = p_name and variant.bucket = 'tournament-media' and variant.status = 'ready'"),
    'a thumbnail is readable exactly when its photo is');
  assert.match(read, /exception when insufficient_privilege or invalid_parameter_value then\s+return false;/);
});

test('gateway RPCs: completion and failure only under the claim for THAT session; replay never duplicates', () => {
  const complete = fnText(SQL, 'create or replace function public.complete_tournament_media_gallery_upload(');
  assert.ok(complete.includes('private.tournament_media_gateway_session() is distinct from p_session_id'));
  assert.ok(complete.includes("object.bucket_id = 'tournament-media'") && complete.includes("(object.metadata->>'size')::bigint = p_byte_size"),
    'the exact object must be in the bucket');
  assert.ok(complete.includes('public.complete_tournament_media_simple_upload(\n    v_identity, p_session_id, p_token,'), 'the baseline completion');
  assert.ok(fnText(SQL, 'create or replace function public.fail_tournament_media_gallery_upload(').includes('private.tournament_media_gateway_session() is distinct from p_session_id'));
  const begin = fnText(SQL, 'create or replace function public.begin_tournament_media_gallery_upload(');
  assert.ok(begin.includes("'state', 'uploaded'") && begin.includes("message = 'TORNEOS_MEDIA_UPLOAD_IN_PROGRESS'"));
  assert.ok(begin.includes('public.request_tournament_media_upload_session('), 'the baseline session RPC (quota trigger, rate limit, readiness)');
  assert.ok(begin.includes('pg_catalog.hashtextextended(v_identity::text, 2)'), 'the baseline actor lock');
  const targets = fnText(SQL, 'create or replace function public.get_tournament_media_read_targets(');
  assert.ok(targets.includes('cardinality(p_asset_ids) > 60') && targets.includes("p_kind not in ('thumbnail', 'grid', 'detail')"));
  assert.ok(targets.includes('public.authorize_tournament_media_read(v_identity, v_asset_id, p_kind)'));
  assert.ok(targets.includes("if p_kind in ('thumbnail', 'grid') then") && targets.includes("variant.kind = 'thumbnail' and variant.status = 'ready'"),
    'the grid reads the thumbnail; detail reads the photo');
  for (const sig of CONTRACT.functions_added.filter((s) => s.startsWith('public.'))) {
    const name = sig.slice(0, sig.indexOf('('));
    assert.match(body, new RegExp(`revoke all on function ${name.replace('.', '\\.')}\\(`), `${sig} revoked from public/anon`);
  }
  assert.doesNotMatch(body, /grant execute on function [^;]+ to [^;]*\banon\b/, 'nothing is granted to anon');
});

test('replaced bodies change only what they say: the readiness selection cap, the delivery rule, the storage verifier exception', () => {
  const readinessNew = fnText(SQL, 'CREATE OR REPLACE FUNCTION public.tournament_media_effective_readiness()');
  const readinessOld = fnText(BASELINE, 'CREATE FUNCTION public.tournament_media_effective_readiness()');
  assert.equal(readinessNew.replace('CREATE OR REPLACE', 'CREATE').replaceAll("'maxSelectedFileBytes',26214400", "'maxSelectedFileBytes',8388608"), readinessOld);
  assert.equal((readinessNew.match(/'maxSelectedFileBytes',26214400/g) || []).length, 2, 'MVP_SIMPLE and DISABLED only');
  assert.ok(readinessNew.includes("'maxFileBytes',4194304") && readinessNew.includes("'maxEdge',1600"), 'what is sent is unchanged');
  const published = fnText(SQL, 'create or replace function public.get_published_tournament_media(');
  assert.ok(published.includes("v_readiness->>'processingTier' = 'mvp_simple'"));
  assert.ok(published.includes("where item.gallery_id = gallery.id and asset.status = 'published'"), 'only published assets');
  assert.ok(published.includes('public.can_current_user_read_media_gallery(gallery_page.id)'), 'the audience rule is the baseline\'s');
  assert.ok(published.includes("'originalAvailable',false"));
  const storage = fnText(SQL, 'create or replace function public.tournament_media_storage_contract_status()');
  assert.ok(storage.includes("policy.policyname = 'tournament_media_gateway_insert' and policy.cmd = 'INSERT'"));
  assert.ok(storage.includes("policy.policyname = 'tournament_media_gateway_delete' and policy.cmd = 'DELETE'"));
  assert.ok(storage.includes('and not (policy.policyname::text = any($1))'), 'every OTHER client write still closes uploads');
});

test('storage budget and concurrency: one operator singleton, enforced before any byte under one global lock', () => {
  assert.match(body, /create table if not exists public\.tournament_media_storage_budget \(/);
  assert.match(body, /alter table public\.tournament_media_storage_budget enable row level security;/);
  assert.match(body, /revoke all on table public\.tournament_media_storage_budget from public, anon, authenticated;/);
  assert.match(body, /values \(true, 471859200, 419430400, 12\)\s+on conflict \(singleton\) do nothing;/);
  same(CONTRACT.storage_budget_defaults, { project_max_bytes: 471859200, gallery_max_bytes: 419430400, max_inflight_uploads: 12 });
  const status = fnText(SQL, 'create or replace function public.tournament_media_storage_budget_status()');
  for (const part of ["(object.metadata->>'size')::bigint", "object.bucket_id = 'tournament-media'", "object.bucket_id = 'tournament-branding'",
    "coalesce((session.quota_snapshot->>'thumbnailBytes')::bigint, 0)"]) assert.ok(status.includes(part), part);
  assert.match(body, /revoke all on function public\.tournament_media_storage_budget_status\(\) from public, anon, authenticated;/);
  const begin = fnText(SQL, 'create or replace function public.begin_tournament_media_gallery_upload(');
  const lock = begin.indexOf("hashtextextended('tournament-media:storage-budget', 0)");
  assert.ok(lock > 0 && lock < begin.indexOf('public.request_tournament_media_upload_session('), 'budget decided before the session exists');
  for (const code of ['TORNEOS_MEDIA_BUSY', 'TORNEOS_MEDIA_STORAGE_BUDGET_EXCEEDED']) assert.ok(begin.includes(code), code);
  assert.ok(begin.includes("> (v_budget->>'projectMaxBytes')::bigint") && begin.includes("> (v_budget->>'galleryMaxBytes')::bigint"));
  assert.ok(begin.indexOf("'state', 'uploaded'") < lock, 'a replay of an uploaded photo never needs budget');
});

test('thumbnails: a JPEG variant of the same photo, declared at begin, verified in the bucket at completion', () => {
  const complete = fnText(SQL, 'create or replace function public.complete_tournament_media_gallery_upload(');
  for (const part of ['(v_declared is null) <> (p_thumbnail_size is null)', 'p_thumbnail_size <> v_declared',
    'p_thumbnail_width not between 1 and 640', 'abs(p_thumbnail_width::bigint * p_height - p_thumbnail_height::bigint * p_width) > greatest(p_width, p_height)',
    "object.name = v_thumbnail_path", "'thumbnail', v_thumbnail_path,\n      'image/jpeg'"]) assert.ok(complete.includes(part.replace('\\n', '\n')), part);
  const path = fnText(SQL, 'create or replace function public.tournament_media_thumbnail_path(p_internal_path text)');
  assert.ok(path.includes("'-thumbnail.jpg'") && path.includes('immutable'));
});

test('retiring content: the three moderation / lifecycle / report RPCs regain authenticated, nothing else is re-exposed', () => {
  const grants = [...body.matchAll(/grant execute on function (public\.[a-z_]+\([^)]*\)) to authenticated;/g)].map(([, sig]) => sig).sort();
  assert.deepEqual(grants, [...CONTRACT.grants_restored].sort());
  for (const disabled of ['tag_tournament_media_asset', 'manage_tournament_media_consent', 'assign_tournament_media_photographer']) {
    assert.ok(!body.includes(disabled), disabled);
  }
});

test('rollback: drops exactly what 0012 added, restores the three baseline bodies verbatim, never deletes photos', () => {
  assert.match(rollback, /^BEGIN;/m);
  assert.match(rollback, /^COMMIT;/m);
  for (const policy of CONTRACT.storage_policies) assert.match(rollback, new RegExp(`drop policy if exists ${policy} on storage\\.objects;`));
  for (const sig of CONTRACT.functions_added) assert.ok(rollback.includes(`drop function if exists ${sig};`), sig);
  for (const sig of CONTRACT.grants_restored) assert.ok(rollback.includes(`revoke execute on function ${sig} from anon, authenticated;`), sig);
  for (const start of ['CREATE FUNCTION public.tournament_media_storage_contract_status()', 'CREATE FUNCTION public.tournament_media_effective_readiness()',
    'CREATE FUNCTION public.get_published_tournament_media(']) {
    assert.equal(fnText(ROLLBACK, start.replace('CREATE', 'CREATE OR REPLACE')).replace('CREATE OR REPLACE', 'CREATE'), fnText(BASELINE, start), start);
  }
  assert.doesNotMatch(rollback, /delete from storage\.|(insert into|update|delete from) storage\.buckets|delete from public\.tournament_media/i, 'photos and their rows stay');
  assert.match(rollback, /TORNEOS_MEDIA_V1_ROLLBACK_POSTCONDITION_FAILED/);
});
