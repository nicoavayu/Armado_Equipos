# R4.1A isolation and R4.1B preparation

Scope: local Torneos + exact Core staging, with the existing R2 DB/REST and ring preserved.
No gateway listener, matrix, QA, fixtures, production request, commit or push is authorized here.

## Architecture

The future gateway uses exactly the harness namespace restrictions: R2's existing internal
network and a new internal proxy network. It has no external interface. A short-lived helper
with NET_ADMIN installs only three peer /32 routes (DB, REST, proxy) and unreachable IPv4/IPv6
defaults. It never enters a DB/REST namespace. The application drops ALL capabilities and
cannot restore a subnet/default route. DNS forwarding points to loopback; local peer aliases
are pinned. No Docker socket is mounted. Root filesystem and dependency cache are read-only.

Only the TLS reverse proxy joins the external bridge. It allows the exact SNI and HTTP Host
`hhyvmhgpapyuzjgxfnqv.supabase.co`; it refuses CONNECT, upgrades and absolute-form URLs.
It connects only to that hardcoded upstream, validates its public TLS certificate, resolves
its IPv4 address on each new connection, and rejects private/local addresses. It never follows
redirects and rejects all upstream 3xx or Location headers. It has IP forwarding disabled.
This is a transport boundary even if gateway JavaScript bypasses the fetch adapter.

The gateway fetch adapter trusts an ephemeral private CA only for the staging hostname and
sets redirect:error. The proxy leaf private key and CA signing key are generated in operator
memory, never written; its public certificates/CSR are temporary and removed after the audit.
The proxy never receives the HMAC during these transport-only tests.

## Custody

The sole HMAC source is macOS Keychain `arma2-torneos-nonprod-core / contract-secret`.
The operator captures it in memory and writes one JSON envelope over `docker exec -i` stdin.
A shell with umask 077 writes a mode 0600 file on a 1 MiB container tmpfs, then atomically
renames it. `consumeCustody` reads it once and unlinks it before parsing/initializing.
The remaining configuration reuses the original R2 ring and limited-login passwords.

Edge main workers do not support Deno.env.set. `installMemoryEnvironment` overrides only the
isolate's JS `Deno.env.toObject` accessor; the secret remains in process memory, never Docker
Config.Env or OS launch environment. The harness verifies actual gateway loadConfig accepts
this configuration. Missing custody input after 15 seconds exits 78; this is tested by
restarting the same container without reinjection. Docker metadata, process argv, logs,
generated files and evidence are scanned in memory for the HMAC. The images are never built
or committed. As usual, the trusted operator/Docker daemon can access process memory.

## Offline dependencies

A local copy of `arma2-core-contracts-phase3a_torneos-deno-cache` holds the certified
`npm:jose@6.2.12` and `npm:postgres@3.4.7`. No package installation or download is performed.
Both declare no package dependencies. Selected ESM entrypoints are `dist/webapi/index.js`
and `src/index.js`. Postgres uses embedded Node builtins: crypto, fs, net, os, perf_hooks,
stream and tls. Its Cloudflare export is not selected. There are no jsr/https imports.
Each cached file, source file and bundle has SHA256 evidence. Exact image IDs are recorded.

The Edge runtime bundles with `--network none`. Runtime loads every gateway module from the
eszip while all network controls are active and the cache is mounted read-only. The harness
intercepts Deno.serve only while importing the gateway, so no actual gateway endpoint opens.
A separate gateway bootstrap is compiled by prepare, but is not executed.

## Running the authorized stages

Use the existing worktree; do not call the old lab.mjs up/reset/destroy or the old Compose
`gateway` profile (it still has generic egress and env_file semantics).

```
node backend/torneos/phase3b/r4/audit.mjs
node backend/torneos/phase3b/r4/runner.mjs prepare
node backend/torneos/phase3b/r4/runner.mjs preflight
```

The first command is the R4.1A runtime harness. The runner refuses prepare/preflight unless
the latest R4.1A attempt passed and all seals, cached dependencies and certified sources match.
Prepare compiles the gateway offline. Preflight verifies seals, R2 IDs/images/start times,
networks, volume, ring, JWKS, Keychain presence without reading its value, absence of temporary
containers and availability of port 58431 (immediate bind/close).

The dispatcher also recognizes start-gateway, smoke, certify, cleanup and status.
All seven handlers are implemented. **start-gateway/smoke/certify require an explicit,
unexpired `.runtime/authorization.json` bound to the R4.1A evidence seal. That authorization
is NOT created by this task.** Their real execution remains deferred to R4.2.
Start-gateway reuses audit.mjs provisioning, /32 route controls and memory custody, selects
the prepared gateway bundle and records its owned resources. The same proxy publishes only
127.0.0.1:58431 and forwards ingress to the fixed gateway container, so the gateway never
needs an external interface. Smoke validates config, JWKS and health read-only. Certify
validates externally supplied `R4.2.matrix.v1` evidence: run/bundle binding, all required
cases, exact 43/33 RPC coverage, evidence hashes and QA/fixture/session cleanup. It does not
create a matrix, fixtures or QA. The matrix producer is outside this R4.1 authorization.
Cleanup is restricted to a recorded run's labeled resources; status reads actual runtime state.
Neither is invoked here, since the audit performs and verifies its own cleanup.

A future authorization must specify phase R4.2, userAuthorized true, the exact commands,
r41aSealSHA256 and expiresAt. Start also requires the approved Core staging public anon key
in coreAnonKey. No public key is guessed or read from a production env file. The authorization
and matrix validators have unit tests; the R4.2 handlers have deliberately not been executed.

## Test interpretation

Core staging /auth/v1/health returning 200/401/403 proves TLS and transport reachability,
not authentication or a successful contract operation. REST is probed read-only. DB probes
use the two intended login/NOLOGIN-role pairs in read-only transactions, and verify they
cannot become postgres. No data mutation is performed.

Production and other denied names are pinned to TEST-NET-1 so denial probes cannot contact
Production even if isolation were faulty. Independently, each forbidden HTTP Host is sent
to the live proxy and must get 403; raw TCP to external IPs, the current staging IP and the
host bridge gateways must fail. Wrong SNI and CONNECT are tested at the live proxy.
Redirect transport tests use a loopback-only synthetic 302, including raw follow without the
fetch wrapper; upstream redirect rejection also has unit coverage. No Core/REST/DB outage
or fault is injected. A live redirect from Core is not induced or claimed.

Evidence retains failed attempts with their true status, followed by the passing run. R2
before/after snapshots cover container identity, image, start time, mounts, networks, health,
roles, functions/ACLs, table ACL/RLS, policies, foreign-server count, ring and JWKS hashes.
This preserves the accepted R2 state; it is not a new full R2 data recertification.
