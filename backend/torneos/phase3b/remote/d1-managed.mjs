// User-authorized dedicated QA creation for D1 (2026-09-17). Staging only.
// Credentials remain in memory. Cleanup may delete ONLY the user created by this run.
import {randomBytes,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {CORE_REF} from './core-contract.mjs';
import {run,httpsRequest,PAT_PATTERN,assertNoProduction} from './mgmt.mjs';
import {runD1Positive,decodeJwt,assertAnonKey} from './d1-positive.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function managedD1({pat,secret}, {mgmt=run,request=httpsRequest,fetchImpl=fetch,probe=runD1Positive}={}) {
  if (!PAT_PATTERN.test(pat??'') || !/^[0-9a-f]{64}$/.test(secret??'')) throw new Error('credentials_invalid');
  assertNoProduction('token',pat);
  const result={generated_at:new Date().toISOString(),core_ref:CORE_REF,mode:'run',pass:false,verdict:'D1_POSITIVE_FAIL',qa_user:{dedicated:true,created:false},cleanup:{deleted:false},steps:[]};
  let stage='project',createdId,service;
  const email=`qa-d1-${randomUUID()}@accounts.invalid`, password=randomBytes(32).toString('base64url');
  async function admin(method,path,body) {
    const r=await fetchImpl(`https://${CORE_REF}.supabase.co/auth/v1/admin/users${path}`,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{apikey:service,authorization:`Bearer ${service}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    let data;try{data=await r.json()}catch{data=null}return {status:r.status,data};
  }
  try {
    const p=await mgmt({op:'project',pat,ref:CORE_REF});
    if(p.project?.name!=='arma2-torneos-staging'||p.project?.status!=='ACTIVE_HEALTHY')throw new Error('project_guard');
    stage='function';const f=await mgmt({op:'function',pat,ref:CORE_REF,slug:'torneos-core-contract'});
    if(f.fn?.status!=='ACTIVE')throw new Error('function_guard');
    stage='api_keys';const keys=await request({pat,method:'GET',path:`/v1/projects/${CORE_REF}/api-keys?reveal=true`});
    if(keys.status!==200||!Array.isArray(keys.body))throw new Error('api_keys_unavailable');
    const anon=keys.body.find(k=>decodeJwt(k.api_key)?.role==='anon'&&decodeJwt(k.api_key)?.ref===CORE_REF)?.api_key;
    service=keys.body.find(k=>decodeJwt(k.api_key)?.role==='service_role'&&decodeJwt(k.api_key)?.ref===CORE_REF)?.api_key;
    assertAnonKey(anon,CORE_REF);if(!service)throw new Error('service_key_unavailable');
    stage='create_user';const c=await admin('POST','',{email,password,email_confirm:true,app_metadata:{purpose:'phase3b-d1'},user_metadata:{name:'QA D1 ephemeral'}});
    if(![200,201].includes(c.status)||!UUID.test(c.data?.id??'')||c.data?.email!==email)throw new Error('create_user_not_confirmed');
    createdId=c.data.id;result.qa_user={dedicated:true,created:true,user_id:createdId};
    stage='d1_probe';const d=await probe({ref:CORE_REF,anon_key:anon,email,password,secret,fetchImpl});
    // Persist an allowlisted summary; no API error bodies or credentials.
    result.steps=d.steps.map(s=>({step:s.step,status:s.status,ok:s.ok,...(s.body?.active===true?{body:{active:true,checked_at:s.body.checked_at}}:{}),...(s.body?.error==='FORBIDDEN'?{body:{error:'FORBIDDEN'}}:{})}));
    if(d.core_user_id!==createdId||!UUID.test(d.session_id??''))throw new Error('test_identity_mismatch');
    stage='session_readback';const sess=await mgmt({op:'core-session-exists',pat,ref:CORE_REF,user_id:createdId,session_id:d.session_id});
    result.session={id_prefix:d.session_id.slice(0,8),present_after:sess.session_present,user_sessions_after:sess.user_sessions};
    result.pass=d.pass===true&&sess.session_present===false&&sess.user_sessions===0;
    result.verdict=result.pass?'D1_POSITIVE_PASS':'D1_POSITIVE_FAIL';
  } catch(e) {result.failure={stage,error:'stage_failed',kind:e.name};}
  finally {
    if(createdId) {
      try {
        const own=await admin('GET',`/${createdId}`);
        if(own.status!==200||own.data?.id!==createdId||own.data?.email!==email||own.data?.app_metadata?.purpose!=='phase3b-d1')throw new Error('cleanup_identity_guard');
        const del=await admin('DELETE',`/${createdId}`,{should_soft_delete:false});
        if(![200,204].includes(del.status))throw new Error('cleanup_delete_failed');
        const after=await admin('GET',`/${createdId}`);
        result.cleanup={deleted:after.status===404,status:after.status};
      }catch{result.cleanup={deleted:false,error:'cleanup_failed'};}
      if(!result.cleanup.deleted){result.pass=false;result.verdict='D1_CLEANUP_FAILED';}
    }
  }
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let s='';for await(const c of process.stdin)s+=c;
 try{const d=await managedD1(JSON.parse(s));s='';process.stdout.write(JSON.stringify(d)+'\n');process.exitCode=d.pass?0:1;}
 catch{process.stdout.write('{"pass":false,"verdict":"D1_INPUT_FAILED"}\n');process.exitCode=1;}
}
