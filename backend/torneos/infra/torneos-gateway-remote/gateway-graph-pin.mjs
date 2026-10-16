#!/usr/bin/env node
// GATEWAY SOURCE GRAPH PIN — pins/gateway-graph.json is the exact deployed module graph of torneos-gateway/index.ts:
// every file path, its sha256 and byte count, and the graph digest, all computed by gateway-bundle.mjs buildAssets()
// (the same manifest and digest a deploy labels as custom.bundle_digest). gateway-remote and competition-remote compare
// the working tree against it, so any gateway source change — a new file, a removed file, one changed byte — fails
// until this pin is regenerated on purpose and reviewed.
//   node backend/torneos/infra/torneos-gateway-remote/gateway-graph-pin.mjs           # check (exit 1 on drift)
//   node backend/torneos/infra/torneos-gateway-remote/gateway-graph-pin.mjs --write   # regenerate
import fs from 'node:fs';
import { buildAssets } from './gateway-bundle.mjs';

export const GRAPH_PIN_FILE = new URL('./pins/gateway-graph.json', import.meta.url);

export function readGraphPin() {
  return JSON.parse(fs.readFileSync(GRAPH_PIN_FILE, 'utf8'));
}

/** The pin document for the current working tree (never requires a clean tree: the tests compare it themselves). */
export function currentGraphPin() {
  const b = buildAssets({ requireClean: false });
  return {
    purpose: 'Exact torneos-gateway deployed module graph (paths + sha256 + bytes + digest), from gateway-bundle.mjs buildAssets()',
    generator: 'node backend/torneos/infra/torneos-gateway-remote/gateway-graph-pin.mjs --write',
    files: b.manifest.length,
    digest: b.digest,
    bare: b.bare,
    manifest: b.manifest,
  };
}

/** Differences between two pin documents: added / removed / changed paths, digest. Empty = identical. */
export function graphDrift(pin, now) {
  const a = new Map(pin.manifest.map((m) => [m.path, m])); const b = new Map(now.manifest.map((m) => [m.path, m]));
  const drift = [];
  for (const p of b.keys()) if (!a.has(p)) drift.push(`added ${p}`);
  for (const p of a.keys()) if (!b.has(p)) drift.push(`removed ${p}`);
  for (const [p, m] of b) if (a.has(p) && (a.get(p).sha256 !== m.sha256 || a.get(p).bytes !== m.bytes)) drift.push(`changed ${p}`);
  if (pin.digest !== now.digest) drift.push(`digest ${pin.digest} -> ${now.digest}`);
  if (pin.files !== now.files) drift.push(`files ${pin.files} -> ${now.files}`);
  if (JSON.stringify(pin.bare) !== JSON.stringify(now.bare)) drift.push(`bare ${pin.bare} -> ${now.bare}`);
  return drift;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const now = currentGraphPin();
  if (process.argv.includes('--write')) {
    fs.writeFileSync(GRAPH_PIN_FILE, `${JSON.stringify(now, null, 1)}\n`);
    console.log(`wrote ${now.files} files, digest ${now.digest}`);
  } else {
    const drift = graphDrift(readGraphPin(), now);
    console.log(drift.length ? drift.join('\n') : `PIN OK: ${now.files} files, digest ${now.digest}`);
    process.exitCode = drift.length ? 1 : 0;
  }
}
