# tournament-media-processor — where the credential comes from

Every value in this document is fictional. Nothing here names a real project, a
real host or a real credential.

## The contract

Each secret variable has a `_FILE` twin. Use **one** of them, never both.

| direct | file |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY=<value>` | `SUPABASE_SERVICE_ROLE_KEY_FILE=/run/secrets/example` |
| `SUPABASE_SECRET_KEY=<value>` | `SUPABASE_SECRET_KEY_FILE=/run/secrets/example` |

`SUPABASE_SERVICE_ROLE_KEY` takes precedence over `SUPABASE_SECRET_KEY`,
whichever source each is given. That order is unchanged by the file mechanism.

Setting both halves of a pair — `SUPABASE_SERVICE_ROLE_KEY` *and*
`SUPABASE_SERVICE_ROLE_KEY_FILE` — is a start-up refusal
(`SECRET_SOURCE_AMBIGUOUS`), not a preference. Two sources for one credential
means one of them is stale, and picking silently is how a rotated key keeps not
taking effect: the rotation looks applied, the old value keeps being sent, and
nothing reports a problem.

There is no fallback in the other direction either. A `_FILE` that is missing,
unreadable, empty or implausible fails; it never falls back to the environment.

## What the file must contain

- the credential, and nothing else;
- at most one trailing line ending, `LF` or `CRLF`, which is removed. Anything
  else — leading spaces, interior whitespace, a second trailing newline — is
  part of the credential and is kept. This is one documented allowance, not a
  `trim()`: a `trim()` that alters a legitimately padded value produces a
  credential that is wrong in a way nothing downstream can detect;
- at most 64 KiB;
- no NUL byte.

The path must be **absolute**, and must name a **regular file** — not a
directory, not a fifo, and **not a symlink**. A symlink is refused rather than
followed: the point of the mechanism is that the operator named the file, and a
link redirects that to somewhere the manifest never mentions.

The open is non-blocking, which matters for one case in particular: opening a
fifo for reading otherwise waits for a writer that may never arrive, so a `_FILE`
pointing at one would hang start-up rather than refuse it. Every non-regular file
is refused, but **which** code you get depends on how far the kernel let the open
get — see below.

## Failure codes

| code | meaning |
|---|---|
| `SECRET_SOURCE_AMBIGUOUS` | both the variable and its `_FILE` twin are set |
| `SECRET_FILE_PATH_INVALID` | `_FILE` is set to an empty or relative path |
| `SECRET_FILE_UNREADABLE` | missing, this process may not read it, or the kernel refused the open outright — a Unix socket is the usual example |
| `SECRET_FILE_NOT_REGULAR` | opened, but not a regular file: a fifo, a device, a directory |
| `SECRET_FILE_SYMLINK` | a symlink |
| `SECRET_FILE_TOO_LARGE` | over 64 KiB |
| `SECRET_FILE_EMPTY` | empty, or nothing but a line ending |
| `SECRET_FILE_BINARY` | contains a NUL byte |
| `WORKER_MISCONFIGURED` | no credential was supplied by either mechanism |

The split between `SECRET_FILE_UNREADABLE` and `SECRET_FILE_NOT_REGULAR` is the
kernel's, not a promise this worker makes. A non-regular file is rejected at the `fstat` on the open descriptor, so
it reports `SECRET_FILE_NOT_REGULAR` only when the open succeeded; when the
kernel refuses the open first, the failure is `SECRET_FILE_UNREADABLE` and the
`fstat` never runs. Do not pin a specific code for a specific special file —
platforms differ. What is guaranteed is the part that matters: **no non-regular
file ever yields a credential, and none of them can hang start-up.**

No message ever contains the credential, the file's contents, or the path. They
name the variable and the rule, because that is what an operator needs and it
discloses nothing.

## Ordering — the part that is load-bearing

The credential is resolved **after** `SUPABASE_URL` and
`TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF` have been validated against the target
guard, and the file source does not change that. A refused target — Production,
a lookalike host, a missing project ref — costs no read of the credential
variable and opens no file at all. `test/secret-source.test.mjs` asserts the
absence of the syscall, not merely the presence of the error.

## Example

Fictional throughout. `example.supabase.co` and `<project-ref>` are
placeholders — the repository's static guard refuses a tracked file that names
any Supabase host it does not recognise, including invented ones.

```yaml
services:
  processor:
    environment:
      SUPABASE_URL: https://example.supabase.co
      TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF: <project-ref>
      SUPABASE_SERVICE_ROLE_KEY_FILE: /run/secrets/example
    secrets:
      - source: example
        target: example
secrets:
  example:
    file: ${SECRET_DIR}/example
```

The container configuration holds the path. It does not hold the credential.

## What this does and does not protect

A credential passed as an `environment:` value is readable from four places
that have nothing to do with the process holding it: `docker inspect`, the
container's `config.v2.json` at rest on the host disk, the output of
`docker compose config` — the ordinary act of validating a manifest prints it —
and `/proc/<pid>/environ`. Reading it from a file removes all four: the only
thing the configuration ever holds is the path, and the worker reads the file
itself rather than having a wrapper export it back into the environment.

Once read, the credential is a string on this process's heap. Root on the host,
a debugger, a ptrace-capable process or a core dump can still reach it. `_FILE`
removes configuration and environment surfaces; it does not make a process that
holds a credential invulnerable to something that can already read its memory.

The file itself is at rest on the host, protected by its ownership and mode. In
non-Swarm mode Compose ignores `uid`, `gid` and `mode` on file-based secrets —
the file is mounted with whatever it has on the host, so those are set when the
file is created, not in the manifest. This image runs as `node` (uid 1000).

## Rotation

Replace the file and restart the container. The credential is read once, at
start-up, so a running process keeps the value it started with.
