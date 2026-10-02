import hmac,hashlib,base64,json,time,sys,urllib.request
S=sys.argv[1]; BASE=sys.argv[2]
sec=open(S+'/jwt.secret').read().strip().encode()
b64=lambda b: base64.urlsafe_b64encode(b).rstrip(b'=').decode()
def tok(sub,core,role='authenticated'):
    t=int(time.time()); h=b64(json.dumps({"alg":"HS256","typ":"JWT"}).encode())
    p=b64(json.dumps({"role":role,"iss":"urn:arma2:local:identity-bridge","aud":"arma2-torneos-local","sub":sub,"core_user_id":core,"session_id":"s","jti":"j%d"%t,"iat":t,"nbf":t,"exp":t+120}).encode())
    return h+'.'+p+'.'+b64(hmac.new(sec,(h+'.'+p).encode(),hashlib.sha256).digest())
U=('11111111-1111-4111-8111-111111111111','a1111111-1111-4111-8111-111111111111')
V=('22222222-2222-4222-8222-222222222222','a2222222-2222-4222-8222-222222222222')
OA,OB='aaaaaaaa-0000-4000-8000-00000000000a','bbbbbbbb-0000-4000-8000-00000000000b'
SA,SB='5a5a5a5a-0000-4000-8000-0000000000a1','5b5b5b5b-0000-4000-8000-0000000000b1'
TA='7a7a7a7a-0000-4000-8000-0000000000a1'; RND='deadbeef-0000-4000-8000-000000000000'
def call(name,expect,rpc,body,auth):
    req=urllib.request.Request(BASE+'/rpc/'+rpc,data=json.dumps(body).encode(),method='POST',headers={'content-type':'application/json',**({'authorization':'Bearer '+auth} if auth else {})})
    try:
        r=urllib.request.urlopen(req); st=r.status; txt=r.read().decode()
    except urllib.error.HTTPError as e: st=e.code; txt=e.read().decode()
    try: j=json.loads(txt)
    except Exception: j=txt
    short = (j.get('plan')+' season='+j['scope']['seasonId'][:8]) if isinstance(j,dict) and 'plan' in j else (j.get('message') if isinstance(j,dict) else repr(j))
    ok = st==expect
    print('%-4s %-42s expect=%d got=%d | %s'%('PASS' if ok else 'FAIL',name,expect,st,short)); return ok
S_='get_effective_tournament_season_entitlements'; T_='get_effective_tournament_entitlements'
u=tok(*U); v=tok(*V)
r=[call('P1 owner orgA+seasonA',200,S_,{'p_organization_id':OA,'p_season_id':SA},u),
   call('P5 tournament orgA+tournamentA',200,T_,{'p_organization_id':OA,'p_tournament_id':TA},u),
   call('N1 orgA+seasonB (cross)',403,S_,{'p_organization_id':OA,'p_season_id':SB},u),
   call('N2 orgB+seasonA (cross)',403,S_,{'p_organization_id':OB,'p_season_id':SA},u),
   call('N3 season inexistente',403,S_,{'p_organization_id':OA,'p_season_id':RND},u),
   call('N4 org inexistente',403,S_,{'p_organization_id':RND,'p_season_id':SA},u),
   call('N9 sin membership',403,S_,{'p_organization_id':OA,'p_season_id':SA},v),
   call('N13 tournament orgB+tournamentA',403,T_,{'p_organization_id':OB,'p_tournament_id':TA},u),
   call('X1 sin bearer (anon)',401,S_,{'p_organization_id':OA,'p_season_id':SA},None),
   call('X2 bearer firma invalida',401,S_,{'p_organization_id':OA,'p_season_id':SA},u[:-4]+'AAAA')]
print('TOTAL PASS=%d FAIL=%d'%(sum(r),len(r)-sum(r)))
