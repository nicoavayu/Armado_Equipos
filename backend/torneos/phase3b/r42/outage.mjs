// Bundles and runs the outage harness in the certified Edge image with --network none, the
// read-only offline cache of R4.1 and no secret. Reproducible: the eszip SHA256 is recorded.
import fs from 'node:fs';
import {Worker} from 'node:worker_threads';
import {root, r4, repo, runtime, d, EDGE_IMAGE, sha, Stop, log} from './lib.mjs';

export function runOutageHarness({label}) {
  fs.mkdirSync(runtime, {recursive: true, mode: 0o700});
  const gateway = repo + '/backend/torneos/supabase/functions/torneos-gateway';
  const mounts = ['-v', root + ':/r42', '-v', r4 + '/offline-cache:/cache:ro', '-v', gateway + ':/gateway:ro'];
  const bundle = d(['run', '--rm', '--pull', 'never', '--network', 'none', '--label', 'arma2.r4.run=' + label, '-e', 'DENO_DIR=/cache', ...mounts, EDGE_IMAGE,
    'bundle', '--entrypoint', '/r42/outage-harness/index.ts', '--output', '/r42/.runtime/outage.eszip', '--checksum', 'sha256', '--timeout', '30'], {ok: true, timeout: 120000});
  if (bundle.status !== 0) throw new Stop('OUTAGE_BUNDLE_FAILED', (bundle.stderr ?? '').slice(-1500));
  const eszip = runtime + '/outage.eszip';
  const bundleSHA256 = sha(fs.readFileSync(eszip));
  log(`outage harness bundled offline sha256=${bundleSHA256}`);
  const run = d(['run', '--rm', '--pull', 'never', '--network', 'none', '--label', 'arma2.r4.run=' + label, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=32m', '-e', 'DENO_DIR=/cache', '-v', root + '/.runtime:/r42/.runtime:ro', '-v', r4 + '/offline-cache:/cache:ro', EDGE_IMAGE,
    'start', '--main-service', '/r42/.runtime/outage.eszip', '--ip', '127.0.0.1', '--port', '9000'], {ok: true, timeout: 120000});
  const line = (run.stdout + '\n' + run.stderr).split('\n').find((l) => l.startsWith('R42_OUTAGE_RESULT '));
  if (!line) throw new Stop('OUTAGE_NO_RESULT', ((run.stdout ?? '') + (run.stderr ?? '')).slice(-2500));
  const report = JSON.parse(line.slice('R42_OUTAGE_RESULT '.length));
  return {...report, bundleSHA256, edgeImage: EDGE_IMAGE, exit: run.status, mode: 'real gateway modules in the certified Edge runtime, --network none, no secret; Core/REST responses stubbed'};
}
/** --input-type applies to eval/stdin, not a file-backed Worker. Preserve every
 * other argument, including the order and values of legitimate Node flags. */
export function workerExecArgv(parent = process.execArgv) {
  const execArgv = [], removed = [];
  for (let i = 0; i < parent.length; i++) {
    const arg = parent[i];
    if (arg === '--input-type') {
      removed.push(arg);
      if (i + 1 < parent.length && !parent[i + 1].startsWith('--')) removed.push(parent[++i]);
    } else if (arg.startsWith('--input-type=')) removed.push(arg);
    else execArgv.push(arg);
  }
  return {execArgv, removed};
}
/** Keep the operator event loop servicing pooled sockets while the offline Docker harness
 * runs synchronously in its own worker. Exactly one harness execution; no HTTP retry,
 * dispatcher replacement, timeout/TTL change, or network-policy change. Only a public
 * resource label crosses the worker boundary, never credentials. */
export function runOutageHarnessAsync({label}) {
  if (!/^arma2-r42-[a-z0-9-]+$/.test(label)) return Promise.reject(new Stop('OUTAGE_LABEL_INVALID'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./outage-worker.mjs', import.meta.url), {
      execArgv: workerExecArgv().execArgv,
      workerData: {label}, env: {PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: '1'},
    });
    let message;
    worker.on('message', value => { message = value; });
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code === 0 && message?.ok) resolve(message.result);
      else reject(new Stop(message?.code ?? 'OUTAGE_WORKER_FAILED', message?.message ?? `exit=${code}`));
    });
  });
}
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const result = runOutageHarness({label: 'arma2-r42-outage-rehearsal'});
  console.log(JSON.stringify(result, null, 1));
  process.exitCode = result.pass ? 0 : 1;
}
