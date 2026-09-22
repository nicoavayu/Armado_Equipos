import tls from 'node:tls';
import {consumeCustody,installMemoryEnvironment} from '../custody.ts';
import { installTransport, CORE } from '../transport.ts';
const report: any = { tests: [], gatewayStarted: false };
async function test(name: string, fn: () => Promise<unknown>) {
  try { const detail = await fn(); report.tests.push({ name, pass: true, detail }); }
  catch (e) { report.tests.push({ name, pass: false, error: e instanceof Error ? e.name : 'Error', ...(name==='deny_external_dns'&&e instanceof Error?{diagnostic:e.message}:{}) }); }
}
function assert(ok: unknown) { if (!ok) throw new Error('ASSERT'); }
async function deniedFetch(url: string, init: any = {}) {
  try { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(2200) }); await r.body?.cancel(); }
  catch { return 'transport denied'; }
  throw new Error('UNEXPECTED_CONNECT');
}
let envelope: any;
try {
  envelope=await consumeCustody();
} catch { console.log('R4_FAIL_CLOSED_MISSING_SECRET'); Deno.exit(78); }
report.custody={readOnce:true,mode:'0600',artifactRemoved:!(await Deno.stat('/custody/input').catch(()=>null))};
// Keep custody in the isolate object; Edge main workers forbid Deno.env.set.
// A future gateway user worker must receive this via in-memory envVars, not Docker env.
const transport=installTransport(envelope.cert);
const memoryEnv=installMemoryEnvironment(envelope);
await test('in_memory_gateway_config',async()=>{const {loadConfig}=await import('../../gateway/config.ts');const cfg=loadConfig(Deno.env.toObject());assert(cfg.coreContractSecret.length>=32&&cfg.bridge.activeKid==='p3b-k1');return {valid:true,keyRingReused:true};});
await test('load_all_gateway_modules_offline',async()=>{
  const realServe = Deno.serve;
  let intercepted=0;
  Deno.serve = ((..._args: any[])=>{intercepted++;return {};}) as any;
  try { await import('../../gateway/index.ts'); } finally { Deno.serve=realServe; }
  assert(intercepted===1);
  return {served:false,entrypointImported:true};
});
await test('core_staging_exact',async()=>{
  const r=await fetch(`https://${CORE}/auth/v1/health`,{signal:AbortSignal.timeout(8000)});
  assert([200,401,403].includes(r.status));await r.body?.cancel();return {status:r.status};
});
await test('torneos_rest',async()=>{const r=await fetch('http://torneos-rest:3000/',{signal:AbortSignal.timeout(2500)});assert([200,401,403,404].includes(r.status));await r.body?.cancel();return {status:r.status};});
const targets=[['production','https://rcyuuoaqfwcembdajcss.supabase.co'],['other_supabase','https://abcdefghijklmnopqrst.supabase.co'],['google','https://google.com'],['github','https://github.com'],['npm','https://registry.npmjs.org'],['esm','https://esm.sh'],['denoland','https://deno.land'],['external_ip','https://1.1.1.1'],['external_http_ip','http://1.1.1.1'],['ipv6','https://[2606:4700:4700::1111]']];
await Promise.all(targets.map(([name,url])=>test('deny_'+name,()=>deniedFetch(url))));
await test('deny_external_dns',async()=>{
 try {const records=await Deno.resolveDns('example.org','A',{nameServer:{ipAddr:'127.0.0.11',port:53},signal:AbortSignal.timeout(2500)});if(records.length===0)return {records:0};throw new Error('DNS_EGRESS_RECORDS_'+JSON.stringify(records));}
 catch(e){if(!(e instanceof Deno.errors.TimedOut || e instanceof Deno.errors.NotFound || e instanceof Deno.errors.ConnectionRefused || (e instanceof Error&&(['AbortError','TimeoutError'].includes(e.name)||/failed to lookup address information|Temporary failure in name resolution|Name or service not known|SERVFAIL/.test(e.message)))))throw e;return 'external DNS unavailable';}
 throw new Error('DNS_EGRESS');
});
await test('deny_direct_core_ip',()=>deniedFetch(`https://${envelope.coreIP}`));
async function deniedTCP(hostname:string, port:number) {
 const attempt=Deno.connect({hostname,port}).then(c=>{c.close();return 'CONNECTED';},()=> 'DENIED');
 const outcome=await Promise.race([attempt,new Promise<string>(resolve=>setTimeout(()=>resolve('TIMEOUT'),2200))]);
 assert(outcome!=='CONNECTED');return outcome;
}
await Promise.all([['1.1.1.1',443],['8.8.8.8',53],[envelope.coreIP,443],['192.0.2.1',443],[envelope.localGateway,58430],[envelope.proxyGateway,80]].map(([host,port])=>test('raw_tcp_deny_'+host+'_'+port,()=>deniedTCP(String(host),Number(port)))));
for(const [name,url] of targets.filter(([name])=>!name.includes('ip')))await test('proxy_deny_'+name,async()=>{
 const socket=await Deno.connectTls({hostname:CORE,port:443,caCerts:[envelope.cert]});
 await socket.write(new TextEncoder().encode(`GET / HTTP/1.1\r\nHost: ${new URL(url).hostname}\r\nConnection: close\r\n\r\n`));
 const buffer=new Uint8Array(2048);const n=await socket.read(buffer);socket.close();assert(new TextDecoder().decode(buffer.subarray(0,n||0)).includes('403'));return '403';
});

await test('deny_proxy_wrong_sni',async()=>{
 await new Promise<void>((resolve,reject)=>{
  const socket=tls.connect({host:envelope.proxyIP,port:443,servername:'google.com',ca:envelope.cert});
  socket.setTimeout(2200,()=>{socket.destroy();reject(new Error('TIMEOUT'));});
  socket.once('secureConnect',()=>socket.write(`GET / HTTP/1.1\r\nHost: ${CORE}\r\nConnection: close\r\n\r\n`));
  socket.once('data',()=>{socket.destroy();reject(new Error('SNI_ACCEPTED'));});
  socket.once('end',()=>{socket.destroy();resolve();});
  socket.once('error',()=>{socket.destroy();resolve();});
 });return 'TLS rejected';
});
await test('deny_proxy_connect_tunnel',async()=>{
 const socket=await Deno.connectTls({hostname:CORE,port:443,caCerts:[envelope.cert]});
 await socket.write(new TextEncoder().encode(`CONNECT google.com:443 HTTP/1.1\r\nHost: ${CORE}\r\n\r\n`));
 const buf=new Uint8Array(128);try{const n=await socket.read(buf);assert(n===null);}catch(e){if(!(e instanceof Deno.errors.UnexpectedEof))throw e;}finally{socket.close();}return 'tunnel closed';
});
await test('deny_proxy_absolute_url',async()=>{
  const socket=await Deno.connectTls({hostname:CORE,port:443,caCerts:[envelope.cert]});
  await socket.write(new TextEncoder().encode(`GET https://google.com/ HTTP/1.1\r\nHost: ${CORE}\r\nConnection: close\r\n\r\n`));
  const buffer=new Uint8Array(2048);const n=await socket.read(buffer);socket.close();assert(new TextDecoder().decode(buffer.subarray(0,n||0)).includes('403'));return '403';
});
await test('redirect_other_host',async()=>{
  const server=Deno.serve({hostname:'127.0.0.1',port:9101,onListen:()=>{}},()=>new Response(null,{status:302,headers:{location:'https://google.com'}}));
  try { await deniedFetch('http://127.0.0.1:9101/');
    try { const r=await transport.original('http://127.0.0.1:9101/',{redirect:'follow',signal:AbortSignal.timeout(2200)});await r.body?.cancel();throw new Error('FOLLOW_SUCCEEDED'); }
    catch(e){if(e instanceof Error && e.message==='FOLLOW_SUCCEEDED')throw e;}
    return {policyDenied:true,rawFollowNetworkDenied:true,source:'local transport-only redirect response'};
  }finally{await server.shutdown();}
});
const {connect,asRole}=await import('../../gateway/db.ts');
for(const [key,login,role] of [['writerPassword','torneos_edge_identity_writer','torneos_identity_writer'],['adapterPassword','torneos_edge_core_adapter','torneos_core_adapter']]){
  await test('db_'+role,async()=>{
    const sql=connect(`postgres://${login}:${envelope[key]}@torneos-db:5432/postgres`);
    try{return await asRole(sql,role as any,async(tx:any)=>{await tx.unsafe('SET TRANSACTION READ ONLY');const rows=await tx.unsafe('SELECT current_user, session_user, current_setting(\'transaction_read_only\') AS read_only, pg_has_role(session_user, \'postgres\', \'MEMBER\') AS can_be_postgres');assert(rows[0].current_user===role&&rows[0].read_only==='on'&&!rows[0].can_be_postgres);return rows[0];});}
    finally{await sql.end({timeout:1});}
  });
}
envelope=null;transport.client.close();
report.pass=report.tests.every((t:any)=>t.pass);
console.log('R4_RESULT '+JSON.stringify(report));
Deno.exit(report.pass?0:1);
