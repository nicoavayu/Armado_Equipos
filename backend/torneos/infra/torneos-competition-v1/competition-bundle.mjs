// COMPETITION-V1 REMOTE — the two gateway sources W2 can deploy, built exactly like gateway-remote's buildAssets():
//   candidate  the static module graph of torneos-gateway/index.ts at HEAD (working tree must equal HEAD for it);
//   previous   the same graph extracted from git at the deployed commit (bea307a3), never from the working tree —
//              its manifest digest must equal the gateway-remote deploy pin (723c5d39…) or nothing is deployed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildAssets, moduleGraph } from '../torneos-gateway-remote/gateway-bundle.mjs';
import { assertAssets, REPO_ROOT, sha256 } from '../torneos-gateway-remote/remote-contract.mjs';
import { CURRENT } from './competition-remote-contract.mjs';

const FUNCTIONS_REL = 'backend/torneos/supabase/functions';

export function buildCandidate({ requireClean = true } = {}) {
  const b = buildAssets({ requireClean });
  return { assets: b.assets, manifest: b.manifest, head: b.head, digest: b.digest, bare: b.bare };
}

/** Extracts <commit>:backend/torneos/supabase/functions into a temp dir (git archive), then builds the graph there. */
export function buildFromCommit(commit = CURRENT.head, { repoRoot = REPO_ROOT } = {}) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('commit_must_be_a_full_sha');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-cv1-previous-'));
  try {
    const tar = execFileSync('git', ['-C', repoRoot, 'archive', '--format=tar', commit, FUNCTIONS_REL], { maxBuffer: 64 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', dir], { input: tar });
    const root = path.join(dir, FUNCTIONS_REL);
    const { files, bare } = moduleGraph(root);
    const assets = {}; const manifest = [];
    for (const rel of files) {
      const content = fs.readFileSync(path.join(root, rel), 'utf8');
      assets[rel] = { kind: 'file', encoding: 'utf-8', content };
      manifest.push({ path: rel, sha256: sha256(content), bytes: Buffer.byteLength(content) });
    }
    assertAssets(assets);
    return { assets, manifest, head: commit, digest: sha256(JSON.stringify(manifest)), bare, root: null };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

export const buildPrevious = () => buildFromCommit(CURRENT.head);

/** Extracts a commit's function tree to a caller-owned dir (for loading an older gateway in tests). */
export function extractTree(commit, dest, { repoRoot = REPO_ROOT } = {}) {
  const tar = execFileSync('git', ['-C', repoRoot, 'archive', '--format=tar', commit, FUNCTIONS_REL], { maxBuffer: 64 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', dest], { input: tar });
  return path.join(dest, FUNCTIONS_REL);
}
