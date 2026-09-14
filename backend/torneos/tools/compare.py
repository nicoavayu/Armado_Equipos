import json,re,collections
from pglast.parser import parse_sql_json
from lab import BASE,sql
h=json.loads((BASE/'evidence/history-catalog.json').read_text());b=json.loads((BASE/'evidence/baseline-catalog.json').read_text())
excluded={'usuarios','jugadores','teams','team_members'}
def ast_normalize(x):
 if isinstance(x,list): return [ast_normalize(v) for v in x]
 if isinstance(x,dict):
  x={k:ast_normalize(v) for k,v in x.items() if k not in ('location','stmt_location','stmt_len')}
  if 'BoolExpr' in x:
   v=x['BoolExpr']; args=[]
   for arg in v.get('args',[]):
    if isinstance(arg,dict) and arg.get('BoolExpr',{}).get('boolop')==v['boolop']: args.extend(arg['BoolExpr']['args'])
    else: args.append(arg)
   v['args']=args
  return x
 return x
def norm(x):
 if isinstance(x,str):
  x=re.sub(r'(?<![a-z_.])(?:auth\.)?uid\(\)', 'private.current_identity_id()',x).replace('REFERENCES users(', 'REFERENCES torneos_identity(').replace('auth.users','public.torneos_identity')
  if x.startswith('CHECK ('): return ast_normalize(json.loads(parse_sql_json('CREATE TABLE candidate (x int, '+x+')')))
  return x
 if isinstance(x,list):return [norm(y) for y in x]
 if isinstance(x,dict):
  y={k:norm(v) for k,v in x.items()}
  if 'acl' in y:
   y['acl']=sorted(a for a in (y['acl'] or []) if not a.startswith('supabase_admin='))
  return y
 return x
differences=[];checks=[]
def compare(kind,key,aa,bb):
 a={key(x):norm(x) for x in aa};z={key(x):norm(x) for x in bb}
 for k in sorted(a.keys()|z.keys()):
  if a.get(k)!=z.get(k):differences.append({'kind':kind,'object':k,'historical':a.get(k),'baseline':z.get(k)})
 checks.append({'kind':kind,'historical':len(a),'baseline':len(z),'equal_after_identity_normalization':sum(a[k]==z.get(k) for k in a)})
compare('tables',lambda x:x['name'],[t for t in h['tables'] if t['name'] not in excluded],[t for t in b['tables'] if t['name']!='torneos_identity'])
compare('indexes',lambda x:x['name'],[i for i in h['indexes'] if i['table'] not in excluded],[i for i in b['indexes'] if i['table']!='torneos_identity'])
compare('policies',lambda x:x['table']+'.'+x['name'],h['policies'],[p for p in b['policies'] if p['table']!='torneos_identity'])
compare('triggers',lambda x:x['table']+'.'+x['name'],h['triggers'],[t for t in b['triggers'] if t['table']!='torneos_identity'])
compare('functions',lambda x:x['name']+'('+x['signature']+')',[f for f in h['functions'] if f['name']!='public.team_user_is_admin_or_owner'],[f for f in b['functions'] if f['name'] not in ('public.gen_random_uuid','private.check_token','private.current_identity_id','private.prevent_identity_reassignment')])
for d in differences:
 if d['kind']=='functions':d['reason']='Core boundary adaptation; see intentional-function-differences.json' if d['object'].split('(')[0].split('.')[-1] in ['accept_tournament_team_invitation','search_tournament_players','search_tournament_arma2_teams','create_tournament_team_entry'] else 'review required'
 elif d['kind']=='tables' and d['object']=='tournament_team_entries':d['reason']='opaque Core team id: physical Core FK removed'
 else:d['reason']='review required'
# Attribute-level equivalence and duplicates are machine-readable, not inferred from names.
idx=sql('baseline',"""select coalesce(json_agg(x),'[]') from (select a.relname kept,b.relname duplicate from pg_index i join pg_index j on i.indrelid=j.indrelid and i.indexrelid<j.indexrelid and i.indkey=j.indkey and i.indclass=j.indclass and i.indcollation=j.indcollation and i.indoption=j.indoption and i.indisunique=j.indisunique and i.indnkeyatts=j.indnkeyatts and coalesce(pg_get_expr(i.indpred,i.indrelid),'')=coalesce(pg_get_expr(j.indpred,j.indrelid),'') and coalesce(pg_get_expr(i.indexprs,i.indrelid),'')=coalesce(pg_get_expr(j.indexprs,j.indrelid),'') join pg_class a on a.oid=i.indexrelid join pg_class b on b.oid=j.indexrelid join pg_namespace n on n.oid=a.relnamespace where n.nspname='public') x""")
report={'normalization':['auth.uid() to validated private.current_identity_id()','auth.users FK to local torneos_identity','Core-only reference substitutes excluded','ACL owner-default representation normalized; sorted role ACLs','CHECK ASTs parsed with pglast 8.3, source locations removed and nested same-operator Boolean expressions flattened'],'comparisons':checks,'differences':differences,'duplicate_indexes':json.loads(idx)}
(BASE/'evidence/equivalence.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(checks,indent=2));print('Differences',len(differences),'duplicate indexes',idx)
for d in differences:print(d['kind'],d['object'],d['reason'])
