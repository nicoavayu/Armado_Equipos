"""Compile/analyze PL/pgSQL in a transaction; diagnostics extension is rolled back."""
import json
from lab import BASE,sql
query="""
BEGIN;
CREATE EXTENSION plpgsql_check WITH SCHEMA extensions;
SELECT coalesce(json_agg(x),'[]') FROM (
 SELECT p.oid::regprocedure::text AS function, c.relname AS trigger_table,
 d.*
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 JOIN pg_language l ON l.oid=p.prolang
 LEFT JOIN pg_trigger t ON t.tgfoid=p.oid AND NOT t.tgisinternal
 LEFT JOIN pg_class c ON c.oid=t.tgrelid
 CROSS JOIN LATERAL extensions.plpgsql_check_function_tb(p.oid,coalesce(t.tgrelid,0)::regclass,
 fatal_errors=>false,security_warnings=>true) d
 WHERE n.nspname IN ('public','private') AND l.lanname='plpgsql'
 AND (p.prorettype <> 'trigger'::regtype OR t.tgrelid IS NOT NULL)
 ORDER BY p.proname,c.relname,d.lineno
) x;
ROLLBACK;
"""
lines=sql('baseline',query).splitlines();data=json.loads('\n'.join(lines[2:-1]))
(BASE/'evidence/function-analysis.json').write_text(json.dumps(data,indent=2)+'\n')
errors=[d for d in data if d['level']=='error'];print(len(errors),'errors;',len(data),'total diagnostics')
for d in errors:print(d['function'],d['lineno'],d['message'])
