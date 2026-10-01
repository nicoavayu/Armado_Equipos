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
const FUNCTIONS = 'backend/torneos/supabase/functions';
const INDEX = `${FUNCTIONS}/torneos-gateway/index.ts`;
const git = (...args) => execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' });

test('integration: the complete reachable gateway graph equals certified G1 byte for byte', () => {
  const expected = buildFromCommit(git('rev-parse', G1).trim());
  const root = path.join(REPO_ROOT, FUNCTIONS);
  const { files, bare } = moduleGraph(root);
  const manifest = files.map((file) => {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    return { path: file, sha256: sha256(content), bytes: Buffer.byteLength(content) };
  });
  assert.deepEqual(manifest, expected.manifest);
  assert.deepEqual(bare, expected.bare);
  assert.equal(sha256(JSON.stringify(manifest)), expected.digest);
});

test('integration: only the G1 entrypoint differs from current main in the complete functions tree', () => {
  assert.deepEqual(git('diff', '--name-only', MAIN, '--', FUNCTIONS).trim().split('\n'), [INDEX]);
  assert.equal(fs.readFileSync(path.join(REPO_ROOT, INDEX), 'utf8'), git('show', `${G1}:${INDEX}`));
});

test('integration: repository changes are confined to gateway G1, its tests, one npm command and the review evidence', () => {
  const changed = new Set([...git('diff', '--name-only', MAIN).split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean));
  const allowed = new Set([INDEX, 'package.json', 'backend/torneos/perf-v2/g1-parallel-checks.test.mjs',
    'backend/torneos/perf-v2/g1-main-integration.test.mjs']);
  for (const file of changed) assert.ok(allowed.has(file) || file.startsWith('docs/torneos/perf/g1-main-integration/'), file);
  for (const file of changed) assert.deepEqual(secretFindings(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8')), [], `secret scan: ${file}`);
  const before = JSON.parse(git('show', `${MAIN}:package.json`));
  const after = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(typeof after.scripts['test:torneos:g1'], 'string');
  delete after.scripts['test:torneos:g1'];
  assert.deepEqual(after, before);
});
