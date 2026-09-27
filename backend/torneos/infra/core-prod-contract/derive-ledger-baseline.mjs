#!/usr/bin/env node
// INFRA-0.5 — derives the pinned Core PRODUCTION ledger baseline from the last read-only capture
// of Production that exists locally (never from the network). Offline and deterministic.
//
//   node derive-ledger-baseline.mjs <INVENTORY-EVIDENCE.json>   → writes pins/production-ledger-baseline.json
//   node derive-ledger-baseline.mjs <INVENTORY-EVIDENCE.json> --check  → exit 0 iff the pinned file is reproduced
//
// Source: step37-final-window-r5-20260911-B71wJo/inventory/INVENTORY-EVIDENCE.json — the
// PRODUCTION_BEFORE_V3 capture taken READ ONLY (BEGIN READ ONLY, transaction_read_only=on) on
// 2026-09-11T20:40:55Z through the session pooler as postgres.rcyuuoaqfwcembdajcss. Its sha256 is
// pinned below: another file is refused. Only per-row DIGESTS leave this script (version, name,
// count, md5, bytes, null flags) — never the statements text. The digest is the exact expression the
// read-only preflight evaluates server-side (prod-contract.mjs LEDGER_ALL_ROWS_SQL):
//   md5(array_to_string(statements, chr(30))), octet_length(…), cardinality(…), IS NULL flags.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CAPTURE_SHA256 = 'd00faa708ab6e6659882d897511bc60930b1872e230112b07ba8bd9aadd5162d';
export const CAPTURE_LABEL = 'step37-final-window-r5-20260911-B71wJo/inventory/INVENTORY-EVIDENCE.json';
export const BASELINE_FILE = path.join(HERE, 'pins/production-ledger-baseline.json');
const RS = String.fromCharCode(30);
const md5 = (t) => crypto.createHash('md5').update(t, 'utf8').digest('hex');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** One ledger row → the digest row the preflight SQL returns for it. */
export function digestRow(r) {
  const st = r.statements;
  if (st !== null && !Array.isArray(st)) throw new Error(`statements_not_array_${r.version}`);
  if (Array.isArray(st) && st.some((s) => typeof s !== 'string')) throw new Error(`statements_null_element_${r.version}`); // array_to_string would skip it
  const joined = st === null ? null : st.join(RS);
  return {
    version: r.version,
    name: r.name ?? null,
    statements_is_null: st === null,
    statements_count: st === null ? 0 : st.length,
    statements_digest: joined === null ? '' : md5(joined),
    statements_bytes: joined === null ? 0 : Buffer.byteLength(joined, 'utf8'),
    created_by_is_null: r.created_by === null,
    idempotency_key_is_null: r.idempotency_key === null,
    rollback_is_null: r.rollback === null,
  };
}
/** Byte order ("C" collation), the order the preflight SQL uses. */
export const byVersionC = (a, b) => (Buffer.compare(Buffer.from(a.version), Buffer.from(b.version)));

export function deriveBaseline(captureBytes) {
  const sha = sha256(captureBytes);
  if (sha !== CAPTURE_SHA256) throw new Error(`capture_sha256_mismatch_${sha}`);
  const doc = JSON.parse(captureBytes.toString('utf8'));
  const cap = doc.capture;
  if (cap?.kind !== 'PRODUCTION_BEFORE_V3' || cap?.projectRef !== 'rcyuuoaqfwcembdajcss') throw new Error('capture_not_production_before_v3');
  if (cap.sessionContext?.transaction_read_only !== 'on') throw new Error('capture_not_read_only');
  const rows = cap.fingerprint.ledger.map(digestRow).sort(byVersionC);
  const versions = rows.map((r) => r.version);
  if (new Set(versions).size !== versions.length) throw new Error('duplicate_versions');
  return {
    kind: 'CORE_PRODUCTION_LEDGER_BASELINE',
    project: 'rcyuuoaqfwcembdajcss',
    source: { file: CAPTURE_LABEL, sha256: CAPTURE_SHA256, captured_utc: cap.capturedUtc, capture_kind: cap.kind, read_only: true, catalog_sha256: cap.catalogSha256 },
    digest_expression: 'md5(array_to_string(statements, chr(30))) · octet_length · cardinality · IS NULL flags, ordered by version COLLATE "C"',
    totals: { rows: rows.length, min_version: versions[0], max_version: versions[versions.length - 1], created_by_set: rows.filter((r) => !r.created_by_is_null).length, idempotency_key_set: rows.filter((r) => !r.idempotency_key_is_null).length, rollback_set: rows.filter((r) => !r.rollback_is_null).length, statements_null: rows.filter((r) => r.statements_is_null).length },
    rows,
  };
}

export const serialize = (baseline) => `${JSON.stringify(baseline, null, 1)}\n`;

function main() {
  const [src, flag] = process.argv.slice(2);
  if (!src) { process.stderr.write('usage: derive-ledger-baseline.mjs <INVENTORY-EVIDENCE.json> [--check]\n'); process.exit(2); }
  const text = serialize(deriveBaseline(fs.readFileSync(src)));
  if (flag === '--check') {
    const same = fs.readFileSync(BASELINE_FILE, 'utf8') === text;
    process.stdout.write(`${same ? 'BASELINE_REPRODUCED' : 'BASELINE_DIFFERS'} ${sha256(text)}\n`);
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(BASELINE_FILE, text);
  process.stdout.write(`BASELINE_WRITTEN ${sha256(text)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
