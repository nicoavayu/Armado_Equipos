import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activateLocalSimpleMode,
  assertLocalDatabase,
  LocalStorageError,
  STORAGE_CONTRACT,
  STORAGE_MODES,
  STORAGE_POLICY_CONTRACT,
  runStorageMode,
  validatePolicies,
} from './provision-tournament-media-local.mjs';

const response = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => payload === null ? '' : JSON.stringify(payload),
});

const fakeStorage = ({ initial = null, objects = [], missingStatus = 404 } = {}) => {
  let bucket = initial;
  let mutations = 0;
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    const requestPath = parsed.pathname.replace('/storage/v1', '');
    if (requestPath === `/bucket/${STORAGE_CONTRACT.bucket}` && (!init.method || init.method === 'GET')) {
      return bucket ? response(200, bucket) : response(missingStatus, missingStatus === 400
        ? { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' }
        : { message: 'not found' });
    }
    if (requestPath === '/bucket' && init.method === 'POST') {
      mutations += 1;
      bucket = JSON.parse(init.body);
      return response(200, bucket);
    }
    if (requestPath === `/object/list/${STORAGE_CONTRACT.bucket}` && init.method === 'POST') {
      return response(200, objects);
    }
    if (requestPath === `/bucket/${STORAGE_CONTRACT.bucket}` && init.method === 'DELETE') {
      mutations += 1;
      bucket = null;
      return response(200, null);
    }
    return response(500, { message: 'unexpected request' });
  };
  return { fetchImpl, mutations: () => mutations };
};

const exactBucket = () => ({
  id: STORAGE_CONTRACT.bucket,
  name: STORAGE_CONTRACT.bucket,
  public: false,
  file_size_limit: STORAGE_CONTRACT.maxFileBytes,
  allowed_mime_types: [...STORAGE_CONTRACT.allowedMimeTypes],
});

const exactPolicies = () => Object.entries(STORAGE_POLICY_CONTRACT).map(([policyname, cmd]) => ({
  policyname,
  cmd,
  roles: ['service_role'],
  qual: ['SELECT', 'INSERT'].includes(cmd) ? "bucket_id = 'tournament-media'" : 'false',
  with_check: cmd === 'INSERT' ? "bucket_id = 'tournament-media'" : (cmd === 'UPDATE' ? 'false' : null),
}));

const run = (mode, fake, extra = {}) => runStorageMode({
  mode,
  rawUrl: 'http://127.0.0.1:54321',
  secret: 'local-fixture-key',
  fetchImpl: fake.fetchImpl,
  policySnapshot: exactPolicies(),
  ...extra,
});

test('all six Storage modes are explicit', () => {
  assert.deepEqual(STORAGE_MODES, ['inspect', 'plan', 'dry-run', 'apply', 'verify', 'rollback']);
});

test('inspect, plan and dry-run never mutate the local fixture', async () => {
  for (const mode of ['inspect', 'plan', 'dry-run']) {
    const fake = fakeStorage();
    const result = await run(mode, fake);
    assert.equal(result.current, 'absent');
    assert.equal(fake.mutations(), 0);
  }
});

test('current local Storage 400/404 absence envelope is recognized narrowly', async () => {
  const absent = fakeStorage({ missingStatus: 400 });
  assert.equal((await run('inspect', absent)).current, 'absent');
  const unexpected = fakeStorage({ missingStatus: 401 });
  await assert.rejects(() => run('inspect', unexpected), /HTTP 401/);
});

test('apply creates exact private bucket and is idempotent', async () => {
  const fake = fakeStorage();
  assert.equal((await run('apply', fake)).verified, true);
  assert.equal(fake.mutations(), 1);
  assert.equal((await run('apply', fake)).idempotent, true);
  assert.equal(fake.mutations(), 1);
});

test('apply refuses to replace public or mismatched existing configuration', async () => {
  for (const mutation of [
    (bucket) => { bucket.public = true; },
    (bucket) => { bucket.file_size_limit = 1; },
    (bucket) => { bucket.allowed_mime_types.push('image/svg+xml'); },
  ]) {
    const bucket = exactBucket();
    mutation(bucket);
    const fake = fakeStorage({ initial: bucket });
    await assert.rejects(() => run('apply', fake), LocalStorageError);
    assert.equal(fake.mutations(), 0);
  }
});

test('every mode rejects missing, unexpected, or client Storage policies before mutation', async () => {
  assert.equal(validatePolicies(exactPolicies()), true);
  assert.equal(validatePolicies(exactPolicies().map((policy) => ({
    ...policy,
    roles: '{service_role}',
  }))), true);
  for (const mutation of [
    (policies) => { policies.pop(); },
    (policies) => { policies.push({ policyname: 'tournament_media_client_write', cmd: 'INSERT', roles: ['authenticated'], with_check: "bucket_id = 'tournament-media'" }); },
    (policies) => { policies[0].roles = ['authenticated']; },
    (policies) => { policies[0].cmd = 'INSERT'; },
  ]) {
    const policies = exactPolicies();
    mutation(policies);
    const fake = fakeStorage();
    await assert.rejects(
      () => run('apply', fake, { policySnapshot: policies }),
      LocalStorageError,
    );
    assert.equal(fake.mutations(), 0);
  }
});

test('rollback needs second confirmation and never deletes a non-empty bucket', async () => {
  const fake = fakeStorage({ initial: exactBucket() });
  await assert.rejects(() => run('rollback', fake), /confirm-empty-local-bucket-delete/);
  assert.equal(fake.mutations(), 0);
  const nonEmpty = fakeStorage({ initial: exactBucket(), objects: [{ name: 'preserve.jpg' }] });
  await assert.rejects(() => run('rollback', nonEmpty, { confirmEmptyLocalBucketDelete: true }), /non-empty/);
  assert.equal(nonEmpty.mutations(), 0);
  const empty = fakeStorage({ initial: exactBucket() });
  const result = await run('rollback', empty, { confirmEmptyLocalBucketDelete: true });
  assert.equal(result.userObjectsDeleted, false);
  assert.equal(empty.mutations(), 1);
});

test('non-loopback targets always abort with no override', async () => {
  const fake = fakeStorage();
  await assert.rejects(() => runStorageMode({
    mode: 'inspect', rawUrl: 'https://hhyvmhgpapyuzjgxfnqv.supabase.co',
    secret: 'fixture', fetchImpl: fake.fetchImpl, policySnapshot: exactPolicies(),
  }), /refusing non-local backend/);
  assert.equal(fake.mutations(), 0);
});

test('the explicit QA activation is loopback-only and verifies effective readiness', async () => {
  const queries = [];
  class FakeClient {
    constructor(config) { this.config = config; }
    async connect() { queries.push('connect'); }
    async end() { queries.push('end'); }
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      queries.push(normalized);
      if (normalized.startsWith('update public.tournament_media_pipeline_configuration')) {
        return { rowCount: 1, rows: [{ mode: 'MVP_SIMPLE' }] };
      }
      if (normalized.startsWith('select public.tournament_media_effective_readiness')) {
        return {
          rows: [{ value: {
            mode: 'MVP_SIMPLE', uploadReady: true, storageReady: true,
            private: true, blockers: [],
          } }],
        };
      }
      return { rowCount: null, rows: [] };
    }
  }
  const result = await activateLocalSimpleMode(
    'postgresql://postgres:fixture@127.0.0.1:54322/postgres',
    FakeClient,
  );
  assert.deepEqual(result, {
    mode: 'MVP_SIMPLE', uploadReady: true, storageReady: true,
    private: true, blockers: [],
  });
  assert.ok(queries.includes('begin'));
  assert.ok(queries.includes('commit'));
  assert.equal(queries.includes('rollback'), false);
  assert.throws(
    () => assertLocalDatabase('postgresql://postgres:fixture@db.example.com/postgres'),
    /loopback PostgreSQL/,
  );
});

test('QA activation rolls back when readiness is not actually safe', async () => {
  const queries = [];
  class FakeClient {
    async connect() {}
    async end() {}
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      queries.push(normalized);
      if (normalized.startsWith('update public.tournament_media_pipeline_configuration')) {
        return { rowCount: 1, rows: [{ mode: 'MVP_SIMPLE' }] };
      }
      if (normalized.startsWith('select public.tournament_media_effective_readiness')) {
        return { rows: [{ value: {
          mode: 'MVP_SIMPLE', uploadReady: false, storageReady: false, private: true,
        } }] };
      }
      return { rows: [] };
    }
  }
  await assert.rejects(
    () => activateLocalSimpleMode(
      'postgresql://postgres:fixture@127.0.0.1:54322/postgres',
      FakeClient,
    ),
    /did not become safe/,
  );
  assert.ok(queries.includes('rollback'));
  assert.equal(queries.includes('commit'), false);
});
