# Multimedia Staging — secret injection audit

**Verdict: `SECRET_INJECTION_CODE_GAP`.**

The Staging manifest is wired for file-based secret injection. The worker
packages do not implement it yet. Nothing in this repository changes that — the
fix is a small, separate PR against the two workers, specified at the end of
this document.

Nothing here was executed against a host. No secret was created, read or
written. The values in every example below are fictional.

---

## The three secrets

| Secret | Authorises | Holder | Must never reach |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | unconditional authority over the Staging project — bypasses RLS, reads and writes every bucket | `processor` | `renewer`, `clamd` |
| `TOURNAMENT_MEDIA_ATTESTATION_SECRET` | the signer's `health` action, which is what mints a 3600s attestation | `renewer` | `processor`, `clamd` |
| `TOURNAMENT_MEDIA_GATEWAY_JWT` | passing the Functions gateway (`verify_jwt = true`). Public by design | `renewer` | `clamd` |

The split is not stylistic. The processor is the container that decodes
attacker-supplied pixels; giving it the attestation secret would put the
signer's authority inside the largest attack surface on the host. The renewer
deliberately holds no service credential and refuses to start if the credential
it is given looks privileged (`RENEWER_GATEWAY_KEY_PRIVILEGED`).

`test/secrets-model.test.mjs` re-derives all of this from the manifest and from
the worker sources on every run.

---

## The four mechanisms, compared

### What each surface is

- **`docker inspect`** — reads `Config.Env`, the environment baked into the
  container's configuration at creation.
- **`config.v2.json`** — `/var/lib/docker/containers/<id>/config.v2.json`, the
  same data at rest on the host disk, unencrypted, root-readable.
- **`docker compose config`** — the standard "check my manifest" command. It
  renders interpolation, so whatever it interpolates is printed to stdout.
- **`/proc/<pid>/environ`** — the live process environment inside the container.
- **container fs** — a file visible in the container's mount namespace.

### The matrix

| Surface | **A** `environment:` value | **B** Compose file secret | **C** systemd credential | **D** entrypoint wrapper |
|---|---|---|---|---|
| `docker inspect` | **value** | path only | path only | path only |
| `config.v2.json` at rest | **value** | path only | path only | path only |
| `docker compose config` | **value printed** | path only | path only | path only |
| `/proc/1/environ` (container) | **value** | absent | absent | **value** |
| container filesystem | absent | value, tmpfs `0400` | value, tmpfs `0400` | value, tmpfs `0400` |
| process `argv` | absent | absent | absent | absent, *if written correctly* |
| image layers | absent | absent | absent | absent |
| logs | absent | absent | absent | absent |
| **works with today's code** | **yes** | no | no | yes |

### A — `environment:` with the value

Rejected. It is the mechanism the certified local compose file uses, and it is
the reason the Staging manifest is a standalone file rather than an override of
it: Compose **merges** `environment` maps and offers no way to remove an
inherited key, so anything built on
`workers/tournament-media-processor/docker-compose.yml` inherits

```
SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY:?local service key}
```

and with it every row in column A. That is acceptable for `supabase start` on a
developer's laptop, where the key authorises a throwaway local project. It is
not acceptable for a credential with unconditional authority over Staging.

The `docker compose config` row is the one that is usually missed: the ordinary
act of validating the manifest prints the service-role key to the terminal, and
into the log of any CI job that runs it.

### B — Compose file secrets

The chosen mechanism. `secrets:` with `file:` bind-mounts the host file to
`/run/secrets/<name>` inside the container, and only the mount path appears in
the container configuration.

Two implementation facts that must not be guessed at:

- **Compose in non-Swarm mode ignores `uid`, `gid` and `mode`** on file-based
  secrets. The file is mounted with the ownership and mode it has on the host.
  The processor image runs as `node` (uid 1000), so the host files must be
  `chown 1000:1000` and `chmod 0400`. Setting `mode:` in the manifest would
  look like it worked and would do nothing.
- The mount is read-only and the file is not copied into the image or any
  layer.

### C — systemd `LoadCredentialEncrypted=`

Not used, and the reason is structural rather than a preference.

`LoadCredentialEncrypted=` decrypts a secret into `$CREDENTIALS_DIRECTORY`
(under `/run/credentials/<unit>`), on tmpfs, mode `0400`, readable only by the
unit's user, never touching the disk in clear. For a process that reads its own
secrets it is strictly better than a file on disk.

It does not compose cleanly with Docker, because **the bind mount is performed
by `dockerd`, not by the unit**. `dockerd` is a separate long-running daemon and
resolves a volume source path in *its own* mount namespace. `/run/credentials/<unit>`
is a per-unit mount, and whether `dockerd` can see it depends on the host's
systemd version and on whether the unit ends up with a private mount namespace —
which several unrelated hardening directives enable implicitly.

**This is UNVERIFIED and is not claimed either way.** There is no Staging host to
test it on, and the failure mode of guessing wrong is not a clean error: a
source path `dockerd` cannot resolve is created as an empty directory, so the
container starts with an empty secret file and the worker fails on a
missing-credential path that looks like a provisioning mistake.

If it is to be adopted later, this is the probe that settles it — run on the
real host, with a **fictional** value:

```bash
# 1. a throwaway unit that loads a fake credential and asks dockerd to mount it
printf 'not-a-real-secret' > /tmp/fake.cred
systemd-creds encrypt /tmp/fake.cred /etc/arma2/fake.cred.enc
# 2. in the unit: LoadCredentialEncrypted=probe:/etc/arma2/fake.cred.enc
# 3. from inside that unit's ExecStart:
docker run --rm -v "${CREDENTIALS_DIRECTORY}/probe:/probe:ro" busybox cat /probe
```

If that prints `not-a-real-secret`, mechanism C is available and mechanism B
should be replaced by it. If it prints nothing or errors, C is unavailable on
this host and B is correct. Either way, delete `/tmp/fake.cred` afterwards.

Until that probe runs, the secrets are root-owned files under
`ARMA2_MEDIA_SECRET_DIR`, which `dockerd` can unambiguously resolve. **The
residual risk is stated rather than hidden:** those files are at rest on the
host disk, protected by `0400` ownership and whatever full-disk encryption the
VM has, not by TPM sealing.

### D — entrypoint wrapper

Rejected as a default, and `test/secrets-model.test.mjs` fails the suite if it
appears in the manifest without a decision.

A wrapper such as

```sh
export SUPABASE_SERVICE_ROLE_KEY="$(cat /run/secrets/supabase_service_role_key)"
exec node src/index.mjs
```

would make the stack start **today**, with no code change. It keeps the value
out of `Config.Env`, out of `config.v2.json`, and out of `docker compose config`
output — the top three rows of the matrix are genuinely clean.

What it does not do is remove the value from `/proc/<pid>/environ`, because the
worker reads `process.env`. Anything that can read that file — a process with
the same uid inside the container, or root on the host — reads the key. That is
the same exposure as mechanism A for an attacker who is already inside, and the
difference is entirely about the *host-side* surfaces.

It is a real improvement over A, and it is a workaround that makes the code gap
invisible: with a wrapper in place, nothing ever forces the `*_FILE` support to
be written. That is the reason it is not used here.

---

## Why the manifest is wired to a mechanism the code ignores

`docker-compose.staging.yml` passes:

```yaml
SUPABASE_SERVICE_ROLE_KEY_FILE: /run/secrets/supabase_service_role_key
TOURNAMENT_MEDIA_ATTESTATION_SECRET_FILE: /run/secrets/attestation_secret
TOURNAMENT_MEDIA_GATEWAY_JWT_FILE: /run/secrets/gateway_jwt
```

None of those three variables is read by any worker today. Verified against the
source, not assumed:

- `workers/tournament-media-processor/src/supabase.mjs:28` reads
  `env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY`, and throws
  `WORKER_MISCONFIGURED` when both are empty.
- `workers/tournament-media-signer-renewer/src/config.mjs:223` reads
  `env.TOURNAMENT_MEDIA_ATTESTATION_SECRET` and fails
  `RENEWER_SECRET_MISSING` below 32 characters.
- `workers/tournament-media-signer-renewer/src/config.mjs:172` reads
  `env.TOURNAMENT_MEDIA_GATEWAY_JWT`.

So the stack as committed **does not start**. The processor exits
`WORKER_MISCONFIGURED`; the renewer exits `RENEWER_SECRET_MISSING`.

That is the intended state, for three reasons:

1. **It fails closed.** No credential is disclosed, no job is leased, no
   attestation is minted. The pipeline's own fail-closed design does the rest:
   with no fresh attestation, `uploadReady` goes false and uploads stop.
2. **It is honest about the blocker.** The alternative — wiring mechanism A or
   D so the stack comes up — would ship an infrastructure PR whose security
   posture is worse than the one it documents, and would remove the pressure to
   fix it.
3. **It cannot be deployed by accident.** `ARMA2_MEDIA_SECRET_DIR` has no
   default, so `docker compose` refuses to read the manifest at all until an
   operator names a directory. There is no path where this stack quietly comes
   up half-configured.

---

## The follow-up PR this blocks on

Small, isolated, against the two worker packages. **Not part of the
infrastructure PR** — an application change hidden in an IaC diff is how a
credential-handling path gets merged without a credential-handling review.

**Scope**

For each of the three variables, accept a `*_FILE` form:

- if `<VAR>_FILE` is set, read the file, `trim()` the trailing newline, and use
  the contents;
- if both `<VAR>` and `<VAR>_FILE` are set, **fail** — do not prefer one. Two
  sources for one credential means one of them is stale, and picking silently
  is how a rotated key keeps not taking effect;
- if the file is missing, unreadable or empty, fail with the existing
  fail-closed code. No fallback to the environment;
- read it **once, at start-up**, in `readConfig` / `readRenewerConfig`, so the
  existing "target is validated before the credential is read" ordering in
  `target.mjs` is preserved;
- never put the path or the contents in an error message. The existing
  `secretValues()` redactor in the renewer already covers the value.

**Tests it needs**

- `<VAR>_FILE` alone → config resolves, value matches file contents
- `<VAR>` alone → still works, so nothing about the local stack breaks
- both set → refusal, with a distinct code
- file missing / empty / unreadable → the existing fail-closed code
- trailing newline is stripped; interior whitespace is not
- no test uses a real credential

**After it lands**

`test/secrets-model.test.mjs` detects the `*_FILE` support and stops requiring
this document — the invariant it asserts holds in both states, so nothing here
has to be edited in lockstep.

---

## Host provisioning, for whoever creates the secret files later

Not authorized by this change, and listed so the mode/ownership facts above are
not rediscovered from a broken container.

```bash
install -d -m 0700 -o root -g root /etc/arma2/media-staging/secrets

# Written with no trailing newline, from a shell with history disabled.
# uid 1000 is the `node` user inside the processor image; Compose does NOT
# apply uid/gid/mode from the manifest in non-Swarm mode.
install -m 0400 -o 1000 -g 1000 /dev/null /etc/arma2/media-staging/secrets/supabase_service_role_key
install -m 0400 -o 1000 -g 1000 /dev/null /etc/arma2/media-staging/secrets/attestation_secret
install -m 0400 -o 1000 -g 1000 /dev/null /etc/arma2/media-staging/secrets/gateway_jwt
```

Rotation is a file replacement plus `systemctl restart arma2-media-staging`. The
secrets are read at start-up, so a running container keeps the old value until
it is recreated.
