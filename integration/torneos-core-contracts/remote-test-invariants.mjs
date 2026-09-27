// MP-B1.1 R2 — local invariants + secret scan against the MP-B1.2 base. Prints counts/hashes, never secret values.
// Run on the commerce lab (TORNEOS_LAB_MODE=commerce) BEFORE it is destroyed, so container logs and the live
// payment-service ACL are covered. Writes backend/torneos/mp-b/evidence/mp-b1.1-r2/invariants.json.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { repo, dc } from './lab.mjs';
import { labSecrets, admin } from './payments-lab.mjs';

const base = '1f8e560ff0fa1a064aed5621247550c0325b8cda';
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const sha = (b) => createHash('sha256').update(b).digest('hex');
const paths = [...new Set([git('diff', '--name-only', base), git('ls-files', '--others', '--exclude-standard')].flatMap(x => x.split('\n').filter(Boolean)))];

// 1. scope: only the MP-B1.1 R2 surface changed (compose.yaml is a temporary local-only lab edit, restored before commit).
const allowed = [
  /^backend\/torneos\/supabase\/functions\/torneos-gateway\/(commerce|index)\.ts$/,
  /^backend\/torneos\/supabase\/functions\/torneos-payments\/(config|handler|remote-hosts|webhook-freshness)\.ts$/,
  /^integration\/torneos-core-contracts\/(compose\.mpa\.yaml|remote-test-enablement\.test\.mjs|webhook-replay\.test\.mjs|remote-test-invariants\.mjs)$/,
  /^integration\/torneos-core-contracts\/compose\.yaml$/,
  /^backend\/torneos\/mp-b\/evidence\/mp-b1\.1-r2\//,
];
const outside = paths.filter(p => !allowed.some(re => re.test(p)));
assert.deepEqual(outside, [], `files outside the R2 scope: ${outside}`);
const frozen = git('diff', '--name-only', base, '--', 'src', 'public', 'supabase', 'server', 'api', 'scripts', 'backend/torneos/supabase/migrations',
  'backend/torneos/supabase/functions/_shared', 'backend/torneos/supabase/functions/torneos-gateway/token.ts', 'backend/torneos/supabase/functions/torneos-gateway/core-client.ts',
  'backend/torneos/supabase/functions/torneos-gateway/adapter.ts', 'backend/torneos/supabase/functions/torneos-gateway/config.ts', 'backend/torneos/supabase/functions/torneos-gateway/db.ts',
  'backend/torneos/supabase/functions/torneos-payments/rpc.ts', 'backend/torneos/supabase/functions/torneos-payments/db.ts', 'backend/torneos/supabase/functions/torneos-payments/hmac.ts',
  'integration/torneos-core-contracts/gateway.mjs', 'integration/torneos-core-contracts/torneos-edge-main', 'integration/torneos-core-contracts/mp-stub.mjs',
  'integration/torneos-core-contracts/lab.mjs', 'backend/torneos/mp-b/evidence/mp-b1', 'backend/torneos/mp-b/evidence/mp-b1.1', 'backend/torneos/mp-b/evidence/mp-b1.2');
assert.equal(frozen, '', `frozen paths changed: ${frozen}`);

// 2. index.ts: only the commerce boot call (dependency URLs) and its header comment changed — /exchange, bridge, Core untouched.
const indexDiff = git('diff', '-U0', base, '--', 'backend/torneos/supabase/functions/torneos-gateway/index.ts').split('\n')
  .filter(l => /^[+-](?![+-])/.test(l)).map(l => l.slice(1).trim()).filter(l => l && !l.startsWith('//'));
assert.deepEqual(indexDiff, [
  'distinctFrom: [env.TORNEOS_CONTRACT_SERVICE_SECRET, env.TORNEOS_BRIDGE_KEYS, ...cfg.bridge.keys.map((k) => k.privateKey), cfg.coreAnonKey, cfg.torneosAnonKey] })',
  'distinctFrom: [env.TORNEOS_CONTRACT_SERVICE_SECRET, env.TORNEOS_BRIDGE_KEYS, ...cfg.bridge.keys.map((k) => k.privateKey), cfg.coreAnonKey, cfg.torneosAnonKey],',
  'dependencyUrls: [cfg.coreAuthUrl, cfg.coreJwtIssuer, cfg.coreContractUrl, cfg.torneosRestUrl, cfg.allowedOrigin] })',
], 'index.ts code diff is exactly the dependency-URL wiring');

// 3. migrations 0000..0003 byte-identical to the base; exactly four; no new migration.
const MIG = 'backend/torneos/supabase/migrations/';
const migrations = git('ls-files', MIG).split('\n').map(p => p.slice(MIG.length)).sort();
assert.deepEqual(migrations, ['00000000000000_torneos_baseline_v1.sql', '00000000000001_staging_v1_rpc_exposure.sql',
  '00000000000002_mercadopago_checkout_pro_test.sql', '00000000000003_mercadopago_provider_ordering.sql']);
const hashes = {};
for (const name of migrations) {
  const actual = readFileSync(repo + MIG + name);
  assert.ok(actual.equals(execFileSync('git', ['show', `${base}:${MIG}${name}`], { cwd: repo, maxBuffer: 32 * 1024 * 1024 })), `${name} changed`);
  hashes[name] = sha(actual);
}

// 4. live ACL: the payment service executes exactly the four ordered MP-A2/MP-B1.2 functions.
const execs = JSON.parse(admin(`set role torneos_payment_service; select coalesce(json_agg(p.oid::regprocedure::text order by 1), '[]') from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and has_function_privilege(current_user, p.oid, 'EXECUTE');`).trim().split('\n').pop());
assert.equal(execs.length, 4, `payment EXECUTE = ${execs.length}`);
const watermark = admin(`select count(*) from information_schema.table_privileges where table_name = 'tournament_payment_provider_watermarks' and grantee in ('anon','authenticated','service_role','torneos_payment_service')`).trim();
assert.equal(watermark, '0', 'no API/service table privilege on the watermark');

// 5. secret scan: every changed/new file (incl. evidence), and the lab container logs.
const secrets = labSecrets();
assert.ok(secrets.length >= 10, 'lab secrets loaded for the scan');
let bytes = 0;
const patterns = [/APP_USR-[0-9A-Za-z-]{20,}/, /TEST-[a-f0-9]{24,}/, /eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{20,}/, /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]{40,}/,
  /lab-payer-[0-9]+@payer\.invalid/, /ts=\d{9,},v1=[a-f0-9]{64}/, /postgres(?:ql)?:\/\/[^\s"'@/$]+:[^\s"'@$]+@/];
function scan(text, label) {
  bytes += Buffer.byteLength(text);
  for (const s of secrets) assert.ok(!text.includes(s), `secret in ${label}`);
  for (const re of patterns) assert.ok(!re.test(text), `credential pattern ${re.source.slice(0, 20)} in ${label}`);
}
const files = paths.filter(p => existsSync(repo + p));
for (const p of files) scan(readFileSync(repo + p, 'utf8'), p);
scan(dc(['logs', '--no-color'], undefined, true), 'local container logs');

// 6. isolation of the running lab: egress without masquerade; Mercado Pago hosts black-holed in the functions container.
const net = JSON.parse(execFileSync('docker', ['network', 'inspect', `${process.env.PHASE3A_LAB_PROJECT}_egress`], { encoding: 'utf8' }))[0];
assert.equal(net.Options?.['com.docker.network.bridge.enable_ip_masquerade'], 'false', 'egress cannot reach the outside');
const hostsFile = execFileSync('docker', ['exec', `${process.env.PHASE3A_LAB_PROJECT}-torneos-functions-1`, 'cat', '/etc/hosts'], { encoding: 'utf8' });
assert.match(hostsFile, /127\.0\.0\.9\s+api\.mercadopago\.com/);

const result = { base, head: git('rev-parse', 'HEAD'), changedFiles: paths.length, scope: 'R2 surface only', frozenPathsChanged: 0, indexTsCodeDiff: 'dependencyUrls wiring only',
  migrations: hashes, paymentServiceExecute: execs.length, watermarkApiPrivileges: 0, secrets: 0, scannedFiles: files.length, scannedBytes: bytes,
  labIsolation: { egressMasquerade: false, mercadoPagoHostsBlackholed: true } };
writeFileSync(`${repo}backend/torneos/mp-b/evidence/mp-b1.1-r2/invariants.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
