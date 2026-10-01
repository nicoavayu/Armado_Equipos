// The Production source anchor is supplied by the approved cutover handoff.
// This suite reads Git and local files only; it never queries a remote service.
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
const G1 = 'd2edf66d0';
// origin/main when Mi plan + PLAN READ + 0007 were integrated (G1 PR #167 and Android build 44 PR #168 included).
const BASE = '4a8c5bbe62fc340df9308b3e3b773a98d75b6cd1';
// Complete gateway graph deployed to the shadow tgw-sp-g1 and certified there (PLAN READ ON, Commerce OFF), 2026-10-01.
const SHADOW_CERTIFIED_DIGEST = '80f94685131c5fad93f7e0d8fa849ac9b3e33da36a6fb7c97d1bb8a711765486';
const FUNCTIONS = 'backend/torneos/supabase/functions';
const INDEX = `${FUNCTIONS}/torneos-gateway/index.ts`;
const git = (...args) => execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' });
const PLAN = `${FUNCTIONS}/torneos-gateway/plan-read.ts`;
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

test('integration: certified G1 graph stays byte-identical except the pinned plan-read composition', () => {
  const expected = buildFromCommit(git('rev-parse', G1).trim());
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
  assert.equal(withoutPlanComposition(fs.readFileSync(path.join(REPO_ROOT, INDEX), 'utf8')), git('show', `${G1}:${INDEX}`));
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
    'docs/torneos/TORNEOS-PLAN-INTEGRATION.md', 'docs/torneos/b04/b04-audit.json', 'docs/torneos/b04/TORNEOS-CALL-MAP.md',
    'scripts/torneos-frontend/commerce.test.mjs', 'scripts/torneos-frontend/foundation.test.mjs']);
  const prefixes = ['backend/torneos/season-scope-fix/', 'scripts/qa/plan-ux/', 'src/features/torneos/', 'src/__tests__/torneos'];
  for (const file of changed) assert.ok(allowed.has(file) || prefixes.some((p) => file.startsWith(p)), file);
  for (const file of changed) assert.deepEqual(secretFindings(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8')), [], `secret scan: ${file}`);
  assert.deepEqual(git('diff', '--name-only', BASE, '--', 'backend/torneos/supabase/migrations').trim().split('\n'),
    ['backend/torneos/supabase/migrations/00000000000007_season_entitlements_scope.sql'], 'only 0007 is new; 0000–0006 untouched');
  const before = JSON.parse(git('show', `${BASE}:package.json`));
  const after = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(typeof after.scripts['test:torneos:g1'], 'string');
  assert.deepEqual(after, before);
});
