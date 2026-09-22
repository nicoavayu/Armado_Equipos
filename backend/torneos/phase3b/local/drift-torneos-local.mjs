#!/usr/bin/env node
// Phase 3B — INFORMATIVE drift run (NON-BLOCKING): install the certified baseline + gate into a
// fresh, network-disabled container of ANOTHER Postgres image (default 17.6.1.147 = the version
// Core staging reports) and compare the effective ACL surface object by object with the certified
// Phase 2D after-real inventory (same `api_view` code), plus the shared verification contract.
// The official R2 PASS is measured on the certified image (17.6.1.143, id 80d7b27c…) by the lab;
// this run only reports whether the other image would change anything. A material difference is
// documented as INFORMATIVE_DRIFT_DETECTED_STOP_FOR_HUMAN_REVIEW — never reinterpreted here, never
// turned into a FAIL of R2. The image must already be present locally (no pull). Container removed.
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CERTIFIED, FILES, STAMP, canonical, docker, evaluateExpect, integrity, promoteEvidence, secretsKnown, sha256, stop } from '../../../../integration/torneos-isolated-local/lab.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const TAG = process.argv[2] ?? '17.6.1.147';
if (!/^\d+\.\d+\.\d+\.\d+$/.test(TAG)) stop('TAG_MALFORMED', TAG);
const IMAGE = `public.ecr.aws/supabase/postgres:${TAG}`;
const NAME = `arma2-torneos-drift-${TAG}-${STAMP.toLowerCase()}`;

function psql(query) {
  const r = docker(['exec', '-i', NAME, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { input: query, check: false });
  if (r.status !== 0) throw new Error((r.stderr ?? '').split('\n').filter((l) => l.startsWith('ERROR:') || l.startsWith('psql:')).join(' | ') || 'psql failed');
  return r.stdout;
}
async function main() {
  const t0 = Date.now();
  const integ = await integrity(); // baseline/gate/contract pins; also confirms the CERTIFIED image id is what the lab uses
  const img = docker(['image', 'inspect', IMAGE, '--format', '{{.Id}}'], { check: false });
  if (img.status !== 0) stop('IMAGE_NOT_PRESENT_LOCALLY', `${IMAGE} (no pull is performed)`);
  const imageId = img.stdout.trim();
  if (imageId === CERTIFIED.image_id) stop('SAME_IMAGE_AS_CERTIFIED', 'the drift run needs a different image');
  const pw = randomBytes(24).toString('hex'); secretsKnown.push(pw);
  const doc = { generated_at: null, tool: 'backend/torneos/phase3b/local/drift-torneos-local.mjs', phase: '3B', step: 'R2-local drift (informative)', informative: true, blocking: false,
    reference: { image: CERTIFIED.image, image_id: CERTIFIED.image_id, certified_inventory: FILES.certifiedAcl.replace(/^.*\/backend\//, 'backend/') },
    image: IMAGE, image_id: imageId, container: NAME, network: 'none', baseline_sha256: integ.baseline_sha256, gate_sha256: integ.gate_sha256, verify_sql_sha256: integ.verify_sql_sha256, expect_sha256: integ.expect_sha256 };
  console.log(`drift run on ${IMAGE} (${imageId}) — informative, non-blocking`);
  docker(['run', '-d', '--name', NAME, '--network', 'none', '--label', 'arma2.phase=3b-local-torneos-drift', '-e', `POSTGRES_PASSWORD=${pw}`, IMAGE, 'postgres', '-D', '/etc/postgresql', '-c', 'log_statement=none']);
  try {
    const info = JSON.parse(docker(['inspect', NAME]).stdout)[0];
    if (info.HostConfig.NetworkMode !== 'none' || info.Image !== imageId) stop('DRIFT_CONTAINER_UNEXPECTED');
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      try { if (docker(['logs', NAME], { check: false }).stderr.includes('PostgreSQL init process complete') || docker(['logs', NAME], { check: false }).stdout.includes('PostgreSQL init process complete')) { psql('select 1'); ready = true; } } catch { /* not yet */ }
      if (!ready) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!ready) stop('DRIFT_DB_NOT_READY');
    doc.server_version = psql("select current_setting('server_version')").trim();
    doc.preflight = JSON.parse(psql("select json_build_object('public_relations', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m','S')), 'torneos_roles', (select count(*) from pg_roles where rolname like 'torneos%'), 'identity_table', to_regclass('public.torneos_identity') is not null, 'default_acl_public', (select coalesce(json_agg(json_build_object('role',r.rolname,'type',d.defaclobjtype,'acl',d.defaclacl::text) order by r.rolname,d.defaclobjtype),'[]') from pg_default_acl d join pg_roles r on r.oid=d.defaclrole join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public'))"));
    if (doc.preflight.public_relations !== 0 || doc.preflight.torneos_roles !== 0 || doc.preflight.identity_table) stop('DRIFT_PRECONDITION');
    const steps = {};
    for (const [label, file] of [['baseline', FILES.baseline], ['gate', FILES.gate]]) {
      try { psql(await readFile(file, 'utf8')); steps[label] = 'installed'; }
      catch (e) { steps[label] = `FAILED: ${e.message.slice(0, 300)}`; doc.install = steps; doc.status = 'INFORMATIVE_DRIFT_DETECTED_STOP_FOR_HUMAN_REVIEW'; doc.material_difference = `${label} does not install on ${IMAGE}`; return; }
    }
    // Post-install as the runners do (no passwords needed here: nothing connects).
    psql("begin; create role torneos_edge_identity_writer login noinherit; create role torneos_edge_core_adapter login noinherit; grant torneos_identity_writer to torneos_edge_identity_writer; grant torneos_core_adapter to torneos_edge_core_adapter; alter role authenticator set pgrst.db_pre_request = 'private.check_token'; commit;");
    doc.install = steps;
    const verification = JSON.parse(psql(integ.verify_sql));
    const expectations = evaluateExpect(integ.expect, verification);
    doc.verification = verification; doc.expectations = expectations; doc.expectations_passed = expectations.filter((e) => e.ok).length;
    doc.catalog_hash = sha256(canonical(verification));
    const inventory = JSON.parse(psql(await readFile(FILES.aclInventory, 'utf8')));
    const r = spawnSync('python3', [`${HERE}api_view.py`], { input: JSON.stringify({ live: inventory, certified_path: FILES.certifiedAcl }), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) stop('API_VIEW_BRIDGE', (r.stderr ?? '').slice(-300));
    const cmp = JSON.parse(r.stdout);
    doc.equivalence_vs_certified = { compared: cmp.compared, mismatches: cmp.mismatches, counts: cmp.counts, live_view_sha256: cmp.live_view_sha256, certified_view_sha256: cmp.certified_view_sha256, live_summary: cmp.live_summary };
    doc.extensions = verification.extensions;
    const material = cmp.mismatches.length > 0 || expectations.some((e) => !e.ok);
    doc.status = material ? 'INFORMATIVE_DRIFT_DETECTED_STOP_FOR_HUMAN_REVIEW' : 'INFORMATIVE_NO_DRIFT';
    doc.material_difference = material ? `${cmp.mismatches.length} api_view mismatches, ${expectations.filter((e) => !e.ok).length} expectation mismatches` : null;
  } finally {
    docker(['rm', '-f', NAME], { check: false });
    doc.container_removed = docker(['ps', '-a', '--filter', `name=^${NAME}$`, '--format', '{{.Names}}']).stdout.trim() === '';
    doc.duration_s = Math.round((Date.now() - t0) / 1000);
    doc.generated_at = new Date().toISOString();
    const ev = await promoteEvidence(`local-torneos-drift-${TAG}-${STAMP}.json`, doc);
    console.log(`PHASE3B_R2_LOCAL_DRIFT_${doc.status} ${IMAGE} → ${ev.file}`);
  }
}
main().catch((e) => { console.error(`!! STOP ${e?.message ?? e}`); process.exitCode = 1; });
