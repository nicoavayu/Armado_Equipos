// PILOT 0015 + 0016 operator driver, offline: the exact files and bodies it pins, the states it recognizes, the gates on every
// write and the "nothing outside 0015/0016 moved" rule. The real transitions (apply, rollback, re-apply) ran on a disposable
// copy of Production's Torneos state through run() with a local psql: see the pilot rehearsal evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  BODIES, FILES, NOTICE, REF, changedOutside, classify, phraseFor, run,
} from './remote/db-0015-0016.mjs';

const sha256 = (path) => crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const RPC = { secdef: true, config: ['search_path=""'], authenticated: true, anon: false };
const TRIGGER = { secdef: true, config: ['search_path=""'], authenticated: false, anon: false };
const KEPT = {
  counts: { authenticated: 193, anon: 16 },
  kept_fn: { count: 500, digest: 'f' }, kept_relations: { count: 90, digest: 'r' }, kept_policies: { count: 40, digest: 'p' },
  kept_constraints: { count: 16, digest: 'c' }, kept_triggers: { count: 1, digest: 't' },
};
const catalogAt = (state, extra = {}) => ({
  torneos_tables: true,
  ...KEPT,
  bodies: { ...BODIES[state] },
  acl: { player: RPC, managed: RPC, reschedule: RPC, notifications: RPC, notify: state === 'POST_0016' ? TRIGGER : null },
  notice: { ...(state === 'POST_0016' ? NOTICE.on : NOTICE.off), rows: 0 },
  ...extra,
});

test('db 0015/0016 pins the exact files of this branch, the target ref and the bodies each file installs', () => {
  assert.equal(REF, 'onzpwnqxnvlgsevivngf');
  for (const f of Object.values(FILES)) assert.equal(sha256(f.path), f.sha256, f.rel);
  const m15 = fs.readFileSync(FILES['apply-0015'].path, 'utf8');
  const m16 = fs.readFileSync(FILES['apply-0016'].path, 'utf8');
  // Each file's own pre/post md5 checks are the same bodies the driver classifies by.
  for (const md5 of [BODIES.BASE.player, BODIES.BASE.managed, BODIES.POST_0015.player, BODIES.POST_0015.managed]) assert.ok(m15.includes(md5), md5);
  for (const md5 of [BODIES.BASE.reschedule, BODIES.BASE.notifications, BODIES.POST_0016.reschedule, BODIES.POST_0016.notifications, BODIES.POST_0016.notify]) {
    assert.ok(m16.includes(md5), md5);
  }
  const r16 = fs.readFileSync(FILES['rollback-0016'].path, 'utf8');
  assert.ok(r16.includes(BODIES.POST_0016.reschedule) && r16.includes(BODIES.BASE.reschedule));
  assert.equal(phraseFor('apply-0016'), `APPLY TORNEOS 0016 ${REF} de06a84a7286`);
  assert.equal(phraseFor('rollback-0015'), `ROLLBACK TORNEOS 0015 ${REF} 2e94e2dcd07a`);
});

test('db 0015/0016 classify: BASE, POST_0015, POST_0016, and every drift fails closed', () => {
  for (const state of ['BASE', 'POST_0015', 'POST_0016']) assert.deepEqual(classify(catalogAt(state)), { state, failures: [] });
  assert.equal(classify({ torneos_tables: false }).state, 'DRIFT');
  // 0016 bodies without 0015's (not an order this driver produces).
  assert.equal(classify(catalogAt('BASE', { bodies: { ...BODIES.BASE, reschedule: BODIES.POST_0016.reschedule } })).state, 'DRIFT');
  // POST_0016 bodies but the notice table without its columns, or the trigger disabled.
  assert.equal(classify(catalogAt('POST_0016', { notice: { ...NOTICE.on, columns: [], rows: 0 } })).state, 'DRIFT');
  assert.equal(classify(catalogAt('POST_0016', { notice: { ...NOTICE.on, trigger: false, rows: 0 } })).state, 'DRIFT');
  // Match notices left behind without 0016.
  assert.equal(classify(catalogAt('POST_0015', { notice: { ...NOTICE.off, rows: 3 } })).state, 'DRIFT');
  // An API role able to execute the trigger function, or anon on a participant read.
  assert.equal(classify(catalogAt('POST_0016', { acl: { player: RPC, managed: RPC, reschedule: RPC, notifications: RPC, notify: { ...TRIGGER, authenticated: true } } })).state, 'DRIFT');
  assert.equal(classify(catalogAt('POST_0015', { acl: { player: { ...RPC, anon: true }, managed: RPC, reschedule: RPC, notifications: RPC, notify: null } })).state, 'DRIFT');
  // Match notices are allowed (they are data) once 0016 is on.
  assert.equal(classify(catalogAt('POST_0016', { notice: { ...NOTICE.on, rows: 9 } })).state, 'POST_0016');
});

function fakeDb(states, { code = 0 } = {}) {
  let i = 0; const applied = [];
  return {
    applied,
    deps: {
      readFile: (p) => fs.readFileSync(p),
      catalog: async () => states[Math.min(i, states.length - 1)],
      applySql: async (sql) => { applied.push(sql); i += 1; return { code }; },
    },
  };
}

test('db 0015/0016 run: the exact phrase, the file hash and the observed state gate every write', async () => {
  const ok = fakeDb([catalogAt('BASE'), catalogAt('POST_0015')]);
  const out = await run('apply-0015', phraseFor('apply-0015').split(' '), ok.deps);
  assert.equal(out.verdict, 'APPLY_0015_DONE');
  assert.equal(out.before, 'BASE'); assert.equal(out.after, 'POST_0015'); assert.deepEqual(out.changedOutside, []);
  assert.equal(ok.applied.length, 1);

  await assert.rejects(run('apply-0015', ['APPLY', 'TORNEOS', '0015'], fakeDb([catalogAt('BASE')]).deps), /PHRASE_REQUIRED/);
  await assert.rejects(run('apply-0015', phraseFor('apply-0015').split(' '), { ...fakeDb([catalogAt('BASE')]).deps, readFile: () => Buffer.from('tampered') }), /FILE_HASH_MISMATCH/);
  // 0016 only from POST_0015; 0015 never twice.
  const early = fakeDb([catalogAt('BASE')]);
  await assert.rejects(run('apply-0016', phraseFor('apply-0016').split(' '), early.deps), /PRE_STATE_BASE/);
  assert.equal(early.applied.length, 0);
  await assert.rejects(run('apply-0015', phraseFor('apply-0015').split(' '), fakeDb([catalogAt('POST_0015')]).deps), /PRE_STATE_POST_0015/);
  // A DRIFT before is never written over.
  await assert.rejects(run('apply-0016', phraseFor('apply-0016').split(' '), fakeDb([catalogAt('POST_0015', { notice: { ...NOTICE.off, rows: 1 } })]).deps), /PRE_STATE_DRIFT/);
});

test('db 0015/0016 run: anything outside moving, a psql error or the wrong state after is a FAILED verdict', async () => {
  const moved = fakeDb([catalogAt('POST_0015'), catalogAt('POST_0016', { kept_fn: { count: 500, digest: 'other' } })]);
  const a = await run('apply-0016', phraseFor('apply-0016').split(' '), moved.deps);
  assert.equal(a.verdict, 'APPLY_0016_FAILED'); assert.deepEqual(a.changedOutside, ['kept_fn']);
  const granted = fakeDb([catalogAt('POST_0015'), catalogAt('POST_0016', { counts: { authenticated: 194, anon: 16 } })]);
  assert.deepEqual((await run('apply-0016', phraseFor('apply-0016').split(' '), granted.deps)).changedOutside, ['counts']);
  const failedPsql = fakeDb([catalogAt('POST_0015'), catalogAt('POST_0015')], { code: 3 });
  assert.equal((await run('apply-0016', phraseFor('apply-0016').split(' '), failedPsql.deps)).verdict, 'APPLY_0016_FAILED');
  assert.deepEqual(changedOutside(catalogAt('BASE'), catalogAt('POST_0016')), []);
});

test('db 0015/0016 rollbacks: 0016 first (its notices counted as the data it deletes), then 0015, back to BASE', async () => {
  const r16 = fakeDb([catalogAt('POST_0016', { notice: { ...NOTICE.on, rows: 9 } }), catalogAt('POST_0015')]);
  const out = await run('rollback-0016', phraseFor('rollback-0016').split(' '), r16.deps);
  assert.equal(out.verdict, 'ROLLBACK_0016_DONE'); assert.equal(out.noticesDeleted, 9);
  await assert.rejects(run('rollback-0015', phraseFor('rollback-0015').split(' '), fakeDb([catalogAt('POST_0016')]).deps), /PRE_STATE_POST_0016/);
  const r15 = fakeDb([catalogAt('POST_0015'), catalogAt('BASE')]);
  assert.equal((await run('rollback-0015', phraseFor('rollback-0015').split(' '), r15.deps)).verdict, 'ROLLBACK_0015_DONE');
});

test('db 0015/0016 observe is read only and the catalog is one read-only JSON select naming every pinned object', async () => {
  const db = fakeDb([catalogAt('POST_0016')]);
  const out = await run('observe', [], db.deps);
  assert.equal(out.verdict.state, 'POST_0016'); assert.equal(db.applied.length, 0);
  const sql = fs.readFileSync(new URL('./remote/sql-catalog-0015-0016.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, '');
  assert.match(sql.trim(), /^with [\s\S]*select json_build_object\([\s\S]*\)::text;$/);
  assert.doesNotMatch(sql, /\b(insert|update|delete|create|alter|drop|grant|revoke|truncate|set )\b/i);
  for (const name of ['get_player_tournament_matches', 'get_managed_tournament_matches', 'reschedule_tournament_match',
    'get_my_torneos_notifications', 'notify_tournament_match_schedule_change', 'tournament_match_reschedules_notify',
    'tournament_user_notifications_reschedule_recipient_key', 'tournament_user_notifications_match_shape_check']) {
    assert.ok(sql.includes(name), name);
  }
});
