import test from 'node:test';
import assert from 'node:assert/strict';
import {managedD1} from './d1-managed.mjs';
import {CORE_REF} from './core-contract.mjs';
const id='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222';
const jwt=role=>'eyJ.fake'.replace('fake',Buffer.from(JSON.stringify({role,ref:CORE_REF})).toString('base64url'))+'.signature';
function harness({throws=false,wrongIdentity=false,missingKeys=false}={}){
 let user,deleted=false;const calls=[];
 return {calls,deps:{
 mgmt:async r=>r.op==='project'?{project:{name:'arma2-torneos-staging',status:'ACTIVE_HEALTHY'}}:r.op==='function'?{fn:{status:'ACTIVE'}}:{session_present:false,user_sessions:0},
 request:async r=>{assert.equal(r.path,`/v1/projects/${CORE_REF}/api-keys?reveal=true`);return {status:200,body:missingKeys?[]:[{api_key:jwt('anon')},{api_key:jwt('service_role')}]};},
 fetchImpl:async(url,opt)=>{assert(url.startsWith(`https://${CORE_REF}.supabase.co/auth/v1/admin/users`));calls.push(opt.method);if(opt.method==='POST'){user={...JSON.parse(opt.body),id};assert(user.email.startsWith('qa-d1-'));assert.equal(user.email_confirm,true);return Response.json(user)}if(opt.method==='DELETE'){deleted=true;return Response.json({})}return Response.json(wrongIdentity?{...user,email:'someone-else@example.org'}:user,{status:deleted?404:200})},
 probe:async args=>{assert.equal(args.email,user.email);assert.equal(args.password,user.password);if(throws)throw new Error('secret should not leak '+args.password);return {pass:true,core_user_id:id,session_id:sid,steps:[200,200,204,403].map(status=>({step:'test',status,ok:true}))}}
 }};
}
const input={pat:'sbp_'+'x'.repeat(30),secret:'a'.repeat(64)};
test('managed D1 passes only after session absence and own-user cleanup',async()=>{const h=harness();const d=await managedD1(input,h.deps);assert.equal(d.pass,true);assert.equal(d.cleanup.deleted,true);assert.deepEqual(h.calls,['POST','GET','DELETE','GET']);assert(!JSON.stringify(d).includes(input.pat));assert(!JSON.stringify(d).includes('password'));});
test('probe exception still cleans up own user',async()=>{const h=harness({throws:true});const d=await managedD1(input,h.deps);assert.equal(d.pass,false);assert.equal(d.cleanup.deleted,true);assert.equal(d.failure.stage,'d1_probe');});
test('cleanup refuses a different identity',async()=>{const h=harness({wrongIdentity:true});const d=await managedD1(input,h.deps);assert.equal(d.pass,false);assert(!h.calls.includes('DELETE'));});
test('unavailable API keys stop before creating any user',async()=>{const h=harness({missingKeys:true});const d=await managedD1(input,h.deps);assert.equal(d.pass,false);assert.equal(h.calls.length,0);});
