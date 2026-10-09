// BRANDING-V1 migration and rollback, read as text (no database). The behaviour against real Storage + Postgres is
// certified by integration/torneos-core-contracts/branding.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const CONTRACT = JSON.parse(fs.readFileSync('backend/torneos/branding-v1/contract.json', 'utf8'));
const SQL = fs.readFileSync(CONTRACT.migration, 'utf8');
const ROLLBACK = fs.readFileSync(CONTRACT.rollback, 'utf8');
const code = (text) => text.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
const body = code(SQL);

test('one transaction, fail-closed preconditions (0009 in force and a Storage schema) and postconditions', () => {
  assert.match(body, /^BEGIN;/m);
  assert.match(body, /^COMMIT;/m);
  assert.match(body, /TORNEOS_BRANDING_V1_PRECONDITION_FAILED: 00000000000009 is not in force/);
  assert.match(body, /to_regclass\('storage\.objects'\) IS NULL/);
  for (const reused of CONTRACT.functions_reused) {
    assert.ok(body.includes(`to_regprocedure('${reused}')`) || reused.includes('get_public_tournament_branding'), `precondition ${reused}`);
  }
  assert.match(body, /TORNEOS_BRANDING_V1_POSTCONDITION_FAILED: the branding bucket must be private/);
});

test('the bucket is PRIVATE, with the same limits as Core\'s branding bucket; nothing makes it public', () => {
  assert.match(body, /values \('tournament-branding', 'tournament-branding', false, 2097152, array\['image\/jpeg', 'image\/png', 'image\/webp'\]::text\[\]\)/);
  assert.match(body, /on conflict \(id\) do update\s+set name = excluded\.name,\s+public = false,/);
  assert.doesNotMatch(body, /public\s*=\s*true|,\s*true,\s*2097152/i);
  assert.deepEqual(CONTRACT.bucket, { id: 'tournament-branding', public: false, file_size_limit: 2097152, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] });
});

test('exactly the five policies; writes reuse can_write_tournament_branding_object; objects are immutable', () => {
  const created = [...body.matchAll(/create policy ([a-z_]+)\s+on storage\.objects for (select|insert|update|delete)\s+to (anon|authenticated)/g)]
    .map(([, name, cmd, role]) => `${name}:${cmd}:${role}`).sort();
  assert.deepEqual(created, [
    'tournament_branding_delete_authorized:delete:authenticated',
    'tournament_branding_insert_authorized:insert:authenticated',
    'tournament_branding_select_authorized:select:authenticated',
    'tournament_branding_select_public:select:anon',
    'tournament_branding_update_denied:update:authenticated',
  ]);
  assert.deepEqual(created.map((x) => x.split(':')[0]), CONTRACT.storage_policies);
  assert.match(body, /for insert\s+to authenticated\s+with check \(bucket_id = 'tournament-branding' and public\.can_write_tournament_branding_object\(name\)\)/);
  assert.match(body, /for delete\s+to authenticated\s+using \(bucket_id = 'tournament-branding' and public\.can_write_tournament_branding_object\(name\)\)/);
  assert.match(body, /for update\s+to authenticated\s+using \(false\)\s+with check \(false\)/);
  assert.match(body, /to anon\s+using \(bucket_id = 'tournament-branding' and public\.is_public_tournament_branding_object\(name\)\)/);
  for (const policy of CONTRACT.storage_policies) assert.match(body, new RegExp(`drop policy if exists ${policy} on storage\\.objects`));
});

test('public read: only the CURRENT reference of a published page, with the public page\'s own gates', () => {
  const fn = body.slice(body.indexOf('create or replace function public.is_public_tournament_branding_object'),
    body.indexOf('create or replace function public.can_read_tournament_branding_object'));
  for (const gate of [
    "page.status = 'published'",
    "tournament.status in ('registration', 'scheduled', 'active', 'completed')",
    "organization.status = 'active'",
    "season.status <> 'archived'",
    'tournament.logo_path = p_name',
    'organization.logo_path = p_name',
    "fixture.status = 'published'",
    "participant.status in ('active', 'withdrawn')",
    'participant.snapshot_shield_path = p_name',
    'public.is_tournament_branding_path(p_name)',
  ]) assert.ok(fn.includes(gate), gate);
  assert.match(fn, /security definer\s+set search_path = ''/);
});

test('identity read: public, or writable, or the current branding of a live entry the identity is an active responsible of', () => {
  const fn = body.slice(body.indexOf('create or replace function public.can_read_tournament_branding_object'),
    body.indexOf('revoke all on function public.is_public_tournament_branding_object'));
  for (const gate of [
    'public.is_public_tournament_branding_object(p_name)',
    'private.current_identity_id() is not null',
    'public.can_write_tournament_branding_object(p_name)',
    "manager.status = 'active'",
    "entry.status not in ('rejected', 'withdrawn', 'archived')",
    'entry.shield_path = p_name',
    'tournament.logo_path = p_name',
    'organization.logo_path = p_name',
  ]) assert.ok(fn.includes(gate), gate);
  assert.match(body, /grant execute on function public\.is_public_tournament_branding_object\(text\) to anon, authenticated, service_role;/);
  assert.match(body, /grant execute on function public\.can_read_tournament_branding_object\(text\) to authenticated, service_role;/);
  assert.doesNotMatch(body, /can_read_tournament_branding_object\(text\) to anon/);
});

test('no existing function body, grant or table is modified', () => {
  assert.doesNotMatch(body, /create or replace function public\.(can_write_tournament_branding_object|set_tournament_branding_reference|get_tournament_branding_context|get_public_tournament_branding|is_tournament_branding_path)\b/i);
  assert.doesNotMatch(body, /\balter table\b|\bdrop table\b|\bcreate table\b/i);
  assert.doesNotMatch(body, /revoke [a-z ,]+ on function public\.(set_tournament_branding_reference|get_tournament_branding_context|can_write)/i);
});

test('rollback: drops exactly what 0010 added, keeps objects and references, never touches requests or profiles', () => {
  const rb = code(ROLLBACK);
  for (const policy of CONTRACT.storage_policies) assert.match(rb, new RegExp(`drop policy if exists ${policy} on storage\\.objects;`));
  assert.match(rb, /drop function if exists public\.can_read_tournament_branding_object\(text\);/);
  assert.match(rb, /drop function if exists public\.is_public_tournament_branding_object\(text\);/);
  assert.doesNotMatch(rb, /delete from|truncate|drop table|update public\./i);
  assert.match(ROLLBACK, /Requests, entries and profiles are untouched/);
});
