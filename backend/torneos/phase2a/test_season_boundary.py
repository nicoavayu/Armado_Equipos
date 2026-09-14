"""Run explicitly after tools/test.py; fixed local database; every probe rolls back."""
import json, pathlib, sys, time, uuid
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'tools'))
from lab import sql, BASE

def run():
    row=json.loads(sql('baseline',"""select row_to_json(x) from (
      select m.user_id,i.core_user_id,m.organization_id,t.id tournament_id,t.season_id
      from public.tournament_organization_members m
      join public.torneos_identity i on i.id=m.user_id
      join public.tournaments t on t.organization_id=m.organization_id
      where m.role='admin' and t.slug='beta-cup') x"""))
    now=int(time.time());category=str(uuid.uuid4())
    claims={'sub':row['user_id'],'core_user_id':row['core_user_id'],'role':'authenticated',
       'iss':'urn:arma2:local:identity-bridge','aud':'arma2-torneos-local','session_id':str(uuid.uuid4()),
       'jti':str(uuid.uuid4()),'iat':now,'nbf':now,'exp':now+120}
    prefix=f"""BEGIN;
    update public.tournaments set status='registration' where id='{row['tournament_id']}';
    insert into public.tournament_categories(id,organization_id,tournament_id,name,slug)
      values('{category}','{row['organization_id']}','{row['tournament_id']}','Probe','probe');
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claims='{json.dumps(claims)}';
    """
    query=f"""select public.create_tournament_team_entry('{row['organization_id']}','{row['tournament_id']}',
      '{category}',null,'Cross Season Probe',null,null,null,'manual',null,null,null,gen_random_uuid());"""
    access=sql('baseline',prefix+f"select public.has_tournament_season_access('{row['organization_id']}','{row['season_id']}'); ROLLBACK;").splitlines()[-2]
    assert access=='f'
    try:
        sql('baseline',prefix+query+'ROLLBACK;')
        denied=False
    except RuntimeError as error:
        denied='TORNEOS_RESOURCE_FORBIDDEN' in str(error)
    assigned=json.loads(sql('baseline',"select row_to_json(x) from (select id tournament_id,season_id from public.tournaments where slug='alpha-cup') x"))
    assigned_prefix=prefix.replace(row['tournament_id'],assigned['tournament_id'])
    assigned_query=query.replace(row['tournament_id'],assigned['tournament_id'])
    positive=sql('baseline',assigned_prefix+assigned_query+'ROLLBACK;')
    assigned_pass='"entryId"' in positive and '"rosterId"' in positive
    assert assigned_pass
    result={'name':'unassigned admin cannot create team in another season','pass':denied,
            'season_access':False,'assigned_admin_create_pass':assigned_pass,'transaction':'rollback (including error disconnect)',
            'before_fix':'Reproduced: season_access=false yet entryId and rosterId returned; rolled back.'}
    (BASE/'phase2a/season-boundary.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2));assert denied
if __name__=='__main__':run()
