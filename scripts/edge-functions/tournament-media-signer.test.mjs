import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const signerPath = path.join(
  process.cwd(), 'supabase', 'functions', 'tournament-media-signer', 'index.ts',
);

async function writeModule(directory, name, source) {
  await fs.writeFile(path.join(directory, name), source, 'utf8');
}

async function loadSigner(service, environment) {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arma2-media-signer-'));
  let source = await fs.readFile(signerPath, 'utf8');
  const imports = new Map([
    ['https://deno.land/std@0.224.0/http/server.ts', './server.mjs'],
    ['https://esm.sh/@supabase/supabase-js@2.49.1', './supabase.mjs'],
    ['../_shared/supabaseApiKeys.ts', './supabase-api-keys.mjs'],
    ['../_shared/tournamentMediaService.ts', './media-service.mjs'],
    ['../_shared/tournamentMediaContract.ts', './media-contract.mjs'],
  ]);
  for (const [original, replacement] of imports) {
    source = source.replace(`"${original}"`, `"${replacement}"`);
  }
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
    },
    fileName: 'tournament-media-signer.ts',
  });

  await Promise.all([
    writeModule(outDir, 'signer.mjs', outputText),
    writeModule(outDir, 'server.mjs', `
      export function serve(handler) { globalThis.__signerHandler = handler; }
    `),
    writeModule(outDir, 'supabase.mjs', `
      export function createClient() { return globalThis.__signerService; }
    `),
    writeModule(outDir, 'supabase-api-keys.mjs', `
      export function createSupabaseCredentialFetch() { return fetch; }
      export function getSupabaseSecretCredential() {
        return { key: 'service-key', kind: 'legacy_service_role' };
      }
    `),
    writeModule(outDir, 'media-service.mjs', `
      export const SESSION_TOKEN_RE = /^[a-f0-9]{64}$/;
      export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      export function buildCorsHeaders() { return {}; }
      export function jsonResponse(headers, status, payload) {
        return new Response(JSON.stringify(payload), {
          status,
          headers: { ...headers, 'content-type': 'application/json' },
        });
      }
      export function mapRpcError() { return { status: 500, error: 'rpc_error' }; }
      export async function resolveActor() {
        return '22222222-2222-4222-8222-222222222222';
      }
      export function secretMatches(expected, provided) { return expected === provided; }
    `),
    writeModule(outDir, 'media-contract.mjs', `
      export const MEDIA_SIGNED_URL_TTL_SECONDS = 300;
      export const MEDIA_UPLOAD_URL_TTL_SECONDS = 300;
      export const TOURNAMENT_MEDIA_BUCKET = 'tournament-media';
    `),
  ]);

  globalThis.__signerHandler = undefined;
  globalThis.__signerService = service;
  globalThis.Deno = { env: { get: (name) => environment[name] } };
  await import(pathToFileURL(path.join(outDir, 'signer.mjs')).href);
  assert.equal(typeof globalThis.__signerHandler, 'function');

  return {
    handler: globalThis.__signerHandler,
    cleanup: async () => {
      delete globalThis.__signerHandler;
      delete globalThis.__signerService;
      delete globalThis.Deno;
      await fs.rm(outDir, { recursive: true, force: true });
    },
  };
}

function serviceFor(target, signedUpload) {
  const createSignedUploadUrl = async (objectName, options) => {
    signedUpload.calls.push({ objectName, options });
    return { data: signedUpload.data, error: null };
  };
  return {
    rpc: async (name) => {
      assert.equal(name, 'authorize_tournament_media_upload_target');
      return { data: target, error: null };
    },
    storage: {
      from: (bucket) => {
        assert.equal(bucket, 'tournament-media');
        return { createSignedUploadUrl };
      },
    },
  };
}

function uploadIntentRequest() {
  return new Request('http://internal-host/tournament-media-signer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'upload-intent',
      sessionId: '11111111-1111-4111-8111-111111111111',
      token: 'a'.repeat(64),
    }),
  });
}

const DELETE_ASSET_ID = '44444444-4444-4444-8444-444444444444';
const DELETE_OBJECT = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  `${DELETE_ASSET_ID}.jpg`,
].join('/');

function deleteRequest() {
  return new Request('http://internal-host/tournament-media-signer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'delete-asset', assetId: DELETE_ASSET_ID }),
  });
}

function deleteService({ storageError = false, finalizeFailures = 0 } = {}) {
  const calls = [];
  let remainingFinalizeFailures = finalizeFailures;
  return {
    calls,
    service: {
      rpc: async (name, args) => {
        calls.push({ type: 'rpc', name, args });
        if (name === 'begin_tournament_media_asset_delete') {
          return {
            data: {
              assetId: DELETE_ASSET_ID,
              bucket: 'tournament-media',
              objectNames: [DELETE_OBJECT],
              deletePending: true,
            },
            error: null,
          };
        }
        assert.equal(name, 'complete_tournament_media_asset_delete');
        if (remainingFinalizeFailures > 0) {
          remainingFinalizeFailures -= 1;
          return { data: null, error: { message: 'finalize failed' } };
        }
        return { data: { assetId: DELETE_ASSET_ID, deleted: true }, error: null };
      },
      storage: {
        from: (bucket) => {
          assert.equal(bucket, 'tournament-media');
          return {
            remove: async (names) => {
              calls.push({ type: 'remove', names });
              return storageError
                ? { data: null, error: { message: 'storage unavailable' } }
                : { data: names.map((name) => ({ name })), error: null };
            },
          };
        },
      },
    },
  };
}

test('MVP_SIMPLE upload intent uses a public-origin-relative Function URL', async (context) => {
  const objectName = 'org/tournament/gallery/asset.jpg';
  const signedUpload = { calls: [], data: null };
  const loaded = await loadSigner(serviceFor({
    processingTier: 'mvp_simple',
    objectName,
    contentType: 'image/jpeg',
    expectedBytes: 1024,
    maxBytes: 2048,
    expiresAt: '2026-08-10T12:05:00.000Z',
  }, signedUpload), {
    SUPABASE_URL: 'https://example-project.supabase.co',
  });
  context.after(loaded.cleanup);

  const response = await loaded.handler(uploadIntentRequest());
  assert.equal(response.status, 200);
  const intent = await response.json();
  const uploadUrl = new URL(intent.uploadUrl, 'https://browser-configured.example');

  assert.equal(intent.uploadUrl.startsWith('/functions/v1/'), true);
  assert.equal(uploadUrl.hostname, 'browser-configured.example');
  assert.equal(uploadUrl.pathname, '/functions/v1/tournament-media-signer');
  assert.deepEqual(Object.fromEntries(uploadUrl.searchParams), {
    action: 'mvp-simple-upload',
    sessionId: '11111111-1111-4111-8111-111111111111',
    token: 'a'.repeat(64),
  });
  assert.equal(uploadUrl.searchParams.has('internal_path'), false);
  assert.equal(uploadUrl.searchParams.has('objectName'), false);
  assert.equal(uploadUrl.toString().includes(objectName), false);
  assert.equal(uploadUrl.toString().includes('tournament-media/'), false);
  assert.deepEqual(signedUpload.calls, []);
});

test('PROCESSOR_EXTERNAL keeps the existing signed Storage upload flow', async (context) => {
  const objectName = 'org/tournament/gallery/asset.jpg';
  const signedUpload = {
    calls: [],
    data: {
      signedUrl: 'https://example-project.supabase.co/storage/v1/object/upload/sign/capability',
      token: 'storage-token',
    },
  };
  const loaded = await loadSigner(serviceFor({
    processingTier: 'processor_external',
    objectName,
    contentType: 'image/jpeg',
    expectedBytes: 1024,
    maxBytes: 2048,
    expiresAt: '2026-08-10T12:05:00.000Z',
  }, signedUpload), {
    SUPABASE_URL: 'https://example-project.supabase.co',
  });
  context.after(loaded.cleanup);

  const response = await loaded.handler(uploadIntentRequest());
  assert.equal(response.status, 200);
  const intent = await response.json();
  assert.equal(intent.uploadUrl, '/storage/v1/object/upload/sign/capability');
  assert.equal(intent.uploadToken, 'storage-token');
  assert.deepEqual(signedUpload.calls, [{ objectName, options: { upsert: false } }]);
});

test('delete uses only DB-derived object names and finalizes after Storage', async (context) => {
  const stub = deleteService();
  const loaded = await loadSigner(stub.service, {
    SUPABASE_URL: 'http://127.0.0.1:57321',
  });
  context.after(loaded.cleanup);

  const response = await loaded.handler(deleteRequest());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { assetId: DELETE_ASSET_ID, deleted: true });
  assert.deepEqual(stub.calls.map(({ type, name }) => name || type), [
    'begin_tournament_media_asset_delete',
    'remove',
    'complete_tournament_media_asset_delete',
  ]);
  assert.deepEqual(stub.calls[1].names, [DELETE_OBJECT]);
  assert.equal(JSON.stringify(body).includes(DELETE_OBJECT), false);
});

test('a Storage delete failure leaves metadata pending and never finalizes', async (context) => {
  const stub = deleteService({ storageError: true });
  const loaded = await loadSigner(stub.service, {
    SUPABASE_URL: 'http://127.0.0.1:57321',
  });
  context.after(loaded.cleanup);

  const response = await loaded.handler(deleteRequest());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: 'delete_storage_failed', deletePending: true,
  });
  assert.equal(stub.calls.some(({ name }) => (
    name === 'complete_tournament_media_asset_delete'
  )), false);
});

test('finalize failure remains retryable after Storage was removed', async (context) => {
  const stub = deleteService({ finalizeFailures: 1 });
  const loaded = await loadSigner(stub.service, {
    SUPABASE_URL: 'http://127.0.0.1:57321',
  });
  context.after(loaded.cleanup);

  const first = await loaded.handler(deleteRequest());
  assert.equal(first.status, 500);
  assert.deepEqual(await first.json(), {
    error: 'delete_finalize_failed', deletePending: true,
  });
  const retry = await loaded.handler(deleteRequest());
  assert.equal(retry.status, 200);
  assert.equal(stub.calls.filter(({ type }) => type === 'remove').length, 2);
  assert.equal(stub.calls.filter(({ name }) => (
    name === 'complete_tournament_media_asset_delete'
  )).length, 2);
});
