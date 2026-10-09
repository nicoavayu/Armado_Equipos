-- Core / Torneos capacity report (READ ONLY): one SELECT, one JSON row, valid on both projects. Safe to run in the SQL
-- editor or through scripts/ops/free-plan/ops_free_plan.py inspect (which also forces default_transaction_read_only=on).
-- Core's operational logs have their own report: inspect-core-logs.sql.
-- What the Free plan measures is the database size (500 MB per project; the organization's sum is also checked for
-- the Fair Use restriction). This report says where that size is and how much of it is operational logs or bloat.
with rels as (
  select n.nspname as schema, c.relname as name, c.oid, c.relkind,
         pg_total_relation_size(c.oid) as total, pg_relation_size(c.oid) as heap, pg_indexes_size(c.oid) as idx
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'm')
)
select json_build_object(
  'read_only', current_setting('default_transaction_read_only'),
  'database', current_database(),
  'database_bytes', pg_database_size(current_database()),
  'cluster_bytes', (select sum(pg_database_size(datname)) from pg_database where datallowconn and has_database_privilege(datname, 'CONNECT')),
  'schemas', (select json_agg(s order by s.bytes desc) from (select schema, sum(total) as bytes from rels group by schema) s),
  'top_relations', (select json_agg(t) from (select schema || '.' || name as rel, total, heap, idx from rels order by total desc limit 15) t),
  'wal_lsn', pg_current_wal_lsn()::text
)::jsonb::text as report
