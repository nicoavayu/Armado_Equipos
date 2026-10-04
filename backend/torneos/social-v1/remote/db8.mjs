// SOCIAL-V1 0008 operator driver for the Torneos Production DB (gate D). Never run by CI or by the operator without GO.
//   node backend/torneos/social-v1/remote/db8.mjs observe                       (read-only, READ ONLY transaction)
//   node backend/torneos/social-v1/remote/db8.mjs apply    APPLY TORNEOS 0008 <ref> <sha12 of 0008>
//   node backend/torneos/social-v1/remote/db8.mjs rollback ROLLBACK TORNEOS 0008 <ref> <sha12 of the rollback>
// Transport = the certified OEC/CV1 one (installer postgres.<ref>, Session Pooler sa-east-1:5432, verify-full + Supabase
// CA, password read from the macOS Keychain into memory only, redacted from every output). Each write is gated by the
// exact phrase, the file sha256 and the exact observed state before (POST_0007 / POST_0008) and after; the rest of the
// catalog (every other function, relations, policies) must be identical before and after.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOCIAL = path.resolve(HERE, '..');
const CONTRACT = JSON.parse(fs.readFileSync(path.join(SOCIAL, 'contract.json'), 'utf8'));
const REPO = path.resolve(SOCIAL, '../../..');
export const REF = 'onzpwnqxnvlgsevivngf';
export const AUTHORIZE = 'authorize_tournament_social_export(uuid,uuid,text,text,boolean)';
export const FILES = Object.freeze({
  apply: Object.freeze({ path: path.join(REPO, CONTRACT.migration), sha256: '8b1e7bf96c13caa5b8102ff1150e462346820e472c8a58f8f6bd6be0a6310c2f', from: 'POST_0007', to: 'POST_0008' }),
  rollback: Object.freeze({ path: path.join(REPO, CONTRACT.rollback), sha256: 'dcc65afe7aeb1f0b9013616d24bac9c9d95a4a6b0ee003d81b7ac66f08be148d', from: 'POST_0008', to: 'POST_0007' }),
});
// Social catalog at POST_0007 (evidence/catalog-post0007.txt): every function but authorize keeps this body.
export const KEPT_MD5 = Object.freeze({
  'current_user_tournament_social_capabilities(uuid)': '40ace2223c80ee45ffafd3033603b768',
  'get_tournament_social_snapshot(uuid,uuid,uuid,uuid,text,uuid,uuid)': '5640252b8bbf9aebb1575b48aa78db0a',
  'get_tournament_social_snapshot_plan_legacy(uuid,uuid,uuid,uuid,text,uuid,uuid)': 'e7606acb7df7381f81b9302aa3c987ae',
  'get_tournament_social_studio_context(uuid)': '860a6746dbf4b3a9fd29c3430ac8b8a7',
  'get_tournament_social_studio_context_organization_legacy(uuid)': '42287a3a4e91e5714cfdb20e0332ed23',
  'has_tournament_social_capability(uuid,text)': 'f7558d609734718f7131b9f9dc027a13',
  'set_tournament_social_permission(uuid,uuid,boolean)': '6bec22e64e5dd60a9303c42e5df17eda',
  'tournament_social_match_rows(uuid,uuid,uuid,boolean)': '37686ea2a0fe990907e50b09207486a8',
  'tournament_social_next_fixture(uuid,uuid,uuid)': '42e14685d1b169fc4c2dc0f61341e552',
  'tournament_social_player_candidates(uuid,jsonb)': 'f60726bbd0d3de5349dd07b48849d7c8',
  'tournament_social_published_scope(uuid,uuid,uuid,uuid)': 'e479c745bdeeb899140aef691fae79f6',
  'tournament_social_role_capabilities(text)': '2763a8313613bff6211867fb0be33512',
});
const STATES = Object.freeze({
  POST_0007: { md5: CONTRACT.pins.authorize_pre_md5, authenticated: false, counts: CONTRACT.pins.acl_pre },
  POST_0008: { md5: CONTRACT.pins.authorize_post_md5, authenticated: true, counts: CONTRACT.pins.acl_post },
});
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const unqualified = (sig) => sig.replace(/^public\./, '');

/** POST_0007 | POST_0008 | DRIFT, with every reason. Pure. */
export function classify(catalog) {
  const failures = [];
  if (!catalog || catalog.torneos_tables !== true) return { state: 'DRIFT', failures: ['not_the_torneos_db'] };
  const social = Object.fromEntries(Object.entries(catalog.social || {}).map(([sig, fn]) => [unqualified(sig), fn]));
  const fn = social[AUTHORIZE];
  if (!fn) return { state: 'DRIFT', failures: ['authorize_missing'] };
  const names = Object.keys(social).sort();
  const expected = [AUTHORIZE, ...Object.keys(KEPT_MD5)].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) failures.push(`social_set ${names.join(',')}`);
  for (const [sig, md5] of Object.entries(KEPT_MD5)) if (social[sig] && social[sig].md5 !== md5) failures.push(`body ${sig}`);
  if (fn.secdef !== true || fn.volatile !== 's' || JSON.stringify(fn.config) !== JSON.stringify(['search_path=""'])) failures.push('authorize_attributes');
  if (fn.exec.anon || fn.exec.public || !fn.exec.service_role) failures.push('authorize_acl_base');
  const state = Object.entries(STATES).find(([, s]) => s.md5 === fn.md5)?.[0];
  if (!state) return { state: 'DRIFT', failures: [...failures, `authorize_md5 ${fn.md5}`] };
  const want = STATES[state];
  if (fn.exec.authenticated !== want.authenticated) failures.push(`authorize_authenticated ${fn.exec.authenticated}`);
  if (catalog.counts?.authenticated !== want.counts[0] || catalog.counts?.anon !== want.counts[1]) failures.push(`counts ${catalog.counts?.authenticated}/${catalog.counts?.anon}`);
  return failures.length ? { state: 'DRIFT', failures } : { state, failures: [] };
}

const unchangedOutsideAuthorize = (before, after) => ['other_fn', 'relations', 'policies']
  .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));

/** The whole operator decision, with injected I/O (tested offline with fakes). */
export async function run(mode, words, { readFile = fs.readFileSync, catalog, applySql }) {
  const out = { mode, target: REF };
  if (mode === 'observe') {
    out.catalog = await catalog();
    out.verdict = classify(out.catalog);
    return out;
  }
  const file = FILES[mode];
  if (!file) throw new Error('usage: observe | apply <phrase> | rollback <phrase>');
  const phrase = `${mode.toUpperCase()} TORNEOS 0008 ${REF} ${file.sha256.slice(0, 12)}`;
  if (words.join(' ') !== phrase) throw new Error(`PHRASE_REQUIRED: ${phrase}`);
  const bytes = readFile(file.path);
  if (sha256(bytes) !== file.sha256) throw new Error('FILE_HASH_MISMATCH');
  const before = await catalog();
  const pre = classify(before);
  if (pre.state !== file.from) throw new Error(`PRE_STATE_${pre.state} ${pre.failures.join('; ')}`);
  out.psql = await applySql(bytes.toString('utf8'));
  const after = await catalog();
  const post = classify(after);
  const moved = unchangedOutsideAuthorize(before, after);
  out.before = pre.state; out.after = post.state; out.changedOutsideAuthorize = moved;
  out.verdict = out.psql.code === 0 && post.state === file.to && !moved.length
    ? `${mode.toUpperCase()}_0008_DONE` : `${mode.toUpperCase()}_0008_FAILED`;
  return out;
}

async function realDeps() {
  const infra = path.join(REPO, 'backend/torneos/infra');
  const C = await import(path.join(infra, 'torneos-officialization-error-v1/oec-remote-contract.mjs'));
  const CV1 = await import(path.join(infra, 'torneos-competition-v1/competition-remote.mjs'));
  const { runPsqlProbe } = await import(path.join(infra, 'torneos-payments-test/payments-db.mjs'));
  const { applySql } = await import(path.join(infra, 'torneos-gateway-auth/psql-gateway-auth.mjs'));
  const { systemKeychain } = await import(path.join(infra, 'torneos-gateway-auth/keychain-gateway-auth.mjs'));
  if (C.TORNEOS_REF !== REF) throw new Error('REF_MISMATCH');
  let password = null;
  const secret = () => password ?? (password = systemKeychain().dataplane.read());
  const redact = (s) => { let t = String(s ?? ''); if (password) t = t.split(password).join('[REDACTED]'); return t; };
  const sql = fs.readFileSync(path.join(HERE, 'sql-catalog.sql'), 'utf8').trim();
  return {
    redact,
    wipe: () => { password = null; },
    catalog: async () => {
      const r = await runPsqlProbe({ script: C.readOnlyScript(sql), env: CV1.readOnlyEnv({ password: secret() }), redact });
      if (r.code !== 0) throw new Error(`CATALOG_READ_FAILED ${r.code} ${r.stderr_tail}`);
      return JSON.parse(r.stdout.trim().split('\n').filter(Boolean).pop());
    },
    applySql: (text) => applySql({ sql: text, env: CV1.installerEnv({ password: secret(), app: 'arma2-torneos-social-v1-0008' }), redact }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, ...words] = process.argv.slice(2);
  const output = { at: new Date().toISOString(), transport: 'psql aws-0-sa-east-1.pooler.supabase.com:5432 verify-full' };
  let deps = null;
  try {
    deps = await realDeps();
    Object.assign(output, await run(mode, words, deps));
  } catch (error) {
    output.error = (deps?.redact ?? String)(error?.message ?? error).slice(0, 600);
  }
  deps?.wipe();
  process.stdout.write(`${JSON.stringify(output, null, 1)}\n`);
  process.exit(output.error || /FAILED/.test(output.verdict || '') ? 1 : 0);
}
