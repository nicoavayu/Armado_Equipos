# tournament-media-signer-renewer — where the credentials come from

Every value in this document is fictional. Nothing here names a real project, a
real host or a real credential.

## The contract

Each secret variable has a `_FILE` twin. Use **one** of them, never both.

| direct | file |
|---|---|
| `TOURNAMENT_MEDIA_ATTESTATION_SECRET=<value>` | `TOURNAMENT_MEDIA_ATTESTATION_SECRET_FILE=/run/secrets/example` |
| `TOURNAMENT_MEDIA_GATEWAY_JWT=<value>` | `TOURNAMENT_MEDIA_GATEWAY_JWT_FILE=/run/secrets/example` |
| `TOURNAMENT_MEDIA_GATEWAY_KEY=<value>` | `TOURNAMENT_MEDIA_GATEWAY_KEY_FILE=/run/secrets/example` |
| `SUPABASE_PUBLISHABLE_KEY=<value>` | `SUPABASE_PUBLISHABLE_KEY_FILE=/run/secrets/example` |
| `SUPABASE_ANON_KEY=<value>` | `SUPABASE_ANON_KEY_FILE=/run/secrets/example` |

Setting both halves of a pair is a start-up refusal (`SECRET_SOURCE_AMBIGUOUS`),
not a preference. Two sources for one credential means one of them is stale, and
picking silently is how a rotated credential keeps not taking effect.

There is no fallback in the other direction either. A `_FILE` that is missing,
unreadable, empty or implausible fails; it never falls back to the environment.

## Precedence, unchanged

The apikey is the first of `TOURNAMENT_MEDIA_GATEWAY_KEY`,
`SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY` that is supplied — whichever
source each is given. The bearer is `TOURNAMENT_MEDIA_GATEWAY_JWT` when set,
otherwise the apikey, and a publishable key is not a JWT so it still cannot be
the bearer (`RENEWER_GATEWAY_JWT_REQUIRED`). The file mechanism reorders
nothing.

Every existing rule about the gateway credential also survives it. A service
credential — `sb_secret_…`, or a JWT whose role is `service_role` — is refused
with `RENEWER_GATEWAY_KEY_PRIVILEGED` when it arrives from a file exactly as
when it arrives from the environment. This process holds no service credential.

## What the file must contain

- the credential, and nothing else;
- at most one trailing line ending, `LF` or `CRLF`, which is removed. Anything
  else — leading spaces, interior whitespace, a second trailing newline — is
  part of the credential and is kept. This is one documented allowance, not a
  `trim()`;
- at most 64 KiB;
- no NUL byte.

The path must be **absolute**, and must name a **regular file** — not a
directory, not a fifo, and **not a symlink**. A symlink is refused rather than
followed: the point of the mechanism is that the operator named the file.

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
| `RENEWER_SECRET_MISSING` | no attestation secret, or one under 32 characters |
| `RENEWER_GATEWAY_KEY_MISSING` | no gateway credential by either mechanism |

The split between `SECRET_FILE_UNREADABLE` and `SECRET_FILE_NOT_REGULAR` is the
kernel's, not a promise this worker makes. A non-regular file is rejected at the `fstat` on the open
descriptor, so it reports `SECRET_FILE_NOT_REGULAR` only when the open succeeded;
when the kernel refuses the open first, the failure is `SECRET_FILE_UNREADABLE`
and the `fstat` never runs. Do not pin a specific code for a specific special
file — platforms differ. What is guaranteed is the part that matters: **no
non-regular file ever yields a credential, and none of them can hang start-up.**

No message ever contains a credential, a file's contents, or a path. They name
the variable and the rule. `secretValues()` continues to cover file-sourced
values, so everything downstream that redacts through it — alerts, exit
messages, the state file — keeps doing so.

## Ordering

`resolveHealthUrl` validates `SUPABASE_URL` and
`TOURNAMENT_MEDIA_EXPECTED_API_HOST` against the compiled forbidden-target
policy **before** any credential is touched, and the file source does not change
that. A host that names Production costs no read of the attestation secret and
opens no file at all. `test/secret-source.test.mjs` asserts the absence of the
syscall, not merely the presence of the error.

## Example

Fictional throughout. `example.supabase.co` is a placeholder — the repository's
static guard refuses a tracked file that names any Supabase host it does not
recognise, including invented ones.

```yaml
services:
  renewer:
    environment:
      SUPABASE_URL: https://example.supabase.co
      TOURNAMENT_MEDIA_EXPECTED_API_HOST: example.supabase.co
      TOURNAMENT_MEDIA_ATTESTATION_SECRET_FILE: /run/secrets/example
      TOURNAMENT_MEDIA_GATEWAY_JWT_FILE: /run/secrets/example
    secrets:
      - source: example
        target: example
secrets:
  example:
    file: ${SECRET_DIR}/example
```

The container configuration holds paths. It does not hold credentials.

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

## Rotation

Replace the file and restart the container. Credentials are read once, at
start-up, so a running process keeps the values it started with.
