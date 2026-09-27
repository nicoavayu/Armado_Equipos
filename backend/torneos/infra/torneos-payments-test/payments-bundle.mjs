// PAYMENTS TEST — the exact source set deployed to torneos-payments-test: the static module graph of
// torneos-payments/index.ts relative to the functions root (the repo-root package.json stays outside Deno's resolution
// scope). Reuses the certified graph walker (gateway-bundle.mjs moduleGraph: bare specifiers only npm:jose@6.2.12 /
// npm:postgres@3.4.7, no filesystem / subprocess / KV APIs). Files must equal HEAD: a dirty payments source refuses the deploy.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { moduleGraph } from '../torneos-gateway-remote/gateway-bundle.mjs';
import { FUNCTIONS_DIR, ENTRYPOINT, REPO_ROOT, sha256, assertAssets } from './payments-test-contract.mjs';

export function buildPaymentsAssets({ root = FUNCTIONS_DIR, repoRoot = REPO_ROOT, requireClean = true } = {}) {
  const { files, bare } = moduleGraph(root, ENTRYPOINT);
  if (bare.join(',') !== 'npm:postgres@3.4.7') throw new Error(`payments_bare_specifiers ${bare.join(',')}`);
  const assets = {}; const manifest = [];
  for (const rel of files) {
    const content = fs.readFileSync(path.join(root, rel), 'utf8');
    assets[rel] = { kind: 'file', encoding: 'utf-8', content };
    manifest.push({ path: rel, sha256: sha256(content), bytes: Buffer.byteLength(content) });
  }
  assertAssets(assets);
  let head = null; let dirty = [];
  try {
    head = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    dirty = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain', '--', ...files.map((f) => path.relative(repoRoot, path.join(root, f)))], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch { head = null; }
  if (requireClean && (!head || dirty.length)) throw new Error('payments_sources_not_committed');
  return { assets, manifest, bare, head, digest: sha256(JSON.stringify(manifest)) };
}
