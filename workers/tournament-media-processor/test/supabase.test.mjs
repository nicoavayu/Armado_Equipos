// The storage client's read path, against the answers Storage really gives.
//
// A missing object is not an error: the self-test deletes its probe and then
// reads it back to prove `cleanup`, and the pipeline reads the quarantine
// object to prove it is still there. Both need "absent" to arrive as `null`.
// Supabase Storage does not report that uniformly — current versions answer a
// miss with `400 {"statusCode":"404","error":"not_found"}` rather than a bare
// 404 — so a client that only special-cases 404 throws on every delete probe,
// `cleanup` can never be proved, and `uploadReady` can never open against a
// real bucket. These tests pin both shapes, and pin that a genuine failure
// still raises.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createStorageClient } from '../src/supabase.mjs';

const CONFIG = { url: 'http://127.0.0.1:57321', key: 'service-key' };

function respond({ status, body = '', bytes = null }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => body,
    arrayBuffer: async () => (bytes ? bytes.buffer : new ArrayBuffer(0)),
  };
}

test('an object that is there comes back as bytes', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const storage = createStorageClient(CONFIG, async () => respond({ status: 200, bytes }));
  const read = await storage.download('org/tournament/gallery/object.jpg');
  assert.deepEqual(Array.from(read), [1, 2, 3, 4]);
});

test('a plain 404 reads as absent', async () => {
  const storage = createStorageClient(CONFIG, async () => respond({ status: 404 }));
  assert.equal(await storage.download('org/tournament/gallery/gone.jpg'), null);
});

test('the 400 not_found envelope also reads as absent', async () => {
  const storage = createStorageClient(CONFIG, async () => respond({
    status: 400,
    body: JSON.stringify({ statusCode: '404', error: 'not_found', message: 'Object not found' }),
  }));
  assert.equal(await storage.download('org/tournament/gallery/gone.jpg'), null);
});

test('a 400 that is not a miss still raises', async () => {
  const storage = createStorageClient(CONFIG, async () => respond({
    status: 400,
    body: JSON.stringify({ statusCode: '400', error: 'InvalidRequest', message: 'bad bucket' }),
  }));
  await assert.rejects(
    () => storage.download('org/tournament/gallery/object.jpg'),
    /STORAGE_DOWNLOAD_FAILED:400/,
  );
});

test('an unreadable 400 body is treated as a failure, not as absence', async () => {
  const storage = createStorageClient(CONFIG, async () => respond({
    status: 400,
    body: '<html>gateway</html>',
  }));
  await assert.rejects(
    () => storage.download('org/tournament/gallery/object.jpg'),
    /STORAGE_DOWNLOAD_FAILED:400/,
  );
});

test('a server error is never mistaken for an empty bucket', async () => {
  const storage = createStorageClient(CONFIG, async () => respond({ status: 500 }));
  await assert.rejects(
    () => storage.download('org/tournament/gallery/object.jpg'),
    /STORAGE_DOWNLOAD_FAILED:500/,
  );
});
