# Multimedia Staging — stop and rollback runbook

Four distinct operations, in increasing order of what they destroy. They are
separated because they are separately authorized, and because the most common
mistake is reaching for the last one when the first would have done.

**Nothing in this document has been executed.** There is no Staging host. No
command here has been run against any environment.

| | Stops work | Removes containers | Removes signatures | Removes the host |
|---|---|---|---|---|
| 1. Stop the processor | yes | no | no | no |
| 2. Stop the renewer | after ≤3600s | no | no | no |
| 3. Stop the stack | yes | no | no | no |
| 4. Destroy the host | yes | yes | yes | yes |

None of them touch the database, Storage or any migration. There is no step in
this document that deletes a row or an object.

---

## 1. Stop the processor

The routine operation. Media stops being processed; nothing is lost.

```bash
docker compose -f docker-compose.staging.yml stop --timeout 400 processor
```

### What is supposed to happen

- **SIGTERM**, then up to the `stop_grace_period` of 6 minutes. The `--timeout
  400` is longer than the 300s lease on purpose: a worker holding a job gets
  time to finish or hand it back before anything escalates to SIGKILL.
- **No new leases.** The worker's loop stops claiming work as soon as it is
  signalled.
- **Revoke is best-effort.** If the in-flight job can be released cleanly, it is.
  A failed revoke is not an error state and must not be retried into one.
- **Expiry is the guarantee, not revoke.** If revoke fails, the lease expires on
  its own after ≤300s and the job returns to the queue. If the processor's
  attestation cannot be renewed, it expires after ≤900s
  (`TOURNAMENT_MEDIA_ATTEST_TTL_SECONDS`).
- **`uploadReady` fails closed.** With no valid processor attestation,
  `tournament_media_pipeline_readiness()` closes and the client stops offering
  uploads. Stopping the processor cannot leave uploads accepted with nothing to
  process them.

### What to check

```bash
docker compose -f docker-compose.staging.yml ps processor     # Exited (0)
docker compose -f docker-compose.staging.yml logs --tail=50 processor
```

A non-zero exit after a `stop` means SIGKILL was reached. That is worth
understanding — it implies a job took longer than the grace period — but it is
not a data-loss event: the lease still expires and the job still returns.

### Restart

```bash
docker compose -f docker-compose.staging.yml start processor
```

---

## 2. Stop the renewer

```bash
docker compose -f docker-compose.staging.yml stop --timeout 30 renewer
```

The renewer's shutdown budget is 5 seconds and its interval sleep is
interruptible, so 30 is generous.

**Understand what this starts:** the signer's attestation has a 3600s TTL and
the renewer is the only thing that refreshes it. Stopping it does not stop
uploads now — it stops them **within the hour**, when the current attestation
expires and `uploadReady` closes.

That delay is a feature of the fail-closed design and a trap for an operator who
stops the renewer, sees nothing break, and moves on. If uploads must keep
working, the renewer must come back before the current attestation expires.
`TOURNAMENT_MEDIA_ATTESTATION_KNOWN_EXPIRES_AT` exists so a restarted renewer
can report a real margin instead of "cannot prove one".

Nothing here revokes anything. The only path that deletes an attestation is
`revoke_tournament_media_service_attestation(...)`, which is a database
operation under its own authorization and is **not** part of stopping a
container.

---

## 3. Stop the whole stack

```bash
systemctl stop arma2-media-staging
```

which runs `docker compose stop --timeout 400` — **`stop`, never `down`**.

`down` removes the networks, and the moment anyone appends `-v` it removes the
`clamav-db` volume with them. That turns a two-minute stop into a full signature
re-download, and on a host with restricted egress it can turn into a clamd that
never becomes healthy again. `stop` leaves containers, networks and volumes in
place.

Order matters if stopping by hand: **renewer, then processor, then clamd.**
Stopping clamd first leaves the processor unable to scan, which it correctly
treats as a reason to refuse work — a burst of failures that looks like an
incident and is only an ordering mistake.

### Rolling back a bad image

```bash
# the tags are pinned in docker-compose.staging.yml; roll back by editing the
# tag and restarting, never by rebuilding in place
docker compose -f docker-compose.staging.yml up --detach --no-build processor
```

`--no-build` prevents a rebuild and `pull_policy: never` prevents acquisition
from a registry. The rollback therefore uses only a tag already present on the
host and fails closed if that image is absent. `systemctl restart` and
`docker compose up` are never image-acquisition mechanisms.

---

## 4. Destroy the host

**Requires its own explicit authorization. Not covered by any of the above.**

This is deliberately not a script. Guards to satisfy first, in order:

1. **Is the pipeline supposed to be off?** Destroying the host stops media
   processing for Staging entirely. Confirm that is intended, not incidental to
   fixing something else.
2. **Are the attestations expected to lapse?** They will, within 3600s. Uploads
   will close. That is correct behaviour and should be expected rather than
   discovered.
3. **Are the secrets accounted for?** The three files under
   `ARMA2_MEDIA_SECRET_DIR` are on the host disk. Destroying the VM destroys
   them, which is fine if and only if they are recoverable from wherever they
   were originally issued. If the only copy of the attestation secret is on that
   disk, **stop** — destroying the host means the signer can never be renewed
   again without a rotation.
4. **Is the signature volume needed?** It is not, in the sense that freshclam
   re-downloads it. Budget the time.

Then, and only then, remove the server through the Hetzner console or API. That
is a separate authorized operation; nothing in this repository performs it.

There is no step in this section that touches the Supabase project. Destroying
the host leaves the database, Storage, migrations and Edge Functions exactly as
they were.

---

## Rolling back the firewall

Separate from all of the above, and the one with a time limit.

```bash
# from a NEW ssh session, within CONFIRM_WINDOW
sudo ops/torneos-staging/media-runtime/firewall/apply-with-rollback.sh --confirm
```

If the new session cannot connect, **do nothing**. The armed revert feeds the
saved backup to `nft -f`; that backup begins with `flush ruleset` and then the
complete pre-apply dump, so restoration replaces rather than merges the nft
ruleset. The iptables snapshot remains a separate `iptables-restore` step. The
raw nft dump and the combined backup use separate temporary files. A failed,
zero-byte or whitespace-only dump publishes nothing, removes the temporary
files and preserves any prior valid definitive backup. A stale temporary file
is never treated as that definitive backup. The offline tests prove backup
construction, cleanup and publication ordering, not live-kernel atomicity. The
files live under `/var/lib/arma2-media-staging/firewall/`.
Confirming from the session that applied the rules proves nothing: it is already
`ESTABLISHED`, so conntrack accepts it whatever the input policy says.

If the deadman has already fired and the rules are gone, that is the system
working. Re-run `validate.sh`, fix what was wrong, and apply again.
