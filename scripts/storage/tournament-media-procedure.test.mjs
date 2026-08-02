import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LocalStorageError,
  STORAGE_CONTRACT,
  STORAGE_MODES,
  runStorageMode,
} from './provision-tournament-media-local.mjs';

const response = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => payload === null ? '' : JSON.stringify(payload),
});

const fakeStorage = ({ initial = null, objects = [] } = {}) => {
  let bucket = initial;
  let mutations = 0;
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    const requestPath = parsed.pathname.replace('/storage/v1', '');
    if (requestPath === `/bucket/${STORAGE_CONTRACT.bucket}` && (!init.method || init.method === 'GET')) {
      return bucket ? response(200, bucket) : response(404, { message: 'not found' });
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

const run = (mode, fake, extra = {}) => runStorageMode({
  mode,
  rawUrl: 'http://127.0.0.1:54321',
  secret: 'local-fixture-key',
  fetchImpl: fake.fetchImpl,
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
    secret: 'fixture', fetchImpl: fake.fetchImpl,
  }), /refusing non-local backend/);
  assert.equal(fake.mutations(), 0);
});
