import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { SignJWT, importPKCS8, decodeJwt, generateKeyPair } from 'jose';
import { chromium } from 'playwright';
import { config, dc, sql, writeServerConfig } from './lab.mjs';
import { createSsoClients } from './clients.mjs';
import { verifyToken } from './token.mjs';

const base = 'http://127.0.0.1:58410';
const results = [];
const seenTokens = [];
const browserRequests = [];
async function request(path, token, method='GET', data) {
  const r = await fetch(`${base}${path}`, { method, headers: {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(data ? { 'content-type':'application/json', prefer:'return=representation' } : {}),
  }, body: data ? JSON.stringify(data) : undefined });
  const text = await r.text();
  return { status:r.status, body:text ? JSON.parse(text) : null };
}
async function signup(label) {
  const email = `sso-${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa!`;
  const r = await request('/auth/v1/signup', null, 'POST', {email,password});
  assert.equal(r.status,200,'local GoTrue signup succeeds');
  assert.ok(r.body.access_token,'Core issues real session');
  seenTokens.push(r.body.access_token, r.body.refresh_token);
  return { email,password,...r.body };
}
async function exchange(coreToken) {
  const r = await request('/exchange',coreToken,'POST');
  assert.equal(r.status,200,'server-side exchange succeeds');
  seenTokens.push(r.body.access_token);
  return r.body.access_token;
}
async function sign(payload, cfg, kid='poc-k1') {
  const key = cfg.keys.find(k=>k.kid===kid);
  const token = await new SignJWT(payload).setProtectedHeader({alg:'RS256',typ:'JWT',kid})
    .sign(await importPKCS8(key.privateKey,'RS256'));
  seenTokens.push(token);
  return token;
}
function direct(token, path='/sso_probe') {
  // Deliberate attacker test INSIDE the private network, no public PostgREST port.
  const script = `const r=await fetch(${JSON.stringify(`http://torneos-rest:3000${path}`)},
    {headers:{authorization:${JSON.stringify(`Bearer ${token}`)}}});
    console.log(JSON.stringify({status:r.status,body:await r.text()}));`;
  return JSON.parse(dc(['exec','-T','gateway','node','--input-type=module','-'],script,true));
}
async function rotate(cfg, activeKid, trustedKids) {
  await writeFile('.runtime/config.json',JSON.stringify({...cfg,activeKid,trustedKids}),{mode:0o600});
  await writeServerConfig({...cfg,activeKid,trustedKids});
  await writeFile('.runtime/public/jwks.json',JSON.stringify({keys:cfg.keys.filter(k=>trustedKids.includes(k.kid)).map(k=>k.publicKey)}));
  dc(['kill','--signal','SIGUSR2','torneos-rest'],undefined,true);
  await new Promise(r=>setTimeout(r,300));
}

test('SSO isolated backend certification', async t => {
  const cfg = await config();
  const a = await signup('alice'), b = await signup('bob');
  const ta = await exchange(a.access_token), tb = await exchange(b.access_token);
  const ca = decodeJwt(ta), cb = decodeJwt(tb);
  const probeA = randomUUID(), probeB = randomUUID();
  async function check(name, fn) {
    await t.test(name, async () => {
      try { await fn(); results.push({name,status:'PASS'}); }
      catch (error) { results.push({name,status:'FAIL'}); throw error; }
    });
  }
  try {
    await check('two independent databases; only gateway published; no remote network', async () => {
      const ps = dc(['ps','--format','json'],undefined,true).trim().split('\n').map(JSON.parse);
      assert.equal(ps.length,6);
      for (const service of ps) {
        const ports = service.Publishers?.filter(p=>p.PublishedPort) ?? [];
        if (service.Service === 'gateway') {
          assert.equal(ports.length,1); assert.equal(ports[0].URL,'127.0.0.1');
        } else assert.equal(ports.length,0);
      }
      assert.equal(sql('core-db',"select count(*) from pg_tables where schemaname='public' and tablename in ('torneos_identity','sso_probe');").trim(),'0');
      assert.equal(sql('torneos-db',"select count(*) from pg_tables where schemaname='public' and tablename in ('torneos_identity','sso_probe');").trim(),'2');
      assert.match(await readFile('compose.yaml','utf8'),/internal: true/);
    });
    await check('exact JWT contract; distinct shadow IDs; concurrent upsert idempotent', async () => {
      assert.equal(ca.exp-ca.iat,120); assert.equal(ca.iss,'urn:arma2:local:identity-bridge');
      assert.equal(ca.aud,'arma2-torneos-local'); assert.equal(ca.core_user_id,a.user.id);
      assert.notEqual(ca.sub,a.user.id); assert.notEqual(ca.sub,cb.sub);
      const tokens=await Promise.all(Array.from({length:5},()=>exchange(a.access_token)));
      assert.ok(tokens.every(token=>decodeJwt(token).sub===ca.sub));
      assert.equal(new Set(tokens.map(token=>decodeJwt(token).jti)).size,5);
      assert.equal(sql('torneos-db',`select count(*) from public.torneos_identity where core_user_id='${a.user.id}';`).trim(),'1');
    });
    await check('least privilege DB roles, forced RLS and exactly two public Torneos tables', async () => {
      assert.equal(sql('core-db', `select
        has_column_privilege('poc_session_reader','auth.users','encrypted_password','SELECT') or
        has_column_privilege('poc_session_reader','auth.users','email','SELECT') or
        has_table_privilege('poc_session_reader','auth.refresh_tokens','SELECT');`).trim(),'f');
      assert.equal(sql('torneos-db', `select has_table_privilege('poc_identity_writer','public.sso_probe','SELECT') or
        has_table_privilege('authenticated','public.torneos_identity','INSERT') or
        has_table_privilege('anon','public.sso_probe','SELECT');`).trim(),'f');
      assert.equal(sql('torneos-db', `select count(*) from pg_tables where schemaname='public';`).trim(),'2');
      assert.equal(sql('torneos-db', `select count(*) from pg_class where oid in
        ('public.torneos_identity'::regclass,'public.sso_probe'::regclass) and relrowsecurity and relforcerowsecurity;`).trim(),'2');
    });
    await check('own insert/read/update; cross-user read hidden by real Postgres RLS', async () => {
      assert.equal((await request('/torneos/rest/v1/sso_probe',ta,'POST',{id:probeA,identity_id:ca.sub,note:'Alice private'})).status,201);
      assert.equal((await request('/torneos/rest/v1/sso_probe',tb,'POST',{id:probeB,identity_id:cb.sub,note:'Bob private'})).status,201);
      const own=await request('/torneos/rest/v1/sso_probe?select=*',ta);
      assert.equal(own.status,200); assert.deepEqual(own.body.map(x=>x.id),[probeA]);
      assert.deepEqual((await request(`/torneos/rest/v1/sso_probe?id=eq.${probeB}`,ta)).body,[]);
      const raw=direct(ta);
      assert.equal(raw.status,200); assert.deepEqual(JSON.parse(raw.body).map(x=>x.id),[probeA]);
      assert.equal((await request(`/torneos/rest/v1/sso_probe?id=eq.${probeA}`,ta,'PATCH',{note:'Alice updated'})).status,200);
    });
    await check('cross-user insert/update/delete and ownership reassignment denied', async () => {
      assert.equal((await request('/torneos/rest/v1/sso_probe',ta,'POST',{identity_id:cb.sub,note:'intrusion'})).status,403);
      assert.deepEqual((await request(`/torneos/rest/v1/sso_probe?id=eq.${probeB}`,ta,'PATCH',{note:'intrusion'})).body,[]);
      assert.equal((await request(`/torneos/rest/v1/sso_probe?id=eq.${probeA}`,ta,'PATCH',{identity_id:cb.sub})).status,403);
      assert.deepEqual((await request(`/torneos/rest/v1/sso_probe?id=eq.${probeB}`,ta,'DELETE')).body,null);
      const bob=await request(`/torneos/rest/v1/sso_probe?id=eq.${probeB}`,tb);
      assert.equal(bob.body[0].note,'Bob private');
      assert.equal((await request('/torneos/rest/v1/torneos_identity',ta,'POST',{core_user_id:b.user.id})).status,403);
      assert.deepEqual((await request('/torneos/rest/v1/torneos_identity',ta)).body.map(x=>x.id),[ca.sub]);
    });
    const old = Math.floor(Date.now()/1000)-300;
    const variants = {
      'expired token': {...ca,iat:old,nbf:old,exp:old+120},
      'wrong audience': {...ca,aud:'another-backend'},
      'wrong issuer': {...ca,iss:'urn:attacker'},
      'missing subject': Object.fromEntries(Object.entries(ca).filter(([k])=>k!=='sub')),
      'missing core_user_id': Object.fromEntries(Object.entries(ca).filter(([k])=>k!=='core_user_id')),
      'missing session_id': Object.fromEntries(Object.entries(ca).filter(([k])=>k!=='session_id')),
      'invalid session_id': {...ca,session_id:randomUUID()},
      'user mismatch': {...ca,sub:cb.sub},
      'Core session user mismatch': {...ca,core_user_id:b.user.id,sub:cb.sub},
      'privilege escalation': {...ca,role:'service_role'},
      'future issued token': {...ca,iat:ca.iat+60,nbf:ca.iat+60,exp:ca.exp+60},
      'excessive lifetime': {...ca,exp:ca.exp+3600},
      'missing jti': Object.fromEntries(Object.entries(ca).filter(([k])=>k!=='jti')),
    };
    for (const [name,payload] of Object.entries(variants)) {
      await check(name, async () => {
        const token=await sign(payload,cfg);
        assert.equal((await request('/torneos/rest/v1/sso_probe',token)).status,401);
        // Session ownership is checked by gateway; other authorization claims also by DB.
        if (!['Core session user mismatch','invalid session_id'].includes(name)) assert.ok(direct(token).status>=400);
      });
    }
    await check('forged signature, altered payload, unsigned and Core token rejected', async () => {
      const pair=await generateKeyPair('RS256');
      const forged=await new SignJWT(ca).setProtectedHeader({alg:'RS256',kid:'poc-k1',typ:'JWT'}).sign(pair.privateKey);
      const altered=ta.split('.'); altered[1]=Buffer.from(JSON.stringify({...ca,sub:cb.sub})).toString('base64url');
      for (const token of [forged,altered.join('.'),'eyJhbGciOiJub25lIn0.e30.',a.access_token]) {
        seenTokens.push(token);
        assert.equal((await request('/torneos/rest/v1/sso_probe',token)).status,401);
        assert.ok(direct(token).status>=400);
      }
    });
    await check('malformed JWT and malformed session UUID rejected', async () => {
      for (const token of ['not-a-jwt','@@@.%%%.!!!',await sign({...ca,session_id:'not-a-uuid'},cfg)]) {
        assert.equal((await request('/torneos/rest/v1/sso_probe',token)).status,401);
      }
    });
    await check('exchange ignores no caller identity; rejects spoofed body and foreign origin', async () => {
      assert.equal((await request('/exchange',a.access_token,'POST',{core_user_id:b.user.id,role:'service_role'})).status,400);
      assert.equal((await request('/exchange',ta,'POST')).status,401);
      assert.equal((await fetch(`${base}/exchange`,{method:'POST',headers:{Origin:'https://attacker.invalid',Authorization:`Bearer ${a.access_token}`}})).status,403);
      assert.equal((await request('/torneos/rest/v1/rpc/anything',ta,'POST')).status,404);
    });
    await check('bearer reuse allowed while active; jti is not one-use proof', async () => {
      for (let i=0;i<2;i++) assert.equal((await request('/torneos/rest/v1/sso_probe',ta)).status,200);
    });
    await check('clock skew exact boundaries: exp+4 accepted, exp+5 denied; nbf-5 accepted, nbf-6 denied', async () => {
      await verifyToken(ta,cfg,new Date((ca.exp+4)*1000));
      await assert.rejects(()=>verifyToken(ta,cfg,new Date((ca.exp+5)*1000)));
      await verifyToken(ta,cfg,new Date((ca.nbf-5)*1000));
      await assert.rejects(()=>verifyToken(ta,cfg,new Date((ca.nbf-6)*1000)));
      const now=Math.floor(Date.now()/1000);
      const grace=await sign({...ca,iat:now-122,nbf:now-122,exp:now-2},cfg);
      assert.equal((await request('/torneos/rest/v1/sso_probe',grace)).status,200);
      const elapsed=await sign({...ca,iat:now-126,nbf:now-126,exp:now-6},cfg);
      assert.equal((await request('/torneos/rest/v1/sso_probe',elapsed)).status,401);
      assert.ok(direct(elapsed).status>=400);
    });
    await check('two SDK clients keep Core session; no Torneos Auth; Core refresh works', async () => {
      const clients=createSsoClients({coreUrl:base,torneosUrl:`${base}/torneos`,anonKey:cfg.anonKey});
      try {
        assert.equal((await clients.supabaseCore.auth.setSession({access_token:a.access_token,refresh_token:a.refresh_token})).error,null);
        const before=(await clients.supabaseCore.auth.getSession()).data.session;
        const rows=await Promise.all(Array.from({length:4},()=>clients.supabaseTorneos.from('sso_probe').select('*')));
        assert.ok(rows.every(r=>r.error===null && r.data.length===1));
        assert.ok((await clients.supabaseCore.auth.getSession()).data.session.access_token===before.access_token);
        assert.equal((await clients.supabaseCore.auth.getUser()).data.user.id,a.user.id);
        const refreshed=await clients.supabaseCore.auth.refreshSession();
        assert.equal(refreshed.error,null); assert.equal(refreshed.data.user.id,a.user.id);
        seenTokens.push(refreshed.data.session.access_token,refreshed.data.session.refresh_token);
      } finally { clients.dispose(); }
    });
    await check('Torneos outage preserves Core session; Core Auth outage fails closed; recovery', async () => {
      const clients=createSsoClients({coreUrl:base,torneosUrl:`${base}/torneos`,anonKey:cfg.anonKey});
      try {
        const login=await clients.supabaseCore.auth.signInWithPassword({email:a.email,password:a.password});
        assert.equal(login.error,null);
        const session=login.data.session;
        const token=await exchange(session.access_token);
        dc(['stop','torneos-rest'],undefined,true);
        try {
          assert.equal((await request('/torneos/rest/v1/sso_probe',token)).status,503);
          assert.equal((await clients.supabaseCore.auth.getUser()).data.user.id,a.user.id);
          assert.ok((await clients.supabaseCore.auth.getSession()).data.session.access_token===session.access_token);
        } finally { dc(['start','torneos-rest'],undefined,true); }
        dc(['stop','core-auth'],undefined,true);
        try {
          assert.equal((await request('/exchange',session.access_token,'POST')).status,503);
          assert.equal((await request('/torneos/rest/v1/sso_probe',token)).status,503);
          assert.ok((await clients.supabaseCore.auth.getSession()).data.session.access_token===session.access_token);
        } finally { dc(['start','core-auth'],undefined,true); }
        for(let i=0;i<40;i++) {
          if ((await request('/health')).status===200) break;
          await new Promise(r=>setTimeout(r,250));
        }
        assert.equal((await request('/torneos/rest/v1/sso_probe',token)).status,200);
      } finally { clients.dispose(); }
    });
    await check('rotation overlap, new signing key, old key removal in gateway and PostgREST', async () => {
      try {
        await rotate(cfg,'poc-k2',['poc-k1','poc-k2']);
        const t2=await exchange(b.access_token);
        assert.equal((await request('/torneos/rest/v1/sso_probe',tb)).status,200);
        assert.equal(direct(tb).status,200); assert.equal(direct(t2).status,200);
        await rotate(cfg,'poc-k2',['poc-k2']);
        assert.equal((await request('/torneos/rest/v1/sso_probe',tb)).status,401);
        assert.ok(direct(tb).status>=400);
        assert.equal((await request('/torneos/rest/v1/sso_probe',t2)).status,200);
      } finally { await rotate(cfg,'poc-k1',['poc-k1']); }
    });
    await check('disabled Core user rejected immediately at exchange and data access', async () => {
      assert.ok(decodeJwt(tb).exp>Math.floor(Date.now()/1000),'bearer still unexpired');
      sql('core-db',`update auth.users set banned_until=now()+interval '1 hour' where id='${b.user.id}';`);
      try {
        assert.equal((await request('/exchange',b.access_token,'POST')).status,401);
        assert.equal((await request('/torneos/rest/v1/sso_probe',tb)).status,401);
      } finally { sql('core-db',`update auth.users set banned_until=null where id='${b.user.id}';`); }
    });
    await check('direct Core logout rejects new exchange and replay of live Torneos bearer', async () => {
      assert.ok(decodeJwt(tb).exp>Math.floor(Date.now()/1000),'bearer still unexpired at logout');
      assert.ok([200,204].includes((await request('/auth/v1/logout?scope=local',b.access_token,'POST')).status));
      assert.equal((await request('/exchange',b.access_token,'POST')).status,401);
      assert.equal((await request('/torneos/rest/v1/sso_probe',tb)).status,401);
    });
    await check('Core session revoked server-side without browser logout rejects existing bearer', async () => {
      const person=await signup('revoked');
      const token=await exchange(person.access_token);
      const claims=decodeJwt(token);
      sql('core-db',`delete from auth.sessions where id='${claims.session_id}';`);
      assert.ok(claims.exp>Math.floor(Date.now()/1000));
      assert.equal((await request('/exchange',person.access_token,'POST')).status,401);
      assert.equal((await request('/torneos/rest/v1/sso_probe',token)).status,401);
    });
    await check('no secrets in browser assets; private paths inaccessible; no tokens in service logs', async () => {
      const assets=await readFile('dist/index.html','utf8')+JSON.stringify((await request('/config')).body);
      const logs=dc(['logs','--no-color'],undefined,true);
      for (const value of [cfg.dbPassword,cfg.readerPassword,cfg.writerPassword,cfg.coreSecret,
        ...cfg.keys.map(k=>k.privateKey),...seenTokens]) {
        assert.equal(assets.includes(value),false,'no secret/token in public assets');
        assert.equal(logs.includes(value),false,'no secret/token in logs');
      }
      assert.equal(assets.includes('BEGIN PRIVATE KEY'),false);
      assert.equal(decodeJwt((await request('/config')).body.anonKey).role,'anon');
      for (const path of ['/.runtime/config.json','/server.mjs','/token.mjs','/compose.yaml','/node_modules/pg/package.json']) {
        assert.equal((await request(path)).status,404);
      }
    });
    await check('gateway cannot read Core signing secret or operator DB admin credentials', async () => {
      const result=dc(['exec','-T','gateway','node','--input-type=module','-'],`
        import {readFile} from 'node:fs/promises';
        const c=JSON.parse(await readFile('.runtime/server/config.json'));
        let exposed=('coreSecret' in c)||('dbPassword' in c);
        for (const p of ['.runtime/config.json','.runtime/compose.env']) {
          try { await readFile(p); exposed=true; } catch {}
        }
        console.log(JSON.stringify({exposed}));`,true);
      assert.deepEqual(JSON.parse(result),{exposed:false});
    });
  } finally {
    await mkdir('evidence',{recursive:true});
    await writeFile('evidence/backend-results.json',JSON.stringify({
      timestamp:new Date().toISOString(),scope:'Local GoTrue Core + private Torneos PostgREST; not real app integration',
      status:results.every(r=>r.status==='PASS')?'LOCAL_LAB_PASS':'FAIL',results,browserRequests,
    },null,2));
  }
});
