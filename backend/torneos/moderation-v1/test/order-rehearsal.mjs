// Ordering rehearsal of 0022 next to 0020 (sponsors, origin/claude/torneos-premium-sponsors) and 0021 (account erasure,
// the other agent's in-progress file, copied read-only): both orders, each with a functional smoke and full rollbacks.
// Prints one JSON line per step (evidence).
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
const W = new URL('../../../../', import.meta.url).pathname.replace(/\/$/, '');
// Directory holding 0020.sql, 0020.rollback.sql, 0021.sql, 0021.rollback.sql (copies of the other branches' files).
const S = process.env.MODERATION_ORDER_DIR || process.argv[2];
if (!S) throw new Error('usage: node order-rehearsal.mjs <dir with 0020.sql 0020.rollback.sql 0021.sql 0021.rollback.sql>');
const L = await import(`${W}/backend/torneos/moderation-v1/test/lab.mjs`);
const { lit } = L.F;
const out = (step, data) => console.log(JSON.stringify({ step, ...data }));
const asPg = (label, text) => { const r = L.lab.sqlTry(text, { user: 'postgres' }); out(label, { ok: r.ok, error: r.error || undefined }); if (!r.ok) throw new Error(label); };
const file = (name) => fs.readFileSync(`${S}/${name}`, 'utf8');
const has = (q) => L.one(q) === 't';
const state = () => ({ s0020: has("select to_regclass('public.tournament_organization_sponsors') is not null"),
  s0021: has("select to_regprocedure('private.erase_tournament_account(uuid,uuid)') is not null"), s0022: L.applied() });

function smoke(label) {
  const w = L.world(`ord${label}`);
  const fan = L.F.identity('fan');
  const r = L.call(fan, 'report_tournament_content', `'team', ${lit(w.slug)}, null, ${lit(w.teamName)}, 'offensive', null, ${lit(randomUUID())}`);
  const handled = L.call(w.admin, 'handle_tournament_content_report', `${lit(r.reportId)}, 'resolved', 'neutralize_team_name', 'Ensayo de orden'`);
  const result = { report: r.reviewScope, handled: handled.status };
  if (state().s0021) {
    // The reporter deletes their account: 0021 erases it; the report stays, its reporter is the severed identity.
    const erased = JSON.parse(L.lab.sql(`select private.erase_tournament_account(${lit(fan.core)}, ${lit(randomUUID())})::text`, { user: 'postgres' }).trim().split('\n').pop());
    result.erasure = erased.outcome;
    result.reportKept = L.one(`select count(*) from public.tournament_content_reports where id = ${lit(r.reportId)}`) === '1';
  }
  out(`smoke ${label}`, result);
}

await L.prepare();
await L.toPre();
out('start', state());
// Order 1: 0020 → 0021 → 0022.
asPg('apply 0020', file('0020.sql'));
asPg('apply 0021', file('0021.sql'));
const a1 = await L.drive('apply-0022');
out('apply 0022 (driver) after 0020+0021', { verdict: a1.verdict, changedOutside: a1.changedOutside });
smoke('1');
const r1 = await L.drive('rollback-0022', { force: true });
out('rollback 0022 (forced)', { verdict: r1.verdict, changedOutside: r1.changedOutside });
asPg('rollback 0021', "SET torneos.account_erasure_rollback_force = 'DISCARD ERASURE LEDGER';\n" + file('0021.rollback.sql'));
asPg('rollback 0020', "SET torneos.sponsors_rollback_force = 'DISCARD SPONSOR ROWS';\n" + file('0020.rollback.sql'));
out('after order 1', state());
// Order 2: 0022 → 0020 → 0021.
const a2 = await L.drive('apply-0022');
out('apply 0022 (driver) first', { verdict: a2.verdict });
asPg('apply 0020 after 0022', file('0020.sql'));
asPg('apply 0021 after 0022', file('0021.sql'));
out('classify with 0020+0021 on top', { state: L.D.classify(await L.deps.catalog()).state });
smoke('2');
asPg('rollback 0021', "SET torneos.account_erasure_rollback_force = 'DISCARD ERASURE LEDGER';\n" + file('0021.rollback.sql'));
asPg('rollback 0020', "SET torneos.sponsors_rollback_force = 'DISCARD SPONSOR ROWS';\n" + file('0020.rollback.sql'));
const r2 = await L.drive('rollback-0022', { force: true });
out('rollback 0022 last (forced)', { verdict: r2.verdict, changedOutside: r2.changedOutside });
out('end', state());
