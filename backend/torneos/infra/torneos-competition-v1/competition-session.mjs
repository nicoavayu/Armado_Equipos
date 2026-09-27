#!/usr/bin/env node
// COMPETITION-V1 REMOTE — entry points.
//
//   node competition-session.mjs g1 [--no-ring]
//       READ-ONLY, non-interactive: DB state + catalog drift (psql READ ONLY, installer password from the Keychain),
//       bundle comparison (candidate at HEAD vs pin; previous rebuilt from git = deploy pin) and gateway probes
//       (public; with the Production k1 from the Keychain unless --no-ring). No Deno token here → the Deno leg is
//       reported as not observed (verdict G1_PASS_WITHOUT_DENO_OBSERVATION at best).
//
//   ARMA2_SESSION_DIR=<abs dir, 0700> bash run-competition-session.sh
//       operator session: the Deno Deploy organization token is typed on the tty (echo off) and piped here on stdin;
//       commands and plan phrases arrive one line at a time on the FIFO $ARMA2_SESSION_DIR/ctl:
//         g1 | db | deno | deno-audit | probes-previous | probes-candidate   read-only
//         w1 | w1-rollback | w2 | w2-rollback                           writes (PLAN id → exact phrase → one request)
//         quit
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as C from './competition-remote-contract.mjs';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import { makeRemote } from './competition-remote.mjs';
import { buildCandidate, buildPrevious } from './competition-bundle.mjs';
import { runPsqlProbe } from '../torneos-payments-test/payments-db.mjs';
import { applySql, assertPsqlPrerequisites } from '../torneos-gateway-auth/psql-gateway-auth.mjs';
import { systemKeychain } from '../torneos-gateway-auth/keychain-gateway-auth.mjs';
import { denoHttpsTransport } from '../torneos-gateway-remote/deno-client.mjs';
import { gatewayHttps } from '../torneos-gateway-remote/gateway-probe.mjs';
import { assertSessionDir, fifoLineReader } from '../torneos-gateway-remote/remote-session.mjs';

export function realDeps({ say, readLine = () => { throw new Error('no operator channel'); }, denoToken = null }) {
  const pre = assertPsqlPrerequisites();
  if (pre.length) throw new Error(`psql prerequisites: ${pre.join(',')}`);
  const kc = systemKeychain();
  return {
    say, readLine, denoToken, now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    psql: ({ script, env, redact }) => runPsqlProbe({ script, env, redact }),
    applySql: ({ sql, env, redact }) => applySql({ sql, env, redact }),
    keychain: { installerPassword: () => kc.dataplane.read(), ring: (slot, kid) => kc.ring.read(slot, kid) },
    denoTransport: denoHttpsTransport, gatewayTransport: gatewayHttps,
    buildCandidate: () => buildCandidate(), buildPrevious: () => buildPrevious(),
    evidenceDir: C.EVIDENCE_DIR, deployedPinFile: path.join(path.dirname(C.CANDIDATE_PIN_FILE), 'competition-v1-gateway-deploy.json'),
  };
}

export async function runCommand(remote, line) {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (rest.length) throw Object.assign(new Error('COMMAND_REFUSED'), { code: 'COMMAND_REFUSED' });
  switch (cmd) {
    case 'g1': return remote.g1();
    case 'db': { const d = await remote.dbObserve(); return { verdict: `DB_${d.state}`, failures: d.failures }; }
    case 'deno': { const d = await remote.denoObserve(); return { verdict: d.failures.length ? 'DENO_OBSERVE_FAILED' : 'DENO_OBSERVE_OK', current: d.current?.id, failures: d.failures }; }
    case 'deno-audit': { const a = await remote.denoAudit(); return { verdict: a.failures.length ? 'DENO_AUDIT_FAILED' : 'DENO_AUDIT_OK', failures: a.failures, runtime: a.runtime }; }
    case 'probes-previous': case 'probes-candidate': { const p = await remote.probes(cmd.slice(7)); return { verdict: p.pass ? 'PROBES_PASS' : 'PROBES_FAILED', passed: `${p.passed}/${p.total}`, failed: p.checks.filter((c) => !c.pass).map((c) => c.name) }; }
    case 'w1': return remote.w1();
    case 'w1-rollback': return remote.w1Rollback();
    case 'w2': return remote.w2();
    case 'w2-rollback': return remote.w2Rollback();
    default: throw Object.assign(new Error('COMMAND_UNKNOWN'), { code: 'COMMAND_UNKNOWN' });
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'g1') {
    if (argv.slice(1).some((a) => a !== '--no-ring')) { process.stderr.write('usage: g1 [--no-ring]\n'); process.exit(2); }
    const remote = makeRemote(realDeps({ say: (s) => process.stdout.write(`${s}\n`) }));
    try { const r = await remote.g1({ withDeno: false, withRing: !argv.includes('--no-ring') }); process.stdout.write(`${JSON.stringify(r)}\n`); process.exit(r.verdict.startsWith('G1_PASS') ? 0 : 1); } catch (e) {
      const d = e?.detail ? JSON.stringify(e.detail).slice(0, 1500) : String(e?.message ?? e).slice(0, 300);
      process.stdout.write(`STOP ${e?.code ?? 'ERROR'} ${G.secretFindings(d, remote.known).length ? '(detail withheld)' : d}\n`); process.exit(1);
    } finally { remote.wipe(); }
  }
  if (argv.length) { process.stderr.write('usage: g1 [--no-ring] | (session via run-competition-session.sh)\n'); process.exit(2); }
  const dir = assertSessionDir(process.env.ARMA2_SESSION_DIR);
  const fifo = path.join(dir, 'ctl');
  if (!fs.existsSync(fifo)) { const r = spawnSync('/usr/bin/mkfifo', ['-m', '600', fifo]); if (r.status !== 0) throw new Error('mkfifo failed'); }
  if (!fs.lstatSync(fifo).isFIFO()) throw new Error('ctl is not a FIFO');
  const transcript = path.join(dir, 'transcript.log');
  const stdin = await new Promise((resolve) => { const c = []; process.stdin.on('data', (x) => c.push(x)); process.stdin.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); });
  let request; try { request = JSON.parse(stdin); } catch { process.stderr.write('SESSION_STDIN_NOT_JSON\n'); process.exit(2); }
  if (Object.keys(request).join(',') !== 'deno') { process.stderr.write('SESSION_STDIN_SHAPE\n'); process.exit(2); }
  const readLine = fifoLineReader(fifo);
  const say = (s) => { process.stdout.write(`${s}\n`); fs.appendFileSync(transcript, `${s}\n`, { mode: 0o600 }); };
  const remote = makeRemote(realDeps({ say, readLine, denoToken: request.deno }));
  request.deno = '';
  say(`COMPETITION-V1 SESSION READY ${new Date().toISOString()} — commands on ${fifo}`);
  for (;;) {
    const line = readLine();
    if (line === 'quit') break;
    say(`\n> ${line}`);
    try { const r = await runCommand(remote, line); say(`OK ${JSON.stringify(r)}`); } catch (e) {
      const d = e?.detail ? JSON.stringify(e.detail).slice(0, 1500) : String(e?.message ?? e).slice(0, 300);
      say(`STOP ${e?.code ?? 'ERROR'} ${G.secretFindings(d, remote.known).length ? '(detail withheld: secret-shaped)' : d}`);
    }
  }
  remote.wipe();
  say('SESSION CLOSED');
  process.exit(0);
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
