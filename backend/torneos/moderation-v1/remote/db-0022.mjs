#!/usr/bin/env node
// CONTENT MODERATION 0022 operator driver for the Torneos Production DB. PREPARED ONLY: it is unit-tested offline and
// rehearsed on the local lab (moderation-0022.test.mjs); it is never run against a remote without Nico's explicit GO.
// Same transport and discipline as sponsors-v1/remote/db-0020.mjs:
//   node backend/torneos/moderation-v1/remote/db-0022.mjs observe                                     (read only)
//   node backend/torneos/moderation-v1/remote/db-0022.mjs apply-0022    APPLY TORNEOS 0022 <ref> <sha12 of 0022>
//   node backend/torneos/moderation-v1/remote/db-0022.mjs rollback-0022 ROLLBACK TORNEOS 0022 <ref> <sha12 of its rollback>
//   node backend/torneos/moderation-v1/remote/db-0022.mjs rollback-0022 ROLLBACK TORNEOS 0022 <ref> <sha12> DISCARD MODERATION ROWS
//     (the only way to roll back while moderation rows exist: the file itself refuses otherwise)
// Platform moderation (the Arma2 operators; there is no admin UI — runbook in ../README.md):
//   node …/db-0022.mjs inbox [pending|open|under_review|resolved|dismissed]                         (read only)
//   node …/db-0022.mjs act <reportId> <under_review|resolved|dismissed> <action|none> <note …> ACT TORNEOS 0022 <ref> <reportId first 8>
// Transport = the certified OEC/CV1 one (installer postgres.<ref>, Session Pooler sa-east-1:5432, verify-full + Supabase
// CA, the installer password read from the macOS Keychain into memory only and redacted from every output). Every schema
// write is gated by the exact phrase, the file sha256, the exact observed state before (PRE_0022 → POST_0022 and back) and
// after, and "nothing else moved": every other function (body, ACL, owner, secdef flag, config), relation, trigger and
// policy of public / private / storage. The EXECUTE counts move by exactly the seven RPCs 0022 adds (authenticated +7,
// anon +0, service_role +0). Every body 0022 installs is pinned by md5 in POST_0022.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
export const REF = 'onzpwnqxnvlgsevivngf';
const file = (rel, sha256, from, to) => Object.freeze({ path: path.join(REPO, rel), rel, sha256, from, to, phase: '0022' });
export const FILES = Object.freeze({
  'apply-0022': file('backend/torneos/supabase/migrations/00000000000022_content_moderation.sql',
    'b4d3c41da9fb5d0915302bd458987106771aa486e3116263ba06914d71947c88', 'PRE_0022', 'POST_0022'),
  'rollback-0022': file('backend/torneos/moderation-v1/rollback/00000000000022_content_moderation.rollback.sql',
    '8e4dfb465be818af40d4f0b56f7cd18153ef64a94ca91c552cdb4e528c265b6d', 'POST_0022', 'PRE_0022'),
});
/** The session setting the rollback file honours to discard moderation rows (see its header). */
export const FORCE_WORDS = 'DISCARD MODERATION ROWS';
export const FORCE_SQL = `SET torneos.moderation_rollback_force = '${FORCE_WORDS}';\n`;
/** The body of the existing lever 0022 calls (pinned by 0022 itself too). */
export const PLATFORM_REMOVE_MD5 = '57a9a930ffd7d1735b0bfc5351d87e60';
const NAMES = Object.freeze(['report', 'list', 'handle', 'block', 'unblock', 'mute', 'mutes', 'platform_list', 'platform_handle',
  'is_manager', 'engine', 'page_hold', 'application_block', 'delivery_mute']);
const nothing = Object.freeze(Object.fromEntries(NAMES.map((name) => [name, null])));
/** md5(prosrc): PRE_0022 = nothing of 0022; POST_0022 = the exact text between the dollar quotes of the migration. */
export const BODIES = Object.freeze({
  PRE_0022: nothing,
  POST_0022: Object.freeze({
    report: 'de43212520ac1e1c11b5fe6957d0c478', list: 'b75c91343477164b087144c86b3ae2de', handle: '85900ecf6ee4f6da6da0907732d7e5aa',
    block: 'f20b09eaca8a5cd040ad944e8919ebd9', unblock: '9807c2d9763ac53f589932d2bdf54a26', mute: '70060fef7f26093d602b1146ce814800',
    mutes: '94aafc2f5fa97c4e176254f8e0e6450b', platform_list: 'e0dccbbe73efc0efb48d8d52737a749f', platform_handle: 'f399e27854dc0bd407ebb39452a14a24',
    is_manager: '819e0f37099b8a4fc7d42675e370afc7', engine: 'b4ed1651aa285f712532ef1bc5cd4455', page_hold: '8257d944cc68b9017d0cc3d3a73689d2',
    application_block: '65f58a1c6bd129c905c1e1a20818bef7', delivery_mute: 'fabd4046b577ddbbdb09714b4322f310',
  }),
});
const rpc = Object.freeze({ secdef: true, config: ['search_path=""'], authenticated: true, anon: false, service_role: false });
const closed = Object.freeze({ secdef: true, config: ['search_path=""'], authenticated: false, anon: false, service_role: false });
export const ACL = Object.freeze({
  PRE_0022: nothing,
  POST_0022: Object.freeze({
    report: rpc, list: rpc, handle: rpc, block: rpc, unblock: rpc, mute: rpc, mutes: rpc,
    platform_list: closed, platform_handle: closed, is_manager: closed, engine: closed, page_hold: closed,
    application_block: closed, delivery_mute: closed,
  }),
});
const table = Object.freeze({ rls: true, api_grants: false, policies: 0 });
export const TABLES = Object.freeze({
  PRE_0022: Object.freeze({ 'public.tournament_content_reports': null, 'public.tournament_content_report_events': null,
    'public.tournament_communication_mutes': null, 'public.tournament_applicant_blocks': null, 'private.tournament_moderation_holds': null }),
  POST_0022: Object.freeze({ 'public.tournament_content_reports': table, 'public.tournament_content_report_events': table,
    'public.tournament_communication_mutes': table, 'public.tournament_applicant_blocks': table, 'private.tournament_moderation_holds': table }),
});
export const TRIGGERS = Object.freeze({
  PRE_0022: Object.freeze({ tournament_public_pages_moderation_hold: null, tournament_team_applications_moderation_block: null,
    tournament_announcement_deliveries_moderation_mute: null }),
  POST_0022: Object.freeze({ tournament_public_pages_moderation_hold: 'O', tournament_team_applications_moderation_block: 'O',
    tournament_announcement_deliveries_moderation_mute: 'O' }),
});
/** authenticated EXECUTE delta of apply (rollback: the opposite); anon and service_role never move. */
export const RPC_DELTA = 7;
export const STATUSES = Object.freeze(['under_review', 'resolved', 'dismissed']);
export const ACTIONS = Object.freeze(['neutralize_team_name', 'remove_team_shield', 'neutralize_player_name', 'take_down_tournament',
  'take_down_organization', 'release_tournament_hold', 'clear_organization_logo', 'clear_tournament_logo', 'revoke_announcement',
  'block_applicant']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

/** PRE_0022 | POST_0022 | DRIFT, with every reason. Pure. */
export function classify(catalog) {
  if (!catalog || catalog.torneos_tables !== true) return { state: 'DRIFT', failures: ['not_the_torneos_db'] };
  const failures = [];
  if (catalog.prerequisites?.connected !== true) failures.push('connected_0009_missing');
  if (catalog.prerequisites?.season_lifecycle !== true) failures.push('season_lifecycle_0018_missing');
  if (catalog.prerequisites?.platform_remove !== PLATFORM_REMOVE_MD5) failures.push(`platform_remove ${catalog.prerequisites?.platform_remove}`);
  const state = Object.entries(BODIES).find(([, pin]) => same(pin, catalog.bodies))?.[0];
  if (!state) return { state: 'DRIFT', failures: [...failures, `bodies ${JSON.stringify(catalog.bodies)}`] };
  for (const name of NAMES) {
    if (!same(catalog.acl?.[name] ?? null, ACL[state][name])) failures.push(`acl.${name} ${JSON.stringify(catalog.acl?.[name])}`);
  }
  if (!same(catalog.tables ?? null, TABLES[state])) failures.push(`tables ${JSON.stringify(catalog.tables)}`);
  if (!same(catalog.triggers ?? null, TRIGGERS[state])) failures.push(`triggers ${JSON.stringify(catalog.triggers)}`);
  if (state === 'PRE_0022' && catalog.rows != null) failures.push('rows_without_tables');
  if (state === 'POST_0022' && !(Number.isInteger(catalog.rows) && catalog.rows >= 0)) failures.push(`rows ${catalog.rows}`);
  if (failures.length) return { state: 'DRIFT', failures };
  return { state, failures: [] };
}

/** What 0022 must not touch: the names of the sections that changed (counts: exactly +7 authenticated on apply, −7 on rollback). */
export function changedOutside(before, after, direction) {
  const moved = ['kept_fn', 'kept_relations', 'kept_triggers', 'kept_policies'].filter((key) => !same(before[key], after[key]));
  const delta = direction === 'apply' ? RPC_DELTA : -RPC_DELTA;
  if (after.counts?.authenticated !== (before.counts?.authenticated ?? NaN) + delta || after.counts?.anon !== before.counts?.anon
    || after.counts?.service_role !== before.counts?.service_role) moved.push('counts');
  return moved;
}

export function phraseFor(mode, { force = false, reportId = null } = {}) {
  if (mode === 'act') {
    if (!UUID.test(reportId || '')) throw new Error('REPORT_ID_REQUIRED');
    return `ACT TORNEOS 0022 ${REF} ${reportId.slice(0, 8)}`;
  }
  const f = FILES[mode];
  if (!f) throw new Error('usage: observe | inbox [status] | apply-0022 | rollback-0022 <phrase> | act <reportId> <status> <action|none> <note> <phrase>');
  if (force && mode !== 'rollback-0022') throw new Error('FORCE_ONLY_FOR_ROLLBACK');
  return `${mode.split('-')[0].toUpperCase()} TORNEOS ${f.phase} ${REF} ${f.sha256.slice(0, 12)}${force ? ` ${FORCE_WORDS}` : ''}`;
}

/** The platform decision of `act`, validated before any I/O: { reportId, status, action, note, sql }. Pure. */
export function parseAct(args) {
  const [reportId, status, action, ...rest] = args;
  if (!UUID.test(reportId || '')) throw new Error('REPORT_ID_REQUIRED');
  if (!STATUSES.includes(status)) throw new Error(`STATUS_INVALID: ${STATUSES.join(' | ')}`);
  if (action !== 'none' && !ACTIONS.includes(action)) throw new Error(`ACTION_INVALID: none | ${ACTIONS.join(' | ')}`);
  const phrase = phraseFor('act', { reportId }).split(' ');
  const tail = rest.slice(-phrase.length);
  if (!same(tail, phrase)) throw new Error(`PHRASE_REQUIRED: ${phrase.join(' ')}`);
  const note = rest.slice(0, rest.length - phrase.length).join(' ').trim();
  if ((status !== 'under_review' || action !== 'none') && (note.length < 3 || note.length > 500)) throw new Error('NOTE_REQUIRED (3..500)');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note)) throw new Error('NOTE_INVALID');
  const sql = `select public.platform_handle_tournament_content_report(${lit(reportId)}::uuid, ${lit(status)}, ${action === 'none' ? 'null' : lit(action)}, ${note ? lit(note) : 'null'})::text;`;
  return { reportId, status, action: action === 'none' ? null : action, note, sql };
}

const INBOX_STATUSES = Object.freeze(['pending', 'open', 'under_review', 'resolved', 'dismissed']);
export function inboxSql(status = 'pending') {
  if (!INBOX_STATUSES.includes(status)) throw new Error(`STATUS_INVALID: ${INBOX_STATUSES.join(' | ')}`);
  return `select public.platform_list_tournament_content_reports(${lit(status)}, 200)::text;`;
}
const lastLine = (stdout) => String(stdout ?? '').trim().split('\n').filter(Boolean).pop() ?? '';

/** The whole operator decision, with injected I/O (tested offline with fakes and on the local lab as the installer). */
export async function run(mode, args, { readFile = fs.readFileSync, catalog, applySql, readOnlySql, writeSql }) {
  const out = { mode, target: REF };
  if (mode === 'observe') {
    out.catalog = await catalog();
    out.verdict = classify(out.catalog);
    return out;
  }
  if (mode === 'inbox' || mode === 'act') {
    const query = mode === 'inbox' ? inboxSql(args[0] ?? 'pending') : null;
    const decision = mode === 'act' ? parseAct(args) : null;
    const state = classify(await catalog());
    if (state.state !== 'POST_0022') throw new Error(`STATE_${state.state} ${state.failures.join('; ')}`);
    const r = mode === 'inbox' ? await readOnlySql(query) : await writeSql(`\\set ON_ERROR_STOP 1\nBEGIN;\n${decision.sql}\nCOMMIT;\n`);
    if (r.code !== 0) throw new Error(`${mode.toUpperCase()}_FAILED ${r.code} ${r.stderr_tail ?? ''}`);
    const parsed = JSON.parse(lastLine(r.stdout) || 'null');
    if (mode === 'inbox') {
      out.reports = parsed ?? [];
      out.pending = out.reports.length;
      out.oldestHours = out.reports.reduce((max, item) => Math.max(max, Number(item.ageHours) || 0), 0);
      out.verdict = 'INBOX_READ';
    } else {
      out.decision = { reportId: decision.reportId, status: decision.status, action: decision.action };
      out.result = parsed;
      out.verdict = parsed?.reportId === decision.reportId ? 'ACT_DONE' : 'ACT_FAILED';
    }
    return out;
  }
  const force = mode === 'rollback-0022' && args.join(' ') === phraseFor(mode, { force: true });
  const phrase = phraseFor(mode);
  if (!force && args.join(' ') !== phrase) throw new Error(`PHRASE_REQUIRED: ${phrase}`);
  const f = FILES[mode];
  const bytes = readFile(f.path);
  if (sha256(bytes) !== f.sha256) throw new Error('FILE_HASH_MISMATCH');
  const before = await catalog();
  const pre = classify(before);
  if (pre.state === 'DRIFT' || pre.state !== f.from) throw new Error(`PRE_STATE_${pre.state} ${pre.failures.join('; ')}`);
  // Reports, blocks, mutes and holds are user/moderation data: without the force phrase a rollback with rows is refused.
  if (mode === 'rollback-0022' && before.rows > 0 && !force) throw new Error(`ROLLBACK_REFUSED ${before.rows} moderation rows (force phrase required)`);
  out.forced = force;
  out.psql = await applySql(`${force ? FORCE_SQL : ''}${bytes.toString('utf8')}`);
  const after = await catalog();
  const post = classify(after);
  const moved = changedOutside(before, after, mode.startsWith('apply') ? 'apply' : 'rollback');
  out.before = pre.state; out.after = post.state; out.changedOutside = moved;
  if (post.failures.length) out.failures = post.failures;
  const ok = out.psql.code === 0 && post.state === f.to && !moved.length;
  out.verdict = `${mode.toUpperCase().replace('-', '_')}_${ok ? 'DONE' : 'FAILED'}`;
  return out;
}

async function realDeps() {
  const infra = path.join(REPO, 'backend/torneos/infra');
  const C = await import(path.join(infra, 'torneos-officialization-error-v1/oec-remote-contract.mjs'));
  const CV1 = await import(path.join(infra, 'torneos-competition-v1/competition-remote.mjs'));
  const { runPsqlProbe } = await import(path.join(infra, 'torneos-payments-test/payments-db.mjs'));
  const { applySql } = await import(path.join(infra, 'torneos-gateway-auth/psql-gateway-auth.mjs'));
  const { systemKeychain } = await import(path.join(infra, 'torneos-gateway-auth/keychain-gateway-auth.mjs'));
  if (C.TORNEOS_REF !== REF) throw new Error('REF_MISMATCH');
  let password = null;
  const secret = () => password ?? (password = systemKeychain().dataplane.read());
  const redact = (s) => { let t = String(s ?? ''); if (password) t = t.split(password).join('[REDACTED]'); return t; };
  const sql = fs.readFileSync(path.join(HERE, 'sql-catalog-0022.sql'), 'utf8').trim();
  return {
    redact,
    wipe: () => { password = null; },
    catalog: async () => {
      const r = await runPsqlProbe({ script: C.readOnlyScript(sql), env: CV1.readOnlyEnv({ password: secret() }), redact });
      if (r.code !== 0) throw new Error(`CATALOG_READ_FAILED ${r.code} ${r.stderr_tail}`);
      const line = lastLine(r.stdout);
      if (!line) throw new Error(`CATALOG_READ_EMPTY ${r.stderr_tail ?? ''}`);
      return JSON.parse(line);
    },
    applySql: (text) => applySql({ sql: text, env: CV1.installerEnv({ password: secret(), app: 'arma2-torneos-moderation-0022' }), redact }),
    readOnlySql: (text) => runPsqlProbe({ script: C.readOnlyScript(text.replace(/;\s*$/, '')), env: CV1.readOnlyEnv({ password: secret() }), redact }),
    writeSql: (text) => runPsqlProbe({ script: text, env: CV1.installerEnv({ password: secret(), app: 'arma2-torneos-moderation-act' }), redact }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);
  const output = { at: new Date().toISOString(), transport: 'psql aws-0-sa-east-1.pooler.supabase.com:5432 verify-full' };
  let deps = null;
  try {
    deps = await realDeps();
    Object.assign(output, await run(mode, args, deps));
  } catch (error) {
    output.error = (deps?.redact ?? String)(error?.message ?? error).slice(0, 600);
  }
  deps?.wipe();
  process.stdout.write(`${JSON.stringify(output, null, 1)}\n`);
  process.exit(output.error || /FAILED/.test(output.verdict || '') ? 1 : 0);
}
