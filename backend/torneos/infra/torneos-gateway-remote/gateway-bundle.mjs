// GATEWAY REMOTE — the exact source set deployed: the static module graph of torneos-gateway/index.ts, relative to the
// functions root (so the repo-root package.json is outside Deno's resolution scope). Files are read from the working
// tree, which must equal HEAD for them (a dirty gateway source refuses the deploy). Bare specifiers allowed: exactly
// npm:jose@6.2.12 and npm:postgres@3.4.7 (the certified pins).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { FUNCTIONS_DIR, ENTRYPOINT, REPO_ROOT, sha256, assertAssets } from './remote-contract.mjs';

const ALLOWED_BARE = new Set(['npm:jose@6.2.12', 'npm:postgres@3.4.7']);
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+"([^"]+)"|(?:^|\n)\s*import\s+"([^"]+)"/g;

export function moduleGraph(root = FUNCTIONS_DIR, entry = ENTRYPOINT) {
  const seen = new Set(); const bare = new Set(); const queue = [entry];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep)) throw new Error(`graph_escapes_root ${rel}`);
    seen.add(rel);
    if (!rel.endsWith('.ts')) continue;
    const src = fs.readFileSync(abs, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith('./') || spec.startsWith('../')) queue.push(path.relative(root, path.resolve(path.dirname(abs), spec)));
      else if (ALLOWED_BARE.has(spec)) bare.add(spec);
      else throw new Error(`graph_bare_specifier_refused ${spec}`);
    }
    if (/\bDeno\.(readFile|readTextFile|open|run|Command|openKv|cron|dlopen)\b|EdgeRuntime|process\.env/.test(src)) throw new Error(`graph_forbidden_api ${rel}`);
  }
  return { files: [...seen].sort(), bare: [...bare].sort() };
}

/** { assets, manifest } for POST /v2/apps/<app>/deploy. manifest = per-file sha256 + git blob state. */
export function buildAssets({ root = FUNCTIONS_DIR, repoRoot = REPO_ROOT, requireClean = true } = {}) {
  const { files, bare } = moduleGraph(root);
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
    const rels = files.map((f) => path.relative(repoRoot, path.join(root, f)));
    dirty = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain', '--', ...rels], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch { head = null; }
  if (requireClean && (!head || dirty.length)) throw new Error('gateway_sources_not_committed');
  const digest = sha256(JSON.stringify(manifest));
  return { assets, manifest, bare, head, digest };
}
