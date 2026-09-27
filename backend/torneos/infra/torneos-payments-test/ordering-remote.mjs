#!/usr/bin/env node
// PAYMENTS TEST — the hosted ordering run (session command `ordering`) as a standalone read-only step, for a session
// process started before the runner fix (payments-db.mjs runPsqlProbe keeps the whole stdout). Same script, same
// evaluation, same evidence name and verdicts as the session:
//   • P2 / S2 come from the latest pt-05-qa-fixtures evidence of this run (QA_FIXTURES_ISOLATED), the pooler host from
//     the latest pt-01-preflight evidence (PAYMENTS_PREFLIGHT_PASS); no argument.
//   • The payments login password is read from Keychain into this process; psql gets it as PGPASSWORD only.
//   • Every permutation ends in ROLLBACK; the purchase lookup before and after must be byte-identical.
import fs from 'node:fs';
import path from 'node:path';
import * as C from './payments-test-contract.mjs';
import * as D from './payments-db.mjs';
import { systemKeychain } from './keychain-payments-test.mjs';

const DIR = path.join(C.EVIDENCE_DIR, 'remote');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const latest = (prefix, verdict) => {
  const name = fs.readdirSync(DIR).filter((n) => n.startsWith(`${prefix}-`)).sort().at(-1);
  const doc = name ? JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8')) : null;
  if (!doc || doc.verdict !== verdict) throw new Error(`${prefix}_not_${verdict}`);
  return { name, doc };
};

const fx = latest('pt-05-qa-fixtures', 'QA_FIXTURES_ISOLATED').doc.fixtures;
const host = latest('pt-01-preflight', 'PAYMENTS_PREFLIGHT_PASS').doc.torneos.pooler.hosts.find((h) => D.POOLER_HOST_PATTERN.test(h));
if (!host || !/^[0-9a-f-]{36}$/.test(fx?.P2 ?? '')) throw new Error('inputs_missing');
const password = systemKeychain().dbPassword.read();
const known = [password];
const redact = (t) => String(t).split(password).join('«REDACTED»');
const res = await D.runPsqlProbe({ script: D.orderingScript({ purchaseId: fx.P2 }), env: D.paymentLoginEnv({ host, port: 6543, password }), redact });
const ev = D.evaluateOrdering(res.stdout);
const pass = ev.pass && res.code === 0;
const body = { tool: 'backend/torneos/infra/torneos-payments-test/ordering-remote.mjs', generated_at: new Date().toISOString(), verdict: pass ? 'REMOTE_ORDERING_PASS' : 'REMOTE_ORDERING_FAILED',
  purchase: fx.P2, season: fx.S2, host, port: 6543, psql_exit: res.code, stdout_bytes: Buffer.byteLength(res.stdout), stderr_tail: res.stderr_tail || null,
  whoami: ev.whoami, initial: ev.initial, after_identical_to_initial: ev.after_identical_to_initial, cases: ev.cases, failures: ev.failures,
  note: 'every permutation ran in its own transaction ending in ROLLBACK; synthetic provider payment ids are 99-prefixed 20-digit values that never reached Mercado Pago; supersedes the first run, whose runner cut the first 64 KB of output' };
const text = `${JSON.stringify(body, null, 1)}\n`;
if (C.secretFindings(text, known).length) { process.stdout.write('EVIDENCE_REJECTED_SECRET_LEAK\n'); process.exit(3); }
const name = `pt-06-ordering-rollback-${stamp}.json`;
fs.writeFileSync(path.join(DIR, name), text, { mode: 0o600, flag: 'wx' });
process.stdout.write(`EVIDENCE ${name} ${C.sha256(text)}\nordering: ${ev.cases.filter((c) => c.pass).length}/${ev.cases.length} stdout=${body.stdout_bytes}B identical=${ev.after_identical_to_initial}\n`
  + `historical restored-then-old-dispute: ${JSON.stringify(ev.cases.find((c) => c.label === 'restored-then-old-dispute')?.steps.at(-1)?.result ?? null)}\n${ev.failures.length ? `FAIL ${ev.failures.join(' ')}\n` : ''}${body.verdict}\n`);
process.exit(pass ? 0 : 1);
