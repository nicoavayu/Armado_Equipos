# Rehearsal on Core Production's real schema

Core Production is not the schema the repository's migrations build. The canonical RLS and
grants migrations are in its ledger but were never executed there, and its tables, views and
policies differ: no `partidos.admin_id`/`uuid`, `profiles` without `telefono`, open `USING (true)`
policies, and others.

So every change for Production is rehearsed on a copy of its **real** schema: the coordinator's
`~/Arma2Backups/d3-prod-schema-lab.sh`, which loads a `pg_dump --schema-only` of Production into
a container with no network. Changes are applied as `postgres`, like in hosted Supabase.

| File | What it is |
|---|---|
| `seed.sql` | Synthetic data shaped like Production: 1,200 accounts with private fields, 40 templates (uuid), 400 matches, 4,000 roster rows, requests and voters. |
| `smoke.sql` | 44 checks, run as anon and as specific accounts inside a rolled-back transaction after the migrations: privacy, codes, rosters, joins, requests, approvals, link voting, survey job. |
| `snapshot.sql` | State the rollbacks must restore: policies, functions, views, triggers, ACLs and data digests. |
| `rehearse.mjs` | `A`: per migration → rollbacks 142→133 → compare + catalog digest. `B`: the exact runbook files. `C`: the alignment and its rollback against Production's original catalog. |

```bash
node integration/prod-schema/rehearse.mjs B
```
