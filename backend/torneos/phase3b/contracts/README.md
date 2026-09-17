# Phase 3B — shared bootstrap verification contract (**VERIFICATION CONTRACT V2**)

`torneos-bootstrap-verify.sql` + `torneos-bootstrap-expect.json` are the ONE source both Torneos
bootstrap runners certify against, so the local isolated stack (R2 local,
`integration/torneos-isolated-local`) and the remote project (R2 remote, deferred:
`remote/bootstrap-torneos.sh`) prove the same numbers by construction.

* `torneos-bootstrap-verify.sql` — the read-only catalog query with the 33 gated names replaced by the
  placeholder `__GATED_NAMES__` (4 occurrences). **No header comment on purpose**: the runners send the
  rendered text as-is and pin its SHA-256; trailing newlines are stripped before rendering. Any edit
  here changes that hash and both runners STOP.
  * **v1** — byte-for-byte the text the remote runner carried inline before the extraction
    (rendered sha256 `7b8881ea6c8faafd3a949dd29895e42e61645e186206bb8b239a1e8b1666b7e0`). Never
    executed anywhere until R2-local. **Latent defect**: the `cron_jobs` and `storage_buckets` probes
    referenced `cron.job` / `storage.buckets` inside a `CASE … ELSE (select count(*) …)`; PostgreSQL
    resolves the relation while parsing, so the whole query failed on any database where those
    optional relations are absent (`ERROR: relation "cron.job" does not exist`) — the certified image
    (17.6.1.143) and any hosted project without `pg_cron`. Evidence of the failure kept:
    `evidence/local-torneos-bootstrap-20260915T171938Z.json`, `local-torneos-certify-20260915T171954Z.json`,
    `local-torneos-certify-20260915T172211Z.json` (16/17, only A failing).
  * **v2 (current, operator decision 2026-09-15)** — ONLY those two expressions changed: the count is
    evaluated lazily (`query_to_xml` inside the `ELSE` branch), so an absent relation yields `-1` as the
    v1 author intended and a present one yields the same count v1 returned. Rendered sha256
    `0d6ef458d0d46375d8332c6a85e014597a7d30f0d4891d1b62e12df88c9c844c` (file
    `50cb9453be7aa5f7b317f108f10133cb4f231b7164bfd33d0d65754d3995fb50`). NOT a product, baseline, gate or
    ACL/RLS change; the 16 expectations are untouched (neither field is an expectation).
* `torneos-bootstrap-expect.json` — the expected values, in the order they are checked (first mismatch
  aborts); sha256 `2c0772c2bda3433e60a44c00b62a8ef79de976c205a7a88379c9e44dfdb81118`, identical in v1
  and v2. Scalars compare as their string form, arrays as their JSON text — exactly the comparison the
  remote runner made inline (`json_field` → `expect`).
* `session.schema.json` — the Core contract v1.1 `session` verdict schema (bundled into the gateway).

Offline identity tests: `node --test backend/torneos/phase3b/local/local.test.mjs` and
`remote/inventory.test.mjs` assert the rendered hash, the 16 expectations, and that neither runner
carries its own copy.
