// Unit tests for supabase/functions/_shared/coreAccountStorageErasure.ts (account deletion: the person's own Core Storage
// objects). Transpiles the real TypeScript and drives it against a fake Storage API with storage-api list/remove
// semantics (fixtures/fake-core-storage.mjs). No network, no real Storage.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createFakeReferenceDb, createFakeStorage } from './fixtures/fake-core-storage.mjs';

const modulePath = path.join(process.cwd(), 'supabase', 'functions', '_shared', 'coreAccountStorageErasure.ts');
let outDir; let m;
test.before(async () => {
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arma2-core-storage-erasure-'));
  const js = ts.transpileModule(await fs.readFile(modulePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true }, fileName: 'm.ts' }).outputText;
  await fs.writeFile(path.join(outDir, 'm.mjs'), js);
  m = await import(pathToFileURL(path.join(outDir, 'm.mjs')).href);
});
test.after(async () => { await fs.rm(outDir, { recursive: true, force: true }); });

const UID = randomUUID();
const OTHER = randomUUID();
const PUBLIC = 'https://core.example.invalid/storage/v1/object/public';
const run = (storage, db = createFakeReferenceDb(), extra = {}) => m.eraseCoreAccountStorage({ storage: storage.api, db, userId: UID, ...extra });
const removedPaths = (storage, bucket) => storage.calls.filter((c) => c.op === 'remove' && c.bucket === bucket).flatMap((c) => c.paths).sort();

test('jugadores-fotos: removes <uid>/… (any depth), root <uid>_… files and <uid>_… folders; never another id, guest/, partido_ or a name with the uid in the middle', async () => {
  const mine = [`${UID}/a.jpg`, `${UID}/x/y.png`, `${UID}_169.jpg`, `${UID}_old/z.jpg`];
  const foreign = [`${OTHER}/a.jpg`, `${OTHER}_1.jpg`, 'guest/m1/g.jpg', 'partido_1700.jpg', `foo${UID}_x.jpg`, `foo/${UID}_x.jpg`, `${UID.toUpperCase()}_1.jpg`];
  const storage = createFakeStorage({ 'jugadores-fotos': [...mine, ...foreign] });
  const result = await run(storage);
  assert.deepEqual(result, { status: 'ok', removed: 4, keptReferenced: 0 });
  assert.deepEqual(removedPaths(storage, 'jugadores-fotos'), [...mine].sort());
  assert.deepEqual(storage.objects('jugadores-fotos'), [...foreign].sort());
  const rootList = storage.calls.find((c) => c.op === 'list' && c.prefix === '');
  assert.equal(rootList.options.search, UID, 'the root listing is narrowed by search; the filter itself is in code');
  assert.deepEqual(rootList.options.sortBy, { column: 'name', order: 'asc' });
});

test('team-crests: keeps what teams.crest_url / team_members.photo_url use (query string, URL-encoded), removes drafts and old versions, never another id', async () => {
  const crest = `${UID}/team-1/1700-escudo.png`;
  const memberPhoto = `${UID}/team-1/members/m-9/1700-foto jugador.png`;
  const storage = createFakeStorage({ 'team-crests': [
    crest, memberPhoto, `${UID}/team-1/1600-escudo-viejo.png`, `${UID}/draft/1500-borrador.png`, `${UID}/team-1/members/draft/1.png`,
    `${OTHER}/team-2/1700-escudo.png`,
  ] });
  const db = createFakeReferenceDb({
    teams: [{ crest_url: `${PUBLIC}/team-crests/${crest}?t=123` }, { crest_url: `${PUBLIC}/team-crests/${OTHER}/team-2/1700-escudo.png` }],
    team_members: [{ photo_url: `${PUBLIC}/team-crests/${encodeURI(memberPhoto)}` }, { photo_url: null }],
  });
  const result = await run(storage, db);
  assert.deepEqual(result, { status: 'ok', removed: 3, keptReferenced: 2 });
  assert.deepEqual(storage.objects('team-crests'), [crest, memberPhoto, `${OTHER}/team-2/1700-escudo.png`].sort());
  for (const q of db.calls) assert.equal(q.pattern, `%/team-crests/${UID}/%`, 'the reference queries look only at this uid folder');
  assert.deepEqual(db.calls.map((q) => `${q.table}.${q.col}`).sort(), ['team_members.photo_url', 'teams.crest_url']);
});

test('no crest objects → no reference query at all', async () => {
  const db = createFakeReferenceDb();
  await run(createFakeStorage({ 'jugadores-fotos': [`${UID}_1.jpg`] }), db);
  assert.equal(db.calls.length, 0);
});

test('pagination and batches: 2300 objects are listed in 3 pages and removed in 23 batches of ≤ 100', async () => {
  const paths = Array.from({ length: 2300 }, (_, i) => `${UID}/${String(i).padStart(5, '0')}.jpg`);
  const storage = createFakeStorage({ 'jugadores-fotos': paths });
  const result = await run(storage);
  assert.deepEqual(result, { status: 'ok', removed: 2300, keptReferenced: 0 });
  const removes = storage.calls.filter((c) => c.op === 'remove');
  assert.equal(removes.length, 23);
  assert.ok(removes.every((c) => c.paths.length <= 100));
  assert.deepEqual(storage.calls.filter((c) => c.op === 'list' && c.bucket === 'jugadores-fotos' && c.prefix === UID).map((c) => c.options.offset), [0, 1000, 2000]);
  assert.deepEqual(storage.objects('jugadores-fotos'), []);
});

test('bounded: 6000 objects → incomplete after 5000 (a retry finishes); a retry never re-removes what is gone', async () => {
  const paths = Array.from({ length: 6000 }, (_, i) => `${UID}/${String(i).padStart(5, '0')}.jpg`);
  const storage = createFakeStorage({ 'jugadores-fotos': paths });
  const first = await run(storage);
  assert.deepEqual(first, { status: 'incomplete', removed: 5000, keptReferenced: 0, code: 'storage_too_many_objects' });
  const second = await run(storage);
  assert.deepEqual(second, { status: 'ok', removed: 1000, keptReferenced: 0 });
  assert.deepEqual(storage.objects('jugadores-fotos'), []);
});

test('idempotent: running twice gives the same final state; the second run removes nothing', async () => {
  const storage = createFakeStorage({ 'jugadores-fotos': [`${UID}/a.jpg`, `${OTHER}/b.jpg`], 'team-crests': [`${UID}/draft/x.png`] });
  assert.equal((await run(storage)).removed, 2);
  const before = [storage.objects('jugadores-fotos'), storage.objects('team-crests')];
  assert.deepEqual(await run(storage), { status: 'ok', removed: 0, keptReferenced: 0 });
  assert.deepEqual([storage.objects('jugadores-fotos'), storage.objects('team-crests')], before);
});

test('fail closed: a list error, a remove error or a reference-query error → failed with a code (and crests are never removed without the reference check)', async () => {
  const s1 = createFakeStorage({ 'jugadores-fotos': [`${UID}/a.jpg`] });
  s1.state.failOn = (op) => (op === 'list' ? { message: 'boom' } : null);
  assert.deepEqual(await run(s1), { status: 'failed', removed: 0, keptReferenced: 0, code: 'storage_list_failed' });
  assert.equal(s1.calls.filter((c) => c.op === 'remove').length, 0);

  const s2 = createFakeStorage({ 'jugadores-fotos': [`${UID}/a.jpg`] });
  s2.state.failOn = (op) => (op === 'remove' ? { message: 'boom' } : null);
  assert.deepEqual(await run(s2), { status: 'failed', removed: 0, keptReferenced: 0, code: 'storage_remove_failed' });

  const s3 = createFakeStorage({ 'jugadores-fotos': [`${UID}/a.jpg`], 'team-crests': [`${UID}/t/1.png`] });
  const db = createFakeReferenceDb({}, { failOn: (table) => (table === 'team_members' ? { message: 'boom' } : null) });
  assert.deepEqual(await run(s3, db), { status: 'failed', removed: 0, keptReferenced: 0, code: 'storage_references_failed' });
  assert.equal(s3.calls.filter((c) => c.op === 'remove').length, 0, 'nothing at all is removed before the reference check passes');
});

test('timeout: a Storage call that hangs → failed storage_timeout', async () => {
  const storage = createFakeStorage({ 'jugadores-fotos': [`${UID}/a.jpg`] });
  storage.state.hangOn = (op) => op === 'remove';
  assert.deepEqual(await run(storage, undefined, { timeoutMs: 20 }), { status: 'failed', removed: 0, keptReferenced: 0, code: 'storage_timeout' });
});

test('a malformed uid makes no Storage call at all (uppercase, empty, path tricks)', async () => {
  for (const bad of ['', 'abc', UID.toUpperCase(), `${UID}/..`, `../${UID}`, '%', '_']) {
    const storage = createFakeStorage({ 'jugadores-fotos': [`${UID}/a.jpg`] });
    const result = await m.eraseCoreAccountStorage({ storage: storage.api, db: createFakeReferenceDb(), userId: bad });
    assert.deepEqual(result, { status: 'failed', removed: 0, keptReferenced: 0, code: 'storage_invalid_user' }, bad);
    assert.equal(storage.calls.length, 0);
  }
});

test('the last guard: one foreign or dot-dot path from a misbehaving listing aborts everything (nothing removed)', async () => {
  const storage = createFakeStorage({ 'jugadores-fotos': [`${UID}/a.jpg`] });
  storage.state.listEntriesOverride = (bucket, prefix) => (bucket === 'jugadores-fotos' && prefix === UID
    ? [{ name: 'a.jpg', id: 'x' }, { name: '..', id: 'y' }] : null);
  assert.deepEqual(await run(storage), { status: 'failed', removed: 0, keptReferenced: 0, code: 'storage_guard_violation' });
  assert.equal(storage.calls.filter((c) => c.op === 'remove').length, 0);
  // entries carrying a slash are never trusted as a child name
  const s2 = createFakeStorage({});
  s2.state.listEntriesOverride = (bucket, prefix) => (prefix === UID ? [{ name: `../${OTHER}/a.jpg`, id: 'x' }] : prefix === '' ? [{ name: `${UID}_/../x`, id: 'y' }] : null);
  assert.deepEqual(await run(s2), { status: 'ok', removed: 0, keptReferenced: 0 });
  assert.equal(s2.calls.filter((c) => c.op === 'remove').length, 0);
});

test('isOwnPath / crestPathFromUrl', () => {
  assert.ok(m.isOwnPath('jugadores-fotos', UID, `${UID}/a.jpg`));
  assert.ok(m.isOwnPath('jugadores-fotos', UID, `${UID}_1.jpg`));
  assert.ok(!m.isOwnPath('jugadores-fotos', UID, `${UID}`));
  assert.ok(!m.isOwnPath('jugadores-fotos', UID, `${UID}/`));
  assert.ok(!m.isOwnPath('jugadores-fotos', UID, `${UID}.jpg`));
  assert.ok(!m.isOwnPath('jugadores-fotos', UID, `${OTHER}/a.jpg`));
  assert.ok(!m.isOwnPath('jugadores-fotos', UID, `${UID}/../${OTHER}/a.jpg`));
  assert.ok(!m.isOwnPath('team-crests', UID, `${UID}_1.png`), 'team-crests: only the folder');
  assert.ok(m.isOwnPath('team-crests', UID, `${UID}/t/1.png`));
  assert.ok(!m.isOwnPath('tournament-branding', UID, `${UID}/a.png`), 'no other bucket');
  assert.equal(m.crestPathFromUrl(`${PUBLIC}/team-crests/${UID}/t/a%20b.png?x=1#f`), `${UID}/t/a b.png`);
  assert.equal(m.crestPathFromUrl('https://core.example.invalid/storage/v1/render/image/public/team-crests/u/t/a.png?width=64'), 'u/t/a.png');
  assert.equal(m.crestPathFromUrl('https://lh3.googleusercontent.com/a/x'), null);
  assert.equal(m.crestPathFromUrl(null), null);
  assert.equal(m.storageErasureMode(undefined), 'required');
  assert.equal(m.storageErasureMode('BEST_EFFORT'), 'best_effort');
  assert.equal(m.storageErasureMode('off'), 'required', 'anything else fails closed');
});

test('too deep: objects below MAX_DEPTH folders → incomplete storage_too_deep (the shallow ones are removed)', async () => {
  const deep = `${UID}/${Array.from({ length: m.MAX_DEPTH + 1 }, (_, i) => `d${i}`).join('/')}/x.jpg`;
  const storage = createFakeStorage({ 'jugadores-fotos': [`${UID}/a.jpg`, deep] });
  const result = await run(storage);
  assert.deepEqual(result, { status: 'incomplete', removed: 1, keptReferenced: 0, code: 'storage_too_deep' });
  assert.deepEqual(storage.objects('jugadores-fotos'), [deep]);
});
