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
const UX = '33eee1686347b24ee15295a35dde19588832b97f';
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

test('integration: only G1 entrypoint and the exact plan-read module differ from pinned main', () => {
  assert.deepEqual(git('diff', '--name-only', MAIN, '--', FUNCTIONS).trim().split('\n'), [INDEX, PLAN]);
  assert.equal(withoutPlanComposition(fs.readFileSync(path.join(REPO_ROOT, INDEX), 'utf8')), git('show', `${G1}:${INDEX}`));
});

test('integration: changes after approved UX are confined to plan-read, its guards and evidence; npm contract unchanged', () => {
  const changed = new Set([...git('diff', '--name-only', UX).split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean));
  const allowed = new Set([INDEX, PLAN, 'backend/torneos/plan-read/plan-read.test.mjs',
    'backend/torneos/perf-v2/g1-main-integration.test.mjs', 'docs/torneos/TORNEOS-PLAN-READ-LOCAL-READY.md',
    'docs/torneos/TORNEOS-PLAN-READ-SHADOW-CERTIFICATION.md',
    'src/__tests__/torneosStagingV1Gate.test.jsx', 'src/features/torneos/TorneosFeatureGate.jsx',
    'src/features/torneos/foundation/config.js', 'src/features/torneos/foundation/torneosClient.js',
    'src/features/torneos/stagingV1/StagingV1TorneosApp.jsx', 'src/features/torneos/stagingV1/stagingV1Features.js',
    'src/features/torneos/stagingV1/stagingV1WorkspaceService.js']);
  for (const file of changed) assert.ok(allowed.has(file) || file.startsWith('docs/torneos/plan-read-evidence/'), file);
  for (const file of changed) assert.deepEqual(secretFindings(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8')), [], `secret scan: ${file}`);
  const before = JSON.parse(git('show', `${MAIN}:package.json`));
  const after = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(typeof after.scripts['test:torneos:g1'], 'string');
  delete after.scripts['test:torneos:g1'];
  assert.deepEqual(after, before);
});
