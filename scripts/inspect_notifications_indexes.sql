-- Inspect indexes on notifications table
SELECT
    i.relname as index_name,
    pg_get_indexdef(ix.indexrelid) as index_def
FROM
    pg_class t,
    pg_class i,
    pg_index ix,
    pg_attribute a
WHERE
    t.oid = ix.indrelid
    AND i.oid = ix.indexrelid
    AND a.attrelid = t.oid
    AND a.attnum = ANY(ix.indkey)
    AND t.relkind = 'r'
    AND t.relname = 'notifications'
GROUP BY
    i.relname,
    ix.indexrelid;
