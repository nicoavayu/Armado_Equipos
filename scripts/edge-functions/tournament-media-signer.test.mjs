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

test('MVP_SIMPLE upload intent uses the canonical public Function URL', async (context) => {
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
  const uploadUrl = new URL(intent.uploadUrl);

  assert.equal(uploadUrl.protocol, 'https:');
  assert.equal(uploadUrl.hostname, 'example-project.supabase.co');
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
    data: { signedUrl: 'https://storage.local/signed', token: 'storage-token' },
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
  assert.equal(intent.uploadUrl, 'https://storage.local/signed');
  assert.equal(intent.uploadToken, 'storage-token');
  assert.deepEqual(signedUpload.calls, [{ objectName, options: { upsert: false } }]);
});
