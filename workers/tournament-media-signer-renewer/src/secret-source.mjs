/**
 * Where a credential comes from: the environment, or a file.
 *
 * ---------------------------------------------------------------------------
 * The gap this closes
 * ---------------------------------------------------------------------------
 * A credential passed as an `environment:` value in a container manifest is
 * readable from four places that have nothing to do with the process holding
 * it: `docker inspect`, the container's `config.v2.json` at rest on the host
 * disk, the output of `docker compose config` — the ordinary act of validating
 * a manifest prints it — and `/proc/<pid>/environ`. A credential read from a
 * mounted file is in none of the first three, because the only thing the
 * container configuration ever holds is the path.
 *
 * So each secret variable gains a `_FILE` twin. The twin's VALUE is a path, and
 * a path is not a secret: it may appear in `docker inspect`, in `process.env`
 * and in a log line, and that is the point. The file's CONTENTS are the secret,
 * and they are never copied into `process.env`, never placed in `argv`, never
 * logged, and never put in an error message.
 *
 * ---------------------------------------------------------------------------
 * One source, or none
 * ---------------------------------------------------------------------------
 * When both `VAR` and `VAR_FILE` are set the process refuses to start —
 * `SECRET_SOURCE_AMBIGUOUS` — rather than preferring one. Two sources for one
 * credential means one of them is stale, and picking silently is how a rotated
 * key keeps not taking effect: the rotation looks applied, the old value keeps
 * being sent, and nothing anywhere reports a problem. A refusal at start-up is
 * the only outcome that surfaces it.
 *
 * There is no fallback in the other direction either. A `VAR_FILE` that is
 * missing, unreadable, empty or implausible fails; it does not quietly fall
 * back to the environment. Fail closed: for both workers a missing credential
 * means no job is leased and no attestation is minted, which is the safe state.
 *
 * ---------------------------------------------------------------------------
 * What this file does NOT claim
 * ---------------------------------------------------------------------------
 * Once read, the secret is a string on this process's heap. Root on the host,
 * a debugger, a ptrace-capable process, or a core dump can still reach it.
 * `_FILE` removes host-side configuration surfaces and the process environment;
 * it does not make a process that holds a credential invulnerable to something
 * that can already read its memory.
 *
 * ---------------------------------------------------------------------------
 * Two copies, deliberately
 * ---------------------------------------------------------------------------
 * This file is byte-identical in `tournament-media-processor` and in
 * `tournament-media-signer-renewer`, for the same reason `target.mjs` and
 * `forbidden-targets.mjs` are near-copies: the renewer ships as its own npm
 * package and its own container, so neither can import the other. The
 * processor's `test/secret-source.test.mjs` compares the two files and fails if
 * they ever differ, so the duplication cannot silently become a fork.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * The ceiling on a secret file. Every credential these workers accept is a key
 * or a JWT — hundreds of bytes, not kilobytes. 64 KiB is far above anything
 * legitimate and far below a size that could be used to make start-up expensive
 * by pointing `_FILE` at something large.
 */
export const SECRET_FILE_MAX_BYTES = 64 * 1024;

export class SecretSourceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SecretSourceError';
    this.code = code;
  }
}

const fail = (code, message) => { throw new SecretSourceError(code, message); };

/**
 * `O_NOFOLLOW` makes the kernel refuse a symlink as the final path component,
 * atomically, at open time. That is strictly better than an `lstat` first: a
 * check-then-open pair can be raced, and this cannot.
 *
 * A symlink is refused rather than followed because the whole value of the
 * mechanism is that the operator named the file the secret is in. A link
 * redirects that to somewhere the manifest never mentions, which is exactly the
 * thing a reviewer reading the manifest would not see.
 */
const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;

/**
 * `O_NONBLOCK` is what makes the "not a regular file" check below reachable at
 * all. Opening a fifo for reading waits for a writer — forever, if none ever
 * arrives — and `openSync` blocks the thread, so a `_FILE` pointing at a fifo
 * would hang start-up inside `open`, before the `fstat` that exists to reject
 * it ever ran. Hanging is not failing closed: nothing is refused, nothing is
 * logged, and the container simply never becomes ready. With this flag the open
 * returns at once, `fstat` sees a fifo, and the process refuses to start. The
 * same reasoning covers a device whose open waits on a carrier.
 *
 * It is free on the only thing this module is meant to read: a regular file is
 * always ready under POSIX, so neither the open nor any read below behaves
 * differently for one.
 */
const O_NONBLOCK = fs.constants.O_NONBLOCK || 0;

/**
 * Reads one secret file, or throws.
 *
 * Nothing here is best-effort: every rejection below is a state in which the
 * process could have started with a wrong, partial or attacker-chosen
 * credential, and none of them has a safe interpretation.
 *
 * @param {string} fileVariable the NAME of the `_FILE` variable, used in errors
 * @param {string} rawPath its value
 * @returns {string} the file's contents, less at most one trailing line ending
 */
function readSecretFile(fileVariable, rawPath, fsImpl) {
  // The path is trimmed; the secret never is. Surrounding whitespace on a path
  // is a paste artefact, and trimming it cannot change a credential.
  const filePath = String(rawPath === undefined || rawPath === null ? '' : rawPath).trim();
  if (!filePath) {
    fail('SECRET_FILE_PATH_INVALID', `${fileVariable} is set but names no path.`);
  }
  if (!path.isAbsolute(filePath)) {
    // A relative path resolves against a working directory that the manifest
    // does not state, so the same configuration would read different files
    // depending on how the process was started.
    fail('SECRET_FILE_PATH_INVALID', `${fileVariable} must be an absolute path.`);
  }

  let fd = null;
  try {
    fd = fsImpl.openSync(filePath, fs.constants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (error) {
    // The errno is named because it is what an operator needs and it discloses
    // nothing; the path is not, because an error string ends up in logs and the
    // path is the one part of this that a reader has no reason to be handed.
    const errno = String(error && error.code ? error.code : 'EUNKNOWN');
    if (errno === 'ELOOP') {
      fail('SECRET_FILE_SYMLINK', `${fileVariable} names a symlink, which is not accepted.`);
    }
    if (errno === 'EISDIR') {
      fail('SECRET_FILE_NOT_REGULAR', `${fileVariable} does not name a regular file.`);
    }
    fail('SECRET_FILE_UNREADABLE', `${fileVariable} could not be opened (${errno}).`);
  }

  // One 64 KiB + 1 buffer: the extra byte is what turns "the file filled the
  // buffer" into a size refusal instead of a silent truncation.
  const buffer = Buffer.alloc(SECRET_FILE_MAX_BYTES + 1);
  let total = 0;
  try {
    // `fstat` on the open descriptor rather than `stat` on the path: it
    // describes the file this process actually holds, so nothing can be
    // swapped underneath between the check and the read.
    const stat = fsImpl.fstatSync(fd);
    if (stat.isSymbolicLink()) {
      fail('SECRET_FILE_SYMLINK', `${fileVariable} names a symlink, which is not accepted.`);
    }
    if (!stat.isFile()) {
      // Whatever special file the kernel did let this process open: a fifo — it
      // reaches here only because the open above was non-blocking — a device, or
      // a directory on a platform that opens one for reading. The special files
      // whose open the kernel refuses outright never arrive here at all; a Unix
      // socket is the usual one, and it has already failed above as
      // `SECRET_FILE_UNREADABLE`. Both are refusals, which is the point: this
      // branch is not the only way a non-regular file fails closed.
      fail('SECRET_FILE_NOT_REGULAR', `${fileVariable} does not name a regular file.`);
    }
    if (stat.size > SECRET_FILE_MAX_BYTES) {
      fail('SECRET_FILE_TOO_LARGE', `${fileVariable} is larger than ${SECRET_FILE_MAX_BYTES} bytes.`);
    }
    for (;;) {
      let read;
      try {
        read = fsImpl.readSync(fd, buffer, total, buffer.length - total, null);
      } catch (error) {
        const errno = String(error && error.code ? error.code : 'EUNKNOWN');
        if (errno === 'EISDIR') {
          fail('SECRET_FILE_NOT_REGULAR', `${fileVariable} does not name a regular file.`);
        }
        fail('SECRET_FILE_UNREADABLE', `${fileVariable} could not be read (${errno}).`);
      }
      if (read === 0) break;
      total += read;
      if (total > SECRET_FILE_MAX_BYTES) {
        fail('SECRET_FILE_TOO_LARGE', `${fileVariable} is larger than ${SECRET_FILE_MAX_BYTES} bytes.`);
      }
    }
  } finally {
    try { fsImpl.closeSync(fd); } catch { /* the descriptor is going away regardless */ }
  }

  let secret;
  try {
    const raw = buffer.subarray(0, total);
    if (raw.includes(0)) {
      // A NUL means this is not the text credential it is being read as —
      // most likely a binary file, or a truncated write.
      fail('SECRET_FILE_BINARY', `${fileVariable} contains a NUL byte.`);
    }
    // Exactly ONE trailing line ending is removed, LF or CRLF, because almost
    // every way of creating a file adds one and a credential that ends in a
    // newline is not the credential. It is a single, documented allowance and
    // not a `trim()`: interior and leading whitespace, a second trailing
    // newline, and trailing spaces are all part of the secret and are kept,
    // because a `trim()` that alters a legitimately-padded value produces a
    // credential that is wrong in a way nothing can detect.
    let end = total;
    if (end > 0 && raw[end - 1] === 0x0a) {
      end -= 1;
      if (end > 0 && raw[end - 1] === 0x0d) end -= 1;
    }
    secret = raw.subarray(0, end).toString('utf8');
  } finally {
    // The buffer holds the only copy this module controls; the string does not
    // (V8 owns that). Zeroing it is cheap and removes one lingering copy.
    buffer.fill(0);
  }

  if (!secret) {
    fail('SECRET_FILE_EMPTY', `${fileVariable} names a file with no credential in it.`);
  }
  return secret;
}

/**
 * Whether the operator DECLARED a file source, which is not the same as having
 * declared a usable one. Presence of the key is the declaration; a key present
 * with an empty value is a broken file source rather than an absent one, and is
 * refused below instead of falling back to the environment.
 */
const declaresFile = (env, fileVariable) => (
  env !== null && env !== undefined && env[fileVariable] !== undefined
);

/**
 * Refuses a credential that has been given two sources, without reading either
 * file. Pure environment inspection: cheap, and safe to call before anything
 * privileged has been decided.
 *
 * @param {object} env
 * @param {{variable: string, fileVariable: string}} names
 */
export function assertSingleSecretSource(env, { variable, fileVariable }) {
  if (!declaresFile(env, fileVariable)) return;
  const direct = env[variable];
  // An empty `VAR` is treated as absent, exactly as every existing reader in
  // both workers already treats it. A leftover `VAR=` line next to a real
  // `VAR_FILE` is not two live credentials.
  if (direct === undefined || direct === null || String(direct) === '') return;
  fail('SECRET_SOURCE_AMBIGUOUS',
    `${variable} and ${fileVariable} are both set. A credential must have exactly one source: `
    + 'one of the two is stale, and choosing silently is how a rotated credential keeps not '
    + 'taking effect.');
}

/**
 * Resolves one credential from whichever single source was declared.
 *
 * Reads the file at most once, at the moment it is called — so a caller that
 * validates its target first (both workers do) keeps that ordering: nothing
 * here is evaluated at import time or lazily later.
 *
 * @param {object} env
 * @param {{variable: string, fileVariable: string}} names
 * @param {{fs?: object}} [options] an injectable `fs`, used by the tests that
 *   prove no file is opened before a target has been authorized
 * @returns {string} the credential, or `''` when neither source was declared
 */
export function readSecret(env, { variable, fileVariable }, { fs: fsImpl = fs } = {}) {
  assertSingleSecretSource(env, { variable, fileVariable });
  if (declaresFile(env, fileVariable)) {
    return readSecretFile(fileVariable, env[fileVariable], fsImpl);
  }
  const direct = env[variable];
  return direct === undefined || direct === null ? '' : String(direct);
}

/**
 * The first credential in a precedence-ordered list of alternatives.
 *
 * Every candidate is checked for ambiguity first — that check touches no file —
 * and only the winner is then read. So a stale `VAR`/`VAR_FILE` pair anywhere in
 * the chain is still caught, while a secret the process is not going to use is
 * never brought into memory.
 *
 * The order of `candidates` IS the existing precedence between the alternative
 * variables and is not changed by this module.
 *
 * @returns {{variable: string|null, source: 'env'|'file'|null, value: string}}
 */
export function readFirstSecret(env, candidates, { fs: fsImpl = fs } = {}) {
  for (const names of candidates) assertSingleSecretSource(env, names);
  for (const names of candidates) {
    if (declaresFile(env, names.fileVariable)) {
      return {
        variable: names.variable,
        source: 'file',
        value: readSecretFile(names.fileVariable, env[names.fileVariable], fsImpl),
      };
    }
    const direct = env[names.variable];
    const value = direct === undefined || direct === null ? '' : String(direct);
    if (value) return { variable: names.variable, source: 'env', value };
  }
  return { variable: null, source: null, value: '' };
}
