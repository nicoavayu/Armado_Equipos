// COMMERCE-PRODUCTION — the exact source set deployed to the Deno Deploy app `torneos-payments`: the static module graph
// of torneos-payments-production/index.ts relative to the functions root. Same rules as the certified walkers
// (gateway-bundle.mjs / payments-bundle.mjs): relative imports only inside the functions root, the one bare specifier
// npm:postgres@3.4.7, no filesystem / subprocess / KV / FFI API, nothing secret-shaped. One deliberate difference: the
// production entrypoint registers the reconciliation cron (Deno.cron), and only the entrypoint may. Files must equal HEAD
// (a dirty production payments source refuses the deploy).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import { ENTRYPOINT, FUNCTIONS_DIR, REPO_ROOT, sha256 } from './production-contract.mjs';

const ALLOWED_BARE = new Set(['npm:postgres@3.4.7']);
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+"([^"]+)"|(?:^|\n)\s*import\s+"([^"]+)"/g;
const FORBIDDEN_API = /\bDeno\.(readFile|readTextFile|open|run|Command|openKv|dlopen)\b|EdgeRuntime|process\.env/;
const CRON_API = /\bDeno\.cron\b/;
const ASSET_PATH = /^(torneos-payments-production\/[a-z0-9-]+\.ts|torneos-payments\/[a-z0-9-]+\.ts|_shared\/[A-Za-z]+\.ts)$/;
// The TEST runtime's files the production graph may import: pure helpers only, never its config, handler or remote-test.
export const SHARED_TEST_FILES = Object.freeze(['torneos-payments/hmac.ts', 'torneos-payments/lab-fetch.ts', 'torneos-payments/remote-hosts.ts',
  'torneos-payments/webhook-freshness.ts', 'torneos-payments/webhook-signature.ts']);

export function productionModuleGraph(root = FUNCTIONS_DIR, entry = ENTRYPOINT) {
  const seen = new Set(); const bare = new Set(); const queue = [entry];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep)) throw new Error(`graph_escapes_root ${rel}`);
    seen.add(rel);
    const src = fs.readFileSync(abs, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith('./') || spec.startsWith('../')) queue.push(path.relative(root, path.resolve(path.dirname(abs), spec)));
      else if (ALLOWED_BARE.has(spec)) bare.add(spec);
      else throw new Error(`graph_bare_specifier_refused ${spec}`);
    }
    if (FORBIDDEN_API.test(src)) throw new Error(`graph_forbidden_api ${rel}`);
    if (CRON_API.test(src) && rel !== entry) throw new Error(`graph_cron_outside_entrypoint ${rel}`);
  }
  const files = [...seen].sort();
  const testFiles = files.filter((f) => f.startsWith('torneos-payments/'));
  for (const f of testFiles) if (!SHARED_TEST_FILES.includes(f)) throw new Error(`graph_reaches_test_runtime ${f}`);
  return { files, bare: [...bare].sort() };
}

export function assertProductionAssets(assets) {
  const keys = Object.keys(assets ?? {});
  if (!keys.includes(ENTRYPOINT)) throw new Error('deno_assets_no_entrypoint');
  for (const k of keys) {
    if (!ASSET_PATH.test(k)) throw new Error(`deno_asset_outside_graph ${k}`);
    if (k.startsWith('torneos-payments/') && !SHARED_TEST_FILES.includes(k)) throw new Error(`deno_asset_test_runtime ${k}`);
    const a = assets[k];
    if (a.kind !== 'file' || a.encoding !== 'utf-8' || typeof a.content !== 'string') throw new Error('deno_asset_shape');
    if (G.secretFindings(a.content).length) throw new Error(`deno_asset_secret_shaped ${k}`);
  }
  return true;
}

export function buildProductionAssets({ root = FUNCTIONS_DIR, repoRoot = REPO_ROOT, requireClean = true } = {}) {
  const { files, bare } = productionModuleGraph(root);
  if (bare.join(',') !== 'npm:postgres@3.4.7') throw new Error(`payments_bare_specifiers ${bare.join(',')}`);
  const assets = {}; const manifest = [];
  for (const rel of files) {
    const content = fs.readFileSync(path.join(root, rel), 'utf8');
    assets[rel] = { kind: 'file', encoding: 'utf-8', content };
    manifest.push({ path: rel, sha256: sha256(content), bytes: Buffer.byteLength(content) });
  }
  assertProductionAssets(assets);
  let head = null; let dirty = [];
  try {
    head = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    dirty = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain', '--', ...files.map((f) => path.relative(repoRoot, path.join(root, f)))], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch { head = null; }
  if (requireClean && (!head || dirty.length)) throw new Error('payments_production_sources_not_committed');
  return { assets, manifest, bare, head, digest: sha256(JSON.stringify(manifest)) };
}
