// The Production source anchor is supplied by the approved cutover handoff.
// This suite reads Git and local files only; it never queries a remote service.
// Clone-clean: it needs only objects reachable from origin (MAIN, BASE) and versioned files. The certified
// G1 commit itself is never read from Git: its graph is the versioned source manifest, pinned by digest here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildFromCommit } from '../infra/torneos-competition-v1/competition-bundle.mjs';
import { moduleGraph } from '../infra/torneos-gateway-remote/gateway-bundle.mjs';
import { REPO_ROOT, sha256 } from '../infra/torneos-gateway-remote/remote-contract.mjs';
import { secretFindings } from '../infra/torneos-gateway-auth/gateway-auth-contract.mjs';

const MAIN = '46479c6470a47a43dd702f3ccf098fb8ee73b314';
// Certified G1 (Cloud Run torneos-gateway-00001-7lw). Recorded, never resolved: the object is not on origin.
const G1 = 'd2edf66d0043d4534148c8d18693c6bb4900264a';
const G1_MANIFEST_FILE = 'docs/torneos/perf/g1-main-integration/source-manifest.json';
const G1_DIGEST = 'cfe5cd02e5de9703c7b2634ccea196070f3e188f9d859754f299adb0e020ccd2';
// origin/main when Mi plan + PLAN READ + 0007 were integrated (G1 PR #167 and Android build 44 PR #168 included).
const BASE = '4a8c5bbe62fc340df9308b3e3b773a98d75b6cd1';
// Complete gateway graph deployed to the shadow tgw-sp-g1 and certified there (PLAN READ ON, Commerce OFF), 2026-10-01.
const SHADOW_CERTIFIED_DIGEST = '80f94685131c5fad93f7e0d8fa849ac9b3e33da36a6fb7c97d1bb8a711765486';
const FUNCTIONS = 'backend/torneos/supabase/functions';
const INDEX = `${FUNCTIONS}/torneos-gateway/index.ts`;
const git = (...args) => execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' });
const PLAN = `${FUNCTIONS}/torneos-gateway/plan-read.ts`;
// The versioned G1 manifest, accepted only if it still hashes to the pinned digest.
function certifiedG1() {
  const recorded = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, G1_MANIFEST_FILE), 'utf8'));
  assert.equal(recorded.sourceCommit, G1);
  assert.equal(recorded.manifestDigest, G1_DIGEST);
  assert.equal(sha256(JSON.stringify(recorded.manifest)), G1_DIGEST, 'versioned G1 manifest was edited');
  assert.deepEqual(recorded.bare, ['npm:jose@6.2.12', 'npm:postgres@3.4.7']);
  return { manifest: recorded.manifest, bare: recorded.bare, digest: G1_DIGEST };
}
// Reverse only the reviewed composition delta. Any handler/concurrency/security edit still fails.
function withoutPlanComposition(source) {
  for (const [added, previous] of [
    ['import { withPlanRead, PlanReadConfigError } from "./plan-read.ts"\n', ''],
    ['  const rpcAllowlist = withPlanRead(effectiveRpcAllowlist(baseAllowlist, commerce), env)\n', ''],
    ['publicGate: new PublicGate(), rpcAllowlist }', 'publicGate: new PublicGate(), rpcAllowlist: effectiveRpcAllowlist(baseAllowlist, commerce) }'],
    [' || error instanceof PlanReadConfigError', ''],
  ]) {
    assert.equal(source.split(added).length, 2, `exactly one reviewed delta: ${added}`);
    source = source.replace(added, previous);
  }
  return source;
}

test('integration: the integration base on origin carries exactly the certified G1 graph (versioned manifest)', () => {
  const certified = certifiedG1();
  const base = buildFromCommit(BASE);
  assert.deepEqual(base.manifest, certified.manifest);
  assert.deepEqual(base.bare, certified.bare);
  assert.equal(base.digest, G1_DIGEST);
});

test('integration: certified G1 graph stays byte-identical except the pinned plan-read composition', () => {
  const expected = certifiedG1();
  const root = path.join(REPO_ROOT, FUNCTIONS);
  const { files, bare } = moduleGraph(root);
  const manifest = files.map((file) => {
    let content = fs.readFileSync(path.join(root, file), 'utf8');
    if (file === 'torneos-gateway/index.ts') content = withoutPlanComposition(content);
    return { path: file, sha256: sha256(content), bytes: Buffer.byteLength(content) };
  });
  const plan = manifest.find(m => m.path === 'torneos-gateway/plan-read.ts');
  assert.deepEqual(plan, { path: 'torneos-gateway/plan-read.ts', sha256: '9221a3cbba2231a473ac75e8351ea391cd234f01bd2c7d77629bde94ab9fd555', bytes: 734 });
  const preserved = manifest.filter(m => m !== plan);
  assert.deepEqual(preserved, expected.manifest);
  assert.deepEqual(bare, expected.bare);
  assert.equal(sha256(JSON.stringify(preserved)), expected.digest);
});

test('integration: the complete gateway graph equals the candidate certified on the shadow', () => {
  const root = path.join(REPO_ROOT, FUNCTIONS);
  const { files } = moduleGraph(root);
  const manifest = files.map((file) => {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    return { path: file, sha256: sha256(content), bytes: Buffer.byteLength(content) };
  });
  assert.equal(manifest.length, 18);
  assert.equal(sha256(JSON.stringify(manifest)), SHADOW_CERTIFIED_DIGEST);
});

test('integration: only G1 entrypoint and the exact plan-read module differ from pinned main', () => {
  assert.deepEqual(git('diff', '--name-only', MAIN, '--', FUNCTIONS).trim().split('\n'), [INDEX, PLAN]);
  const g1Index = withoutPlanComposition(fs.readFileSync(path.join(REPO_ROOT, INDEX), 'utf8'));
  const certifiedIndex = certifiedG1().manifest.find((m) => m.path === 'torneos-gateway/index.ts');
  assert.deepEqual({ sha256: sha256(g1Index), bytes: Buffer.byteLength(g1Index) }, { sha256: certifiedIndex.sha256, bytes: certifiedIndex.bytes });
  assert.equal(g1Index, git('show', `${BASE}:${INDEX}`));
});

test('integration: changes after the integration base are confined to Mi plan, PLAN READ, 0007 and their guards; npm contract unchanged', () => {
  const changed = new Set([...git('diff', '--name-only', BASE).split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean));
  const allowed = new Set([INDEX, PLAN, 'backend/torneos/plan-read/plan-read.test.mjs',
    'backend/torneos/perf-v2/g1-main-integration.test.mjs',
    'backend/torneos/supabase/migrations/00000000000007_season_entitlements_scope.sql',
    'backend/torneos/infra/torneos-officialization-error-v1/oec-remote-contract.mjs',
    'backend/torneos/infra/torneos-officialization-error-v1/oec-remote.test.mjs',
    'integration/torneos-core-contracts/exposure.test.mjs',
    'integration/torneos-core-contracts/deno-runtime-hardening.test.mjs',
    'integration/torneos-core-contracts/remote-test-enablement.test.mjs',
    'backend/torneos/infra/torneos-gateway-remote/gateway-remote.test.mjs',
    'backend/torneos/infra/torneos-competition-v1/competition-remote.test.mjs',
    'docs/torneos/TORNEOS-PLAN-INTEGRATION.md', 'docs/torneos/b04/b04-audit.json', 'docs/torneos/b04/TORNEOS-CALL-MAP.md',
    'scripts/torneos-frontend/commerce.test.mjs', 'scripts/torneos-frontend/foundation.test.mjs']);
  const prefixes = ['backend/torneos/season-scope-fix/', 'backend/torneos/social-v1/', 'backend/torneos/infra/torneos-cloudrun-readonly/',
    'scripts/qa/plan-ux/', 'src/features/torneos/', 'src/__tests__/torneos'];
  for (const file of changed) assert.ok(allowed.has(file) || prefixes.some((p) => file.startsWith(p)), file);
  // Secret scan of what this integration introduces: whole new files, added lines of files that existed at the base
  // (some pre-existing guards carry deliberate leak-shaped fixtures that must stay refused there).
  const atBase = new Set(git('ls-tree', '-r', '--name-only', BASE).split('\n'));
  for (const file of changed) {
    const introduced = atBase.has(file)
      ? git('diff', '--unified=0', BASE, '--', file).split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)).join('\n')
      : fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    assert.deepEqual(secretFindings(introduced), [], `secret scan: ${file}`);
  }
  assert.deepEqual(git('diff', '--name-only', BASE, '--', 'backend/torneos/supabase/migrations').trim().split('\n'),
    ['backend/torneos/supabase/migrations/00000000000007_season_entitlements_scope.sql'], 'only 0007 is new; 0000–0006 untouched');
  const before = JSON.parse(git('show', `${BASE}:package.json`));
  const after = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(typeof after.scripts['test:torneos:g1'], 'string');
  assert.deepEqual(after, before);
});
