// MP-B1.1 R3 — local invariants + secret scan against the R2 candidate bdc605fd. Prints counts/hashes, never secret values.
// Run on the commerce lab (TORNEOS_LAB_MODE=commerce) BEFORE it is destroyed, so container logs and the live payment-service
// ACL are covered. Writes backend/torneos/mp-b/evidence/mp-b1.1-r3/invariants.json.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { repo, dc } from './lab.mjs';
import { labSecrets, admin } from './payments-lab.mjs';

const candidate = 'bdc605fdccec3fe3fa4082be0fac67e5ba496f79';
const mpb12 = '1f8e560ff0fa1a064aed5621247550c0325b8cda';
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const sha = (b) => createHash('sha256').update(b).digest('hex');
// The R2 final-review notes are a pre-existing untracked directory of an earlier session: neither part of R3 nor committed by it.
const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean).filter(p => !p.startsWith('backend/torneos/mp-b/evidence/mp-b1.1-r2-final-review/'));
const paths = [...new Set([...git('diff', '--name-only', candidate).split('\n').filter(Boolean), ...untracked])];

// 1. scope: only the R3 surface (compose.yaml is the temporary local-only lab edit, restored before commit).
const allowed = [
  /^backend\/torneos\/supabase\/functions\/torneos-payments\/(config|handler|hmac|webhook-freshness|webhook-signature)\.ts$/,
  /^integration\/torneos-core-contracts\/(deno-runtime-hardening|deno-runtime-compat|webhook-ts-ordering)\.test\.mjs$/,
  /^integration\/torneos-core-contracts\/r3-invariants\.mjs$/,
  /^integration\/torneos-core-contracts\/(remote-test-enablement|payments-config|payments-provider-copy)\.test\.mjs$/,
  /^integration\/torneos-core-contracts\/compose\.yaml$/,
  /^backend\/torneos\/mp-b\/evidence\/mp-b1\.1-r3\//,
];
const outside = paths.filter(p => !allowed.some(re => re.test(p)));
assert.deepEqual(outside, [], `files outside the R3 scope: ${outside}`);
const frozen = git('diff', '--name-only', candidate, '--', 'src', 'public', 'supabase', 'server', 'api', 'scripts', 'package.json', 'package-lock.json',
  'backend/torneos/supabase/migrations', 'backend/torneos/supabase/config.toml', 'backend/torneos/supabase/functions/_shared', 'backend/torneos/supabase/functions/torneos-gateway',
  'backend/torneos/supabase/functions/torneos-payments/index.ts', 'backend/torneos/supabase/functions/torneos-payments/db.ts', 'backend/torneos/supabase/functions/torneos-payments/rpc.ts',
  'backend/torneos/supabase/functions/torneos-payments/lab-fetch.ts', 'backend/torneos/supabase/functions/torneos-payments/remote-hosts.ts',
  'integration/torneos-core-contracts/gateway.mjs', 'integration/torneos-core-contracts/torneos-edge-main', 'integration/torneos-core-contracts/edge-main',
  'integration/torneos-core-contracts/mp-stub.mjs', 'integration/torneos-core-contracts/lab.mjs', 'integration/torneos-core-contracts/compose.mpa.yaml',
  'integration/torneos-core-contracts/payments-lab.mjs', 'integration/torneos-core-contracts/webhook-replay.test.mjs', 'integration/torneos-core-contracts/provider-ordering.test.mjs',
  'integration/torneos-core-contracts/commerce-gateway.test.mjs', 'integration/torneos-core-contracts/commerce-db.test.mjs',
  'backend/torneos/mp-a/evidence', 'backend/torneos/mp-b/evidence/mp-b1', 'backend/torneos/mp-b/evidence/mp-b1.1', 'backend/torneos/mp-b/evidence/mp-b1.1-r2',
  'backend/torneos/mp-b/evidence/mp-b1.2');
assert.equal(frozen, '', `frozen paths changed: ${frozen}`);
const frozenUntracked = untracked.filter(p => /^backend\/torneos\/mp-(a|b)\/evidence\/(?!mp-b1\.1-r3\/)/.test(p));
assert.deepEqual(frozenUntracked, [], `new files in earlier evidence directories: ${frozenUntracked}`);

// 2. migrations 0000..0003 byte-identical to the candidate and to MP-B1.2; exactly four; no new migration.
const MIG = 'backend/torneos/supabase/migrations/';
const migrations = git('ls-files', MIG).split('\n').map(p => p.slice(MIG.length)).sort();
assert.deepEqual(migrations, ['00000000000000_torneos_baseline_v1.sql', '00000000000001_staging_v1_rpc_exposure.sql',
  '00000000000002_mercadopago_checkout_pro_test.sql', '00000000000003_mercadopago_provider_ordering.sql']);
assert.deepEqual(existsSync(repo + MIG) ? execFileSync('ls', [repo + MIG], { encoding: 'utf8' }).trim().split('\n').sort() : [], migrations, 'no untracked migration');
const hashes = {};
for (const name of migrations) {
  const actual = readFileSync(repo + MIG + name);
  for (const ref of [candidate, mpb12]) assert.ok(actual.equals(execFileSync('git', ['show', `${ref}:${MIG}${name}`], { cwd: repo, maxBuffer: 32 * 1024 * 1024 })), `${name} differs from ${ref.slice(0, 8)}`);
  hashes[name] = sha(actual);
}

// 3. shared provider copy byte-pinned; frontend / Core / gateway (incl. /exchange) byte-identical to the candidate.
const provider = { 'paymentProvider.ts': 'da5e43266c5107cd1f6183c83046ba49e71343e9102370adb08be8abb4640a40', 'mercadoPagoPaymentProvider.ts': '1136217d93c55c5f981d45dfa9abfd62f14b26a218df120f5f801d547e547961' };
for (const [f, h] of Object.entries(provider)) assert.equal(sha(readFileSync(`${repo}backend/torneos/supabase/functions/_shared/${f}`)), h, f);

// 4. live ACL: the payment service executes exactly the four ordered MP-A2 / MP-B1.2 functions.
const execs = JSON.parse(admin(`set role torneos_payment_service; select coalesce(json_agg(p.oid::regprocedure::text order by 1), '[]') from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and has_function_privilege(current_user, p.oid, 'EXECUTE');`).trim().split('\n').pop());
assert.equal(execs.length, 4, `payment EXECUTE = ${execs.length}`);
const watermark = admin(`select count(*) from information_schema.table_privileges where table_name = 'tournament_payment_provider_watermarks' and grantee in ('anon','authenticated','service_role','torneos_payment_service')`).trim();
assert.equal(watermark, '0', 'no API/service table privilege on the watermark');

// 5. secret scan: every changed/new file (incl. evidence) and the lab container logs. Test fixtures use the literal passwords
//    `pw-fixture` (R3) / `pw` (pre-existing T5 lines); any other credential-shaped DB URL fails. Lab secrets are matched by value.
const secrets = labSecrets();
assert.ok(secrets.length >= 10, 'lab secrets loaded for the scan');
let bytes = 0;
const patterns = [/APP_USR-[0-9A-Za-z-]{20,}/, /TEST-[a-f0-9]{24,}/, /eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{20,}/, /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]{40,}/,
  /lab-payer-[0-9]+@payer\.invalid/, /ts=\d{9,},v1=[a-f0-9]{64}/, /sb_secret_[A-Za-z0-9_-]{10,}/, /ddp_[A-Za-z0-9]{20,}/];
const dbUrl = /postgres(?:ql)?:\/\/[^\s"'@/$]+:([^\s"'@$]+)@/g;
function scan(text, label) {
  bytes += Buffer.byteLength(text);
  for (const s of secrets) assert.ok(!text.includes(s), `lab secret in ${label}`);
  for (const re of patterns) assert.ok(!re.test(text), `credential pattern ${re.source.slice(0, 24)} in ${label}`);
  for (const m of text.matchAll(dbUrl)) assert.ok(['pw-fixture', 'pw'].includes(m[1]), `credential-shaped DB URL in ${label}`);
}
const files = paths.filter(p => existsSync(repo + p) && !p.endsWith('compose.yaml'));
for (const p of files) scan(readFileSync(repo + p, 'utf8'), p);
scan(dc(['logs', '--no-color'], undefined, true), 'local container logs');

// 6. isolation of the running lab: egress without masquerade; Mercado Pago hosts black-holed in the functions container.
const docker = '/Applications/Docker.app/Contents/Resources/bin/docker';
const net = JSON.parse(execFileSync(docker, ['--host', 'unix:///var/run/docker.sock', 'network', 'inspect', `${process.env.PHASE3A_LAB_PROJECT}_egress`], { encoding: 'utf8' }))[0];
assert.equal(net.Options?.['com.docker.network.bridge.enable_ip_masquerade'], 'false', 'egress cannot reach the outside');
const hostsFile = execFileSync(docker, ['--host', 'unix:///var/run/docker.sock', 'exec', `${process.env.PHASE3A_LAB_PROJECT}-torneos-functions-1`, 'cat', '/etc/hosts'], { encoding: 'utf8' });
assert.match(hostsFile, /127\.0\.0\.9\s+api\.mercadopago\.com/);

const result = { candidate, parentOfCommit: candidate, mpb12, head: git('rev-parse', 'HEAD'), changedFiles: paths.length, scope: 'R3 surface only', frozenPathsChanged: 0,
  gatewayRuntimeChanged: false, frontendChanged: false, coreChanged: false, sharedProviderCopy: provider, migrations: hashes, migrationCount: migrations.length,
  paymentServiceExecute: execs.length, watermarkApiPrivileges: 0, secrets: 0, scannedFiles: files.length, scannedBytes: bytes,
  labIsolation: { egressMasquerade: false, mercadoPagoHostsBlackholed: true } };
writeFileSync(`${repo}backend/torneos/mp-b/evidence/mp-b1.1-r3/invariants.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
