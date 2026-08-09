/**
 * File-based secret injection, and the ordering it must not break.
 *
 * Two things are proved here. The first is the reader itself: what it accepts,
 * what it refuses, and that neither the credential nor the path it came from
 * ever reaches an error message, a log line or `process.env`.
 *
 * The second is the one that is load-bearing. `readConfig` validates the target
 * BEFORE it touches the service credential, because a service-role key is
 * unconditional authority over whatever project it is sent to and the only safe
 * moment to discover that `SUPABASE_URL` names the wrong one is before the key
 * exists in a variable. Adding a second way to obtain that key is exactly the
 * kind of change that quietly moves the read above the guard, so the tests
 * below assert the absence of a syscall, not merely the presence of an error:
 * a refused target must open no file, through the injected `fs` and through the
 * real one.
 *
 * Every credential in this file is fictional.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, mock } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  SECRET_FILE_MAX_BYTES, SecretSourceError, readFirstSecret, readSecret,
} from '../src/secret-source.mjs';
import { SERVICE_CREDENTIAL_SOURCES, readConfig } from '../src/supabase.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const STAGING_REF = 'hhyvmhgpapyuzjgxfnqv';
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
const PROD_REF = 'rcyuuoaqfwcembdajcss';

/** Fictional. Distinctive enough that a leak into any string is unmistakable. */
const FAKE_SECRET = 'fake-service-role-credential-0123456789';

const SERVICE_ROLE = SERVICE_CREDENTIAL_SOURCES[0];
const SECRET_KEY = SERVICE_CREDENTIAL_SOURCES[1];

// --- temporary files -------------------------------------------------------

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-secret-source-'));
let seq = 0;

/** Writes a fixture file and returns its absolute path. Bytes exactly as given. */
const secretFile = (contents, { name = `secret-${seq += 1}` } = {}) => {
  const target = path.join(root, name);
  fs.writeFileSync(target, contents, { mode: 0o600 });
  return target;
};

after(() => {
  // Restore any mode this suite narrowed, or the tree cannot be removed.
  for (const entry of fs.readdirSync(root)) {
    try { fs.chmodSync(path.join(root, entry), 0o600); } catch { /* already gone */ }
  }
  fs.rmSync(root, { recursive: true, force: true });
});

const codeOf = (run) => {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof SecretSourceError, `not a SecretSourceError: ${error}`);
    return error.code;
  }
  return null;
};

/** The whole error, as anything downstream could ever see it. */
const textOf = (run) => {
  try {
    run();
  } catch (error) {
    return `${error.code} ${error.message} ${error.stack}`;
  }
  return '';
};

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

test('a direct environment value still works, unchanged', () => {
  assert.equal(readSecret({ [SERVICE_ROLE.variable]: FAKE_SECRET }, SERVICE_ROLE), FAKE_SECRET);
});

test('a value with no source at all resolves to the empty string', () => {
  // Not an error here: the caller decides what a missing credential means, and
  // in this worker it is `WORKER_MISCONFIGURED`.
  assert.equal(readSecret({}, SERVICE_ROLE), '');
});

test('a file source resolves to the file contents', () => {
  const file = secretFile(FAKE_SECRET);
  assert.equal(readSecret({ [SERVICE_ROLE.fileVariable]: file }, SERVICE_ROLE), FAKE_SECRET);
});

test('both sources at once is a refusal, not a preference', () => {
  const file = secretFile(FAKE_SECRET);
  assert.equal(codeOf(() => readSecret({
    [SERVICE_ROLE.variable]: 'a-different-fictional-value',
    [SERVICE_ROLE.fileVariable]: file,
  }, SERVICE_ROLE)), 'SECRET_SOURCE_AMBIGUOUS');
});

test('an empty direct value beside a file source is absence, not ambiguity', () => {
  // A leftover `VAR=` line next to a real `VAR_FILE` is one credential, not
  // two, and every existing reader in this worker already treats "" as absent.
  const file = secretFile(FAKE_SECRET);
  assert.equal(readSecret({
    [SERVICE_ROLE.variable]: '',
    [SERVICE_ROLE.fileVariable]: file,
  }, SERVICE_ROLE), FAKE_SECRET);
});

test('a file that does not exist fails closed', () => {
  assert.equal(codeOf(() => readSecret({
    [SERVICE_ROLE.fileVariable]: path.join(root, 'no-such-file'),
  }, SERVICE_ROLE)), 'SECRET_FILE_UNREADABLE');
});

test('a directory is not a secret file', () => {
  const dir = path.join(root, 'a-directory');
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(codeOf(() => readSecret({
    [SERVICE_ROLE.fileVariable]: dir,
  }, SERVICE_ROLE)), 'SECRET_FILE_NOT_REGULAR');
});

// --- a fifo, which is the case that could hang instead of fail -------------

/**
 * A real fifo, made with the system `mkfifo`, because this is precisely the
 * property a mocked `stat` cannot demonstrate: the danger is not that the type
 * check gets the wrong answer, it is that a blocking `open` never reaches the
 * type check at all.
 */
const fifoPath = path.join(root, 'a-fifo');
const fifoSkip = (() => {
  const made = spawnSync('mkfifo', [fifoPath]);
  if (made.error || made.status !== 0) return 'mkfifo is unavailable on this platform';
  try {
    // `stat` never opens, so this is safe on a fifo with no writer.
    if (!fs.statSync(fifoPath).isFIFO()) return 'mkfifo did not produce a fifo';
  } catch {
    return 'mkfifo is unavailable on this platform';
  }
  return false;
})();

test('a fifo with no writer is refused instead of hanging start-up', { skip: fifoSkip }, () => {
  // Opening a fifo for reading waits for a writer, and `openSync` blocks the
  // thread — so before the non-blocking open this exact configuration hung the
  // process inside `open`, below every refusal this module has. Hanging is not
  // failing closed: nothing is refused, nothing is logged, and the worker just
  // never becomes ready.
  //
  // The read runs in a child process with a hard timeout for the same reason.
  // A regression here does not fail an assertion, it blocks the event loop, and
  // an in-process version of this test would hang the whole runner rather than
  // report anything. The child bounds it: a blocking open is killed and shows
  // up as a failure with a name.
  const child = `
    import fs from 'node:fs';
    const { readSecret } = await import(${JSON.stringify(pathToFileURL(path.join(HERE, '../src/secret-source.mjs')).href)});
    const opened = [];
    const closed = [];
    let reads = 0;
    // Delegates to the real fs — these are real syscalls on a real fifo — while
    // recording what the reader did with the descriptor.
    const watched = {
      openSync: (...args) => { const fd = fs.openSync(...args); opened.push(fd); return fd; },
      fstatSync: (...args) => fs.fstatSync(...args),
      readSync: (...args) => { reads += 1; return fs.readSync(...args); },
      closeSync: (fd) => { closed.push(fd); return fs.closeSync(fd); },
    };
    let code = null;
    try {
      readSecret({ FIFO_SECRET_FILE: ${JSON.stringify(fifoPath)} },
        { variable: 'FIFO_SECRET', fileVariable: 'FIFO_SECRET_FILE' }, { fs: watched });
    } catch (error) {
      code = error.code ?? String(error);
    }
    console.log(JSON.stringify({ code, opened, closed, reads }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', child], {
    timeout: 20_000, killSignal: 'SIGKILL', encoding: 'utf8',
  });
  assert.equal(result.error?.code, undefined,
    `the read did not return: the fifo open blocked (${result.error?.code})`);
  assert.equal(result.signal, null, 'the child was killed rather than returning');
  assert.equal(result.status, 0, `the child failed: ${result.stderr}`);

  const report = JSON.parse(result.stdout);
  assert.equal(report.code, 'SECRET_FILE_NOT_REGULAR',
    'a fifo is not a regular file and must be refused as one');
  // Nothing was read from it. The refusal happens at `fstat`, before any byte
  // of a stream an attacker could still be feeding could reach the credential.
  assert.equal(report.reads, 0, 'the reader read from the fifo');
  // The descriptor the open produced was closed. A refusal that leaks the fd
  // would hold the fifo open for as long as the process lives.
  assert.equal(report.opened.length, 1, 'the fifo was opened more or less than once');
  assert.deepEqual(report.closed, report.opened, 'the refused descriptor was not closed');

  // The reader observes; it does not consume, replace or remove.
  assert.ok(fs.existsSync(fifoPath), 'the fifo was deleted');
  assert.ok(fs.statSync(fifoPath).isFIFO(), 'the fifo was replaced');
});

test('the secret file is opened non-blocking, and still refuses a symlink', () => {
  // The flags themselves, so the property survives on a platform where the
  // fifo test above skips. `O_NONBLOCK` is what makes the type check
  // reachable; dropping `O_NOFOLLOW` to get there would trade one hole for
  // another, so both are pinned together.
  let flags = null;
  let delivered = false;
  const watched = {
    openSync: (_path, openFlags) => { flags = openFlags; return 7; },
    fstatSync: () => ({
      isSymbolicLink: () => false, isFile: () => true, size: FAKE_SECRET.length,
    }),
    readSync: (_fd, buffer, offset) => {
      if (delivered) return 0;
      delivered = true;
      return buffer.write(FAKE_SECRET, offset, 'utf8');
    },
    closeSync: () => {},
  };
  const secret = readSecret({ [SERVICE_ROLE.fileVariable]: path.join(root, 'flags-probe') },
    SERVICE_ROLE, { fs: watched });
  assert.equal(secret, FAKE_SECRET, 'the flags probe did not exercise a successful read');
  assert.equal(flags, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
});

test('a symlink is refused rather than followed', () => {
  // The point of the mechanism is that the operator named the file. A link
  // redirects that to somewhere the manifest never mentions — which is exactly
  // what a reviewer reading the manifest would not see.
  const real = secretFile(FAKE_SECRET, { name: 'link-target' });
  const link = path.join(root, 'a-symlink');
  fs.symlinkSync(real, link);
  assert.equal(codeOf(() => readSecret({
    [SERVICE_ROLE.fileVariable]: link,
  }, SERVICE_ROLE)), 'SECRET_FILE_SYMLINK');
});

test('an empty file is refused', () => {
  assert.equal(codeOf(() => readSecret({
    [SERVICE_ROLE.fileVariable]: secretFile(''),
  }, SERVICE_ROLE)), 'SECRET_FILE_EMPTY');
});

test('a file holding only a newline is refused', () => {
  for (const contents of ['\n', '\r\n']) {
    assert.equal(codeOf(() => readSecret({
      [SERVICE_ROLE.fileVariable]: secretFile(contents),
    }, SERVICE_ROLE)), 'SECRET_FILE_EMPTY');
  }
});

test('exactly one trailing LF or CRLF is removed', () => {
  // Almost every way of creating a file adds one, and a credential that ends in
  // a newline is not the credential.
  assert.equal(readSecret({
    [SERVICE_ROLE.fileVariable]: secretFile(`${FAKE_SECRET}\n`),
  }, SERVICE_ROLE), FAKE_SECRET);
  assert.equal(readSecret({
    [SERVICE_ROLE.fileVariable]: secretFile(`${FAKE_SECRET}\r\n`),
  }, SERVICE_ROLE), FAKE_SECRET);
});

test('a second trailing newline is part of the secret, not more whitespace to eat', () => {
  // One documented allowance, not a `trim()`. A `trim()` that alters a
  // legitimately padded value yields a credential that is wrong in a way
  // nothing downstream can detect.
  assert.equal(readSecret({
    [SERVICE_ROLE.fileVariable]: secretFile(`${FAKE_SECRET}\n\n`),
  }, SERVICE_ROLE), `${FAKE_SECRET}\n`);
});

test('leading, interior and trailing whitespace that is not a line ending is kept', () => {
  const padded = `  ${FAKE_SECRET} with spaces\t `;
  assert.equal(readSecret({
    [SERVICE_ROLE.fileVariable]: secretFile(`${padded}\n`),
  }, SERVICE_ROLE), padded);
});

test('a NUL byte means this is not the credential it is being read as', () => {
  assert.equal(codeOf(() => readSecret({
    [SERVICE_ROLE.fileVariable]: secretFile(Buffer.from(`${FAKE_SECRET}\0tail`, 'utf8')),
  }, SERVICE_ROLE)), 'SECRET_FILE_BINARY');
});

test('a file above the size ceiling is refused', () => {
  const oversized = secretFile(Buffer.alloc(SECRET_FILE_MAX_BYTES + 1, 0x61));
  assert.equal(codeOf(() => readSecret({
    [SERVICE_ROLE.fileVariable]: oversized,
  }, SERVICE_ROLE)), 'SECRET_FILE_TOO_LARGE');
});

test('a file exactly at the ceiling is still accepted', () => {
  const atLimit = secretFile(Buffer.alloc(SECRET_FILE_MAX_BYTES, 0x61));
  assert.equal(readSecret({
    [SERVICE_ROLE.fileVariable]: atLimit,
  }, SERVICE_ROLE).length, SECRET_FILE_MAX_BYTES);
});

test('a file this process may not read fails closed', { skip: process.getuid && process.getuid() === 0 ? 'running as root' : false }, () => {
  const unreadable = secretFile(FAKE_SECRET, { name: 'unreadable' });
  fs.chmodSync(unreadable, 0o000);
  assert.equal(codeOf(() => readSecret({
    [SERVICE_ROLE.fileVariable]: unreadable,
  }, SERVICE_ROLE)), 'SECRET_FILE_UNREADABLE');
});

test('a path that is empty or relative is refused before anything is opened', () => {
  // A relative path resolves against a working directory the manifest does not
  // state, so the same configuration would read different files depending on
  // how the process was started.
  const forbidFs = {
    openSync: () => assert.fail('a file was opened for an unusable path'),
    fstatSync: () => assert.fail('a file was opened for an unusable path'),
    readSync: () => assert.fail('a file was opened for an unusable path'),
    closeSync: () => assert.fail('a file was opened for an unusable path'),
  };
  for (const bad of ['', '   ', 'relative/secret', './secret']) {
    assert.equal(codeOf(() => readSecret(
      { [SERVICE_ROLE.fileVariable]: bad }, SERVICE_ROLE, { fs: forbidFs },
    )), 'SECRET_FILE_PATH_INVALID');
  }
});

// --- what an error may say -------------------------------------------------

test('no refusal ever carries the secret, the file contents or the path', () => {
  const cases = [
    secretFile(''),
    secretFile('\n'),
    secretFile(Buffer.from(`${FAKE_SECRET}\0`, 'utf8')),
    secretFile(Buffer.alloc(SECRET_FILE_MAX_BYTES + 1, 0x61)),
    path.join(root, 'absent-file-name'),
  ];
  for (const file of cases) {
    const text = textOf(() => readSecret({ [SERVICE_ROLE.fileVariable]: file }, SERVICE_ROLE));
    assert.notEqual(text, '', `${file} did not fail`);
    assert.equal(text.includes(FAKE_SECRET), false, 'an error carried the credential');
    assert.equal(text.includes(file), false, 'an error carried the file path');
    assert.equal(text.includes(root), false, 'an error carried the secret directory');
    // The variable name is what an operator needs, and discloses nothing.
    assert.ok(text.includes(SERVICE_ROLE.fileVariable));
  }
  // The ambiguity refusal names both variables and neither value.
  const both = textOf(() => readSecret({
    [SERVICE_ROLE.variable]: FAKE_SECRET,
    [SERVICE_ROLE.fileVariable]: secretFile(FAKE_SECRET),
  }, SERVICE_ROLE));
  assert.equal(both.includes(FAKE_SECRET), false);
  assert.ok(both.includes(SERVICE_ROLE.variable) && both.includes(SERVICE_ROLE.fileVariable));
});

// --- what the reader must not do -------------------------------------------

test('reading a secret file leaves the file exactly as it was', () => {
  const file = secretFile(`${FAKE_SECRET}\n`, { name: 'untouched' });
  const before = fs.statSync(file);
  const bytesBefore = fs.readFileSync(file);
  assert.equal(readSecret({ [SERVICE_ROLE.fileVariable]: file }, SERVICE_ROLE), FAKE_SECRET);
  const afterStat = fs.statSync(file);
  assert.ok(fs.existsSync(file), 'the file was deleted');
  assert.deepEqual(fs.readFileSync(file), bytesBefore, 'the file contents changed');
  assert.equal(afterStat.mode, before.mode, 'the file mode changed');
  assert.equal(afterStat.mtimeMs, before.mtimeMs, 'the file was rewritten');
  assert.equal(afterStat.size, before.size);
});

test('a file-sourced secret is never copied into process.env', () => {
  const file = secretFile(FAKE_SECRET);
  const before = JSON.stringify(process.env);
  const config = readConfig({
    SUPABASE_URL: STAGING_URL,
    TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF: STAGING_REF,
    [SERVICE_ROLE.fileVariable]: file,
  });
  assert.equal(config.key, FAKE_SECRET);
  assert.equal(JSON.stringify(process.env), before, 'process.env was mutated');
  for (const value of Object.values(process.env)) {
    assert.equal(String(value).includes(FAKE_SECRET), false, 'the secret reached the environment');
  }
});

test('the env object the caller passed is not mutated either', () => {
  const file = secretFile(FAKE_SECRET);
  const env = {
    SUPABASE_URL: STAGING_URL,
    TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF: STAGING_REF,
    [SERVICE_ROLE.fileVariable]: file,
  };
  const snapshot = { ...env };
  readConfig(env);
  assert.deepEqual(env, snapshot);
  assert.equal(env[SERVICE_ROLE.variable], undefined,
    'the file contents were written back as the direct variable');
});

// ---------------------------------------------------------------------------
// The processor: target first, credential second
// ---------------------------------------------------------------------------

/** An `fs` that fails the test if anything at all touches it. */
const forbiddenFs = (why) => new Proxy({}, {
  get: (_target, property) => () => assert.fail(`fs.${String(property)} was called ${why}`),
});

/**
 * Counts calls to the REAL `fs` for the duration of `run`. The injected-`fs`
 * tests prove the code path; this proves the module is not reaching around it.
 */
function countingRealFs(run) {
  const counters = { openSync: 0, readSync: 0, readFileSync: 0, readFile: 0 };
  const originals = {};
  for (const name of Object.keys(counters)) {
    originals[name] = fs[name];
    mock.method(fs, name, (...args) => { counters[name] += 1; return originals[name](...args); });
  }
  try {
    run();
  } finally {
    mock.restoreAll();
  }
  return counters;
}

test('a valid target and a file source produce a usable config', () => {
  const config = readConfig({
    SUPABASE_URL: STAGING_URL,
    TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF: STAGING_REF,
    SUPABASE_SERVICE_ROLE_KEY_FILE: secretFile(`${FAKE_SECRET}\n`),
  });
  assert.equal(config.key, FAKE_SECRET);
  assert.equal(config.target.projectRef, STAGING_REF);
  assert.equal(config.url, STAGING_URL);
});

test('SUPABASE_SECRET_KEY_FILE is accepted as the documented alternative', () => {
  const config = readConfig({
    SUPABASE_URL: STAGING_URL,
    TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF: STAGING_REF,
    SUPABASE_SECRET_KEY_FILE: secretFile(FAKE_SECRET),
  });
  assert.equal(config.key, FAKE_SECRET);
});

test('the existing precedence between the two credentials is unchanged', () => {
  // SERVICE_ROLE before SECRET_KEY, whichever source each is given. The file
  // mechanism reorders nothing.
  const preferred = 'fake-preferred-credential-000000000000';
  const other = 'fake-other-credential-111111111111';
  assert.equal(readConfig({
    SUPABASE_URL: STAGING_URL,
    TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF: STAGING_REF,
    SUPABASE_SERVICE_ROLE_KEY_FILE: secretFile(preferred),
    SUPABASE_SECRET_KEY: other,
  }).key, preferred);
  assert.equal(readConfig({
    SUPABASE_URL: STAGING_URL,
    TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF: STAGING_REF,
    SUPABASE_SERVICE_ROLE_KEY: preferred,
    SUPABASE_SECRET_KEY_FILE: secretFile(other),
  }).key, preferred);
});

test('a credential given twice refuses the whole configuration', () => {
  for (const env of [
    { SUPABASE_SERVICE_ROLE_KEY: FAKE_SECRET, SUPABASE_SERVICE_ROLE_KEY_FILE: secretFile(FAKE_SECRET) },
    { SUPABASE_SECRET_KEY: FAKE_SECRET, SUPABASE_SECRET_KEY_FILE: secretFile(FAKE_SECRET) },
  ]) {
    const thrown = codeOf(() => readConfig({
      SUPABASE_URL: STAGING_URL,
      TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF: STAGING_REF,
      ...env,
    }));
    assert.equal(thrown, 'SECRET_SOURCE_AMBIGUOUS');
  }
});

test('the ambiguity check covers the alternative credential too, before either file is read', () => {
  // The winner is SERVICE_ROLE, so a naive implementation would resolve it and
  // never notice that SECRET_KEY was given two sources. That is the stale-key
  // case the refusal exists for.
  assert.equal(codeOf(() => readConfig({
    SUPABASE_URL: STAGING_URL,
    TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF: STAGING_REF,
    SUPABASE_SERVICE_ROLE_KEY: FAKE_SECRET,
    SUPABASE_SECRET_KEY: 'fake-stale-value-2222222222',
    SUPABASE_SECRET_KEY_FILE: secretFile('fake-rotated-value-3333333333'),
  })), 'SECRET_SOURCE_AMBIGUOUS');
});

test('a forbidden target opens no secret file', () => {
  // The F-1 guarantee, restated for the file source. `read` counts every touch
  // of the environment variables; the injected `fs` fails on any syscall.
  let read = 0;
  const file = secretFile(FAKE_SECRET);
  const env = {
    SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
    TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF: STAGING_REF,
    get SUPABASE_SERVICE_ROLE_KEY() { read += 1; return FAKE_SECRET; },
    get SUPABASE_SERVICE_ROLE_KEY_FILE() { read += 1; return file; },
    get SUPABASE_SECRET_KEY() { read += 1; return FAKE_SECRET; },
    get SUPABASE_SECRET_KEY_FILE() { read += 1; return file; },
  };
  let thrown = null;
  try {
    readConfig(env, { fs: forbiddenFs('for a forbidden target') });
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown?.code, 'TARGET_FORBIDDEN');
  assert.equal(read, 0, 'a credential variable was read for a forbidden target');
  assert.equal(String(thrown?.message).includes(FAKE_SECRET), false);
  assert.equal(String(thrown?.message).includes(file), false);
});

test('an invalid target opens no secret file either', () => {
  const file = secretFile(FAKE_SECRET);
  for (const [url, expectedRef, code] of [
    ['not-a-url', STAGING_REF, 'TARGET_INVALID'],
    ['http://example.test', STAGING_REF, 'TARGET_INSECURE'],
    [STAGING_URL, '', 'TARGET_REF_REQUIRED'],
    [STAGING_URL, 'not-a-project-ref', 'TARGET_REF_INVALID'],
    [`https://other-${STAGING_REF}.supabase.co`, STAGING_REF, 'TARGET_HOST'],
    ['https://user:pass@x.supabase.co', STAGING_REF, 'TARGET_CREDENTIALS'],
    ['', STAGING_REF, 'TARGET_MISSING'],
  ]) {
    let read = 0;
    const env = {
      SUPABASE_URL: url,
      TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF: expectedRef,
      get SUPABASE_SERVICE_ROLE_KEY_FILE() { read += 1; return file; },
    };
    let thrown = null;
    try {
      readConfig(env, { fs: forbiddenFs(`for ${code}`) });
    } catch (error) {
      thrown = error;
    }
    assert.equal(thrown?.code, code, `${url} did not fail with ${code}`);
    assert.equal(read, 0, `${code} read the credential variable`);
  }
});

test('the real fs is untouched for a forbidden target, and used exactly once for an allowed one', () => {
  const file = secretFile(FAKE_SECRET);
  const refused = countingRealFs(() => {
    assert.throws(() => readConfig({
      SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
      TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF: STAGING_REF,
      SUPABASE_SERVICE_ROLE_KEY_FILE: file,
    }));
  });
  assert.deepEqual(refused, { openSync: 0, readSync: 0, readFileSync: 0, readFile: 0 },
    'a refused target reached the filesystem');

  let config = null;
  const allowed = countingRealFs(() => {
    config = readConfig({
      SUPABASE_URL: STAGING_URL,
      TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF: STAGING_REF,
      SUPABASE_SERVICE_ROLE_KEY_FILE: file,
    });
  });
  assert.equal(config.key, FAKE_SECRET);
  assert.equal(allowed.openSync, 1, 'the secret file was opened more or less than once');
  // Read once at start-up and never again: no `readFile`, no re-read per request.
  assert.equal(allowed.readFileSync, 0);
  assert.equal(allowed.readFile, 0);
});

// ---------------------------------------------------------------------------
// The mechanism, demonstrated
// ---------------------------------------------------------------------------

test('the container configuration only ever needs the path', () => {
  // What an operator would put in a manifest. This is the whole claim of the
  // file mechanism, and it is checked rather than asserted in prose: the
  // configuration that starts the worker contains a path and no credential.
  const file = secretFile(FAKE_SECRET);
  const containerEnv = Object.freeze({
    SUPABASE_URL: STAGING_URL,
    TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF: STAGING_REF,
    SUPABASE_SERVICE_ROLE_KEY_FILE: '/run/secrets/supabase_service_role_key',
  });
  for (const value of Object.values(containerEnv)) {
    assert.equal(String(value).includes(FAKE_SECRET), false);
  }
  assert.equal(containerEnv.SUPABASE_SERVICE_ROLE_KEY, undefined,
    'the manifest still names the value form');

  // The same configuration, with the path pointed at the fixture, resolves.
  const config = readConfig({ ...containerEnv, SUPABASE_SERVICE_ROLE_KEY_FILE: file });
  assert.equal(config.key, FAKE_SECRET);
  // The credential is on the heap and nowhere else this process controls.
  // Nothing here claims more than that: root, a debugger or a core dump can
  // still reach process memory. `_FILE` removes `docker inspect`,
  // `config.v2.json`, `docker compose config` and `/proc/<pid>/environ` from
  // the list of places the value appears — it does not make the process holding
  // it invulnerable.
  assert.equal(process.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(process.env.SUPABASE_SERVICE_ROLE_KEY_FILE, undefined);
});

test('readFirstSecret reports which variable and which source won', () => {
  const file = secretFile(FAKE_SECRET);
  assert.deepEqual(
    readFirstSecret({ SUPABASE_SERVICE_ROLE_KEY_FILE: file }, SERVICE_CREDENTIAL_SOURCES),
    { variable: 'SUPABASE_SERVICE_ROLE_KEY', source: 'file', value: FAKE_SECRET },
  );
  assert.deepEqual(
    readFirstSecret({ SUPABASE_SECRET_KEY: FAKE_SECRET }, SERVICE_CREDENTIAL_SOURCES),
    { variable: 'SUPABASE_SECRET_KEY', source: 'env', value: FAKE_SECRET },
  );
  assert.deepEqual(
    readFirstSecret({}, SERVICE_CREDENTIAL_SOURCES),
    { variable: null, source: null, value: '' },
  );
});

// ---------------------------------------------------------------------------
// The two copies
// ---------------------------------------------------------------------------

test('the renewer carries a byte-identical copy of the reader', () => {
  // The renewer ships as its own npm package and its own container, so neither
  // worker can import the other's module — the same constraint that made
  // `target.mjs` and `forbidden-targets.mjs` near-copies. Duplication is
  // accepted; a silent fork of a credential-handling primitive is not.
  const mine = fs.readFileSync(path.join(HERE, '../src/secret-source.mjs'));
  const theirs = fs.readFileSync(
    path.join(HERE, '../../tournament-media-signer-renewer/src/secret-source.mjs'),
  );
  assert.deepEqual(mine, theirs,
    'the two copies of secret-source.mjs have diverged; port the change to both');
});

test('the file variables this worker reads are exactly the documented pair', () => {
  // Pinned as literals: a deployment manifest names these strings, and a rename
  // here without a rename there is a stack that fails to start.
  assert.deepEqual(SERVICE_CREDENTIAL_SOURCES.map((s) => s.fileVariable),
    ['SUPABASE_SERVICE_ROLE_KEY_FILE', 'SUPABASE_SECRET_KEY_FILE']);
  assert.deepEqual(SERVICE_CREDENTIAL_SOURCES.map((s) => s.variable),
    ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY']);
  assert.ok(Object.isFrozen(SERVICE_CREDENTIAL_SOURCES));
});
