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
  const rootList = storage.calls.find((c) => c.op === 'list' && c.bucket === 'jugadores-fotos' && c.prefix === '');
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

// ── Bucket classification (Codex review of #218: `avatars` was not classified) ───────────────────────────────────────

const REPO = process.cwd();
const listFiles = async (dir, keep) => {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!['node_modules', '__tests__', '__mocks__'].includes(entry.name)) out.push(...await listFiles(full, keep)); }
    else if (keep(entry.name)) out.push(full);
  }
  return out;
};
/** Every Storage bucket id the Core repo declares or uses: SQL (create/update buckets, policies), config.toml, Edge
 * Functions and the app (storage.from('…'), *_BUCKET constants). The Torneos project (backend/torneos) is another
 * Supabase project with its own Storage: not Core, not this step. */
async function bucketsDeclaredInRepo() {
  const found = new Map();
  const note = (bucket, file) => { if (!found.has(bucket)) found.set(bucket, new Set()); found.get(bucket).add(path.relative(REPO, file)); };
  const sqlFiles = await listFiles(path.join(REPO, 'supabase'), (n) => n.endsWith('.sql'));
  for (const file of sqlFiles) {
    const sql = await fs.readFile(file, 'utf8');
    for (const block of sql.matchAll(/insert\s+into\s+storage\.buckets[\s\S]*?(?:on\s+conflict|;)/gi)) {
      for (const tuple of block[0].matchAll(/\(\s*'([a-z0-9][a-z0-9_-]*)'/gi)) note(tuple[1], file);
    }
    for (const match of sql.matchAll(/update\s+storage\.buckets[\s\S]*?where\s+id\s*=\s*'([^']+)'/gi)) note(match[1], file);
    for (const match of sql.matchAll(/bucket(?:_id|\.id)\s*=\s*'([^']+)'/gi)) note(match[1], file);
    for (const match of sql.matchAll(/bucket(?:_id|\.id)\s+in\s*\(([^)]*)\)/gi)) for (const q of match[1].matchAll(/'([^']+)'/g)) note(q[1], file);
  }
  const tomlPath = path.join(REPO, 'supabase', 'config.toml');
  const toml = await fs.readFile(tomlPath, 'utf8');
  for (const match of toml.matchAll(/^\s*\[storage\.buckets\.([^\]]+)\]/gm)) note(match[1].replace(/^"|"$/g, ''), tomlPath);
  const codeFiles = [
    ...await listFiles(path.join(REPO, 'supabase', 'functions'), (n) => /\.(ts|js|mjs)$/.test(n)),
    ...await listFiles(path.join(REPO, 'src'), (n) => /\.(js|jsx|ts|tsx)$/.test(n) && !/\.test\./.test(n)),
  ];
  for (const file of codeFiles) {
    const code = await fs.readFile(file, 'utf8');
    for (const match of code.matchAll(/storage\s*\.from\(\s*['"`]([^'"`]+)['"`]/g)) note(match[1], file);
    for (const match of code.matchAll(/\b[A-Z][A-Z0-9_]*BUCKET\s*(?::\s*[A-Za-z]+\s*)?=\s*['"`]([^'"`]+)['"`]/g)) note(match[1], file);
  }
  return found;
}

test('classification: every bucket the Core repo declares is classified (fail closed: a new bucket fails this test until it is)', async () => {
  const declared = await bucketsDeclaredInRepo();
  for (const known of ['jugadores-fotos', 'team-crests', 'avatars', 'tournament-branding', 'tournament-player-portraits', 'tournament-team-photos', 'tournament-media']) {
    assert.ok(declared.has(known), `the scanner still finds ${known} (guards against a scanner that silently finds nothing)`);
  }
  const unclassified = [...declared.keys()].filter((bucket) => m.bucketRule(bucket) === null)
    .map((bucket) => `${bucket} (${[...declared.get(bucket)].join(', ')})`);
  assert.deepEqual(unclassified, [], 'classify it in CORE_STORAGE_BUCKETS (supabase/functions/_shared/coreAccountStorageErasure.ts) and in the design doc §2.6');
});

test('the operator inventory SQL is READ ONLY + ROLLBACK, SELECT-only, covers every erased bucket and prints no names', async () => {
  const raw = await fs.readFile(path.join(REPO, 'scripts', 'ops', 'core-account-deletion', 'storage-inventory-readonly.sql'), 'utf8');
  const sql = raw.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n');
  const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
  assert.equal(statements[0].toLowerCase(), 'begin transaction read only');
  assert.equal(statements.at(-1).toLowerCase(), 'rollback');
  for (const statement of statements.slice(1, -1)) {
    assert.match(statement, /^(set local statement_timeout = '\d+s'|select\b|with\b)/i, statement.slice(0, 60));
  }
  assert.doesNotMatch(sql, /\b(insert|update|delete|alter|drop|create|grant|revoke|truncate|copy|call|do)\b/i);
  // Output columns are aggregates or bucket settings: never the object name, an owner id, a URL or a user id.
  assert.doesNotMatch(sql, /select\s+(distinct\s+)?(o\.)?(name|owner_id|id)\s*[,\n]/i);
  for (const bucket of m.ERASED_BUCKETS) assert.ok(sql.includes(`'${bucket}'`), bucket);
});

test('classification: the table is explicit, frozen and erases exactly jugadores-fotos, avatars and team-crests', () => {
  assert.ok(Object.isFrozen(m.CORE_STORAGE_BUCKETS));
  for (const [bucket, rule] of Object.entries(m.CORE_STORAGE_BUCKETS)) {
    assert.ok(Object.isFrozen(rule), bucket);
    assert.ok(['person', 'team', 'organization'].includes(rule.owner), bucket);
    assert.ok(['uid_folder_and_uid_underscore', 'uid_underscore', 'uid_folder_unreferenced', 'never'].includes(rule.erasure), bucket);
    assert.ok(typeof rule.reason === 'string' && rule.reason.length > 40, `${bucket} says why`);
    if (rule.owner === 'organization') assert.equal(rule.erasure, 'never', `${bucket}: organization content is never erased with a person`);
  }
  assert.deepEqual([...m.ERASED_BUCKETS], ['jugadores-fotos', 'avatars', 'team-crests']);
  assert.deepEqual(
    Object.fromEntries(Object.entries(m.CORE_STORAGE_BUCKETS).map(([b, r]) => [b, `${r.owner}:${r.erasure}`])),
    {
      'jugadores-fotos': 'person:uid_folder_and_uid_underscore',
      avatars: 'person:uid_underscore',
      'team-crests': 'team:uid_folder_unreferenced',
      'tournament-branding': 'organization:never',
      'tournament-player-portraits': 'organization:never',
      'tournament-team-photos': 'organization:never',
      'tournament-media': 'organization:never',
    },
  );
  assert.equal(m.bucketRule('unknown-bucket'), null);
  assert.equal(m.bucketRule('__proto__'), null);
  assert.equal(m.bucketRule('toString'), null);
});

test('classification: a bucket that is not erased (tournament-*, unknown) is never listed nor removed, and no path in it is ever "own"', async () => {
  const opened = [];
  const storage = createFakeStorage({ 'tournament-branding': [`${UID}/a.png`], 'unknown-bucket': [`${UID}_1.jpg`] });
  const api = { from: (bucket) => { opened.push(bucket); return storage.api.from(bucket); } };
  await m.eraseCoreAccountStorage({ storage: api, db: createFakeReferenceDb(), userId: UID });
  assert.deepEqual(opened, ['jugadores-fotos', 'avatars', 'team-crests']);
  assert.deepEqual(storage.objects('tournament-branding'), [`${UID}/a.png`]);
  for (const bucket of ['tournament-branding', 'tournament-player-portraits', 'tournament-team-photos', 'tournament-media', 'unknown-bucket', '__proto__']) {
    for (const p of [`${UID}/a.png`, `${UID}_1.jpg`, `organizations/${UID}/x.png`]) assert.ok(!m.isOwnPath(bucket, UID, p), `${bucket}:${p}`);
  }
});

test('avatars: removes root <uid>_… (files and <uid>_… folders); never <uid>/…, another id, a name with the uid in the middle or in uppercase', async () => {
  const mine = [`${UID}_1600000000000.png`, `${UID}_1700000000000.jpg`, `${UID}_old/z.jpg`];
  const foreign = [`${OTHER}_1.png`, `${OTHER}/a.png`, `foo${UID}_x.png`, `${UID.toUpperCase()}_1.png`, `x/${UID}_1.png`, `${UID}/folder.png`, 'default.png'];
  const storage = createFakeStorage({ avatars: [...mine, ...foreign] });
  assert.deepEqual(await run(storage), { status: 'ok', removed: 3, keptReferenced: 0 });
  assert.deepEqual(removedPaths(storage, 'avatars'), [...mine].sort());
  assert.deepEqual(storage.objects('avatars'), [...foreign].sort());
  assert.ok(!storage.calls.some((c) => c.bucket === 'avatars' && c.op === 'list' && c.prefix === UID), 'avatars never lists a <uid>/ folder');
  assert.ok(m.isOwnPath('avatars', UID, `${UID}_1.png`));
  assert.ok(!m.isOwnPath('avatars', UID, `${UID}/a.png`));
  assert.ok(!m.isOwnPath('avatars', UID, `${UID}_`), 'the bare prefix is not an object');
});

test('guest/…, partido_… and every name without the uid prefix stay in every bucket (they are out of scope: their own GO)', async () => {
  const untouched = {
    'jugadores-fotos': ['guest/12/aaaa.jpg', 'guest/13/bbbb.png', 'partido_1700.jpg', 'sin-dueno.jpg', `${OTHER}_1.jpg`],
    avatars: ['default.png', `${OTHER}_9.png`],
    'team-crests': ['draft/x.png', `${OTHER}/t/1.png`],
  };
  const storage = createFakeStorage({
    'jugadores-fotos': [...untouched['jugadores-fotos'], `${UID}_1.jpg`],
    avatars: [...untouched.avatars, `${UID}_1.png`],
    'team-crests': [...untouched['team-crests'], `${UID}/draft/1.png`],
  });
  assert.deepEqual(await run(storage), { status: 'ok', removed: 3, keptReferenced: 0 });
  for (const [bucket, paths] of Object.entries(untouched)) assert.deepEqual(storage.objects(bucket), [...paths].sort(), bucket);
});

test('large user (today\'s max: 136 photos, 8 avatars, 15 crests) among 300+ other objects: everything of theirs, nothing else', async () => {
  const photos = Array.from({ length: 136 }, (_, i) => `${UID}_${1600000000000 + i}.${i % 3 ? 'jpg' : 'png'}`);
  const avatars = Array.from({ length: 8 }, (_, i) => `${UID}_${1500000000000 + i}.png`);
  const crests = Array.from({ length: 15 }, (_, i) => `${UID}/team-${i % 4}/${1700000000000 + i}-escudo.png`);
  const others = Array.from({ length: 198 }, (_, i) => (i % 2 ? `${randomUUID()}_${i}.jpg` : `guest/${i}/x.jpg`));
  const storage = createFakeStorage({ 'jugadores-fotos': [...photos, ...others], avatars: [...avatars, `${OTHER}_1.png`], 'team-crests': [...crests, `${OTHER}/t/x.png`] });
  const db = createFakeReferenceDb({ teams: [{ crest_url: `${PUBLIC}/team-crests/${crests[0]}` }] });
  assert.deepEqual(await run(storage, db), { status: 'ok', removed: 136 + 8 + 14, keptReferenced: 1 });
  assert.deepEqual(storage.objects('jugadores-fotos'), [...others].sort());
  assert.deepEqual(storage.objects('avatars'), [`${OTHER}_1.png`]);
  assert.deepEqual(storage.objects('team-crests'), [crests[0], `${OTHER}/t/x.png`].sort());
  const photoRemoves = storage.calls.filter((c) => c.op === 'remove' && c.bucket === 'jugadores-fotos');
  assert.deepEqual(photoRemoves.map((c) => c.paths.length), [100, 36], '136 photos → batches of 100 + 36');
});

test('pagination of the ROOT listing: 1250 root <uid>_… photos and 1100 avatars are listed in pages of 1000 (offsets 0, 1000) and all removed', async () => {
  const photos = Array.from({ length: 1250 }, (_, i) => `${UID}_${String(i).padStart(6, '0')}.jpg`);
  const avatars = Array.from({ length: 1100 }, (_, i) => `${UID}_${String(i).padStart(6, '0')}.png`);
  const storage = createFakeStorage({ 'jugadores-fotos': [...photos, `${OTHER}_1.jpg`], avatars: [...avatars, `${OTHER}_1.png`] });
  assert.deepEqual(await run(storage), { status: 'ok', removed: 2350, keptReferenced: 0 });
  for (const bucket of ['jugadores-fotos', 'avatars']) {
    const rootLists = storage.calls.filter((c) => c.op === 'list' && c.bucket === bucket && c.prefix === '');
    assert.deepEqual(rootLists.map((c) => c.options.offset), [0, 1000], bucket);
    assert.ok(rootLists.every((c) => c.options.limit === 1000 && c.options.search === UID), bucket);
  }
  assert.deepEqual(storage.objects('jugadores-fotos'), [`${OTHER}_1.jpg`]);
  assert.deepEqual(storage.objects('avatars'), [`${OTHER}_1.png`]);
  assert.ok(storage.calls.filter((c) => c.op === 'remove').every((c) => c.paths.length <= 100));
});

test('the bound counts across buckets: 4990 photos + 20 avatars → incomplete at 5000; the retry finishes the avatars', async () => {
  const photos = Array.from({ length: 4990 }, (_, i) => `${UID}/${String(i).padStart(5, '0')}.jpg`);
  const avatars = Array.from({ length: 20 }, (_, i) => `${UID}_${i}.png`);
  const storage = createFakeStorage({ 'jugadores-fotos': photos, avatars });
  assert.deepEqual(await run(storage), { status: 'incomplete', removed: 5000, keptReferenced: 0, code: 'storage_too_many_objects' });
  assert.deepEqual(await run(storage), { status: 'ok', removed: 10, keptReferenced: 0 });
  assert.deepEqual([storage.objects('jugadores-fotos'), storage.objects('avatars')], [[], []]);
});

test('legacy SVG under the person\'s prefix (6 in Prod jugadores-fotos) is removed by path with remove(): never downloaded, signed or rendered', async () => {
  const svgs = [`${UID}_1600000000000.svg`, `${UID}/legacy.svg`, `${UID}_1600000000001.SVG`];
  const storage = createFakeStorage({ 'jugadores-fotos': [...svgs, `${OTHER}_1.svg`], avatars: [`${UID}_x.svg`] });
  assert.deepEqual(await run(storage), { status: 'ok', removed: 4, keptReferenced: 0 });
  assert.deepEqual(removedPaths(storage, 'jugadores-fotos'), [...svgs].sort());
  assert.deepEqual(removedPaths(storage, 'avatars'), [`${UID}_x.svg`]);
  assert.deepEqual(storage.objects('jugadores-fotos'), [`${OTHER}_1.svg`]);
  assert.deepEqual([...new Set(storage.calls.map((c) => c.op))].sort(), ['list', 'remove'], 'only list and remove: no download, signed URL or public URL');
});
