# arma2-torneos-isolated-local — Phase 3B R2 LOCAL

Isolated **Torneos non-production** stack for the hybrid architecture (Core staging stays remote,
Torneos runs here). One database with the certified Phase 2C/2D baseline + the staging v1 RPC
exposure gate behind PostgREST on loopback. **No Core service exists in this compose file**: nothing
can be reached DB-to-DB. Certification report: `backend/torneos/phase3b/REPORT.md` §7.2.

| Loopback | Service | Phase |
|---|---|---|
| `127.0.0.1:58430` | PostgREST (Torneos Data API) | R2 |
| `127.0.0.1:58431` | edge-runtime `torneos-gateway` (profile `gateway`, not started in R2) | R4 |
| — | `torneos-db` is never published (internal network + `docker exec` only) | |

```
node lab.mjs up        # integrity (hash-pinned) → isolation preflight → fresh volume → install → verify (16/16)
node lab.mjs certify   # A catalog · B 479/0 equivalence · C data API · D isolation · E evidence
node lab.mjs reset     # down -v → up → certify   (run 2 must hash-match run 1)
node lab.mjs drift [17.6.1.147]   # informative, non-blocking, fresh --network none container, removed
node lab.mjs status | down | destroy
node --test ../../backend/torneos/phase3b/local/local.test.mjs   # offline
```

Dependency-free (RS256 via `node:crypto`), no Supabase CLI, fixed Docker socket, explicit project
name, images pinned by id (never pulled). `.runtime/` holds **lab** secrets only (0600, gitignored).
Evidence goes to `backend/torneos/phase3b/evidence/local-torneos-*.json` and is never overwritten.
Every HTTP request of the certifier is confined to `127.0.0.1:58430` by a runtime guard.
