import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const migration = (name) => fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', name), 'utf8');
const rollback = (name) => fs.readFileSync(path.join(ROOT, 'supabase', 'rollbacks', name), 'utf8');

const cases = [
  {
    name: '20260802090000_tournament_media_upload_pipeline',
    migrations: ['20260802090000_tournament_media_upload_pipeline.sql'],
  },
  {
    name: '20260802120000_tournament_media_trusted_processing',
    migrations: [
      '20260802090000_tournament_media_upload_pipeline.sql',
      '20260802120000_tournament_media_trusted_processing.sql',
    ],
  },
  {
    name: '20260803090000_tournament_social_studio',
    migrations: ['20260803090000_tournament_social_studio.sql'],
  },
];

for (const item of cases) {
  test(`${item.name} rollback references only functions present in its migration state`, () => {
    const sql = rollback(`${item.name}.safe.sql`);
    const source = item.migrations.map(migration).join('\n');
    const names = [...sql.matchAll(/(?:REVOKE ALL ON FUNCTION\s+|SELECT\s+public\.)(?:public\.)?([a-z0-9_]+)/gi)]
      .map((match) => match[1]);
    assert.ok(names.length > 0);
    for (const name of names) {
      assert.match(source, new RegExp(`(?:FUNCTION\\s+"?public"?\\."?${name}"?|FUNCTION\\s+public\\.${name})`, 'i'));
    }
  });

  test(`${item.name} rollback is transactional, preserving, and non-destructive`, () => {
    const sql = rollback(`${item.name}.safe.sql`);
    const executable = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
    assert.match(executable, /\bBEGIN\s*;/i);
    assert.match(executable, /\bCOMMIT\s*;/i);
    assert.doesNotMatch(executable, /\b(?:DROP|TRUNCATE)\b|\bDELETE\s+FROM\b/i);
  });
}

test('Multimedia rollbacks serialise writers, drain work, and remove service mutation grants', () => {
  const upload = rollback('20260802090000_tournament_media_upload_pipeline.safe.sql');
  const trusted = rollback('20260802120000_tournament_media_trusted_processing.safe.sql');
  for (const sql of [upload, trusted]) {
    assert.match(sql, /LOCK TABLE public\.tournament_media_upload_sessions/i);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.attest_tournament_media_service[\s\S]+FROM service_role/i);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.request_tournament_media_upload_session[\s\S]+FROM service_role/i);
    assert.match(sql, /has_function_privilege/i);
  }
  assert.match(trusted, /LOCK TABLE[\s\S]+public\.tournament_media_processing_jobs/i);
  assert.match(trusted, /MEDIA_SAFE_ROLLBACK_REQUIRES_DRAIN/i);
  assert.match(trusted, /MEDIA_SAFE_ROLLBACK_REQUIRES_SESSION_DRAIN/i);
});

test('Social rollback removes all three authenticated API entry points and preserves service audit access', () => {
  const sql = rollback('20260803090000_tournament_social_studio.safe.sql');
  for (const name of [
    'get_tournament_social_snapshot',
    'get_tournament_social_studio_context',
    'set_tournament_social_permission',
  ]) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}[\\s\\S]+FROM authenticated`, 'i'));
  }
  assert.doesNotMatch(sql, /FROM service_role, authenticated/i);
});
