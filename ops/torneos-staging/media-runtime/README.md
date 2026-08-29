# Multimedia Staging runtime manifests

Declarative description of the single Hetzner Cloud VM that will run the
tournament media pipeline for Staging.

> **NOTHING HERE IS PROVISIONED OR APPLIED.**
> No VM, no Hetzner API call, no firewall, no secret, no container, no Supabase
> contact, no migration. These files describe a host that does not exist yet.

> **`SECRET_INJECTION_CODE_GAP`: CLOSED.**
> The manifest injects credentials as files, and the workers now implement the
> `*_FILE` form natively — added by PR #139 and merged into the epic. The three
> names this manifest passes are read directly by Node, with no entrypoint
> wrapper. See
> [the secret-injection audit](../../../docs/operations/tournament-media-staging-secret-injection.md).

## Files

| Path | What it is |
|---|---|
| `docker-compose.staging.yml` | the stack: `clamd`, `processor`, `renewer` |
| `env.example` | non-secret configuration; copy to `/etc/arma2/media-staging/runtime.env` |
| `probes/processor-local-readiness.mjs` | the processor `HEALTHCHECK`; local only, never touches Supabase |
| `systemd/arma2-media-staging.service` | unit template — **not installed** |
| `firewall/nftables-host.staging.nft` | host packet policy — **not applied** |
| `firewall/docker-user.rules.sh` | container egress policy — **not applied** |
| `firewall/hetzner-cloud-firewall.json` | edge firewall spec — **not created** |
| `firewall/validate.sh` | dry run; parses and checks, loads nothing |
| `firewall/apply-with-rollback.sh` | the only apply path; arms a revert first |
| `firewall/address-space-preflight.mjs` | local read-only collision check required before I1 |
| `dns/unbound-media-staging.conf` | resolver policy — **not applied** |
| `lib/compose-subset.mjs` | the strict YAML subset reader the tests use |
| `test/` | the guarantees above, re-derived from the files |

## Documentation

- [Architecture and staged rollout I1–I4](../../../docs/operations/tournament-media-staging-runtime.md)
- [Secret injection audit](../../../docs/operations/tournament-media-staging-secret-injection.md)
- [Stop and rollback](../../../docs/operations/tournament-media-staging-rollback.md)

## Validate locally

```bash
npm run test:media-runtime
ops/torneos-staging/media-runtime/firewall/validate.sh
```

Neither contacts anything. Where Docker exists, add the authoritative reader:

```bash
docker compose -f docker-compose.staging.yml config
```

## Why the tests parse the YAML themselves

`docker compose config` is the right validator and is not available on every
machine that reviews this change — Docker, `nft`, `yq` and `systemd-analyze` are
all absent from the environment this was authored in. A guarantee whose only
check silently skips is a comment, so `lib/compose-subset.mjs` reads the
manifests with no dependency at all, and refuses anything outside the small
block subset they are written in. `test/compose-subset.test.mjs` cross-checks
every parse against js-yaml when js-yaml resolves, so the subset cannot drift
from what a real parser would read.

## What this stack does NOT claim

- **`tcp/443` is not a destination restriction.** It permits every HTTPS host on
  the internet. The firewall cannot tell Supabase Staging from Production; it
  never sees the SNI. Production is refused by the compiled block in
  `workers/*/src/target.mjs`, and that is the only layer that actually
  guarantees it.
- **Separate bridge networks do not restrict destinations.** `internal: true`
  does restrict, and membership does; a non-internal bridge grants egress to
  everything routable. The four networks exist so the firewall can write
  per-service rules, not because their existence restricts anything.
- **The host firewall is bypassable by host root.** The Hetzner Cloud firewall
  is the layer that survives a host compromise.
- **The systemd credential path is unverified.** `LoadCredentialEncrypted=` is
  not used because whether `dockerd` can resolve `$CREDENTIALS_DIRECTORY` from
  its own mount namespace is not a property this repository can demonstrate. The
  probe that would settle it is in the secret-injection audit.
- **Runtime never acquires images.** Every service uses `pull_policy: never`;
  processor and renewer must be built locally first, and the pinned ClamAV tag
  must be obtained during a separately authorized provisioning stage. A missing
  image stops startup instead of turning a restart into a pull.
- **systemd does not supervise container life.** The oneshot unit supervises the
  Compose CLI during start/stop; Docker restart policies maintain containers
  after `up -d` exits.
