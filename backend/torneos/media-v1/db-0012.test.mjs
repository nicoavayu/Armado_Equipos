// Operator driver for 0012 on the Torneos Production DB, offline: the pins, the state machine, the gates before every write
// and the "nothing outside MEDIA-V1 moves" rule. The catalog and the transitions were also run on the promotion rehearsal lab
// (real Postgres + Storage, POST_0013), inside one rolled-back transaction: evidence/db-0012-lab-rehearsal.jsonl.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  COMMERCE_DELTA, FILES, MEDIA_BODIES, MEDIA_BUCKET, MEDIA_FUNCTIONS, MEDIA_POLICIES, MODES, REF, STATES, classify, modeSql, run,
} from './remote/db-0012.mjs';
import { ROSTER_SEARCH } from '../connected-v1/remote/db-0009-0011.mjs';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const md5 = (text) => crypto.createHash('md5').update(text).digest('hex');
const MIGRATIONS = 'backend/torneos/supabase/migrations';

// prosrc = the text between `AS $tag$` and the closing `$tag$` of the function's definition (rule checked on the lab).
function prosrc(sql, qualified) {
  const at = sql.search(new RegExp(`create (or replace )?function ${qualified.replace('.', '\\.')}\\(`, 'i'));
  assert.ok(at >= 0, qualified);
  const open = /\bAS (\$[a-z_]*\$)/i.exec(sql.slice(at));
  const start = at + open.index + open[0].length;
  return sql.slice(start, sql.indexOf(open[1], start));
}

function catalogAt(state, { commerce = false, mode, mutate = (c) => c } = {}) {
  const s = STATES[state];
  return mutate({
    torneos_tables: true, storage_ready: true, roster_search: { ...ROSTER_SEARCH.fixed }, commerce, media_objects: 0,
    mode: mode ?? (s.media ? 'MVP_SIMPLE' : 'PROCESSOR_EXTERNAL'),
    counts: { authenticated: s.counts[0] + (commerce ? COMMERCE_DELTA[0] : 0), anon: s.counts[1] + (commerce ? COMMERCE_DELTA[1] : 0) },
    media: s.media
      ? { functions: [...MEDIA_FUNCTIONS], policies: [...MEDIA_POLICIES], budget_table: true, bodies: { ...MEDIA_BODIES[s.bodies] },
        bucket: { ...MEDIA_BUCKET, allowed_mime_types: [...MEDIA_BUCKET.allowed_mime_types] }, grants: { transition: true, change_state: true, report: true } }
      : { functions: [], policies: [], budget_table: false, bodies: { ...MEDIA_BODIES.certified }, bucket: null,
        grants: { transition: false, change_state: false, report: false } },
    kept_fn: { count: 425, digest: 'a' }, kept_relations: { count: 123, digest: 'b' }, kept_policies: { count: 69, digest: 'c' }, other_buckets: { count: 1, digest: 'd' },
  });
}
const phrase = (mode) => `${mode.split('-')[0].toUpperCase()} TORNEOS ${FILES[mode].phase} ${REF} ${FILES[mode].sha256.slice(0, 12)}`.split(' ');

test('db 0012 pins the exact files of this branch, the target ref and the bodies they install', () => {
  assert.equal(REF, 'onzpwnqxnvlgsevivngf');
  for (const f of Object.values(FILES)) assert.equal(sha256(fs.readFileSync(f.rel)), f.sha256, f.rel);
  const baseline = fs.readFileSync(`${MIGRATIONS}/00000000000000_torneos_baseline_v1.sql`, 'utf8');
  const media = fs.readFileSync(FILES['apply-0012'].rel, 'utf8');
  const rollback = fs.readFileSync(FILES['rollback-0012'].rel, 'utf8');
  for (const [key, fn] of [['storage', 'public.tournament_media_storage_contract_status'], ['readiness', 'public.tournament_media_effective_readiness'],
    ['published', 'public.get_published_tournament_media']]) {
    assert.equal(md5(prosrc(baseline, fn)), MEDIA_BODIES.certified[key], `baseline ${fn}`);
    assert.equal(md5(prosrc(rollback, fn)), MEDIA_BODIES.certified[key], `rollback restores ${fn} to the byte`);
    assert.equal(md5(prosrc(media, fn)), MEDIA_BODIES.media[key], `0012 ${fn}`);
  }
  // 0014: the two moderation bodies, from the baseline text, restored byte for byte by its rollback.
  const draft = fs.readFileSync(FILES['apply-0014'].rel, 'utf8');
  const undraft = fs.readFileSync(FILES['rollback-0014'].rel, 'utf8');
  for (const [key, fn] of [['transition', 'public.transition_tournament_media_asset'], ['publish', 'public.publish_tournament_media_gallery']]) {
    assert.equal(md5(prosrc(baseline, fn)), MEDIA_BODIES.certified[key], `baseline ${fn}`);
    assert.equal(MEDIA_BODIES.media[key], MEDIA_BODIES.certified[key], `0012 does not touch ${fn}`);
    assert.equal(md5(prosrc(draft, fn)), MEDIA_BODIES.draft[key], `0014 ${fn}`);
    assert.equal(md5(prosrc(undraft, fn)), MEDIA_BODIES.certified[key], `rollback-0014 restores ${fn} to the byte`);
    assert.ok(draft.includes(`'${MEDIA_BODIES.certified[key]}'`) && draft.includes(`'${MEDIA_BODIES.draft[key]}'`), `0014 pins ${fn} before and after`);
  }
  for (const key of ['storage', 'readiness', 'published']) assert.equal(MEDIA_BODIES.draft[key], MEDIA_BODIES.media[key], `0014 leaves ${key}`);
  for (const name of MEDIA_FUNCTIONS) assert.match(media, new RegExp(`create (or replace )?function ${name.replace('.', '\\.')}\\(`, 'i'), name);
  for (const name of MEDIA_POLICIES) assert.match(media, new RegExp(`create policy ${name}\\b`), name);
  // 8 new functions granted to authenticated + 3 baseline RPCs (transition / change state / report) = +11.
  assert.equal(STATES.POST_0012.counts[0] - STATES.POST_0011.counts[0], 11);
  assert.equal((media.match(/^grant execute on function public\.[^\n]* to authenticated/gm) || []).length, 11);
});

test('db 0012 classify: POST_0011, POST_0012, POST_0014 (with or without 0013) and every drift fails closed', () => {
  for (const state of Object.keys(STATES)) {
    for (const commerce of [false, true]) assert.deepEqual(classify(catalogAt(state, { commerce })), { state, failures: [] }, `${state} commerce=${commerce}`);
  }
  for (const [state, mutate, why] of [
    ['POST_0011', (c) => { c.counts.authenticated = 195; return c; }, '0013 counts without 0013'],
    ['POST_0011', (c) => { c.commerce = undefined; return c; }, 'commerce unknown'],
    ['POST_0011', (c) => { c.media.functions = ['public.begin_tournament_media_gallery_upload']; return c; }, 'partial functions'],
    ['POST_0011', (c) => { c.media.grants.transition = true; return c; }, 'one grant only'],
    ['POST_0011', (c) => { c.media.bodies.storage = MEDIA_BODIES.media.storage; return c; }, 'mixed bodies'],
    ['POST_0011', (c) => { c.mode = 'MVP_SIMPLE'; return c; }, 'MVP_SIMPLE without 0012'],
    ['POST_0011', (c) => { c.media.bucket = { ...MEDIA_BUCKET, public: true }; return c; }, 'public residue'],
    ['POST_0011', (c) => { c.roster_search = { ...ROSTER_SEARCH.certified }; return c; }, 'below 0011'],
    ['POST_0012', (c) => { c.media.bucket.public = true; return c; }, 'public bucket'],
    ['POST_0012', (c) => { c.media.bucket.file_size_limit = 26214400; return c; }, 'bucket limit'],
    ['POST_0012', (c) => { c.media.bucket = null; return c; }, 'no bucket'],
    ['POST_0012', (c) => { c.media.policies.pop(); return c; }, 'policy missing'],
    ['POST_0012', (c) => { c.media.policies.push('tournament_media_client_insert'); return c; }, 'extra policy'],
    ['POST_0012', (c) => { c.media.budget_table = false; return c; }, 'budget table'],
    ['POST_0012', (c) => { c.media.grants.report = false; return c; }, 'grant missing'],
    ['POST_0012', (c) => { c.media.bodies.published = MEDIA_BODIES.certified.published; return c; }, 'unsigned delivery body'],
    ['POST_0012', (c) => { c.counts.anon = 17; return c; }, 'anon grant'],
    ['POST_0012', (c) => { c.mode = 'SOMETHING'; return c; }, 'unknown mode'],
    ['POST_0012', (c) => { c.torneos_tables = false; return c; }, 'not Torneos'],
    ['POST_0012', (c) => { c.media.bodies.transition = MEDIA_BODIES.draft.transition; return c; }, 'half of 0014'],
    ['POST_0014', (c) => { c.media.bodies.publish = MEDIA_BODIES.certified.publish; return c; }, 'half of 0014 (publish)'],
    ['POST_0011', (c) => { c.media.bodies.transition = MEDIA_BODIES.draft.transition; return c; }, '0014 without 0012'],
  ]) assert.equal(classify(catalogAt(state, { mutate })).state, 'DRIFT', why);
  assert.equal(classify(null).state, 'DRIFT');
  // rollback-0012 keeps the private bucket and its photos: accepted below 0012 only with the exact 0012 configuration.
  const residue = classify(catalogAt('POST_0011', { mutate: (c) => { c.media.bucket = { ...MEDIA_BUCKET }; c.media_objects = 78; return c; } }));
  assert.deepEqual(residue, { state: 'POST_0011', failures: [], residue: ['tournament-media bucket (private, no policies, 78 objects; kept by rollback-0012)'] });
});

function fakeDb(start, opts = {}) {
  const calls = [];
  let current = catalogAt(start, opts);
  return {
    calls,
    deps: {
      readFile: (p) => fs.readFileSync(p),
      catalog: async () => JSON.parse(JSON.stringify(current)),
      applySql: async (sql) => {
        calls.push(sql);
        if (opts.next) current = opts.next(current, sql);
        return { code: opts.code ?? 0 };
      },
    },
  };
}
const transitionTo = (state, extra = {}) => (c) => ({ ...catalogAt(state, { commerce: c.commerce, mode: c.mode }), ...extra });

test('db 0012 run: the exact phrase, the file hash and the observed states gate every write', async () => {
  await assert.rejects(run('apply-0012', ['APPLY', 'TORNEOS', '0012'], fakeDb('POST_0011').deps), /PHRASE_REQUIRED: APPLY TORNEOS 0012 onzpwnqxnvlg/);
  await assert.rejects(run('apply-0012', phrase('apply-0012'), { ...fakeDb('POST_0011').deps, readFile: () => Buffer.from('tampered') }), /FILE_HASH_MISMATCH/);
  const already = fakeDb('POST_0012');
  await assert.rejects(run('apply-0012', phrase('apply-0012'), already.deps), /PRE_STATE_POST_0012/);
  assert.equal(already.calls.length, 0);
  await assert.rejects(run('apply-0012', phrase('apply-0012'), fakeDb('POST_0011', { mutate: (c) => { c.storage_ready = false; return c; } }).deps), /STORAGE_SCHEMA_MISSING/);
  await assert.rejects(run('nope', [], fakeDb('POST_0011').deps), /usage/);

  for (const commerce of [false, true]) {
    const db = fakeDb('POST_0011', { commerce, next: transitionTo('POST_0012') });
    const out = await run('apply-0012', phrase('apply-0012'), db.deps);
    assert.equal(out.verdict, 'APPLY_0012_DONE', `commerce=${commerce}`);
    assert.deepEqual([out.before, out.after, out.changedOutside], ['POST_0011', 'POST_0012', []]);
    assert.equal(db.calls[0], fs.readFileSync(FILES['apply-0012'].rel, 'utf8'));
  }
  // Anything outside MEDIA-V1 moving (here a function's ACL) fails the verdict even when the media state is right.
  const leak = await run('apply-0012', phrase('apply-0012'), fakeDb('POST_0011', { next: transitionTo('POST_0012', { kept_fn: { count: 425, digest: 'z' } }) }).deps);
  assert.deepEqual([leak.verdict, leak.changedOutside], ['APPLY_0012_FAILED', ['kept_fn']]);
  const partial = await run('apply-0012', phrase('apply-0012'), fakeDb('POST_0011', { code: 3 }).deps);
  assert.equal(partial.verdict, 'APPLY_0012_FAILED');
});

test('db 0012 rollback: only with the pipeline off MVP_SIMPLE, and it lands on POST_0011 with the bucket residue', async () => {
  const live = fakeDb('POST_0012');
  await assert.rejects(run('rollback-0012', phrase('rollback-0012'), live.deps), /ROLLBACK_REFUSED mode is MVP_SIMPLE/);
  assert.equal(live.calls.length, 0);
  const keep = (c) => { const n = catalogAt('POST_0011', { commerce: c.commerce, mode: c.mode }); n.media.bucket = { ...MEDIA_BUCKET }; return n; };
  const db = fakeDb('POST_0012', { mode: 'PROCESSOR_EXTERNAL', next: keep });
  const out = await run('rollback-0012', phrase('rollback-0012'), db.deps);
  assert.deepEqual([out.verdict, out.before, out.after], ['ROLLBACK_0012_DONE', 'POST_0012', 'POST_0011']);
  // …and apply-0012 passes its gate again from that residue.
  const again = await run('apply-0012', phrase('apply-0012'), fakeDb('POST_0011', { mutate: (c) => { c.media.bucket = { ...MEDIA_BUCKET }; return c; }, next: transitionTo('POST_0012') }).deps);
  assert.equal(again.verdict, 'APPLY_0012_DONE');
});

test('db 0014: from POST_0012 only, a body swap that may land with the pipeline live, and its rollback returns to POST_0012', async () => {
  const early = fakeDb('POST_0011');
  await assert.rejects(run('apply-0014', phrase('apply-0014'), early.deps), /PRE_STATE_POST_0011/);
  assert.equal(early.calls.length, 0);
  await assert.rejects(run('apply-0014', ['APPLY', 'TORNEOS', '0012', REF, FILES['apply-0014'].sha256.slice(0, 12)], fakeDb('POST_0012').deps), /PHRASE_REQUIRED: APPLY TORNEOS 0014/);
  for (const commerce of [false, true]) {
    const db = fakeDb('POST_0012', { commerce, next: transitionTo('POST_0014') });
    const out = await run('apply-0014', phrase('apply-0014'), db.deps);
    assert.deepEqual([out.verdict, out.before, out.after, out.changedOutside], ['APPLY_0014_DONE', 'POST_0012', 'POST_0014', []], `commerce=${commerce}`);
    assert.equal(db.calls[0], fs.readFileSync(FILES['apply-0014'].rel, 'utf8'));
  }
  const back = await run('rollback-0014', phrase('rollback-0014'), fakeDb('POST_0014', { next: transitionTo('POST_0012') }).deps);
  assert.deepEqual([back.verdict, back.before, back.after], ['ROLLBACK_0014_DONE', 'POST_0014', 'POST_0012']);
  // The contract is withdrawn in order: 0014 first, then 0012.
  await assert.rejects(run('rollback-0012', phrase('rollback-0012'), fakeDb('POST_0014', { mode: 'PROCESSOR_EXTERNAL' }).deps), /PRE_STATE_POST_0014/);
  const on = await run('mode', ['MVP_SIMPLE', ...`SET TORNEOS MEDIA PIPELINE MODE MVP_SIMPLE ${REF}`.split(' ')],
    fakeDb('POST_0014', { mode: 'PROCESSOR_EXTERNAL', next: (c) => ({ ...c, mode: 'MVP_SIMPLE' }) }).deps);
  assert.equal(on.verdict, 'MODE_MVP_SIMPLE_DONE');
});

test('db 0012 mode: validated literal, MVP_SIMPLE only on POST_0012, verified after the write', async () => {
  assert.deepEqual(MODES, ['DISABLED', 'MVP_SIMPLE', 'PROCESSOR_EXTERNAL']);
  assert.throws(() => modeSql("MVP_SIMPLE'; drop table x; --"), /MODE_INVALID/);
  assert.match(modeSql('MVP_SIMPLE'), /SET mode = 'MVP_SIMPLE'.*WHERE singleton/);
  const words = (m) => [m, ...`SET TORNEOS MEDIA PIPELINE MODE ${m} ${REF}`.split(' ')];
  await assert.rejects(run('mode', ['MVP_SIMPLE', 'SET', 'TORNEOS'], fakeDb('POST_0012').deps), /PHRASE_REQUIRED: SET TORNEOS MEDIA PIPELINE MODE MVP_SIMPLE/);
  const early = fakeDb('POST_0011');
  await assert.rejects(run('mode', words('MVP_SIMPLE'), early.deps), /PRE_STATE_POST_0011/);
  assert.equal(early.calls.length, 0);
  const setMode = (m) => (c) => ({ ...c, mode: m });
  const on = await run('mode', words('MVP_SIMPLE'), fakeDb('POST_0012', { mode: 'PROCESSOR_EXTERNAL', next: setMode('MVP_SIMPLE') }).deps);
  assert.deepEqual([on.verdict, on.modeBefore, on.modeAfter], ['MODE_MVP_SIMPLE_DONE', 'PROCESSOR_EXTERNAL', 'MVP_SIMPLE']);
  const off = await run('mode', words('PROCESSOR_EXTERNAL'), fakeDb('POST_0012', { next: setMode('PROCESSOR_EXTERNAL') }).deps);
  assert.equal(off.verdict, 'MODE_PROCESSOR_EXTERNAL_DONE');
  const ignored = await run('mode', words('PROCESSOR_EXTERNAL'), fakeDb('POST_0012').deps);
  assert.equal(ignored.verdict, 'MODE_PROCESSOR_EXTERNAL_FAILED', 'the write must be observed');
  await assert.rejects(run('mode', words('MVP_SIMPLE'), fakeDb('POST_0011', { mutate: (c) => { c.counts.anon = 99; return c; } }).deps), /PRE_STATE_DRIFT/);
});

test('db 0012 observe is read only and reports the verdict', async () => {
  const db = fakeDb('POST_0012', { commerce: true });
  const out = await run('observe', [], db.deps);
  assert.deepEqual([out.verdict.state, db.calls.length], ['POST_0012', 0]);
});

test('db 0012 catalog SQL is one read-only JSON select that names every pinned object', () => {
  const sql = fs.readFileSync('backend/torneos/media-v1/remote/sql-catalog.sql', 'utf8');
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /\b(insert|update|delete|alter|drop|create|grant|revoke|truncate|set_config)\b/i);
  for (const name of MEDIA_FUNCTIONS) assert.ok(sql.includes(`'${name}'`), name);
  for (const key of ['kept_fn', 'kept_relations', 'kept_policies', 'other_buckets', 'commerce', 'media_objects', 'mode']) assert.ok(sql.includes(`'${key}'`), key);
});
