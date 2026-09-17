#!/usr/bin/env node
// Phase 3B — R3 (Core contract v1 + v1.1 on CORE STAGING) as DATA. Offline and pure: no socket,
// no credential, no file written. Everything the R3 runner, the rollback runner, the offline
// tests and summarize.py agree on lives here, hash-pinned:
//
//   • the two migrations (bytes pinned) and their CLI-faithful ledger rows: `statements` is
//     exactly `parser.SplitAndTrim(<file>)` of the Supabase CLI (cli_parser.mjs, the port
//     validated against the CLI's own fixtures and against real CLI-written rows);
//   • the SQL actually executed per migration: the file bytes + the ledger INSERT inside the
//     SAME transaction (strategy A, decision 2026-09-15): the CLI's `db push` writes
//     INSERT INTO supabase_migrations.schema_migrations(version, name, statements) in the same
//     batch as the statements; `/database/query` does not, so the runner does it explicitly;
//   • the hosted ledger shape the apply requires (observed on the platform 2026-08-07; the
//     read-only preflight must observe the same shape on Core staging or STOP);
//   • the read-only probes (state, ledger, ACL) and the expectations they are compared to;
//   • the signed-probe expectations of the deployed Edge Function (exact status + body);
//   • the pinned ROLLBACK SQL (contracts/core-contract-rollback.sql).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { splitAndTrim } from './cli_parser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CONTRACTS_DIR = path.join(HERE, '../contracts');

export const PROD_REF = 'rcyuuoaqfwcembdajcss';
export const CORE_REF = 'hhyvmhgpapyuzjgxfnqv';
export const FUNCTION_SLUG = 'torneos-core-contract';
export const SECRET_NAME = 'TORNEOS_CONTRACT_SERVICE_SECRET';
export const KEYCHAIN = { service: 'arma2-torneos-nonprod-core', account: 'contract-secret' };
export const CLI_PARSER_SHA256 = '1ab11b26450ac384a56bd0e50532bdbfe73ae0fa28905629980e8e7a113e65dd';

export class ContractDataError extends Error {}
function fail(code) { throw new ContractDataError(code); }
export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const RS = String.fromCharCode(30);
const md5 = (text) => crypto.createHash('md5').update(text, 'utf8').digest('hex');

// ─────────────────────────── the two migrations (bytes pinned) ───────────────────────────
// `probe` answers "is this version's EFFECT installed?" as one read-only SELECT (no `;`).
// `ledger_digest` = md5(array_to_string(statements, chr(30))) of the CLI-faithful row; the
// ledger probe and the rollback SQL compare against it, so a row R3 did not write is never
// confused with ours.
export const MIGRATIONS = [
  {
    version: '20260914120000', name: 'torneos_core_contract_v1',
    file: 'supabase/migrations/20260914120000_torneos_core_contract_v1.sql',
    sha256: '2967ae6f67e36877c4931cb7821535eab10c5b7312026846f619b14fb045672c',
    owns_transaction: true, // the file is its own BEGIN … COMMIT
    statements_count: 22, ledger_digest: '09ad7d261523fa1c2bb6e203a1624467', ledger_bytes: 16688,
    probe: "select to_regprocedure('public.torneos_contract_execute(text,text,jsonb)') is not null and to_regclass('app_private.torneos_contract_nonces') is not null and to_regclass('app_private.torneos_contract_rate_events') is not null and to_regprocedure('app_private.torneos_contract_email(text)') is not null and to_regprocedure('app_private.torneos_contract_url(text)') is not null and to_regprocedure('app_private.torneos_contract_visible_player(uuid)') is not null and to_regprocedure('app_private.torneos_contract_importable_team(uuid,uuid)') is not null as installed",
  },
  {
    version: '20260915120000', name: 'torneos_core_contract_v1_1_session',
    file: 'supabase/migrations/20260915120000_torneos_core_contract_v1_1_session.sql',
    sha256: '5256413839ad0abe9c9533a675461cc6589fd720e6b2bede3bc8d201a75ce422',
    owns_transaction: false, // wrapped by the runner in BEGIN … COMMIT
    statements_count: 3, ledger_digest: 'b424cc66022e7ab721e8070d0b05cdc7', ledger_bytes: 12088,
    probe: "select position('p_operation = ''session''' in coalesce(pg_get_functiondef(to_regprocedure('public.torneos_contract_execute(text,text,jsonb)')), '')) > 0 as installed",
  },
];
export const VERSIONS = MIGRATIONS.map((m) => m.version);

/** Reads and pins one migration; returns its bytes and CLI-faithful ledger row. */
export function loadMigration(repo, m) {
  if (typeof repo !== 'string' || !path.isAbsolute(repo)) fail('repo_must_be_absolute');
  const bytes = fs.readFileSync(path.join(repo, m.file));
  const sha = sha256(bytes);
  if (sha !== m.sha256) fail(`core_contract_migration_hash_mismatch__${path.basename(m.file)}__ABORT`);
  const text = bytes.toString('utf8');
  if (text.includes(PROD_REF)) fail('production_ref_in_migration__ABORT');
  const row = ledgerRow(bytes, m);
  return { text, bytes, sha256: sha, row };
}

/** The row `supabase db push` would write for this file: (version, name, statements). */
export function ledgerRow(bytes, m) {
  const statements = splitAndTrim(bytes);
  const joined = statements.join(RS);
  const row = { version: m.version, name: m.name, statements, statements_count: statements.length, statements_digest: md5(joined), statements_bytes: Buffer.byteLength(joined, 'utf8') };
  if (row.statements_count !== m.statements_count) fail(`ledger_statements_count_${m.version}_${row.statements_count}__ABORT`);
  if (row.statements_digest !== m.ledger_digest) fail(`ledger_digest_${m.version}_${row.statements_digest}__ABORT`);
  if (row.statements_bytes !== m.ledger_bytes) fail(`ledger_bytes_${m.version}_${row.statements_bytes}__ABORT`);
  return row;
}

// ─────────────────────────── executed SQL: file + ledger INSERT, one transaction ───────────────────────────
const TX_CONTROL = /^(begin|start\s+transaction|commit|end|rollback|abort|savepoint|release|prepare\s+transaction)\b/i;
const stripLeadingComments = (s) => s.replace(/^(?:\s*--[^\n]*\n|\s*\n)+/, '').trim();
const DOLLAR_TAG = '$r3stmt$';
const quoteVersion = (v) => { if (!/^[0-9]{14}$/.test(v)) fail('version_malformed'); return `'${v}'`; };
const quoteName = (n) => { if (!/^[a-z0-9_]{1,120}$/.test(n)) fail('name_malformed'); return `'${n}'`; };

/** Plain INSERT (never ON CONFLICT: a pre-existing row must abort the whole transaction). */
export function ledgerInsertSql(row) {
  if (!Array.isArray(row.statements) || row.statements.length === 0) fail('ledger_statements_empty');
  for (const s of row.statements) if (s.includes(DOLLAR_TAG)) fail('ledger_statement_contains_dollar_tag__ABORT');
  const items = row.statements.map((s) => `${DOLLAR_TAG}${s}${DOLLAR_TAG}`).join(',\n');
  return `insert into supabase_migrations.schema_migrations (version, name, statements)\nvalues (${quoteVersion(row.version)}, ${quoteName(row.name)}, array[\n${items}\n]::text[]);`;
}

/**
 * The exact SQL the runner sends to /database/query for one migration. Deterministic; its
 * sha256 is pinned in APPLY_SQL_SHA256 and recorded in the evidence.
 *   owns_transaction: the file's final `commit;` is replaced by `<ledger insert>; commit;` so the
 *   ledger row commits with the objects (or nothing commits). Otherwise the file is wrapped.
 */
export function renderApplySql(text, m, row) {
  const stmts = row.statements;
  const body = stmts.map(stripLeadingComments);
  if (text.includes(DOLLAR_TAG)) fail('migration_contains_dollar_tag__ABORT');
  const insert = ledgerInsertSql(row);
  if (m.owns_transaction) {
    if (!/^begin$/i.test(body[0])) fail('migration_must_open_with_begin__ABORT');
    if (!/^commit$/i.test(body[body.length - 1])) fail('migration_must_close_with_commit__ABORT');
    for (const s of body.slice(1, -1)) if (TX_CONTROL.test(s)) fail('migration_has_inner_transaction_control__ABORT');
    const tail = /commit;[ \t]*\n?$/i.exec(text);
    if (!tail) fail('migration_tail_not_commit__ABORT');
    const head = text.slice(0, tail.index);
    if (/^\s*commit\s*;/im.test(head)) fail('migration_has_second_commit__ABORT');
    return `${head}${insert}\ncommit;\n`;
  }
  for (const s of body) if (TX_CONTROL.test(s)) fail('migration_has_transaction_control_but_not_owner__ABORT');
  return `begin;\n${text.replace(/\s+$/, '')}\n${insert}\ncommit;\n`;
}

/** Renders all apply documents from the repo; pins are verified on the way. */
export function renderAll(repo) {
  return MIGRATIONS.map((m) => {
    const loaded = loadMigration(repo, m);
    const apply_sql = renderApplySql(loaded.text, m, loaded.row);
    const apply_sql_sha256 = sha256(apply_sql);
    if (apply_sql_sha256 !== APPLY_SQL_SHA256[m.version]) fail(`apply_sql_hash_mismatch_${m.version}_${apply_sql_sha256}__ABORT`);
    return { ...m, migration_sha256: loaded.sha256, row: loaded.row, apply_sql, apply_sql_sha256, apply_sql_bytes: Buffer.byteLength(apply_sql, 'utf8') };
  });
}
// sha256 of the rendered apply SQL per version (checked by tests and by the runner before the PAT).
export const APPLY_SQL_SHA256 = {
  '20260914120000': '3d3e2845987ccdfd74b77ace51195865234066bb5828280fb0c8114969b84485',
  '20260915120000': '859fa7a30dee4a03376a662ab74427927c6a8b8a404556abdd3bfa59e5e5b78c',
};

// ─────────────────────────── hosted ledger shape (observed 2026-08-07, Production audit 02_ledger.json) ───────────────────────────
// The CLI creates (version text PK) + name text + statements text[]; the hosted platform adds
// created_by text, idempotency_key text UNIQUE (NULLS DISTINCT) and rollback text[]. The 3-column
// INSERT leaves the extras NULL, exactly like every CLI-written row. Any other shape → STOP.
export const LEDGER_SHAPE_EXPECTED = {
  relation: { kind: 'r', has_rls: false },
  columns: [
    { ordinal: 1, name: 'version', type: 'text', not_null: true, default: null },
    { ordinal: 2, name: 'statements', type: 'text[]', not_null: false, default: null },
    { ordinal: 3, name: 'name', type: 'text', not_null: false, default: null },
    { ordinal: 4, name: 'created_by', type: 'text', not_null: false, default: null },
    { ordinal: 5, name: 'idempotency_key', type: 'text', not_null: false, default: null },
    { ordinal: 6, name: 'rollback', type: 'text[]', not_null: false, default: null },
  ],
  constraints: [
    { name: 'schema_migrations_idempotency_key_key', kind: 'u', definition: 'UNIQUE (idempotency_key)' },
    { name: 'schema_migrations_pkey', kind: 'p', definition: 'PRIMARY KEY (version)' },
  ],
  indexes: [
    { name: 'schema_migrations_idempotency_key_key', is_primary: false, is_unique: true, is_valid: true, nulls_not_distinct: false },
    { name: 'schema_migrations_pkey', is_primary: true, is_unique: true, is_valid: true, nulls_not_distinct: false },
  ],
};
export function ledgerShapeDiff(observed) {
  const diffs = [];
  if (!observed || typeof observed !== 'object') return ['shape_missing'];
  if (observed.relation?.kind !== 'r') diffs.push(`relation.kind=${observed.relation?.kind}`);
  if (observed.relation?.has_rls !== false) diffs.push(`relation.has_rls=${observed.relation?.has_rls}`);
  const cols = Array.isArray(observed.columns) ? observed.columns : [];
  const exp = LEDGER_SHAPE_EXPECTED.columns;
  if (cols.length !== exp.length) diffs.push(`columns=${cols.length} (expected ${exp.length})`);
  for (let i = 0; i < exp.length; i += 1) {
    const c = cols[i]; const e = exp[i];
    if (!c) { diffs.push(`column ${e.ordinal} ${e.name} missing`); continue; }
    for (const k of ['ordinal', 'name', 'type', 'not_null', 'default']) if ((c[k] ?? null) !== e[k]) diffs.push(`column ${e.name}.${k}=${JSON.stringify(c[k] ?? null)} (expected ${JSON.stringify(e[k])})`);
    if ((c.identity ?? '') !== '' || (c.generated ?? '') !== '') diffs.push(`column ${e.name} identity/generated`);
  }
  const cons = (Array.isArray(observed.constraints) ? observed.constraints : []).map((c) => `${c.name}|${c.kind}|${c.definition}`).sort();
  const consExp = LEDGER_SHAPE_EXPECTED.constraints.map((c) => `${c.name}|${c.kind}|${c.definition}`).sort();
  if (JSON.stringify(cons) !== JSON.stringify(consExp)) diffs.push(`constraints=${JSON.stringify(cons)}`);
  const idx = (Array.isArray(observed.indexes) ? observed.indexes : []).map((i) => `${i.name}|${i.is_primary}|${i.is_unique}|${i.is_valid}|${i.nulls_not_distinct}`).sort();
  const idxExp = LEDGER_SHAPE_EXPECTED.indexes.map((i) => `${i.name}|${i.is_primary}|${i.is_unique}|${i.is_valid}|${i.nulls_not_distinct}`).sort();
  if (JSON.stringify(idx) !== JSON.stringify(idxExp)) diffs.push(`indexes=${JSON.stringify(idx)}`);
  return diffs;
}

// ─────────────────────────── read-only probes (one SELECT each, no `;`) ───────────────────────────
// Every probe is scanned by mgmt.mjs's read-only guard before it is sent.
export const LEDGER_SHAPE_SQL = "select json_build_object('relation', (select json_build_object('kind', c.relkind::text, 'owner', pg_get_userbyid(c.relowner), 'has_rls', c.relrowsecurity) from pg_class c where c.oid = to_regclass('supabase_migrations.schema_migrations')), 'columns', coalesce((select json_agg(json_build_object('ordinal', a.attnum, 'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid), 'identity', a.attidentity::text, 'generated', a.attgenerated::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = to_regclass('supabase_migrations.schema_migrations') and a.attnum > 0 and not a.attisdropped), '[]'::json), 'constraints', coalesce((select json_agg(json_build_object('name', k.conname, 'kind', k.contype::text, 'definition', pg_get_constraintdef(k.oid)) order by k.conname) from pg_constraint k where k.conrelid = to_regclass('supabase_migrations.schema_migrations')), '[]'::json), 'indexes', coalesce((select json_agg(json_build_object('name', ic.relname, 'is_primary', i.indisprimary, 'is_unique', i.indisunique, 'is_valid', i.indisvalid, 'nulls_not_distinct', i.indnullsnotdistinct) order by ic.relname) from pg_index i join pg_class ic on ic.oid = i.indexrelid where i.indrelid = to_regclass('supabase_migrations.schema_migrations')), '[]'::json), 'totals', (select json_build_object('total_rows', count(*), 'max_version', max(version), 'min_version', min(version), 'rows_statements_null', count(*) filter (where statements is null), 'rows_created_by_set', count(*) filter (where created_by is not null), 'rows_idempotency_set', count(*) filter (where idempotency_key is not null), 'rows_rollback_set', count(*) filter (where rollback is not null)) from supabase_migrations.schema_migrations), 'standard_conforming_strings', current_setting('standard_conforming_strings')) as shape";

/** Per-row digests of the given versions (never the text): validates the splitter live and identifies R3's own rows. */
export function ledgerRowsSql(versions) {
  for (const v of versions) if (!/^[0-9]{14}$/.test(v)) fail('version_malformed');
  const list = versions.map((v) => `'${v}'`).join(',');
  return `select m.version, m.name, coalesce(cardinality(m.statements), 0) as statements_count, coalesce(md5(array_to_string(m.statements, chr(30))), '') as statements_digest, coalesce(octet_length(array_to_string(m.statements, chr(30))), 0) as statements_bytes, (m.created_by is null) as created_by_is_null, (m.idempotency_key is null) as idempotency_key_is_null, (m.rollback is null) as rollback_is_null from supabase_migrations.schema_migrations m where m.version in (${list}) order by m.version`;
}
export const LEDGER_ALL_VERSIONS_SQL = 'select version, name from supabase_migrations.schema_migrations order by version';
// The role /database/query writes with on the platform is `postgres`; the apply needs CREATE on the
// database (create schema if not exists checks the privilege even when the schema exists), CREATE on
// app_private and public, and INSERT/DELETE on the ledger. Verified read-only in the preflight.
export const WRITER_PRIVILEGES_SQL = "select json_build_object('writer', 'postgres', 'database', current_database(), 'database_owner', (select pg_get_userbyid(d.datdba) from pg_database d where d.datname = current_database()), 'database_create', has_database_privilege('postgres', current_database(), 'CREATE'), 'app_private_present', to_regnamespace('app_private') is not null, 'app_private_owner', (select pg_get_userbyid(n.nspowner) from pg_namespace n where n.nspname = 'app_private'), 'app_private_create', case when to_regnamespace('app_private') is null then null else has_schema_privilege('postgres', 'app_private', 'CREATE') end, 'public_create', has_schema_privilege('postgres', 'public', 'CREATE'), 'ledger_insert', has_table_privilege('postgres', 'supabase_migrations.schema_migrations', 'INSERT'), 'ledger_delete', has_table_privilege('postgres', 'supabase_migrations.schema_migrations', 'DELETE'), 'ledger_owner', (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = to_regclass('supabase_migrations.schema_migrations'))) as writer";
export function writerPrivilegeFailures(w) {
  if (!w || typeof w !== 'object') return ['writer_probe_missing'];
  const out = [];
  for (const k of ['database_create', 'public_create', 'ledger_insert', 'ledger_delete']) if (w[k] !== true) out.push(`${k}=${w[k]}`);
  if (w.app_private_present === true && w.app_private_create !== true) out.push(`app_private_create=${w.app_private_create}`);
  return out;
}

/** The 9 canonical rows of Core staging (R1, 2026-09-15). 7 were written CLI-shaped (statements =
 *  SplitAndTrim(file)) and the local files must reproduce their digests byte for byte (live validation
 *  of cli_parser.mjs); 2 are LEGACY single-blob rows (statements = ARRAY[<whole file>]) whose provenance
 *  was established from the operator's own session logs (diagnosis 2026-09-16, REPORT §8.6):
 *    20260803090000  applied 2026-08-10T03:24Z via execute_sql: the file's SQL + a manual bookkeeping
 *                    INSERT … ARRAY[$certified_migration$<file>$certified_migration$] (1 element);
 *    20260810160355  applied 2026-08-10T18:43Z via the Management API migrations endpoint (MCP
 *                    apply_migration, query = whole file → platform version 20260810184310), then
 *                    re-keyed to 20260810160355 at 19:00Z by a DO block that copied statements/name/
 *                    created_by/idempotency_key/rollback verbatim. The migrations endpoint fills
 *                    created_by, so this row is the ONLY one of the 9 with created_by set: observed
 *                    live by the read-only preflight of 2026-09-17T16:19:22Z (evidence
 *                    r3-preflight-failed-20260917T161922Z.json, sha256 35baf9208a7eb037d25e075bcc3b7bed
 *                    734a78800598d182f1cbd8fe7012f326: ledger_raw.rows created_by_is_null=false,
 *                    totals.rows_created_by_set=1). The value itself is never read (core-ledger only
 *                    projects the null flags).
 *  Each legacy row is pinned as an EXACT fingerprint (version, name, count, digest, bytes, null flags)
 *  plus the NAMED transformation of the local file that reproduces the blob; the null flags are pinned
 *  PER ROW from the remote observation, never inferred from the other row; nothing is tolerated by
 *  name or by count alone, and any change of a fingerprint — including a legacy row that suddenly
 *  reproduces the splitter — is a STOP. */
export const CLI_WRITTEN_VERSIONS = ['20260727090000', '20260727215106', '20260801090000', '20260802090000', '20260802120000', '20260803090000', '20260809232508', '20260810160355', '20260810215224'];
export const LEGACY_BLOB_TRANSFORMS = { file_verbatim: (text) => text };
export const LEGACY_LEDGER_ROWS = [
  { version: '20260803090000', name: 'tournament_social_studio', statements_count: 1, statements_digest: '32ca5266e223c9a15e1611a4ad412fd1', statements_bytes: 24321, created_by_is_null: true, idempotency_key_is_null: true, rollback_is_null: true, transform: 'file_verbatim', provenance: 'execute_sql 2026-08-10T03:24Z, manual bookkeeping INSERT with the whole file dollar-quoted' },
  { version: '20260810160355', name: 'tournament_entitlements_foundation', statements_count: 1, statements_digest: '90370d0b8c76cbcde3d413a9d46e29d9', statements_bytes: 41903, created_by_is_null: false, idempotency_key_is_null: true, rollback_is_null: true, transform: 'file_verbatim', provenance: 'Management API migrations endpoint (MCP apply_migration) 2026-08-10T18:43Z as 20260810184310 (fills created_by), re-keyed by DO block 19:00Z copying the row; created_by_is_null=false observed 2026-09-17T16:19Z (r3-preflight-failed-20260917T161922Z.json)' },
];
const LEGACY_BY_VERSION = new Map(LEGACY_LEDGER_ROWS.map((l) => [l.version, l]));
export const LEDGER_NULL_FLAGS = ['created_by_is_null', 'idempotency_key_is_null', 'rollback_is_null'];
for (const l of LEGACY_LEDGER_ROWS) if (!CLI_WRITTEN_VERSIONS.includes(l.version) || l.statements_count !== 1 || !LEGACY_BLOB_TRANSFORMS[l.transform] || LEDGER_NULL_FLAGS.some((k) => typeof l[k] !== 'boolean')) fail(`legacy_pin_invalid_${l.version}`);
export const EXPECTED_CLI_ROWS = { reproduced: CLI_WRITTEN_VERSIONS.length - LEGACY_LEDGER_ROWS.length, legacy: LEGACY_LEDGER_ROWS.length };
export function localLedgerDigests(repo, versions) {
  const dir = path.join(repo, 'supabase/migrations');
  const files = fs.readdirSync(dir);
  return versions.map((version) => {
    const file = files.filter((f) => f.startsWith(`${version}_`) && f.endsWith('.sql')).sort()[0];
    if (!file) return { version, file: null };
    const bytes = fs.readFileSync(path.join(dir, file));
    const statements = splitAndTrim(bytes);
    const joined = statements.join(RS);
    const row = { version, file, name: /^([0-9]+)_(.*)\.sql$/.exec(file)[2], statements_count: statements.length, statements_digest: md5(joined), statements_bytes: Buffer.byteLength(joined, 'utf8') };
    const legacy = LEGACY_BY_VERSION.get(version);
    if (legacy) { const blob = LEGACY_BLOB_TRANSFORMS[legacy.transform](bytes.toString('utf8')); row.legacy_blob = { transform: legacy.transform, statements_digest: md5(blob), statements_bytes: Buffer.byteLength(blob, 'utf8') }; }
    return row;
  });
}
/** Per row: a legacy version must equal its pinned fingerprint field by field; every other version must
 *  reproduce the local splitter. `expected` is the pinned fingerprint or the splitter row; `observed` the
 *  remote row. No wildcard, no tolerance by name or count alone. */
export function compareLedgerRows(remoteRows, localRows) {
  const byVersion = new Map((remoteRows ?? []).map((r) => [r.version, r]));
  return localRows.map((l) => {
    const r = byVersion.get(l.version);
    if (!r) return { version: l.version, remote: 'absent', match: false };
    if (!l.file) return { version: l.version, remote: 'present', local_file: null, match: false };
    const legacy = LEGACY_BY_VERSION.get(l.version);
    // null flags are compared as observed booleans only: a missing/non-boolean flag (older shape, text
    // 't'/'f') becomes null and never equals a pinned true OR false.
    const flag = (v) => (typeof v === 'boolean' ? v : null);
    const observed = { name: r.name, statements_count: Number(r.statements_count), statements_digest: r.statements_digest, statements_bytes: Number(r.statements_bytes), created_by_is_null: flag(r.created_by_is_null), idempotency_key_is_null: flag(r.idempotency_key_is_null), rollback_is_null: flag(r.rollback_is_null) };
    if (legacy) {
      const expected = { name: legacy.name, statements_count: legacy.statements_count, statements_digest: legacy.statements_digest, statements_bytes: legacy.statements_bytes, created_by_is_null: legacy.created_by_is_null, idempotency_key_is_null: legacy.idempotency_key_is_null, rollback_is_null: legacy.rollback_is_null };
      const blob_ok = l.legacy_blob && l.legacy_blob.statements_digest === legacy.statements_digest && l.legacy_blob.statements_bytes === legacy.statements_bytes;
      const diff = Object.keys(expected).filter((k) => expected[k] !== observed[k]);
      return { version: l.version, remote: 'present', legacy: true, transform: legacy.transform, local_blob_reproduces_pin: blob_ok === true, expected, observed, diff, match: diff.length === 0 && blob_ok === true };
    }
    const match = r.name === l.name && observed.statements_count === l.statements_count && observed.statements_digest === l.statements_digest && observed.statements_bytes === l.statements_bytes;
    return { version: l.version, remote: 'present', legacy: false, name_match: r.name === l.name, count: [observed.statements_count, l.statements_count], digest: [observed.statements_digest, l.statements_digest], bytes: [observed.statements_bytes, l.statements_bytes], match };
  });
}
/** Fail-closed verdict over compareLedgerRows: exactly the expected cardinalities, nothing else. */
export function cliRowsVerdict(cmp) {
  const reproduced = cmp.filter((c) => c.remote === 'present' && c.legacy === false && c.match).length;
  const legacy_matched = cmp.filter((c) => c.remote === 'present' && c.legacy === true && c.match).length;
  const mismatched = cmp.filter((c) => c.remote === 'present' && !c.match).length;
  const absent = cmp.filter((c) => c.remote === 'absent').length;
  const ok = cmp.length === CLI_WRITTEN_VERSIONS.length && reproduced === EXPECTED_CLI_ROWS.reproduced && legacy_matched === EXPECTED_CLI_ROWS.legacy && mismatched === 0 && absent === 0;
  return { reproduced, legacy_matched, mismatched, absent, expected: EXPECTED_CLI_ROWS, ok };
}

// Object inventory + ACL of the contract, one row per (object, role) with the expected value.
export const CONTRACT_OBJECTS = {
  functions: [
    { signature: 'public.torneos_contract_execute(text,text,jsonb)', security_definer: true, search_path_empty: true, execute: { anon: false, authenticated: false, service_role: true } },
    { signature: 'app_private.torneos_contract_email(text)', security_definer: false, search_path_empty: true, execute: { anon: false, authenticated: false, service_role: false } },
    { signature: 'app_private.torneos_contract_url(text)', security_definer: false, search_path_empty: true, execute: { anon: false, authenticated: false, service_role: false } },
    { signature: 'app_private.torneos_contract_visible_player(uuid)', security_definer: false, search_path_empty: true, execute: { anon: false, authenticated: false, service_role: false } },
    { signature: 'app_private.torneos_contract_importable_team(uuid,uuid)', security_definer: false, search_path_empty: true, execute: { anon: false, authenticated: false, service_role: false } },
  ],
  tables: [
    { name: 'app_private.torneos_contract_nonces', rls: true, privileges: { anon: false, authenticated: false, service_role: false }, indexes: ['torneos_contract_nonces_expiry', 'torneos_contract_nonces_pkey'] },
    { name: 'app_private.torneos_contract_rate_events', rls: true, privileges: { anon: false, authenticated: false, service_role: false }, indexes: ['torneos_contract_rate_events_actor', 'torneos_contract_rate_events_pkey'] },
  ],
};
export const ROLES = ['anon', 'authenticated', 'service_role'];
const fnRow = (sig) => `json_build_object('signature', '${sig}', 'present', to_regprocedure('${sig}') is not null, 'security_definer', (select p.prosecdef from pg_proc p where p.oid = to_regprocedure('${sig}')), 'search_path_empty', (select coalesce('search_path=""' = any (p.proconfig) or 'search_path=' = any (p.proconfig), false) from pg_proc p where p.oid = to_regprocedure('${sig}')), 'owner', (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = to_regprocedure('${sig}')), 'execute', json_build_object(${ROLES.map((r) => `'${r}', case when to_regprocedure('${sig}') is null then null else has_function_privilege('${r}', to_regprocedure('${sig}'), 'EXECUTE') end`).join(', ')}))`;
const tblPriv = (rel, r) => `case when to_regclass('${rel}') is null then null else (has_table_privilege('${r}', to_regclass('${rel}'), 'SELECT') or has_table_privilege('${r}', to_regclass('${rel}'), 'INSERT') or has_table_privilege('${r}', to_regclass('${rel}'), 'UPDATE') or has_table_privilege('${r}', to_regclass('${rel}'), 'DELETE')) end`;
const tblRow = (rel) => `json_build_object('name', '${rel}', 'present', to_regclass('${rel}') is not null, 'rls', (select c.relrowsecurity from pg_class c where c.oid = to_regclass('${rel}')), 'owner', (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = to_regclass('${rel}')), 'privileges', json_build_object(${ROLES.map((r) => `'${r}', ${tblPriv(rel, r)}`).join(', ')}), 'indexes', coalesce((select json_agg(ic.relname order by ic.relname) from pg_index i join pg_class ic on ic.oid = i.indexrelid where i.indrelid = to_regclass('${rel}')), '[]'::json))`;
const EXPECTED_FN_NAMES = CONTRACT_OBJECTS.functions.map((f) => `'${f.signature.replace(/\(.*$/, '')}'`).join(', ');
export const CONTRACT_ACL_SQL = `select json_build_object('functions', json_build_array(${CONTRACT_OBJECTS.functions.map((f) => fnRow(f.signature)).join(', ')}), 'tables', json_build_array(${CONTRACT_OBJECTS.tables.map((t) => tblRow(t.name)).join(', ')}), 'schema', json_build_object('app_private_present', to_regnamespace('app_private') is not null, 'usage', json_build_object(${ROLES.map((r) => `'${r}', case when to_regnamespace('app_private') is null then null else has_schema_privilege('${r}', 'app_private', 'USAGE') end`).join(', ')})), 'session_branch', position('p_operation = ''session''' in coalesce(pg_get_functiondef(to_regprocedure('public.torneos_contract_execute(text,text,jsonb)')), '')) > 0, 'stray_objects', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app_private') and p.proname like 'torneos\\_contract\\_%' and n.nspname || '.' || p.proname not in (${EXPECTED_FN_NAMES})), 'stray_relations', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app_private' and c.relkind in ('r', 'v', 'm', 'p', 'f') and c.relname like 'torneos\\_contract\\_%' and n.nspname || '.' || c.relname not in (${CONTRACT_OBJECTS.tables.map((t) => `'${t.name}'`).join(', ')}))) as acl`;

/** Compares one ACL probe answer with CONTRACT_OBJECTS; returns the list of failed expectations. */
export function aclFailures(acl) {
  const out = [];
  if (!acl || typeof acl !== 'object') return ['acl_missing'];
  const fns = new Map((acl.functions ?? []).map((f) => [f.signature, f]));
  for (const e of CONTRACT_OBJECTS.functions) {
    const f = fns.get(e.signature);
    if (!f || f.present !== true) { out.push(`${e.signature}: absent`); continue; }
    if (f.security_definer !== e.security_definer) out.push(`${e.signature}: security_definer=${f.security_definer}`);
    if (f.search_path_empty !== true) out.push(`${e.signature}: search_path not ''`);
    for (const r of ROLES) if (f.execute?.[r] !== e.execute[r]) out.push(`${e.signature}: ${r} execute=${f.execute?.[r]} (expected ${e.execute[r]})`);
  }
  const tbs = new Map((acl.tables ?? []).map((t) => [t.name, t]));
  for (const e of CONTRACT_OBJECTS.tables) {
    const t = tbs.get(e.name);
    if (!t || t.present !== true) { out.push(`${e.name}: absent`); continue; }
    if (t.rls !== e.rls) out.push(`${e.name}: rls=${t.rls}`);
    for (const r of ROLES) if (t.privileges?.[r] !== e.privileges[r]) out.push(`${e.name}: ${r} privileges=${t.privileges?.[r]} (expected ${e.privileges[r]})`);
    if (JSON.stringify([...(t.indexes ?? [])].sort()) !== JSON.stringify([...e.indexes].sort())) out.push(`${e.name}: indexes=${JSON.stringify(t.indexes)}`);
  }
  if (acl.schema?.app_private_present !== true) out.push('app_private: absent');
  if (acl.session_branch !== true) out.push('torneos_contract_execute: session branch (v1.1) missing');
  if (Number(acl.stray_objects) !== 0) out.push(`stray torneos_contract_* functions: ${acl.stray_objects}`);
  if (Number(acl.stray_relations) !== 0) out.push(`stray torneos_contract_* relations: ${acl.stray_relations}`);
  return out;
}
/** After a rollback: every contract object gone, app_private still there. */
export function rollbackResidue(acl) {
  const out = [];
  if (!acl || typeof acl !== 'object') return ['acl_missing'];
  for (const f of acl.functions ?? []) if (f.present !== false) out.push(`${f.signature}: still present`);
  for (const t of acl.tables ?? []) if (t.present !== false) out.push(`${t.name}: still present`);
  if (acl.schema?.app_private_present !== true) out.push('app_private: dropped (must never happen)');
  if (Number(acl.stray_objects) !== 0) out.push(`stray torneos_contract_* functions: ${acl.stray_objects}`);
  if (Number(acl.stray_relations) !== 0) out.push(`stray torneos_contract_* relations: ${acl.stray_relations}`);
  return out;
}

// ─────────────────────────── signed probe of the deployed endpoint (exact answers) ───────────────────────────
// `handleContractRequest` (supabase/functions/_shared/torneosCoreContract.ts) answers exactly these.
export const PROBE_EXPECT = [
  { name: 'unsigned POST /v1/session', status: 401, body: { error: 'SERVICE_AUTH_REQUIRED' } },
  { name: 'signed with a random key → rejected', status: 401, body: { error: 'SERVICE_AUTH_REQUIRED' } },
  { name: 'signed, X-Time 120 s old → rejected', status: 401, body: { error: 'SERVICE_AUTH_REQUIRED' } },
  { name: 'signed POST /v1/session, unknown session → Core verdict', status: 403, body: { error: 'FORBIDDEN' } },
  { name: 'replay of the previous request (same nonce) → consumed', status: 401, body: { error: 'REPLAY' } },
  { name: 'signed POST /v1/verified-email, unknown session → Core verdict (v1 route)', status: 403, body: { error: 'FORBIDDEN' } },
  { name: 'signed POST /v1/session, malformed schema → rejected after auth', status: 400, body: { error: 'INVALID_REQUEST' } },
  { name: 'signed POST /v1/nope → unknown route', status: 404, body: { error: 'NOT_FOUND' } },
  { name: 'GET /v1/session → method refused', status: 404, body: { error: 'NOT_FOUND' } },
];
export const PROBE_HEADERS_EXPECTED = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

// ─────────────────────────── rollback SQL (pinned file) ───────────────────────────
export const ROLLBACK_SQL_FILE = path.join(CONTRACTS_DIR, 'core-contract-rollback.sql');
export const ROLLBACK_SQL_SHA256 = '08edcd0e5eb8b614cbc79a1af770f914e26abb523bc90e849f2ceed2a72d6853';
export function loadRollbackSql() {
  const text = fs.readFileSync(ROLLBACK_SQL_FILE, 'utf8');
  const sha = sha256(text);
  if (sha !== ROLLBACK_SQL_SHA256) fail(`rollback_sql_hash_mismatch_${sha}__ABORT`);
  if (text.includes(PROD_REF)) fail('production_ref_in_rollback__ABORT');
  // The digests the rollback guards on must be the pinned ledger digests.
  for (const m of MIGRATIONS) if (!text.includes(`('${m.version}', '${m.ledger_digest}')`)) fail(`rollback_sql_missing_digest_${m.version}__ABORT`);
  const code = text.replace(/--[^\n]*/g, '');
  if (/\bcascade\b/i.test(code)) fail('rollback_sql_has_cascade__ABORT');
  if (/drop\s+schema/i.test(code)) fail('rollback_sql_drops_schema__ABORT');
  if (/\b(tournament_|auth\.users|auth\.sessions|cron\.|storage\.)/i.test(code)) fail('rollback_sql_touches_out_of_scope__ABORT');
  return { text, sha256: sha };
}
