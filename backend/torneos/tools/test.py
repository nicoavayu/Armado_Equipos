"""Executable SQL tests against fixed local container; no remote target accepted."""
import json,time,uuid,re,sys,hashlib
from lab import BASE,sql
results=[]
def check(name,actual,expected=True):
 ok=actual==expected; results.append({'name':name,'pass':ok,'actual':actual,'expected':expected}); print(('PASS ' if ok else 'FAIL ')+name,flush=True)
def q(query): return sql('baseline',query).strip()
def lit(v): return "'"+str(v).replace("'","''")+"'"
def claims(user,**overrides):
 now=int(time.time());c={'sub':user,'core_user_id':core[user],'role':'authenticated','iss':'urn:arma2:local:identity-bridge','aud':'arma2-torneos-local','session_id':str(uuid.uuid4()),'jti':str(uuid.uuid4()),'iat':now,'nbf':now,'exp':now+120};c.update(overrides);return c
def as_user(user,query,**overrides):
 return q('BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='+lit(json.dumps(claims(user,**overrides)))+'; '+query+'; COMMIT;').splitlines()[3:-1]
def val(user,query,**overrides): return '\n'.join(as_user(user,query,**overrides))
def anon(query): return q('BEGIN; SET LOCAL ROLE anon; '+query+'; ROLLBACK;').splitlines()[2:-1]
def fails(name,fn,expected):
 try: fn();check(name,False)
 except RuntimeError as e:check(name,expected in str(e))
users=[str(uuid.uuid4()) for _ in range(5)];owner,other,admin,member,outsider=users
core={u:str(uuid.uuid4()) for u in users}
def main():
 baseline=(BASE/'supabase/migrations/00000000000000_torneos_baseline_v1.sql').read_text()
 catalog=json.loads(q((BASE/'tools/catalog.sql').read_text()));(BASE/'evidence/baseline-catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
 check('empty database baseline installed 104 tables',len(catalog['tables']),104)
 fails('second execution atomically rejected',lambda:q(baseline),'TORNEOS_BASELINE_REQUIRES_EMPTY_PUBLIC_SCHEMA')
 check('all public tables RLS',all(t['rls'] for t in catalog['tables']))
 check('all tables have primary key',all(any(x['kind']=='p' for x in t['constraints']) for t in catalog['tables']))
 check('no auth or physical Core tables',q("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' or (n.nspname='public' and c.relname in ('usuarios','jugadores','teams','team_members'))"),'0')
 check('no foreign data wrappers configured',q('select count(*) from pg_foreign_server'),'0')
 check('no physical Core SQL dependencies',not re.search(r'auth\.(users|uid)|public\.(usuarios|jugadores|teams|team_members)\b',baseline))
 check('no production endpoints or embedded JWTs',not re.search(r'https?://[a-zA-Z0-9][a-zA-Z0-9.-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.',baseline))
 check('all SECURITY DEFINER functions fixed search path',all(f['settings'] and 'search_path=""' in f['settings'] for f in catalog['functions'] if f['security_definer']))
 check('no definer PUBLIC EXECUTE',all(not any(a.startswith('=X') for a in f['acl'] or []) for f in catalog['functions'] if f['security_definer']))
 check('no anon write grants',q("select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='anon' and privilege_type <> 'SELECT'"),'0')
 check('default future function PUBLIC execute denied',q("BEGIN; CREATE FUNCTION public.phase2_future_probe() RETURNS integer LANGUAGE sql AS 'SELECT 1'; SELECT has_function_privilege('anon','public.phase2_future_probe()','EXECUTE'); ROLLBACK;").splitlines()[-2],'f')
 check('future migration can create table and rollback',q("BEGIN; CREATE TABLE public.phase2_future_probe(id uuid PRIMARY KEY); ALTER TABLE public.phase2_future_probe ENABLE ROW LEVEL SECURITY; SELECT to_regclass('public.phase2_future_probe') IS NOT NULL; ROLLBACK;").splitlines()[-2],'t')
 check('storage remains unprovisioned',q("select to_regclass('storage.buckets') is null"),'t')
 check('no scheduled cron',q("select to_regclass('cron.job') is null"),'t')
 for u in users:q(f"SET ROLE torneos_identity_writer; INSERT INTO public.torneos_identity(id,core_user_id) VALUES ('{u}','{core[u]}'); RESET ROLE;")
 check('identity shadow own row only',val(owner,'select count(*) from public.torneos_identity'),'1')
 check('valid certified claim tuple accepted',val(owner,'select private.current_identity_id()'),owner)
 for key,value in [('core_user_id',core[other]),('iss','invalid'),('aud','invalid'),('exp',int(time.time())-1000),('session_id',None),('nbf',0)]:
  check('identity invalid '+key+' rejected',val(owner,'select private.current_identity_id() is null',**{key:value}),'t')
 fails('client cannot create shadow',lambda:val(owner,"insert into public.torneos_identity(core_user_id) values (gen_random_uuid())"),'permission denied')
 fails('writer cannot mutate identity mapping',lambda:q(f"SET ROLE torneos_identity_writer; UPDATE public.torneos_identity SET core_user_id=gen_random_uuid() WHERE id='{owner}'"),'TORNEOS_IDENTITY_MAPPING_IMMUTABLE')
 check('second bridge exchange reuses identity',q(f"SET ROLE torneos_identity_writer; INSERT INTO public.torneos_identity(core_user_id) VALUES ('{core[owner]}') ON CONFLICT(core_user_id) DO UPDATE SET core_user_id=EXCLUDED.core_user_id RETURNING id; RESET ROLE;").splitlines()[1],owner)
 fails('PK rejects duplicate identity',lambda:q(f"insert into public.torneos_identity(id,core_user_id) values('{owner}',gen_random_uuid())"),'duplicate key')
 fails('unique Core mapping enforced',lambda:q(f"insert into public.torneos_identity(core_user_id) values('{core[owner]}')"),'duplicate key')
 org=json.loads(val(owner,"select public.create_tournament_organization('Alpha League','alpha-league',gen_random_uuid())"))['organization']['id']
 org2=json.loads(val(other,"select public.create_tournament_organization('Bravo League','bravo-league',gen_random_uuid())"))['organization']['id']
 check('workspace owner sees only own organization',val(owner,'select count(*) from public.tournament_organizations'),'1')
 check('outsider sees no private organizations',val(outsider,'select count(*) from public.tournament_organizations'),'0')
 check('cross-workspace organization hidden',val(owner,f"select count(*) from public.tournament_organizations where id='{org2}'"),'0')
 fails('cross-workspace mutation forbidden',lambda:val(other,f"select public.create_tournament_season('{org}','Other season','other-season',null,null,gen_random_uuid())"),'TORNEOS_RESOURCE_FORBIDDEN')
 season=json.loads(val(owner,f"select public.create_tournament_season('{org}','Season One','season-one',null,null,gen_random_uuid())"))['id']
 season2=json.loads(val(owner,f"select public.create_tournament_season('{org}','Season Two','season-two',null,null,gen_random_uuid())"))['id']
 season_other=json.loads(val(other,f"select public.create_tournament_season('{org2}','Season Other','season-other',null,null,gen_random_uuid())"))['id']
 for who,role in [(admin,'admin'),(member,'collaborator')]:q(f"insert into public.tournament_organization_members(organization_id,user_id,role,joined_at) values('{org}','{who}','{role}',now())")
 check('owner season access without assignment',val(owner,f"select public.has_tournament_season_access('{org}','{season}')"),'t')
 check('admin needs season assignment',val(admin,f"select public.has_tournament_season_access('{org}','{season}')"),'f')
 check('collaborator needs season assignment',val(member,f"select public.has_tournament_season_access('{org}','{season}')"),'f')
 # FREE allows one administrative collaborator; assign admin to season 1, member to season 2.
 for who,s in [(admin,season),(member,season2)]:
  membership=q(f"select id from public.tournament_organization_members where organization_id='{org}' and user_id='{who}'")
  val(owner,f"select public.assign_tournament_season_member('{org}','{s}','{membership}')")
 check('assigned admin has season access',val(admin,f"select public.has_tournament_season_access('{org}','{season}')"),'t')
 check('admin cannot access unassigned season',val(admin,f"select public.has_tournament_season_access('{org}','{season2}')"),'f')
 check('assigned collaborator reads season',val(member,f"select public.has_tournament_season_capability('{org}','{season2}','tournaments.read')"),'t')
 check('collaborator cannot change roles',val(member,f"select public.has_tournament_organization_capability('{org}','members.update_role')"),'f')
 check('owner can archive organization',val(owner,f"select public.has_tournament_organization_capability('{org}','organization.archive')"),'t')
 check('admin cannot archive organization',val(admin,f"select public.has_tournament_organization_capability('{org}','organization.archive')"),'f')
 modality=q('select code from public.tournament_sport_modalities where team_size=5 limit 1')
 fmt=q('select code from public.tournament_competition_formats limit 1')
 def tournament(o,s,u,name):
  return q(f"insert into public.tournaments(organization_id,season_id,name,slug,sport_modality,competition_format,team_size,created_by,creation_key) values('{o}','{s}','{name}','{name}','{modality}','{fmt}',5,'{u}',gen_random_uuid()) returning id").splitlines()[0]
 ta=tournament(org,season,owner,'alpha-cup');tb=tournament(org,season2,owner,'beta-cup');tc=tournament(org2,season_other,other,'other-cup')
 check('assigned admin cannot read tournament in other season',val(admin,f"select count(*) from public.tournaments where id='{tb}'"),'0')
 check('assigned admin reads tournament in assigned season',val(admin,f"select count(*) from public.tournaments where id='{ta}'"),'1')
 check('cross-organization tournament isolation',val(owner,f"select count(*) from public.tournaments where id='{tc}'"),'0')
 fails('composite FK rejects cross-workspace tournament',lambda:tournament(org,season_other,owner,'invalid-cup'),'foreign key constraint')
 fails('FK rejects absent local identity',lambda:q(f"insert into public.user_workspace_preferences(user_id) values(gen_random_uuid())"),'foreign key constraint')
 check('anonymous draft tournament hidden',anon(f"select count(*) from public.tournaments where id='{ta}'"),['0'])
 check('unpublished public page returns null',anon("select public.get_public_tournament_page('alpha-cup') is null"),['t'])
 q(f"update public.tournaments set status='registration' where id='{ta}'; insert into public.tournament_public_pages(tournament_id,organization_id,public_slug,status,published_by,published_at) values('{ta}','{org}','alpha-cup','published','{owner}',now())")
 check('published public page returns intended tournament',anon("select public.get_public_tournament_page('alpha-cup') is not null"),['t'])
 q(f"update public.tournament_public_pages set status='unpublished',unpublished_by='{owner}',unpublished_at=now() where tournament_id='{ta}'")
 check('unpublish removes anonymous page',anon("select public.get_public_tournament_page('alpha-cup') is null"),['t'])
 category=q(f"insert into public.tournament_categories(organization_id,tournament_id,name,slug) values('{org}','{ta}','Open','open') returning id").splitlines()[0]
 team=json.loads(val(owner,f"select public.create_tournament_team_entry('{org}','{ta}','{category}',null,'Local Team',null,null,null,'manual',null,null,null,gen_random_uuid())"))
 check('manual team and roster creation works',bool(team.get('entryId') and team.get('rosterId')))
 fails('Core team import fails closed',lambda:val(owner,f"select public.create_tournament_team_entry('{org}','{ta}','{category}',gen_random_uuid(),'Imported Team',null,null,null,'arma2_team',null,null,null,gen_random_uuid())"),'TORNEOS_CORE_TEAM_IMPORT_CONTRACT_PENDING')
 check('media storage status fails closed',q("select public.tournament_media_storage_contract_status()->>'bucketPresent'"),'false')
 check('pipeline not activated',q("select public.tournament_media_pipeline_readiness()->>'uploadReady'"),'false')
 fails('Core player search explicit pending contract',lambda:val(owner,f"select public.search_tournament_players('{org}','{ta}','ab',8,null)"),'TORNEOS_CORE_BRIDGE_CONTRACT_PENDING')
 fails('Core team search explicit pending contract',lambda:val(owner,f"select public.search_tournament_arma2_teams('{org}','{ta}','ab',8)"),'TORNEOS_CORE_BRIDGE_CONTRACT_PENDING')
 fails('verified email invite explicit pending contract',lambda:val(owner,"select public.accept_tournament_team_invitation('token')"),'TORNEOS_CORE_BRIDGE_CONTRACT_PENDING')
 check('Mercado Pago provider RPC absent',q("select count(*) from pg_proc where proname in ('get_provider_tournament_purchase','apply_verified_tournament_payment_status','apply_verified_tournament_payment_reversal')"),'0')
try:main()
except Exception as e:results.append({'name':'suite completed','pass':False,'error':str(e)});print(e)
finally:
 (BASE/'evidence/tests.json').write_text(json.dumps(results,indent=2)+'\n')
 print(f"{sum(r['pass'] for r in results)}/{len(results)} passed")
 sys.exit(0 if all(r['pass'] for r in results) else 1)
