# Multimedia Staging runtime — architecture and staged rollout

The declarative description of the host that will run
`workers/tournament-media-processor` and
`workers/tournament-media-signer-renewer` for Staging.

**Nothing in this document has been provisioned or executed.** No VM exists, no
Hetzner API call was made, no firewall was created, no secret was created or
read, no container was started, no Supabase project was contacted, no migration
was run.

Manifests: [`ops/torneos-staging/media-runtime/`](../../ops/torneos-staging/media-runtime/).
Secret model: [tournament-media-staging-secret-injection.md](./tournament-media-staging-secret-injection.md).
Stop and rollback: [tournament-media-staging-rollback.md](./tournament-media-staging-rollback.md).

---

## Secret injection: resolved

**`SECRET_INJECTION_CODE_GAP` is CLOSED.** The manifest injects the three
credentials as files, and both worker packages now implement the `*_FILE` form
natively — `src/secret-source.mjs`, added by PR #139 and merged into
`epic/arma2-torneos`. The path lives in `environment:`; the credential does not.
No entrypoint wrapper is used, and none may be added: the secret is read
directly by Node at start-up, so it never enters the process environment. The
mechanism is detailed in the secret-injection document.

The host ownership contract is two-layered: the secret directory is
`root:root 0700`, while each secret file is `1000:1000 0400`. The root-only
directory is the traversal control: host uid 1000 cannot open those files even
though their owner number matches. Docker exposes each file to container uid
1000 as a read-only bind mount.

---

## Host

| | |
|---|---|
| Provider | Hetzner Cloud |
| Instances | 1 |
| Shape | 4 vCPU / 8 GB RAM |
| Runtime | Docker Compose under systemd |
| Inbound | SSH from `ADMIN_CIDR` only |

Budget: clamd 4 GB, processor 1 GB, renewer 256 MB — 5.25 GB of 8, leaving the
host itself roughly 2.75 GB. clamd is the large one because it holds the full
signature set in memory; a clamd that is swapping fails scans on timeout, and a
failed scan correctly blocks an upload, so under-provisioning it looks like a
pipeline fault rather than a memory fault.

---

## Topology

```
                        ┌──────────────────────── Hetzner Cloud firewall ────┐
                        │  in : tcp/22 from ADMIN_CIDR only                  │
                        │  out: 443, 80, 853→DoT, udp/123, icmp             │
                        └───────────────────────────────────────────────────┘
                                            │
  ┌───────────────────────────────── Staging VM ──────────────────────────────┐
  │                                                                            │
  │   nftables (host processes)          DOCKER-USER → ARMA2-MEDIA (containers)│
  │                                                                            │
  │   ┌────────────┐     media-internal 172.31.20.0/28   (internal: true)      │
  │   │ processor  │◄────────────── 3310 ──────────────►┌────────────┐         │
  │   │            │                                     │   clamd    │         │
  │   │ 1 CPU 1 GB │                                     │  4 GB      │         │
  │   │ ro rootfs  │                                     │ freshclam  │         │
  │   └─────┬──────┘                                     └─────┬──────┘         │
  │         │ processor-egress .16/28                          │ clamav-egress  │
  │         │                                                  │ .32/28         │
  │   ┌─────▼──────┐                                           │                │
  │   │  renewer   │─── renewer-egress .48/28 ───┐             │                │
  │   │  256 MB    │                             │             │                │
  │   │  ro rootfs │                             │             │                │
  │   └────────────┘                             │             │                │
  │                                              │             │                │
  │   unbound on .17 / .33 / .49  ───────────────┴─────────────┘                │
  │     Production ref → NXDOMAIN                                              │
  └────────────────────────────────────────────────────────────────────────────┘
                     │                              │
              Supabase Staging                ClamAV mirrors
```

### Networks

| Network | `internal` | Members | Purpose |
|---|---|---|---|
| `media-internal` 172.31.20.0/28 | **yes** | processor, clamd | the only path to clamd:3310 |
| `processor-egress` .16/28 | no | processor | HTTPS to Supabase Staging |
| `clamav-egress` .32/28 | no | clamd | freshclam signature updates |
| `renewer-egress` .48/28 | no | renewer | HTTPS to the signer gateway |

The processor needs both TCP to clamd and HTTPS outbound, so it is on two
networks; clamd is deliberately **not** on `processor-egress` and the processor
is deliberately **not** on `clamav-egress`. The renewer shares no network with
either, so it can neither reach clamd nor be reached by it.

Subnets are pinned rather than pool-allocated because they are the selectors the
firewall matches on. An auto-allocated subnet would make the firewall describe a
different network after any recreate.

### What isolates what — the honest division

**Docker enforces:**

- `internal: true` — real. Docker installs rules that drop traffic between that
  subnet and anything outside it, and gives it no default route. clamd:3310 is
  unreachable off-host by construction, not by convention.
- Network membership — real. Containers can only address each other on a shared
  network.
- No published ports — real. No `ports:` anywhere means no host-side listener.

**Docker does NOT enforce:**

- Anything about destinations. A non-internal bridge grants NAT'd egress to
  every routable address. Creating four bridge networks restricts *nothing*
  about where a container may connect. Their value is that each service leaves
  through a distinct subnet, which is what makes per-service firewall rules
  possible at all.

**nftables / DOCKER-USER enforces:**

- Per-service egress **ports**. A compromised processor cannot leave over SMTP,
  SSH or arbitrary DNS. clamd has generic tcp/80,443 for freshclam and can reach
  any endpoint on those ports, including a Supabase host at the network layer.
  It has no Supabase credential and does not share `processor-egress`; credential
  separation, not the ClamAV firewall rule, limits its impact.
- **Not** destinations. `tcp dport 443 accept` permits every HTTPS host on the
  internet. A packet filter never sees the SNI it would need to distinguish
  Supabase Staging from Production. Anyone reading the ruleset as "Production is
  firewalled off" has read it wrong.
- Bypassable by host root. The layer that survives host root is the Hetzner
  Cloud firewall, enforced outside the VM.

**DNS enforces:**

- That Production's name returns NXDOMAIN on this host. Defence in depth.
- **Not** anything against a connection by IP literal.

**The actual guarantee** that this host cannot reach Production is
`workers/*/src/target.mjs`: Production's ref is compiled in as forbidden, the
environment can only add to that list and never subtract from it, and every
request URL is re-validated against a frozen descriptor immediately before the
credential leaves the process. Pointing this host at Production is a reviewed
source change, not a configuration flip.

---

## DNS

Local `unbound`, `local-zone: "rcyuuoaqfwcembdajcss.supabase.co." always_nxdomain`,
everything else forwarded over DNS-over-TLS to two independent operators.

**No `/etc/hosts` entry and no pinned addresses.** Supabase sits behind
Cloudflare: those addresses are anycast and rotate, so pinning one converts a
routine upstream change into an outage that looks like a code bug. A hosts entry
also cannot express "must not resolve" — `127.0.0.1` is an *answer*, so a client
connects to the loopback and reads whatever listens there.

**The trap that makes this work or silently not work:** when the host's
`/etc/resolv.conf` lists a loopback nameserver, `dockerd` discards it for
containers and substitutes public resolvers. Every container would then resolve
around the policy while the host looks correctly configured. The fix is in the
compose file: each service sets `dns:` to its own egress bridge gateway, which
is this host on a non-loopback address.

Unbound keeps only the explicit interfaces `.17`, `.33` and `.49` and enables
Linux `ip-freebind: yes`. IP_FREEBIND lets it start before Docker creates those
bridge addresses; when the networks appear, the same addresses become usable.
It does not listen on `0.0.0.0`, and Production NXDOMAIN remains defence in
depth beneath the workers' primary compiled target guard.

**When the resolver is down**, nothing degrades open: the processor's requests
fail and its lease expires; the renewer's cycle fails and the attestation
lapses, closing `uploadReady`; freshclam cannot update and clamd keeps serving
the signatures it has until the worker's own 7-day freshness check refuses them.
A resolver outage stops work. It never widens what is reachable.

---

## Health

Three separate things, kept separate:

| | Runs | Touches Supabase | Where |
|---|---|---|---|
| **Liveness / local readiness** | every 60s | **no** | Docker `HEALTHCHECK` |
| **ClamAV readiness** | every 30s | no | Docker `HEALTHCHECK` |
| **Remote certification** | manual only | **yes, writes** | not configured anywhere |

**Processor local readiness** — `probes/processor-local-readiness.mjs`: Node
major is 22, sharp/libvips can decode-resize-encode real pixels, and clamd
answers a `zPING` on 3310. It deliberately does not import from `/app`: a
healthcheck sharing modules with the process it watches reports healthy whenever
those modules load.

**ClamAV readiness** — `clamdscan --ping` plus `clamdscan --version`, which
returns the daemon's own `ClamAV <ver>/<sigs>/<date>`. Ping, version and
signature set in one local command.

**Remote certification** — `npm run healthcheck` runs the full worker self-test,
which uploads, downloads and deletes `_selftest/<timestamp>.png` in the Staging
bucket.

> **`REQUIRES_EXPLICIT_REMOTE_WRITE_AUTHORIZATION`**
>
> It is **not** configured as a `HEALTHCHECK` at any interval. As a periodic
> probe it is an unbounded series of remote writes against a project whose write
> authorization is granted per operation. It stays a manual command, run
> deliberately, once, with authorization.

**The renewer has no healthcheck at all.** Its only health endpoint *attests* as
a side effect of answering, so probing it on an interval would mint a fresh
3600s attestation forever, from a probe. The renewal loop already makes exactly
that call on its own schedule.

---

## ClamAV persistence

Named volume `clamav-db` → `/var/lib/clamav`, declared at the top level so it is
not an anonymous volume lost on recreate.

- The official image's entrypoint owns and initialises the directory; clamd and
  freshclam run as the image's `clamav` user and are the only writers.
- **The processor does not mount it.** It reaches clamd over TCP and never reads
  a signature file. Same for the renewer.
- `docker compose stop` / `start` and `systemctl restart` all preserve it. Only
  `docker compose down -v` destroys it, which is why the systemd unit uses
  `stop` and never `down`.

Verifying persistence does not require downloading real signatures:

```bash
docker compose -f docker-compose.staging.yml exec clamd sh -c \
  'ls -l /var/lib/clamav; clamdscan --version'
docker compose -f docker-compose.staging.yml restart clamd
# same file list, same signature count — no re-download
```

Requires a running stack, so it belongs to stage **I2** below.

---

## Staged rollout — I1 to I4

Each stage is separately authorized. **None has been executed.** Do not proceed
past a stage whose checklist is unsatisfied, and do not batch stages: the point
of the split is that each one has exactly one way to fail.

### I1 — empty infrastructure

Create the VM, the Hetzner firewall, the resolver and the host firewall. Nothing
Arma2-specific runs. The future provisioning order is: the host exists; local
tools including Docker are installed; Docker network inspection and the
effective daemon address pools are authoritative and inspectable; the preflight
runs; only then may the four Arma2 networks (`172.31.20.0/28`, `.16/28`,
`.32/28`, `.48/28`) or rules depending on them be created.

- [ ] Authorization recorded, naming I1 specifically
- [ ] **Before any Arma2 networking**, `node firewall/address-space-preflight.mjs`
      returns `ADDRESS_SPACE_PREFLIGHT_OK` for `172.31.20.0/24`; any collision or
      UNKNOWN source blocks I1. It reads local routes (all tables, including
      visible VPN/admin routes), interface addresses, Docker networks and the
      configured Docker address pools. Docker missing, failed network inspection,
      or address pools that cannot be determined authoritatively are UNKNOWN and
      block I1; absence of `daemon.json` is not evidence that no pools exist.
      Future provisioning must install/start Docker and expose its effective
      network and pool configuration to make those sources inspectable. The
      preflight contacts no Hetzner API.
- [ ] `ADMIN_CIDR` decided and substituted; the repository keeps its placeholder
- [ ] `firewall/validate.sh` passes on the host, with `nft` and `shellcheck`
      actually installed so nothing reports SKIP
- [ ] Firewall applied through `apply-with-rollback.sh --i-am-on-the-console`,
      confirmed from a **second** ssh session
- [ ] `unbound-checkconf` accepts the fragment; Production resolves NXDOMAIN and
      Staging resolves, both checked from the host
- [ ] Docker remains installed; `docker compose version` reports v2
- [ ] The exact `clamav/clamav:1.4.5-debian` image is acquired and inspected in
      this separately authorized provisioning stage. This remediation performs
      no pull; runtime `pull_policy: never` fails closed if it is absent.
- [ ] **No Arma2 image built, no secret created**

### I2 — ClamAV only

- [ ] Authorization recorded, naming I2
- [ ] `docker compose up -d clamd` only
- [ ] freshclam completes a first download; `clamdscan --version` reports a
      signature set
- [ ] Restart-persistence check above passes
- [ ] `docker compose ps` shows clamd healthy and **no other service running**
- [ ] `docker inspect` confirms clamd has no `SUPABASE_*`, service-role or other
      Supabase credential and is not attached to `processor-egress`
- [ ] The reviewed policy still allows only generic tcp/80,443 from
      `clamav-egress` and drops other ports; no destination-isolation claim is
      made and no Supabase endpoint is contacted to test it
- [ ] **No Supabase contact of any kind**

### I3 — processor with no credential

The stage that proves fail-closed behaviour is real rather than intended.

- [ ] Authorization recorded, naming I3
- [ ] Image built from the pinned Dockerfile and tagged
- [ ] `ARMA2_MEDIA_SECRET_DIR` points at a directory whose files are **empty**
- [ ] Processor starts and **exits `WORKER_MISCONFIGURED`** — this is the pass
      condition, not a failure
- [ ] `docker inspect` on the processor shows **no** credential value in
      `Config.Env`; only `*_FILE` paths
- [ ] `docker compose config` output contains no credential
- [ ] Local readiness probe passes when run by hand against a running container
- [ ] **No Supabase contact, no attestation written**

### I4 — local smoke

- [ ] Authorization recorded, naming I4
- [x] `SECRET_INJECTION_CODE_GAP` closed — PR #139, in the epic. The images
      deployed to the host must be built from a revision that contains it
- [ ] Secret directory `root:root 0700`; real files `1000:1000 0400`
- [ ] Processor starts and reaches its polling loop
- [ ] Renewer starts and validates its target without contacting anything
- [ ] Remote certification **still not run** — it is its own authorization

Anything beyond I4 — the first remote write, the first attestation, the first
real job — is outside this document and outside this change.

---

## Operating the stack

```bash
cd /opt/arma2/media-staging

docker compose -f docker-compose.staging.yml config     # parse, no side effects
systemctl status arma2-media-staging
docker compose -f docker-compose.staging.yml ps
docker compose -f docker-compose.staging.yml logs --tail=100 processor
```

The systemd unit runs `up --no-build`, and all three services declare
`pull_policy: never`. Processor and renewer therefore use only a previously
built/reviewed local image; ClamAV uses only the exact tag obtained during the
authorized provisioning step. If any image is missing, startup fails. A
systemctl restart is never an image-acquisition mechanism.

`Type=oneshot` plus `RemainAfterExit` supervises the Compose CLI only while
start/stop runs; it does not monitor container life after `up -d` returns.
Docker's service restart policies maintain the containers. The unit's
`Restart=on-failure` applies only when `ExecStart` itself fails.

---

## Local validation of these manifests

No Docker required:

```bash
node --test ops/torneos-staging/media-runtime/test/*.test.mjs
ops/torneos-staging/media-runtime/firewall/validate.sh
```

Where Docker exists, `docker compose config` is the authoritative reader and
should be run as well. The Node suite exists because it is the check that runs
everywhere — including on the machines that review this change, none of which
have Docker, `nft`, `yq` or `systemd-analyze`.
