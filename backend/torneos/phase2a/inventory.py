"""Complete executable inventory, with honest separation of ACL evidence and semantic review."""
import json,pathlib,re,sys,hashlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'tools'))
from lab import sql,BASE
rows=json.loads(sql('baseline',"""select json_agg(x order by x.function) from (
select p.oid::regprocedure::text function,n.nspname||'.'||p.proname name,
 pg_get_function_identity_arguments(p.oid) arguments,
 p.prosecdef security_definer,r.rolname owner,r.rolsuper owner_superuser,r.rolbypassrls owner_bypassrls,
 p.proconfig settings, p.proacl::text[] acl,
 has_function_privilege('anon',p.oid,'EXECUTE') anon,
 has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
 has_function_privilege('service_role',p.oid,'EXECUTE') service_role,
 pg_get_functiondef(p.oid) definition,
 exists(select 1 from pg_trigger t where t.tgfoid=p.oid and not t.tgisinternal) trigger_used
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
where n.nspname in ('public','private')) x"""))
review=[]; lines=['# Phase 2A executable inventory','',
'Complete inventory; **not a completed semantic certification**. `acl:*` tests validate effective privileges, owner and fixed search path for every function. They do not prove input validation, delegated authorization, or cross-workspace correctness.',
'', 'Owner `supabase_admin` bypasses RLS in this local lab. DEFINER functions therefore require explicit authorization in their bodies/callees. `service_role` grants are server privileges, never evidence of end-user authorization.',
'', '| Function (exact signature) | Mode | Owner | EXECUTE roles | Review / reason | Test |', '|---|---|---|---|---|---|']
for i,f in enumerate(rows,1):
    definition=f.pop('definition');body=definition.split('AS ',1)[-1]
    roles=[r for r in ('anon','authenticated','service_role') if f[r]]
    delegates=sorted(set(re.findall(r'(?:public|private)\.[a-z_]+(?=\s*\()',body)))
    checks=[line.strip() for line in body.splitlines() if re.search(r'raise|if |where |having |check',line,re.I)]
    acl=f['acl'] or []
    public=any(a.startswith('=') and 'X' in a.split('=')[1].split('/')[0] for a in acl)
    expected={role:any(a.startswith(role+'=') and 'X' in a.split('=')[1].split('/')[0] for a in acl) or public for role in ('anon','authenticated','service_role')}
    passed=(all(f[r]==expected[r] for r in expected) and (not f['security_definer'] or ('search_path=""' in (f['settings'] or []) and not public)) and f['owner']=='supabase_admin')
    if f['name']=='public.create_tournament_team_entry':
        status='PARTIAL: cross-season create fixed/tested; Core import remains closed'
    elif 'CONTRACT_PENDING' in body:
        status='BLOCKED: Core adapter absent; denial tested by tools/test.py'
    else:
        status='PENDING: per-function functional authorization and necessity review'
    reason=('RLS bypass / caller and delegate checks require verification' if f['security_definer'] else 'Caller privileges and RLS apply; privileged caller inheritance still requires review')
    if f['trigger_used']:reason+='; trigger context'
    if 'pg_temp.' in body:status+='; pre-existing temp relation ownership requires adversarial test'
    record={**f,'body_sha256':hashlib.sha256(definition.encode()).hexdigest(),'test_id':'acl:'+str(i),'acl_test_pass':passed,
      'public_execute':public,'semantic_status':status,'reason':reason,'authorization_candidates':delegates,
      'validation_and_scope_lines':checks,'dynamic_sql':bool(re.search(r'^\s*execute\b',body,re.I|re.M)),
      'rls_interaction':'Owner bypass' if f['security_definer'] else 'Invoker (can inherit definer owner)',
      'sql_injection_review':'Manual review required for dynamic SQL' if re.search(r'^\s*execute\b',body,re.I|re.M) else 'No direct EXECUTE statement detected; this does not certify callees',
      'privilege_escalation_review':'Not certified', 'cross_workspace_review':'season-boundary.json covers create denial only' if f['name']=='public.create_tournament_team_entry' else 'Not certified'}
    review.append(record)
    lines.append('| `'+f['function']+'` | '+('DEFINER' if f['security_definer'] else 'INVOKER')+' | '+f['owner']+' | '+(', '.join(roles) or 'owner only')+' | '+status+' | `'+record['test_id']+'` '+('PASS' if passed else 'FAIL')+' |')
(BASE/'phase2a/function-inventory.json').write_text(json.dumps(review,indent=2)+'\n')
(BASE/'phase2a/FUNCTIONS.md').write_text('\n'.join(lines)+'\n')
result={'functions':len(rows),'security_definer':sum(f['security_definer'] for f in rows),'acl_checks_pass':sum(r['acl_test_pass'] for r in review),'semantic_certification':False}
(BASE/'phase2a/inventory-results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));assert all(r['acl_test_pass'] for r in review)
