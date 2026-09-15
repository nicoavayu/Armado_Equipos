"""Generate one final-state candidate, never a historical migration replay installer."""
import json,re,pathlib,sys
from lab import BASE,ROOT,sql,docker,NAME
sys.path.insert(0,str(BASE/'phase2b'))
from core_wiring import WIRING,wire_team_entry_import
import season_scope
c=json.loads(sql('history',(BASE/'tools/catalog.sql').read_text()))
(BASE/'evidence/history-catalog.json').write_text(json.dumps(c,indent=2)+'\n')
excluded=['usuarios','jugadores','teams','team_members']
dump=docker('exec',NAME,'pg_dump','-U','supabase_admin','-d','history','--schema-only','--no-owner','--schema=public',*[f'--exclude-table=public.{t}' for t in excluded])
# pg_dump's per-session guards are psql meta commands, not migration SQL.
dump=re.sub(r'^\\.*\n','',dump,flags=re.M)
dump=re.sub(r'^CREATE SCHEMA public;\n','',dump,flags=re.M)
dump=re.sub(r'^COMMENT ON SCHEMA public IS .*;\n','',dump,flags=re.M)
# Remove the reference-only Core helper and its ACL block entirely.
dump=re.sub(r'CREATE FUNCTION public.team_user_is_admin_or_owner\([\s\S]*?\$\$;\n','',dump)
dump=re.sub(r'^(?:GRANT|REVOKE).*FUNCTION public.team_user_is_admin_or_owner.*;\n','',dump,flags=re.M)
# Rewire Core-dependent function bodies before rewriting identity references.
changes=[]
for f in c['functions']:
 name=f['name'].split('.')[-1]
 if name=='team_user_is_admin_or_owner': continue
 # Dump uses CREATE FUNCTION; catalog returns CREATE OR REPLACE FUNCTION.
 pat=r'CREATE FUNCTION public\.'+name+r'\([^;]*?AS (\$[^$]*\$)([\s\S]*?)\1;'
 # Signature has no dollar delimiter until AS; pg_dump always uses $function$.
 for m in list(re.finditer(pat,dump)):
  body=m.group(2); new=body
  if name in WIRING:
   new,change=WIRING[name](new)
   changes.append({'function':name,'change':change})
  elif name=='create_tournament_team_entry':
   anchor="  if p_idempotency_key is null then raise exception using errcode = '22023', message = 'TORNEOS_IDEMPOTENCY_REQUIRED'; end if;"
   assert new.count(anchor)==1
   new=new.replace(anchor,(BASE/'phase2a/team-entry-season-guard.sql').read_text()+anchor)
   new,change=wire_team_entry_import(new)
   changes.append({'function':name,'change':'manual/provisional flow retained; explicit destination season access required before idempotency lookup (Phase 2A security fix); '+change})
  if name in ('rank_tournament_standings','rebuild_tournament_standings'):
   relation='tournament_rank_work' if name=='rank_tournament_standings' else 'tournament_discipline_event_work'
   old=f'  create temporary table if not exists pg_temp.{relation} ('
   assert new.count(old)==1
   new=new.replace(old,f"  -- Never execute DML on a caller-owned temporary relation under elevated privileges.\n  if pg_catalog.to_regclass('pg_temp.{relation}') is not null then\n    drop table pg_temp.{relation};\n  end if;\n  create temporary table pg_temp.{relation} (")
   changes.append({'function':name,'change':'Phase 2B: recreate temporary work relation before privileged DML; never reuse caller-owned triggers/defaults/rules'})
  if name=='reject_tournament_projection_mutation':
   old="  if current_user not in ('postgres', 'service_role') then"
   assert new.count(old)==1
   new=new.replace(old,"  -- Phase 2B: platform mutations run as the function owner (DEFINER context) or the service role;\n  -- the owner role name is not hardcoded, so the isolated baseline is portable.\n  if current_user <> 'service_role' and current_user <> (\n    select r.rolname from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid = p.proowner\n    where p.oid = 'public.reject_tournament_projection_mutation'::regproc\n  ) then")
   changes.append({'function':name,'change':'Phase 2B: projection immutability allows the function owner instead of the hardcoded postgres role name (same intent, portable owner)'})
  new,rules=season_scope.apply(name,f['signature'],new)
  if rules:
   # R3-2D edits are the Phase 2D closure of capability calls whose argument is a CASE expression.
   phase='Phase 2D' if all(r.endswith('-2D') for r in rules) else 'Phase 2B'
   changes.append({'function':name,'change':phase+': organization-derived authority over a season-scoped resource requires the actor\'s season assignment ('+'/'.join(rules)+'); participant, manager and player branches unchanged'})
  if new!=body: dump=dump.replace(m.group(0),m.group(0).replace(body,new))
# Identity UUIDs in historical user_id/arma2_user_id columns now mean local identity.id.
dump=dump.replace('auth.uid()', 'private.current_identity_id()').replace('auth.users','public.torneos_identity')
# External Core team identifier is an opaque reference, never a physical FK.
dump=re.sub(r'ALTER TABLE ONLY public.tournament_team_entries\s+ADD CONSTRAINT tournament_team_entries_arma2_team_id_fkey FOREIGN KEY \(arma2_team_id\) REFERENCES public.teams\(id\) ON DELETE RESTRICT;','',dump)
# Capture final authoritative seed rows, excluding temporary data/backfills.
seed=[];seed_names=[]
counts=json.loads(sql('history',"select json_object_agg(name,n) from ("+' union all '.join(f"select '{t['name']}' name,count(*) n from public.{t['name']}" for t in c['tables'])+") counts"))
ordered=[];pending={t['name']:t for t in c['tables'] if counts[t['name']]}
while pending:
 ready=[t for t in pending.values() if not any(dep in pending and dep != t['name'] for x in t['constraints'] for dep in re.findall(r'REFERENCES (?:public\.)?([a-z_]+)',x['definition']))]
 assert ready, 'cyclic seed dependency needs explicit handling'
 for t in ready: ordered.append(t); del pending[t['name']]
for t in ordered:
 if t['name'] in excluded: continue
 if counts[t['name']]:
  seed_names.append(t['name'])
  data=docker('exec',NAME,'pg_dump','-U','supabase_admin','-d','history','--data-only','--column-inserts','--table=public.'+t['name'])
  seed.extend(line for line in data.splitlines() if line.startswith('INSERT INTO '))
# Only a marker-free empty public schema can be installed. One transaction rolls back on rerun.
header="""-- Arma2 Torneos baseline v1 CANDIDATE — LOCAL ONLY, certification BLOCKED.
-- Derived from 48 hash-verified sources. See REPORT.md for explicit functionality gaps.
BEGIN;
SET LOCAL check_function_bodies = off;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','v','m','S')) THEN RAISE EXCEPTION 'TORNEOS_BASELINE_REQUIRES_EMPTY_PUBLIC_SCHEMA'; END IF; END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated,service_role;
-- Phase 2C: a Supabase database ships schema-scoped default ACLs for the installing role in
-- public (functions, sequences, tables -> anon, authenticated, service_role). Schema-scoped
-- defaults are ADDED to the global ones, so the global revoke above cannot remove them and a
-- per-object REVOKE ... FROM PUBLIC does not touch an explicit anon grant. Revoke the
-- schema-scoped entries too: every API-role privilege below is then an explicit GRANT.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated,service_role;
"""
# Dump restores default ACLs from reference: discard those, use deliberate fresh defaults.
dump=re.sub(r'^ALTER DEFAULT PRIVILEGES .*;\n','',dump,flags=re.M)
# The Core boundary references domain tables, so it follows the dump.
text=header+(BASE/'contracts/identity.sql').read_text()+'\n'+dump+'\n'+(BASE/'contracts/core-boundary.sql').read_text()+'\n'+(BASE/'contracts/season-scope.sql').read_text()+'\n-- Final catalog seed data (no migration/backfill history).\n'+'\n'.join(seed)+'\nCOMMIT;\n'
assert not re.search(r'auth\.(users|uid)|public\.(teams|usuarios|jugadores|team_members|team_user_is_admin_or_owner)\b',text)
text='\n'.join(line.rstrip() for line in text.splitlines())+'\n'
(BASE/'supabase/migrations/00000000000000_torneos_baseline_v1.sql').write_text(text)
(BASE/'evidence/intentional-function-differences.json').write_text(json.dumps(changes,indent=2)+'\n')
(BASE/'evidence/seed-tables.json').write_text(json.dumps(seed_names,indent=2)+'\n')
print('Built candidate',len(text.splitlines()),'lines;',len(c['tables'])-4,'historical domain tables')
