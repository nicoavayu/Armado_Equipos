import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME = path.join(HERE, '..');
const APPLY = path.join(RUNTIME, 'firewall/apply-with-rollback.sh');

function executable(file, contents) {
  fs.writeFileSync(file, contents, { mode: 0o755 });
}

function prepareFixture(t, dumpMode, seed = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-nft-backup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(bin);
  fs.mkdirSync(stateDir);
  const backup = path.join(stateDir, 'nftables.pre-apply.nft');
  const stale = `${backup}.tmp.stale`;
  if (seed.backupContents) fs.writeFileSync(backup, seed.backupContents);
  if (seed.staleContents) fs.writeFileSync(stale, seed.staleContents);

  executable(path.join(bin, 'id'), `#!/usr/bin/env bash
if [ "\${1:-}" = -u ]; then printf '0\\n'; else /usr/bin/id "$@"; fi
`);
  executable(path.join(bin, 'nft'), `#!/usr/bin/env bash
if [ "\${1:-}" = -c ]; then exit 0; fi
if [ "\${1:-}" = list ] && [ "\${2:-}" = ruleset ]; then
  case "\${NFT_DUMP_MODE:-normal}" in
    normal) printf 'table inet filter {}\\n' ;;
    empty) : ;;
    whitespace) printf '\\n \\t\\n' ;;
    fail) printf 'mock dump failure\\n' >&2; exit 42 ;;
    wait) : > "\${NFT_WAIT_READY}"; sleep 30 ;;
  esac
  exit 0
fi
exit 0
`);
  executable(path.join(bin, 'iptables'), '#!/usr/bin/env bash\nexit 0\n');
  // Stop the script immediately after nft backup publication. This keeps the
  // behavioral test wholly local: no systemd unit is written and no rules load.
  executable(path.join(bin, 'iptables-save'), '#!/usr/bin/env bash\nexit 55\n');

  return {
    args: [APPLY, '--i-am-on-the-console'],
    backup,
    cwd: RUNTIME,
    env: {
      ...process.env,
      ADMIN_CIDR: '198.51.100.0/24',
      NFT_DUMP_MODE: dumpMode,
      NFT_WAIT_READY: path.join(root, 'nft-wait-ready'),
      PATH: `${bin}:${process.env.PATH}`,
      STATE_DIR: stateDir,
    },
    root,
    stateDir,
    stale,
  };
}

function fixture(t, dumpMode, seed = {}) {
  const prepared = prepareFixture(t, dumpMode, seed);
  const result = spawnSync('bash', prepared.args, {
    cwd: prepared.cwd,
    encoding: 'utf8',
    env: prepared.env,
  });
  return { ...prepared, result };
}

async function waitFor(file) {
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('normal nft dump is published after exactly one flush line', (t) => {
  const run = fixture(t, 'normal');
  assert.equal(run.result.status, 55, run.result.stderr);
  assert.equal(fs.readFileSync(run.backup, 'utf8'), 'flush ruleset\ntable inet filter {}\n');
});

test('failed nft dump publishes no backup and cleans its own temporary files', (t) => {
  const run = fixture(t, 'fail');
  assert.notEqual(run.result.status, 0);
  assert.equal(fs.existsSync(run.backup), false);
  assert.deepEqual(fs.readdirSync(run.stateDir), []);
});

test('zero-byte nft dump fails closed and publishes no backup', (t) => {
  const run = fixture(t, 'empty');
  assert.notEqual(run.result.status, 0);
  assert.equal(fs.existsSync(run.backup), false);
  assert.deepEqual(fs.readdirSync(run.stateDir), []);
});

test('whitespace-only nft dump is not useful and fails closed', (t) => {
  const run = fixture(t, 'whitespace');
  assert.notEqual(run.result.status, 0);
  assert.equal(fs.existsSync(run.backup), false);
  assert.deepEqual(fs.readdirSync(run.stateDir), []);
});

test('a stale temp is not mistaken for the definitive backup', (t) => {
  const run = fixture(t, 'normal', { staleContents: 'stale and incomplete\n' });
  assert.equal(fs.readFileSync(run.backup, 'utf8'), 'flush ruleset\ntable inet filter {}\n');
  assert.equal(fs.readFileSync(run.stale, 'utf8'), 'stale and incomplete\n');
});

test('a failed new dump preserves a previously valid backup', (t) => {
  const previous = 'flush ruleset\ntable inet previous {}\n';
  const run = fixture(t, 'empty', { backupContents: previous });
  assert.notEqual(run.result.status, 0);
  assert.equal(fs.readFileSync(run.backup, 'utf8'), previous);
  assert.deepEqual(
    fs.readdirSync(run.stateDir).filter((name) => /\.(?:raw|tmp)\./.test(name)),
    [],
  );
});

test('a termination signal cleans raw and combined temporary files', async (t) => {
  const run = prepareFixture(t, 'wait');
  const child = spawn('bash', run.args, {
    cwd: run.cwd,
    detached: true,
    env: run.env,
    stdio: 'ignore',
  });
  t.after(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  });

  await waitFor(run.env.NFT_WAIT_READY);
  assert.ok(fs.readdirSync(run.stateDir).some((name) => name.includes('.raw.')),
    'the signal did not interrupt an active raw dump');
  process.kill(-child.pid, 'SIGTERM');
  const exit = await new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  assert.ok(exit.code === 143 || exit.signal === 'SIGTERM');
  assert.deepEqual(
    fs.readdirSync(run.stateDir).filter((name) => /\.(?:raw|tmp)\./.test(name)),
    [],
  );
});
