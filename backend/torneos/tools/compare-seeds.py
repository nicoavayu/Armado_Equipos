import json
from lab import BASE,sql
names=json.loads((BASE/'evidence/seed-tables.json').read_text());results=[]
for name in names:
 def rows(db):
  values=json.loads(sql(db,f"select coalesce(jsonb_agg(to_jsonb(t)-'created_at'-'updated_at'),'[]') from public.{name} t"))
  return sorted(values,key=lambda v:json.dumps(v,sort_keys=True))
 a,b=rows('history'),rows('baseline');results.append({'table':name,'historical_count':len(a),'baseline_count':len(b),'equal_except_audit_timestamps':a==b})
(BASE/'evidence/seed-equivalence.json').write_text(json.dumps(results,indent=2)+'\n')
assert all(x['equal_except_audit_timestamps'] for x in results)
print(f'{len(results)}/{len(results)} seeded catalogs equivalent')
