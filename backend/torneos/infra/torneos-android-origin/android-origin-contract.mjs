// ANDROID ORIGIN REMOTE — every pin of the Production rollout of the gateway change that admits the Android app origin
// (https://localhost) next to the web origin. Gateway code only: no DB, no migration, no env, no Core, no Vercel.
//
//   G1   read-only   Deno Deploy observation (app, revisions, env names/flags/non-secret digests, audit) + the 66 gateway
//                    probes of the live source + the origin probes (web, Android, deny list). No DB connection at all.
//   W1   one write   Deno Deploy: one production revision of the candidate source (assets + labels only, env never sent).
//   rollback         redeploy of the live source rebuilt from git (0f049ef5, digest 6c252863…, 17 files).
//
// LIVE       revision t5vxxvzp1t9f (OEC W3, 2026-09-28), source 0f049ef5 / 6c252863…, 17 files.
// CANDIDATE  source f7efe18f / 59573b50…, 17 files; delta from live = config.ts, index.ts, topology.ts changed, 0 added/removed.
//
// Both sources are rebuilt from git at their commit (never from the working tree), built twice, and must equal the pin.
// Nothing here is an argument and no credential lives in this directory: the Deno token is typed on the tty by the operator.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import * as R from '../torneos-gateway-remote/remote-contract.mjs';
import * as CV1 from '../torneos-competition-v1/competition-remote-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = R.REPO_ROOT;
export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
export const EVIDENCE_DIR = path.join(REPO_ROOT, 'backend/torneos/android-origin/evidence/remote');
export const CANDIDATE_PIN_FILE = path.join(HERE, 'pins/android-origin-gateway-candidate.json');
export const DEPLOYED_PIN_FILE = path.join(HERE, 'pins/android-origin-gateway-deploy.json');
/** The live revision as written by the OEC W3 (public facts only). */
export const LIVE_DEPLOY_PIN_FILE = path.join(REPO_ROOT, 'backend/torneos/infra/torneos-officialization-error-v1/pins/oec-gateway-deploy.json');

// ─────────────────────────── target ───────────────────────────
export const APP_SLUG = R.APP_SLUG;
export const GATEWAY_BASE = CV1.GATEWAY_BASE;
if (APP_SLUG !== 'torneos-gateway' || GATEWAY_BASE !== 'https://torneos-gateway.nicoavayu.deno.net/functions/v1/torneos-gateway') throw new Error('android_origin_target_pin');

// ─────────────────────────── sources ───────────────────────────
export const LIVE = Object.freeze({
  revision: 't5vxxvzp1t9f', created_at: '2026-09-28T14:43:17.283Z', previous_revision: '66we8r12079d',
  head: '0f049ef5657a3b3046276ff00f44464aba998c08',
  digest: '6c252863fd94bcad0f785af9bb3636d09b2bc2265baafb0af2a771efdb6143a4', files: 17,
});
export const CANDIDATE = Object.freeze({
  head: 'f7efe18f954f55237d90855dee300793cbc2d275',
  digest: '59573b5087226d55e3c47e0f7300abd94185111d00276dbebd9b59e470c6f832', files: 17,
  delta: Object.freeze({ added: Object.freeze([]), changed: Object.freeze(['torneos-gateway/config.ts', 'torneos-gateway/index.ts', 'torneos-gateway/topology.ts']), removed: Object.freeze([]) }),
});
export const readLiveDeployPin = () => JSON.parse(fs.readFileSync(LIVE_DEPLOY_PIN_FILE, 'utf8'));
{
  const p = readLiveDeployPin();
  if (p.revision !== LIVE.revision || p.previous_revision !== LIVE.previous_revision || p.source.head !== LIVE.head || p.source.digest !== LIVE.digest || p.source.files.length !== LIVE.files) throw new Error('live_deploy_pin_mismatch');
  if (p.env.length !== 13) throw new Error('live_deploy_pin_env_count');
}

// ─────────────────────────── env (13, never sent, never changed) ───────────────────────────
/** names + secret flags + contexts + non-secret value digests, exactly as the OEC W3 left them. */
export const ENV_PIN = Object.freeze(readLiveDeployPin().env.map((e) => Object.freeze({ key: e.key, secret: e.secret, contexts: e.contexts, ...(e.secret ? {} : { sha256_16: e.sha256_16 }) })));
export const ENV_COUNT = 13;
if (ENV_PIN.length !== ENV_COUNT || JSON.stringify(ENV_PIN.map((e) => e.key)) !== JSON.stringify([...R.ENV_NAMES])) throw new Error('android_origin_env_pin_shape');
if (ENV_PIN.some((e) => e.secret !== R.SECRET_NAMES.includes(e.key) || e.contexts !== 'all' || (!e.secret && !/^[0-9a-f]{16}$/.test(e.sha256_16)))) throw new Error('android_origin_env_pin_flags');

// ─────────────────────────── Deno organization / app (as the OEC W3 left it) ───────────────────────────
export const DENO_CERTIFIED = Object.freeze({
  evidence: 'backend/torneos/officialization-v1/evidence/remote/oec-04-w3-20260928T144346Z.json',
  org_apps: CV1.DENO_CERTIFIED.org_apps, org_layers: 0,
  app: Object.freeze({ id: CV1.DENO_CERTIFIED.app.id, created_at: CV1.DENO_CERTIFIED.app.created_at, config: CV1.DENO_CERTIFIED.app.config, labels: CV1.DENO_CERTIFIED.app.labels,
    // No configuration or env change since the app got its variables (neither COMPETITION-V1 W2 nor OEC W3 moved it).
    updated_at: '2026-09-26T01:12:00.894Z' }),
  revisions: Object.freeze([LIVE.revision, LIVE.previous_revision, ...CV1.DENO_CERTIFIED.revisions]),
  production_domain: CV1.DENO_CERTIFIED.production_domain,
});
if (DENO_CERTIFIED.app.id !== '5d4f18e9-1614-4e24-b8e0-fd7cff8e4c3d' || DENO_CERTIFIED.revisions.length !== 4) throw new Error('android_origin_deno_pin');

// ─────────────────────────── origins ───────────────────────────
export const WEB_ORIGIN = G.WEB_ORIGIN;
export const ANDROID_ORIGIN = 'https://localhost';
/** Must stay 403 on both sources: other scheme, iOS Capacitor default, other port, foreign host. */
export const DENY_ORIGINS = Object.freeze(['http://localhost', 'capacitor://localhost', 'https://localhost:8443', 'https://evil.example']);
if (WEB_ORIGIN !== 'https://app.arma2.com.ar') throw new Error('android_origin_web_pin');

// ─────────────────────────── phrases / plans ───────────────────────────
export const PHRASES = Object.freeze({
  w1: (id) => `DEPLOY TORNEOS GATEWAY ANDROID-ORIGIN ${APP_SLUG} ${id}`,
  rollback: (id) => `ROLLBACK TORNEOS GATEWAY ${APP_SLUG} TO ${LIVE.head.slice(0, 8)} ${id}`,
});
export const planIdOf = (plan) => sha256(JSON.stringify(plan)).slice(0, 12);
export const envNamesOf = (env) => env.map((e) => `${e.key}${e.secret ? '(secret)' : ''}`);
/** Pure functions of the pins + the observed current revision / env names (no clock, no git HEAD). */
export const PLANS = Object.freeze({
  deploy: ({ which, previousRevision, source, env }) => ({
    step: which === 'candidate' ? 'W1' : 'W1-rollback', app: APP_SLUG, previous_revision: previousRevision,
    source: { head: source.head, digest: source.digest, files: source.manifest.map((m) => m.path) },
    env: 'unchanged (not in the request)', env_now: env, db: 'not touched', core: 'not touched', vercel: 'not touched',
    timelines: { production: true, preview: false },
    ...(which === 'candidate' ? { rollback_to: { head: LIVE.head, digest: LIVE.digest, files: LIVE.files } } : {}),
  }),
});
/** The W1 plan id as it will be printed if Production is still exactly at the live pin. */
export const expectedW1PlanId = (candidate) => planIdOf(PLANS.deploy({ which: 'candidate', previousRevision: LIVE.revision, source: candidate, env: envNamesOf(ENV_PIN) }));
