#!/usr/bin/env node
// ANDROID ORIGIN REMOTE — entry points.
//
//   node android-origin-session.mjs plan
//       OFFLINE: no network, no credential. Rebuilds both sources from git (twice), checks them against the pins and prints
//       the W1 plan id Production will get if it is still exactly at the live pin, and the rollback target.
//
//   node android-origin-session.mjs g1 [--no-ring]
//       READ-ONLY, non-interactive: bundles + the 66 live probes + the origin probes (bridge ring k1 from the Keychain
//       unless --no-ring). No Deno token here → the Deno leg is not observed (G1_PASS_WITHOUT_DENO_OBSERVATION at best).
//
//   ARMA2_SESSION_DIR=<abs dir, 0700> bash run-android-origin-session.sh read-only|deploy
//       operator session: the Deno Deploy token is typed on the tty (echo off) and piped here on stdin; commands and plan
//       phrases arrive one line at a time on the FIFO $ARMA2_SESSION_DIR/ctl:
//         g1 | deno | deno-audit | logs | probes-live | probes-candidate | w1-plan | rollback-plan   read-only (any mode)
//         w1 | rollback                                                                        writes (deploy mode only)
//         quit
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as C from './android-origin-contract.mjs';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import { makeRemote } from './android-origin-remote.mjs';
import { buildCandidate, buildLive } from './android-origin-bundle.mjs';
import { systemKeychain } from '../torneos-gateway-auth/keychain-gateway-auth.mjs';
import { denoHttpsTransport } from '../torneos-gateway-remote/deno-client.mjs';
import { gatewayHttps } from '../torneos-gateway-remote/gateway-probe.mjs';
import { assertSessionDir, fifoLineReader } from '../torneos-gateway-remote/remote-session.mjs';

export const MODES = Object.freeze(['read-only', 'deploy']);
/** A Deno credential may only arrive on stdin from the tty runner: never from the environment of this process. */
export const envCarriesToken = (env) => Object.keys(env).filter((k) => /DENO.*(TOKEN|KEY|SECRET|AUTH)|DEPLOY_TOKEN|ACCESS_TOKEN/i.test(k));

export function realDeps({ say, readLine = () => { throw new Error('no operator channel'); }, denoToken = null, readOnly = true, keychain = true }) {
  const kc = keychain ? systemKeychain() : null;
  return {
    say, readLine, denoToken, readOnly, now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    keychain: { ring: (slot, kid) => { if (!kc) throw new Error('keychain disabled'); return kc.ring.read(slot, kid); }, installerPassword: () => { throw new Error('no database leg in this tooling'); } },
    denoTransport: denoHttpsTransport, gatewayTransport: gatewayHttps,
    buildCandidate: () => buildCandidate(), buildLive: () => buildLive(),
    evidenceDir: C.EVIDENCE_DIR, deployedPinFile: C.DEPLOYED_PIN_FILE,
  };
}

export async function runCommand(remote, line) {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (rest.length) throw Object.assign(new Error('COMMAND_REFUSED'), { code: 'COMMAND_REFUSED' });
  switch (cmd) {
    case 'g1': return remote.g1();
    case 'deno': { const d = await remote.denoObserve(); return { verdict: d.failures.length ? 'DENO_OBSERVE_FAILED' : 'DENO_OBSERVE_OK', current: d.current?.id, env_count: d.env_count, failures: d.failures }; }
    case 'deno-audit': { const a = await remote.denoAudit(); return { verdict: a.failures.length ? 'DENO_AUDIT_FAILED' : 'DENO_AUDIT_OK', failures: a.failures }; }
    case 'probes-live': case 'probes-candidate': {
      const p = await remote.probes(cmd.slice(7));
      return { verdict: p.pass ? 'PROBES_PASS' : 'PROBES_FAILED', base: `${p.base.passed}/${p.base.total}`, origin: `${p.origin.passed}/${p.origin.total}`, failed: [...p.base.checks, ...p.origin.checks].filter((c) => !c.pass).map((c) => c.name) };
    }
    case 'logs': return remote.logsObserve();
    case 'w1-plan': return remote.w1Plan();
    case 'rollback-plan': return remote.rollbackPlan();
    case 'w1': case 'rollback':
      if (remote.readOnly) throw Object.assign(new Error('COMMAND_REFUSED_READ_ONLY_SESSION'), { code: 'COMMAND_REFUSED_READ_ONLY_SESSION' });
      return cmd === 'w1' ? remote.w1() : remote.rollback();
    default: throw Object.assign(new Error('COMMAND_UNKNOWN'), { code: 'COMMAND_UNKNOWN' });
  }
}

const detailOf = (e, known) => { const d = e?.detail ? JSON.stringify(e.detail).slice(0, 1500) : String(e?.message ?? e).slice(0, 300); return G.secretFindings(d, known).length ? '(detail withheld: secret-shaped)' : d; };

async function main() {
  const argv = process.argv.slice(2);
  const leaked = envCarriesToken(process.env);
  if (leaked.length) { process.stderr.write(`STOP ENV_CARRIES_A_TOKEN_NAME ${leaked.join(',')} — unset it; the token is typed on the tty only\n`); process.exit(2); }
  if (argv[0] === 'plan') {
    if (argv.length !== 1) { process.stderr.write('usage: plan\n'); process.exit(2); }
    const remote = makeRemote(realDeps({ say: (s) => process.stdout.write(`${s}\n`), keychain: false }));
    const r = remote.planOffline();
    process.stdout.write(`${JSON.stringify(r, null, 1)}\n`);
    process.exit(r.failures.length ? 1 : 0);
  }
  if (argv[0] === 'g1') {
    if (argv.slice(1).some((a) => a !== '--no-ring')) { process.stderr.write('usage: g1 [--no-ring]\n'); process.exit(2); }
    const remote = makeRemote(realDeps({ say: (s) => process.stdout.write(`${s}\n`) }));
    try { const r = await remote.g1({ withDeno: false, withRing: !argv.includes('--no-ring') }); process.stdout.write(`${JSON.stringify(r)}\n`); process.exit(r.verdict.startsWith('G1_PASS') ? 0 : 1); } catch (e) {
      process.stdout.write(`STOP ${e?.code ?? 'ERROR'} ${detailOf(e, remote.known)}\n`); process.exit(1);
    } finally { remote.wipe(); }
  }
  const mode = argv[0];
  if (argv.length !== 1 || !MODES.includes(mode)) { process.stderr.write('usage: plan | g1 [--no-ring] | (read-only|deploy via run-android-origin-session.sh)\n'); process.exit(2); }
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
  const remote = makeRemote(realDeps({ say, readLine, denoToken: request.deno, readOnly: mode === 'read-only' }));
  request.deno = '';
  say(`ANDROID-ORIGIN SESSION READY (${mode}) ${new Date().toISOString()} — commands on ${fifo}`);
  for (;;) {
    const line = readLine();
    if (line === 'quit') break;
    say(`\n> ${line}`);
    try { const r = await runCommand(remote, line); say(`OK ${JSON.stringify(r)}`); } catch (e) { say(`STOP ${e?.code ?? 'ERROR'} ${detailOf(e, remote.known)}`); }
  }
  remote.wipe();
  say('SESSION CLOSED');
  process.exit(0);
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
