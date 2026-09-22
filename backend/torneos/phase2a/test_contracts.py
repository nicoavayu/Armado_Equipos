import contextlib, copy, io, json, secrets, unittest
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
from contracts import CoreAuthority, CoreClient, CoreServer, Denied, TorneosPOC, encode

class Contracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key=secrets.token_bytes(32);cls.core=CoreAuthority(cls.key);cls.server=CoreServer(cls.core)
    @classmethod
    def tearDownClass(cls): cls.server.close()
    def setUp(self):
        self.core.users.clear();self.core.teams.clear();self.core.sessions.clear();self.core.rates.clear();self.core.nonces.clear();self.core.available=True
        self.u,self.v,self.team,self.org,self.cup=[str(uuid4()) for _ in range(5)]
        self.sid=str(uuid4());self.other_sid=str(uuid4())
        for uid in [self.u,self.v]:
            self.core.users[uid]={'active':True,'discoverable':True,'email':'Player@Example.test','email_verified':True,
                'display_name':'Player Test','avatar_url':None,'positions':['goalkeeper'],'password':'NEVER_RETURN','phone':'NEVER_RETURN','birthdate':'NEVER_RETURN'}
        for sid,uid in [(self.sid,self.u),(self.other_sid,self.v)]: self.core.sessions[sid]={'user_id':uid,'expires_at':self.core.clock()+300}
        self.core.teams[self.team]={'active':True,'discoverable':True,'name':'Player Team','crest_url':None,'players':[self.u,self.v],'importers':[self.u],'revision':1,'private_notes':'NEVER_RETURN'}
        self.client=CoreClient(self.server.url,self.key)
        self.app=TorneosPOC(self.client)
        self.actor={'core_user_id':self.u,'session_id':self.sid}
        self.app.sessions['gateway-fixture']=self.actor
        self.app.scopes[(self.u,self.org,self.cup)]={'search.players','search.teams','import'}
        self.app.invitations['invitation']={'email':'player@example.test','status':'pending'}
        self.idem=str(uuid4())
    def deny(self,fn,status=None):
        with self.assertRaises(Denied) as result: fn()
        if status: self.assertEqual(result.exception.status,status)
    def accept(self): return self.app.accept('gateway-fixture','invitation')
    def search(self,**kwargs): return self.app.search('gateway-fixture',self.org,self.cup,kwargs.pop('kind','players'),'player',**kwargs)
    def importing(self): return self.app.import_team('gateway-fixture',self.org,self.cup,self.team,self.idem)
    def test_verified_accept(self): self.assertEqual(self.accept(),{'status':'accepted'})
    def test_unverified_denied(self): self.core.users[self.u]['email_verified']=False;self.deny(self.accept)
    def test_changed_email_denied(self): self.core.users[self.u]['email']='changed@example.test';self.deny(self.accept)
    def test_missing_email_denied(self): self.core.users[self.u]['email']=None;self.deny(self.accept)
    def test_whitespace_email_denied(self): self.core.users[self.u]['email']=' player@example.test';self.deny(self.accept)
    def test_no_email_alias_rewrite(self): self.core.users[self.u]['email']='player+test@example.test';self.deny(self.accept)
    def test_email_outage_no_mutation(self):
        self.core.available=False;self.deny(self.accept,503);self.assertEqual(self.app.invitations['invitation']['status'],'pending')
    def test_verification_not_cached(self):
        self.client.call('/v1/verified-email',{**self.actor,'expected_email':'player@example.test'})
        self.core.users[self.u]['email_verified']=False;self.deny(self.accept)
    def test_verification_minimal_response(self):
        response=self.client.call('/v1/verified-email',{**self.actor,'expected_email':'player@example.test'})
        self.assertEqual(set(response),{'verified','matches','checked_at'});self.assertNotIn('@',json.dumps(response))
    def test_authorized_search(self): self.assertEqual(len(self.search()['items']),2)
    def test_unauthorized_search(self): self.app.scopes.clear();self.deny(self.search)
    def test_cross_workspace_search(self): self.org=str(uuid4());self.deny(self.search)
    def test_disabled_excluded(self): self.core.users[self.v]['active']=False;self.assertEqual(len(self.search()['items']),1)
    def test_deleted_excluded(self): self.core.users[self.v]['deleted']=True;self.assertEqual(len(self.search()['items']),1)
    def test_hidden_excluded(self): self.core.users[self.v]['discoverable']=False;self.assertEqual(len(self.search()['items']),1)
    def test_hidden_team_excluded(self): self.core.teams[self.team]['discoverable']=False;self.assertEqual(self.search(kind='teams')['items'],[])
    def test_private_fields_absent(self):
        data=self.search();self.assertNotIn('NEVER_RETURN',json.dumps(data))
        self.assertEqual(set(data['items'][0]),{'core_user_id','display_name','avatar_url','positions'})
    def test_pagination(self):
        first=self.search(limit=1);second=self.search(limit=1,cursor=first['next_cursor'])
        self.assertNotEqual(first['items'],second['items']);self.assertIsNone(second['next_cursor'])
    def test_cursor_tamper(self): self.deny(lambda:self.search(limit=1,cursor=self.search(limit=1)['next_cursor']+'a'),400)
    def test_cursor_bound_to_limit(self): self.deny(lambda:self.search(limit=2,cursor=self.search(limit=1)['next_cursor']),400)
    def test_cursor_bound_to_actor(self):
        cursor=self.search(limit=1)['next_cursor']
        self.deny(lambda:self.client.call('/v1/directory',{'core_user_id':self.v,'session_id':self.other_sid,'kind':'players','query':'player','limit':1,'cursor':cursor}),400)
    def test_cursor_expired(self):
        first=self.search(limit=1);original=self.core.clock
        self.core.clock=lambda:original()+61
        self.client.clock=self.core.clock
        try:self.deny(lambda:self.search(limit=1,cursor=first['next_cursor']),400)
        finally:self.core.clock=original;self.client.clock=original
    def test_rate_limit(self):
        for _ in range(30):self.search()
        self.deny(self.search,429)
    def test_rate_limit_concurrent(self):
        def run(_):
            try:self.search();return 200
            except Denied as e:return e.status
        with ThreadPoolExecutor(max_workers=8) as pool: statuses=list(pool.map(run,range(35)))
        self.assertEqual(statuses.count(200),30);self.assertEqual(statuses.count(429),5)
    def test_directory_outage(self): self.core.available=False;self.deny(self.search,503)
    def test_authorized_import(self): self.assertEqual(self.importing()['source']['core_team_id'],self.team)
    def test_unauthorized_import(self): self.core.teams[self.team]['importers']=[];self.deny(self.importing,404)
    def test_cross_workspace_import(self): self.org=str(uuid4());self.deny(self.importing)
    def test_cross_user_import(self):
        self.app.sessions['gateway-fixture']={'core_user_id':self.v,'session_id':self.other_sid}
        self.app.scopes[(self.v,self.org,self.cup)]={'import'};self.deny(self.importing,404)
    def test_snapshot_ownership(self):
        before=copy.deepcopy(self.core.teams);result=self.importing()
        self.assertEqual(result['ownership'],'torneos_competition_snapshot');self.assertEqual(before,self.core.teams)
    def test_deleted_team(self): self.core.teams[self.team]['deleted']=True;self.deny(self.importing,404)
    def test_removed_player_snapshot_frozen(self):
        first=self.importing();self.core.teams[self.team]['players'].remove(self.v);self.core.teams[self.team]['revision']=2
        self.assertEqual(first,self.importing())
    def test_removed_player_before_import(self):
        self.core.teams[self.team]['players'].remove(self.v)
        self.assertEqual([p['core_user_id'] for p in self.importing()['source']['players']],[self.u])
    def test_snapshot_divergence(self):
        first=self.importing();self.core.teams[self.team]['name']='Changed';self.assertEqual(first,self.importing())
    def test_snapshot_copy_not_mutable_by_caller(self):
        result=self.importing();result['source']['name']='Forged';self.assertNotEqual(result,self.importing())
    def test_import_idempotency(self): self.assertEqual(self.importing(),self.importing());self.assertEqual(len(self.app.snapshots),1)
    def test_new_key_same_snapshot(self):
        first=self.importing();self.idem=str(uuid4());self.assertEqual(first,self.importing())
    def test_idempotency_conflict(self):
        self.importing();new_team=str(uuid4());self.core.teams[new_team]=copy.deepcopy(self.core.teams[self.team]);self.team=new_team
        self.deny(self.importing,409)
    def test_import_concurrent(self):
        with ThreadPoolExecutor(max_workers=5) as pool: rows=list(pool.map(lambda _:self.importing(),range(5)))
        self.assertEqual(len({r['id'] for r in rows}),1)
    def test_retry_reauthorizes(self): self.importing();self.core.teams[self.team]['importers']=[];self.deny(self.importing,404)
    def test_import_outage(self): self.core.available=False;self.deny(self.importing,503);self.assertEqual(self.app.snapshots,{})
    def test_outage_existing_snapshot_available_locally(self):
        first=self.importing();self.core.available=False
        self.assertEqual(self.app.snapshots[(self.org,self.cup,self.team)],first);self.deny(self.importing,503)
    def test_service_signature_required(self):
        self.deny(lambda:self.core.handle('/v1/verified-email',encode({}),{}),401)
    def test_wrong_service_key(self):
        self.deny(lambda:CoreClient(self.server.url,b'wrong').call('/v1/verified-email',{**self.actor,'expected_email':'player@example.test'}),401)
    def test_replayed_envelope(self):
        path='/v1/verified-email';body=encode({**self.actor,'expected_email':'player@example.test'});stamp=str(int(self.core.clock()));nonce=secrets.token_hex(16)
        headers={'X-Time':stamp,'X-Nonce':nonce,'X-Signature':self.core.sign(path.encode()+b'\n'+stamp.encode()+b'\n'+nonce.encode()+b'\n'+body)}
        self.core.handle(path,body,headers);self.deny(lambda:self.core.handle(path,body,headers),401)
    def test_actor_session_mismatch(self):
        self.deny(lambda:self.client.call('/v1/verified-email',{**self.actor,'session_id':self.other_sid,'expected_email':'player@example.test'}))
    def test_revoked_session(self): self.core.sessions[self.sid]['revoked']=True;self.deny(self.accept)
    def test_disabled_actor(self): self.core.users[self.u]['active']=False;self.deny(self.search)
    def test_request_extra_claim_rejected(self):
        self.deny(lambda:self.client.call('/v1/verified-email',{**self.actor,'verified':True,'expected_email':'player@example.test'}),400)
    def test_browser_cannot_supply_actor_claims(self): self.deny(lambda:self.app.accept(json.dumps(self.actor),'invitation'),401)
    def test_logs_empty(self):
        out=io.StringIO()
        with contextlib.redirect_stderr(out),contextlib.redirect_stdout(out):self.search();self.accept();self.importing()
        self.assertEqual(out.getvalue(),'')
    def test_extra_private_response_fails_closed(self):
        original=self.core.handle
        self.core.handle=lambda *args:{'verified':True,'matches':True,'checked_at':int(self.core.clock()),'email':'private@example.test'}
        try:self.deny(self.accept,503)
        finally:self.core.handle=original
    def test_stale_response_fails_closed(self):
        original=self.core.handle
        self.core.handle=lambda *args:{'verified':True,'matches':True,'checked_at':int(self.core.clock())-10}
        try:self.deny(self.accept,503)
        finally:self.core.handle=original
    def test_forged_boolean_response_denied(self):
        original=self.core.handle
        self.core.handle=lambda *args:{'verified':'true','matches':True,'checked_at':int(self.core.clock())}
        try:self.deny(self.accept,503)
        finally:self.core.handle=original
    def test_oversized_team_not_truncated(self):
        self.core.teams[self.team]['players']=[self.u]*81;self.deny(self.importing,409)
    def test_invalid_limit(self): self.deny(lambda:self.search(limit=13),400)
    def test_boolean_limit_rejected(self): self.deny(lambda:self.search(limit=True),400)
    def test_unknown_route(self): self.deny(lambda:self.client.call('/v1/unknown',{}),404)
    def test_expired_actor_session(self): self.core.sessions[self.sid]['expires_at']=0;self.deny(self.accept)
    def test_expired_service_envelope(self):
        self.client.clock=lambda:0;self.deny(self.accept,401)
    def test_core_directory_is_projection_not_table_dump(self):
        self.assertEqual(set(self.search(kind='teams')['items'][0]),{'core_team_id','name','crest_url'})
    def test_remote_url_rejected(self):
        with self.assertRaises(ValueError):CoreClient('https://example.test',self.key)
    def test_core_connection_failure(self):
        server=CoreServer(self.core);url=server.url;server.close()
        self.deny(lambda:CoreClient(url,self.key).call('/v1/verified-email',{**self.actor,'expected_email':'player@example.test'}),503)

if __name__=='__main__':unittest.main(verbosity=2)
