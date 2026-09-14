"""Generate the versioned, exact JSON request/response contract (no optional keys)."""
import json,pathlib
S={'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'urn:arma2:core-torneos:phase2a:v1','$defs':{}}
def obj(**properties):return {'type':'object','properties':properties,'required':list(properties),'additionalProperties':False}
def string(lo=0,hi=100):return {'type':'string','minLength':lo,'maxLength':hi}
def array(item,hi):return {'type':'array','items':item,'maxItems':hi}
uid={**string(36,36),'pattern':'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'}
nullable_url={'type':['string','null'],'maxLength':2048,'pattern':'^https://[^\\s]+$'}
nullable_cursor={'type':['string','null'],'minLength':1,'maxLength':2048}
identity={'core_user_id':uid,'session_id':uid}
player=obj(core_user_id=uid,display_name=string(2,100),avatar_url=nullable_url,positions=array(string(1,32),8))
team=obj(core_team_id=uid,name=string(2,100),crest_url=nullable_url)
S['$defs']['verifiedEmailRequest']=obj(**identity,expected_email={**string(3,254),'pattern':'^[^\\s@]+@[^\\s@]+$'})
S['$defs']['verifiedEmailResponse']=obj(verified={'type':'boolean'},matches={'type':'boolean'},checked_at={'type':'integer','minimum':0})
S['$defs']['directoryRequest']=obj(**identity,kind={'enum':['players','teams']},query=string(2,100),limit={'type':'integer','minimum':1,'maximum':12},cursor=nullable_cursor)
S['$defs']['playersResponse']=obj(items=array(player,12),next_cursor=nullable_cursor)
S['$defs']['teamsResponse']=obj(items=array(team,12),next_cursor=nullable_cursor)
S['$defs']['teamSnapshotRequest']=obj(**identity,core_team_id=uid)
S['$defs']['teamSnapshotResponse']=obj(core_team_id=uid,name=string(2,100),crest_url=nullable_url,players=array(player,80),source_revision={'type':'integer','minimum':1},captured_at={'type':'integer','minimum':0})
S['$defs']['errorResponse']=obj(error={'enum':['FORBIDDEN','INVALID_REQUEST','CORE_UNAVAILABLE','SERVICE_AUTH_REQUIRED','REPLAY','NOT_FOUND','INVALID_CURSOR','RATE_LIMITED']})
pathlib.Path(__file__).with_name('schemas.json').write_text(json.dumps(S,indent=2)+'\n')
