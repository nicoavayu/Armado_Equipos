// Targeted transport diagnosis. No matrix, fault injection, retries, or certification.
import fs from 'node:fs';
import dc from 'node:diagnostics_channel';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {r4, root, repo, d, call, docker, ROUTE_IMAGE, guardedFetch, registerSecret, decodeJwt, tableCounts, catalogSHA256, writeEvidence, artifact, log, Stop, GATEWAY, GATEWAY_ORIGIN, CORE_ORIGIN, redact} from './lib.mjs';
import {coreClient} from './core.mjs';
import {cleanupFixtures} from './fixtures.mjs';
import {runOutageHarness, runOutageHarnessAsync, workerExecArgv} from './outage.mjs';

export const socketInfo = s => Object.fromEntries(['localAddress','localPort','remoteAddress','remotePort','bytesWritten','bytesRead','destroyed','readyState'].map(k=>[k,s?.[k]??null]));
export const errorInfo = e => ({name:e?.name??null,code:e?.code??null,errno:e?.errno??null,syscall:e?.syscall??null,message:e?.message??null,cause:e?.cause?errorInfo(e.cause):null,socket:e?.socket?socketInfo(e.socket):null});

// Attach metadata-only listeners to the already-running, run-owned proxy. Inspector binds
// container loopback only; client disconnects immediately, and no request headers/body are evaluated.
export function instrumentProxy(state) {
 const expression = `(() => {
 const out=(event,data={})=>console.log('R42_TRANSPORT '+JSON.stringify({at:new Date().toISOString(),event,...data}));
 const meta=s=>Object.fromEntries(['localAddress','localPort','remoteAddress','remotePort','bytesWritten','bytesRead'].map(k=>[k,s[k]??null]));
 for(const server of process._getActiveHandles().filter(h=>h.constructor.name==='Server'&&h.address()?.port===9000)) {
 out('server',{keepAliveTimeout:server.keepAliveTimeout,keepAliveTimeoutBuffer:server.keepAliveTimeoutBuffer,headersTimeout:server.headersTimeout});
 server.on('connection',s=>{const initial=meta(s);out('connection',initial);s.on('timeout',()=>out('timeout',{...initial,...meta(s)}));s.on('close',hadError=>out('close',{...initial,bytesWritten:s.bytesWritten,bytesRead:s.bytesRead,hadError}));});
 server.on('request',(q,r)=>{const id=q.headers['x-r42-probe']||null;out('request',{id,path:q.url.split('?')[0],...meta(q.socket)});r.on('finish',()=>out('response',{id,status:r.statusCode,...meta(q.socket)}));});
 }
 return 'installed';
})()`;
 const script = `process.kill(1,'SIGUSR1'); await new Promise(r=>setTimeout(r,300));
 const list=await(await fetch('http://127.0.0.1:9229/json/list')).json();
 const ws=new WebSocket(list[0].webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:${JSON.stringify(expression)},returnByValue:true}}));ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id===1){if(m.result?.result?.value!=='installed')reject(new Error('INSTALL_FAILED'));else resolve();}};ws.onerror=reject;});
 ws.close(); await new Promise(r=>setTimeout(r,100));
 console.log('METADATA_OBSERVER_INSTALLED');`;
 const r=d(['exec','-i',state.proxy,'node','--input-type=module'],{input:script,timeout:10000});
 return r.stdout.trim();
}

export async function runTransportProbe({stamp,anonKey,serviceKey,variant='diagnosis'}) {
 const state=JSON.parse(fs.readFileSync(r4+'/.runtime/run.json'));
 const http=guardedFetch([CORE_ORIGIN]);
 const core=coreClient({http,anonKey,serviceKey,run:state.run});
 const baseline=tableCounts(),catalog=catalogSHA256();
 const doc={schema:'R4.2.transport.v1',stamp,variant,run:state.run,node:process.version,undici:process.versions.undici,scope:'targeted transport only; one QA; no fixtures; no faults; no matrix',steps:[],calls:[],events:[],cases:[],cleanup:{},status:'FAIL'};
 const start=new Date().toISOString();
 let user,active=null,Agent;
 const agents=[];const subscriptions=[];const sockets=new WeakSet();
 const event=(event,data)=>doc.events.push({at:new Date().toISOString(),case:active,event,...data});
 for(const name of ['undici:client:sendHeaders','undici:request:error']) {
  const listener=m=>{if(String(m.request?.origin)!==GATEWAY_ORIGIN)return;
   event(name,{path:m.request.path,socket:m.socket?socketInfo(m.socket):null,error:m.error?errorInfo(m.error):null});
   if(m.socket&&!sockets.has(m.socket)){sockets.add(m.socket);const initial=socketInfo(m.socket);for(const ev of ['end','close','timeout'])m.socket.on(ev,()=>event('client:'+ev,{initial,socket:socketInfo(m.socket)}));}
  };dc.channel(name).subscribe(listener);subscriptions.push([name,listener]);
 }
 async function snapshot() {
  // Observation must not itself starve the socket loop. Execute all read-only Docker
  // operations asynchronously, including during a transport failure.
  const ad=args=>promisify(execFile)(docker,args,{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024,
   env:{PATH:process.env.PATH,HOME:process.env.HOME,NO_COLOR:'1'}});
  const [states,ns,tcp,p]=await Promise.all([
   Promise.all([['gateway',state.gateway],['proxy',state.proxy]].map(async([k,n])=>{const x=JSON.parse((await ad(['inspect',n])).stdout)[0];return[k,{id:x.Id,running:x.State.Running,restartCount:x.RestartCount,startedAt:x.State.StartedAt,finishedAt:x.State.FinishedAt,exitCode:x.State.ExitCode,oomKilled:x.State.OOMKilled}];})),
   ad(['run','--rm','--pull','never','--network','container:'+state.gateway,'--cap-drop','ALL','--entrypoint','sh',ROUTE_IMAGE,'-c','ip -f inet route']),
   ad(['exec',state.gateway,'sh','-c','cat /proc/net/tcp; cat /proc/net/tcp6']),
   ad(['exec',state.proxy,'sh','-c','cat /proc/net/tcp; cat /proc/net/tcp6; if test -f /fault/mode; then cat /fault/mode; fi'])]);
  if(!ns.stdout.includes('unreachable default'))throw new Stop('ROUTE_OBSERVATION_FAILED');
  return {at:new Date().toISOString(),containers:Object.fromEntries(states),gatewayRoutes:ns.stdout,gatewayTCP:tcp.stdout,proxyTCPAndFault:p.stdout};
 }
 function fresh(options={}) {const a=new Agent(options);agents.push(a);return a;}
 async function request(path,{dispatcher,close=false,id}={}) {
  const at=new Date().toISOString();const before=performance.now();
  const row={case:active,id,at,url:GATEWAY+path,path};doc.calls.push(row);
  try {
   const r=await fetch(GATEWAY+path,{method:path==='/exchange'?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(25000),...(dispatcher?{dispatcher}:{}),headers:{'x-r42-probe':id,...(close?{connection:'close'}:{}),...(path==='/exchange'?{authorization:'Bearer '+user.sessions.at(-1).accessToken}:{})}});
   const body=await r.json();if(body.access_token){registerSecret(body.access_token);user.claims=decodeJwt(body.access_token);}
   Object.assign(row,{httpResponse:true,status:r.status,error:body.error??null,cacheControl:r.headers.get('cache-control'),keepAlive:r.headers.get('keep-alive'),connection:r.headers.get('connection')});
  }catch(e){Object.assign(row,{httpResponse:false,error:errorInfo(e)});row.atError=new Date().toISOString();row.atErrorState=await snapshot();}
  row.ms=Math.round(performance.now()-before);return row;
 }
 async function offlineSync() {const t=Date.now();const r=runOutageHarness({label:state.run});return {ms:Date.now()-t,pass:r.pass,tests:r.tests.length,bundleSHA256:r.bundleSHA256};}
 try {
  doc.instrumentation=instrumentProxy(state);
  user=await core.createUser('transport');await core.login(user);
  // Initializes Node's own bundled Undici dispatcher; no npm install or version switch.
  const initial=await request('/health',{id:'initial-health',close:true});
  if(initial.status!==200)throw new Stop('INITIAL_HEALTH_FAILED');
  Agent=globalThis[Symbol.for('undici.globalDispatcher.1')].constructor;
  doc.dispatcherConstructor=Agent.name;
  if (variant !== 'worker') {
  active='A';const a={name:'A',before:await snapshot()};doc.cases.push(a);
  a.healthBefore=await request('/health',{id:'A-health-before'});
  for(let i=0;i<8;i++)await request('/exchange',{id:'A-exchange-'+i});
  a.healthAfter=await request('/health',{id:'A-health-after'});a.after=await snapshot();
  }
  for(const name of (variant==='worker'?['G-worker','G-worker-repeat']:variant==='postfix'?['E-block-only','E-block-repeat','E-block-third','F-async-idle','G-worker','G-worker-repeat']:['B','C','D','B-repeat'])) {
   active=name;const c={name,before:await snapshot()};doc.cases.push(c);
   // Same end of previous block as R4.2: recovered health, sync offline harness, exchange.
   c.warm=await Promise.all([0,1].map(i=>request('/health',{id:name+'-warm-'+i})));
   c.healthBefore=await request('/health',{id:name+'-health-before'});
   if(!c.warm.every(r=>r.status===200))throw new Stop('WARM_HEALTH_FAILED',name);
   if(c.healthBefore.status!==200)throw new Stop('PRE_CASE_HEALTH_FAILED',name);
   const t=Date.now();
   if(name.startsWith('E-block')) { call(process.execPath,['-e','Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,8000)']); c.control={kind:'8s synchronous child; no offline harness',ms:Date.now()-t}; }
   else if(name==='F-async-idle') { await new Promise(r=>setTimeout(r,8000)); c.control={kind:'8s async idle; no offline harness',ms:Date.now()-t}; }
   else if(name.startsWith('G-worker')) {let ticks=0;const timer=setInterval(()=>ticks++,100);try {const r=await runOutageHarnessAsync({label:state.run});c.workerInvocation={parent:process.execArgv,...workerExecArgv()};c.offline={ms:Date.now()-t,pass:r.pass,tests:r.tests.length,bundleSHA256:r.bundleSHA256,eventLoopTicks:ticks};}finally{clearInterval(timer);}}
   else c.offline=await offlineSync();
   if(variant==='worker' && (!c.offline?.pass || c.offline.tests!==29))throw new Stop('WORKER_HARNESS_FAILED',name);
   c.exchange=await request('/exchange',{id:name+'-exchange',...(name==='C'?{dispatcher:fresh()}:{}),...(name==='D'?{dispatcher:fresh({pipelining:0}),close:true}:{})});
   if(variant==='worker' && c.exchange.status!==200)throw new Stop('WORKER_EXCHANGE_FAILED',name);
   c.healthAfter=await request('/health',{id:name+'-health-after',dispatcher:fresh(),close:true});
   c.after=await snapshot();
   if(c.healthAfter.status!==200)throw new Stop('POST_CASE_HEALTH_FAILED',name);
   if(variant==='worker') {
    const stable=['gateway','proxy'].every(k=>{
     const before=c.before.containers[k],after=c.after.containers[k];
     return before.running&&after.running&&before.id===after.id&&before.startedAt===after.startedAt
      &&before.restartCount===0&&after.restartCount===0;
    });
    if(!stable||c.before.gatewayRoutes!==c.after.gatewayRoutes)throw new Stop('WORKER_RUNTIME_CHANGED',name);
   }
   log(`transport ${name}: exchange=${c.exchange.status??c.exchange.error?.cause?.code} health=${c.healthAfter.status}`);
  }
  const socketFailure=c=>!c.exchange.httpResponse&&c.exchange.error?.cause?.code==='UND_ERR_SOCKET';
  doc.expectations={noUnexpectedFailures:doc.calls.filter(c=>!c.httpResponse).every(c=>c.id.endsWith('-exchange')&&(c.case.startsWith('E-block')||['B','B-repeat'].includes(c.case))),normal:doc.calls.filter(c=>c.id?.startsWith('A-exchange')).every(c=>c.status===200),
   cases:doc.cases.filter(c=>c.name!=='A').every(c=>(['B','B-repeat'].includes(c.name)||c.name.startsWith('E-block'))?socketFailure(c):c.exchange.status===200),
   health:doc.cases.every(c=>c.healthBefore.status===200&&c.healthAfter.status===200),
   offline:doc.cases.every(c=>!c.offline||c.offline.pass),
   processes:doc.cases.every(c=>['gateway','proxy'].every(k=>c.before.containers[k].running&&c.after.containers[k].running&&c.before.containers[k].startedAt===c.after.containers[k].startedAt&&c.after.containers[k].restartCount===0)),
   routes:doc.cases.every(c=>c.before.gatewayRoutes===c.after.gatewayRoutes)};
  doc.status=Object.values(doc.expectations).every(Boolean)?'PASS':'FAIL';doc.steps.push({name:'targeted_transport_expectations',status:doc.status});
 }catch(e){doc.aborted=redact(e.message);log('transport aborted: '+doc.aborted);}
 finally {
  active='cleanup';
  for(const a of agents)await a.close();
  if(user){const logout=await core.logout(user.sessions.at(-1),'global');const del=await core.deleteUser(user);const rows=cleanupFixtures({baseline,orgs:[],identities:[user.claims?.sub].filter(Boolean),coreUserIds:[user.coreUserId],RUN:state.run.replace('arma2-r42-','').slice(0,15)});
   doc.cleanup={qa:del.deleted,sessions:[204,401,403].includes(logout),rows:rows.ok,catalogUnchanged:catalogSHA256()===catalog,logout,delete:del,rowsDetail:rows};}
  doc.qaUsers=user?[{role:'transport',id:user.coreUserId,lastSession:user.sessions.at(-1)?.sessionId,deleted:doc.cleanup.qa}]:[];
  doc.complete=Object.entries(doc.cleanup).filter(([k])=>['qa','sessions','rows','catalogUnchanged'].includes(k)).length===4&&['qa','sessions','rows','catalogUnchanged'].every(k=>doc.cleanup[k]===true);
  doc.logs=Object.fromEntries([['gateway',state.gateway],['proxy',state.proxy]].map(([k,n])=>{const r=d(['logs','--timestamps','--since',start,n],{ok:true});return[k,redact(r.stdout+'\n'+r.stderr)];}));
  for(const [n,l]of subscriptions)dc.channel(n).unsubscribe(l);
 }
 const evidencePath=writeEvidence('r42-targeted-transport',doc,stamp);return {doc,artifact:artifact(evidencePath),evidencePath};
}
