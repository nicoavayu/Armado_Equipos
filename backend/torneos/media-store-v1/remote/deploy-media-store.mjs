#!/usr/bin/env node
// MEDIA-STORE-V1 — deploy the torneos-media-store Edge Function to the Torneos PRODUCTION project and provision the one
// HMAC secret it shares with the Cloud Run gateway. Operator-run (deploy-media-store.sh), never unattended.
//
//   plan       offline: the exact artifact (files + sha256) and its digest — must equal ARTIFACT_SHA256
//   observe    read only: project, functions, secret NAMES, API key kinds (never values), this function, the GCP secret
//   deploy     first deployment: the phrase on /dev/tty → a fresh 32-byte secret, generated in memory → GCP Secret Manager
//              (`gcloud secrets create … --data-file=-`, value on stdin) + accessor for the gateway's service account on
//              THAT secret only → Supabase function secret TORNEOS_MEDIA_STORE_SECRET → deploy (verify_jwt = false) →
//              GET the function → unsigned probe must answer 401 (configuration loaded; 503 = disabled → STOP)
//   redeploy   code only (both secrets already exist, nothing is generated): phrase → deploy → GET → probe
//   remove     DELETE the function (the gateway at a revision without BRANDING/MEDIA no longer calls it)
//
// The target is a constant. stdin carries exactly {"pat": "sbp_…"} (piped by the wrapper from a hidden prompt); the PAT
// and the generated secret never reach argv, env, disk or output (every output is redacted). The Management API surface
// is closed (assertRequest): any other path, method or body is refused before it is sent. Redirects are refused.
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveFiles, buildDeployBody } from '../../phase3b/remote/mgmt-write.mjs';
import { projectFunction, projectApiKey, PAT_PATTERN, API_HOST } from '../../phase3b/remote/mgmt.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../../../..');
export const REF = 'onzpwnqxnvlgsevivngf';
export const SLUG = 'torneos-media-store';
export const ROOT = 'backend/torneos/supabase';
export const ENTRYPOINT = 'functions/torneos-media-store/index.ts';
export const SECRET_NAME = 'TORNEOS_MEDIA_STORE_SECRET';
export const FUNCTION_URL = `https://${REF}.supabase.co/functions/v1/${SLUG}`;
export const GCP = Object.freeze({ project: 'arma2-465223', secret: 'torneos-gw-media-store-secret',
  member: 'serviceAccount:torneos-gateway-prod@arma2-465223.iam.gserviceaccount.com', role: 'roles/secretmanager.secretAccessor' });
/** sha256 of the artifact manifest (path + sha256 of every file the entrypoint reaches), pinned to the reviewed tree. */
export const ARTIFACT_SHA256 = '694907f4edb0ae64adb033d7833a2288511ba651d7252854e09e1fb836dbd2a9';
const SECRET_PATTERN = /^[0-9a-f]{64}$/;

const BASE = `/v1/projects/${REF}`;
export const PATHS = Object.freeze({
  project: BASE, functions: `${BASE}/functions`, fn: `${BASE}/functions/${SLUG}`, secrets: `${BASE}/secrets`,
  apiKeys: `${BASE}/api-keys?reveal=false`, deploy: `${BASE}/functions/deploy?slug=${SLUG}`,
});

export class Stop extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail ?? null; } }
const stop = (code, detail) => { throw new Stop(code, detail); };
const SECRETS = [];
export const redact = (text) => SECRETS.reduce((out, s) => out.split(s).join('«REDACTED»'), String(text));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

export function artifact(repo = REPO) {
  const files = resolveFiles(path.join(repo, ROOT), ENTRYPOINT);
  const manifest = files.map((f) => ({ path: f.relPath, bytes: f.bytes.length, sha256: f.sha256 }));
  return { files, manifest, digest: sha(JSON.stringify(manifest.map(({ path: p, sha256 }) => [p, sha256]))) };
}

/** The closed request surface: read | write-secret | write-deploy | write-delete, or a refusal before anything is sent. */
export function assertRequest({ method, path: p, body, armed = false }) {
  if (method === 'GET') {
    if (![PATHS.project, PATHS.functions, PATHS.fn, PATHS.secrets, PATHS.apiKeys].includes(p) || body !== undefined) stop('REQUEST_NOT_ALLOWED', { method, path: p });
    return 'read';
  }
  if (!armed) stop('WRITE_NOT_ARMED', { method, path: p });
  if (method === 'POST' && p === PATHS.secrets) {
    if (!Array.isArray(body) || body.length !== 1 || Object.keys(body[0] ?? {}).sort().join() !== 'name,value'
      || body[0].name !== SECRET_NAME || !SECRET_PATTERN.test(body[0].value)) stop('SECRET_BODY_NOT_ALLOWED');
    return 'write-secret';
  }
  if (method === 'POST' && p === PATHS.deploy) {
    if (!Buffer.isBuffer(body)) stop('DEPLOY_BODY_NOT_MULTIPART');
    return 'write-deploy';
  }
  if (method === 'DELETE' && p === PATHS.fn && body === undefined) return 'write-delete';
  stop('REQUEST_NOT_ALLOWED', { method, path: p });
}

export function httpsTransport({ pat, method, path: p, body, contentType = 'application/json', armed = false }) {
  assertRequest({ method, path: p, body, armed });
  const payload = body === undefined ? null : (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)));
  return new Promise((resolve, reject) => {
    const headers = { Authorization: `Bearer ${pat}`, Accept: 'application/json', 'User-Agent': 'arma2-torneos-media-store/1' };
    if (payload) { headers['Content-Type'] = contentType; headers['Content-Length'] = payload.length; }
    const req = https.request({ host: API_HOST, servername: API_HOST, port: 443, method, path: p, headers, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); reject(new Stop('REDIRECT_REFUSED')); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
        resolve({ status: res.statusCode, body: parsed, raw: redact(text).slice(0, 200) });
      });
    });
    req.setTimeout(30000, () => req.destroy(new Error('idle_timeout')));
    req.on('error', (e) => reject(new Stop(redact(`REQUEST_FAILED ${e.message}`))));
    if (payload) req.write(payload);
    req.end();
  });
}

/** gcloud with the value (if any) on stdin only. Returns { code, out } with the output redacted and trimmed. */
export function systemGcloud(args, input) {
  if (!['secrets', 'run'].includes(args[0])) stop('GCLOUD_COMMAND_NOT_ALLOWED');
  const r = spawnSync('gcloud', [...args, `--project=${GCP.project}`, '--quiet'], { input, encoding: 'utf8', maxBuffer: 1 << 20 });
  return { code: r.status, out: redact(`${r.stdout ?? ''}${r.stderr ?? ''}`).trim().slice(-400) };
}

export async function observe({ api, gcloud }) {
  const get = async (p, project) => { const r = await api({ method: 'GET', path: p }); return { status: r.status, value: r.status === 200 ? project(r.body) : null }; };
  const out = { target: REF };
  out.project = await get(PATHS.project, (b) => ({ ref: b?.ref ?? b?.id ?? null, status: b?.status ?? null, region: b?.region ?? null }));
  out.functions = await get(PATHS.functions, (b) => (Array.isArray(b) ? b.map(projectFunction).map((f) => ({ slug: f.slug, status: f.status, verify_jwt: f.verify_jwt })) : null));
  out.secret_names = await get(PATHS.secrets, (b) => (Array.isArray(b) ? b.map((s) => s?.name).filter((n) => typeof n === 'string').sort() : null));
  out.api_keys = await get(PATHS.apiKeys, (b) => (Array.isArray(b) ? b.map(projectApiKey) : null));
  out.function = await get(PATHS.fn, projectFunction);
  const described = gcloud(['secrets', 'describe', GCP.secret, '--format=value(name)']);
  out.gcp_secret = described.code === 0 ? 'present' : (/NOT_FOUND|not found/i.test(described.out) ? 'absent' : `unknown: ${described.out.slice(-160)}`);
  if (out.project.status !== 200 || out.project.value?.ref !== REF) stop('PROJECT_NOT_REACHABLE', out.project);
  return out;
}

async function deployAndProbe({ api, probe }, out) {
  const { files, manifest, digest } = artifact();
  if (digest !== ARTIFACT_SHA256) stop('ARTIFACT_DRIFT', { digest });
  const { boundary, body } = buildDeployBody(SLUG, ENTRYPOINT, false, files);
  const deployed = await api({ method: 'POST', path: PATHS.deploy, body, contentType: `multipart/form-data; boundary=${boundary}`, armed: true });
  if (deployed.status !== 200 && deployed.status !== 201) stop('DEPLOY_FAILED', { status: deployed.status, raw: deployed.raw });
  out.manifest = manifest; out.artifact = digest;
  const fn = await api({ method: 'GET', path: PATHS.fn });
  out.deployed = projectFunction(fn.body);
  if (fn.status !== 200 || out.deployed?.status !== 'ACTIVE' || out.deployed?.verify_jwt !== false) stop('FUNCTION_NOT_ACTIVE', out.deployed);
  // Unsigned: the function answers 401 only when its configuration (secret, service key, publishable key) loaded.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    out.probe = await probe();
    if (out.probe.status === 401) return;
    await new Promise((resolve) => { setTimeout(resolve, 3000); });
  }
  stop('PROBE_FAILED', out.probe);
}

export async function run(mode, deps) {
  const { confirm, generateSecret = () => crypto.randomBytes(32).toString('hex') } = deps;
  if (mode === 'plan') { const { manifest, digest } = artifact(); return { mode, artifact: digest, pinned: ARTIFACT_SHA256, matches: digest === ARTIFACT_SHA256, manifest }; }
  const out = { mode, ...(await observe(deps)) };
  if (mode === 'observe') return out;
  const phrase = { deploy: 'DEPLOY', redeploy: 'REDEPLOY', remove: 'REMOVE' }[mode];
  if (!phrase) stop('MODE_UNKNOWN');
  const expected = `${phrase} TORNEOS MEDIA STORE ${REF} ${ARTIFACT_SHA256.slice(0, 12)}`;
  const secretPresent = out.secret_names.value?.includes(SECRET_NAME);
  if (mode === 'deploy' && (secretPresent || out.gcp_secret !== 'absent' || out.function.status === 200)) {
    stop('NOT_A_FIRST_DEPLOYMENT', { supabase_secret: secretPresent, gcp_secret: out.gcp_secret, function: out.function.status });
  }
  if (mode === 'redeploy' && (!secretPresent || out.gcp_secret !== 'present')) stop('SECRETS_MISSING_USE_DEPLOY');
  if (mode === 'remove' && out.function.status !== 200) stop('NOTHING_TO_REMOVE');
  if ((await confirm(expected)) !== expected) stop('PHRASE_MISMATCH');
  if (mode === 'remove') {
    const r = await deps.api({ method: 'DELETE', path: PATHS.fn, armed: true });
    out.removed = r.status === 200 || r.status === 204;
    if (!out.removed) stop('REMOVE_FAILED', { status: r.status, raw: r.raw });
    return out;
  }
  if (mode === 'deploy') {
    const secret = generateSecret();
    if (!SECRET_PATTERN.test(secret)) stop('SECRET_GENERATION_FAILED');
    SECRETS.push(secret);
    const created = deps.gcloud(['secrets', 'create', GCP.secret, '--replication-policy=automatic', '--data-file=-'], secret);
    if (created.code !== 0) stop('GCP_SECRET_CREATE_FAILED', created.out);
    const bound = deps.gcloud(['secrets', 'add-iam-policy-binding', GCP.secret, `--member=${GCP.member}`, `--role=${GCP.role}`, '--format=none']);
    if (bound.code !== 0) stop('GCP_SECRET_BINDING_FAILED', bound.out);
    const set = await deps.api({ method: 'POST', path: PATHS.secrets, body: [{ name: SECRET_NAME, value: secret }], armed: true });
    if (set.status !== 200 && set.status !== 201) stop('SUPABASE_SECRET_FAILED', { status: set.status, raw: set.raw });
    out.secrets = { gcp: `${GCP.secret} v1 (accessor: the gateway's service account)`, supabase: SECRET_NAME };
  }
  await deployAndProbe(deps, out);
  return out;
}

export async function unsignedProbe() {
  const r = await fetch(`${FUNCTION_URL}/v1/media-sign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', redirect: 'error', signal: AbortSignal.timeout(20000) });
  return { status: r.status, body: (await r.text()).slice(0, 80) };
}

function ttyConfirm(expected) {
  const fd = fs.openSync('/dev/tty', 'r+');
  try {
    fs.writeSync(fd, `\nType exactly:\n  ${expected}\n> `);
    const buf = Buffer.alloc(256); const n = fs.readSync(fd, buf, 0, 256, null);
    return buf.subarray(0, n).toString('utf8').trim();
  } finally { fs.closeSync(fd); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const output = { at: new Date().toISOString() };
  try {
    let pat = null;
    if (mode !== 'plan') {
      const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
      if (Object.keys(input).join() !== 'pat' || !PAT_PATTERN.test(input.pat)) stop('STDIN_MUST_BE_EXACTLY_{"pat"}');
      pat = input.pat; SECRETS.push(pat);
    }
    const api = (req) => httpsTransport({ pat, ...req });
    Object.assign(output, await run(mode, { api, gcloud: systemGcloud, probe: unsignedProbe, confirm: async (e) => ttyConfirm(e) }));
    output.verdict = `${String(mode).toUpperCase()}_DONE`;
  } catch (error) {
    output.verdict = 'STOP'; output.stop = redact(error?.code ?? error?.message ?? error); if (error?.detail) output.detail = JSON.parse(redact(JSON.stringify(error.detail)));
  }
  process.stdout.write(`${redact(JSON.stringify(output, null, 1))}\n`);
  process.exit(output.verdict === 'STOP' ? 1 : 0);
}
