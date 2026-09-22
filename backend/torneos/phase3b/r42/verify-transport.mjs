// Independent evidence checks. Does not make HTTP calls or start any service.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {writeEvidence,artifact,utc} from './lib.mjs';
const [diagnosisPath,postfixPath]=process.argv.slice(2);
if(!diagnosisPath||!postfixPath)throw new Error('usage: verify-transport.mjs diagnosis.json postfix.json');
const diagnosis=JSON.parse(fs.readFileSync(diagnosisPath)),postfix=JSON.parse(fs.readFileSync(postfixPath));
const logs=d=>d.logs.proxy.split('\n').filter(l=>l.includes('R42_TRANSPORT ')).map(l=>JSON.parse(l.slice(l.indexOf('R42_TRANSPORT ')+14)));
const checks=[];
function check(name,fn){fn();checks.push({name,pass:true});}
function verifyFailure(d,name){
 const c=d.cases.find(c=>c.name===name),err=c.exchange.error;
 assert.equal(c.exchange.httpResponse,false);assert.equal(err.cause.code,'UND_ERR_SOCKET');
 const sends=d.events.filter(e=>e.case===name&&e.event==='undici:client:sendHeaders'&&e.path.endsWith('/exchange'));
 assert.equal(sends.length,1,'one exchange attempt only');const s=sends[0];
 assert.ok(s.socket.bytesRead>0&&s.socket.bytesWritten>0,'reused socket');
 assert.equal(err.cause.socket.bytesRead,s.socket.bytesRead,'no new response bytes');
 assert.ok(err.cause.socket.bytesWritten>s.socket.bytesWritten,'client attempted write');
 const end=d.events.find(e=>e.event==='client:end'&&e.initial.localPort===s.socket.localPort&&e.at>=s.at);
 assert.ok(end,'EOF processed after attempted exchange');
 const closed=logs(d).find(e=>e.event==='close'&&e.bytesWritten===s.socket.bytesRead&&e.bytesRead===s.socket.bytesWritten&&e.at<s.at);
 assert.ok(closed,'peer had already closed: reciprocal byte counters correlate Docker NAT sockets');
 assert.equal(logs(d).filter(e=>e.event==='request'&&e.id===c.exchange.id).length,0,'proxy received no exchange');
 for(const k of ['gateway','proxy'])assert.equal(c.exchange.atErrorState.containers[k].running,true);
 return {case:name,closedAt:closed.at,attemptedAt:s.at,EOFAt:end.at,client:s.socket,peer:closed,error:err};
}
let failures=[];
check('A: eight normal exchanges without harness succeed',()=>{const a=diagnosis.calls.filter(c=>c.case==='A'&&c.path==='/exchange');assert.equal(a.length,8);assert.ok(a.every(c=>c.status===200));});
check('B: stale socket; peer close precedes send; no proxy request; both processes alive',()=>failures.push(verifyFailure(diagnosis,'B')));
check('C/D: first exchange after same synchronous harness succeeds on fresh connection',()=>{for(const name of ['C','D']){const c=diagnosis.cases.find(c=>c.name===name);assert.equal(c.offline.pass,true);assert.equal(c.exchange.status,200);assert.equal(logs(diagnosis).filter(e=>e.event==='request'&&e.id===c.exchange.id).length,1);}});
check('E: three deterministic stale failures without offline harness',()=>{for(const name of ['E-block-only','E-block-repeat','E-block-third']){assert.equal(postfix.cases.find(c=>c.name===name).offline,undefined);failures.push(verifyFailure(postfix,name));}});
check('F: async idle succeeds with original dispatcher',()=>assert.equal(postfix.cases.find(c=>c.name==='F-async-idle').exchange.status,200));
check('G: actual async offline harness twice; first exchange succeeds; event loop runs; no retries',()=>{for(const name of ['G-worker','G-worker-repeat']){const c=postfix.cases.find(c=>c.name===name);assert.equal(c.offline.pass,true);assert.equal(c.offline.tests,29);assert.ok(c.offline.eventLoopTicks>100);assert.equal(c.exchange.status,200);const e=postfix.events.filter(e=>e.case===name);assert.equal(e.filter(e=>e.event==='undici:client:sendHeaders'&&e.path.endsWith('/exchange')).length,1);assert.ok(e.some(e=>e.event==='client:close'&&e.at<c.exchange.at));assert.equal(logs(postfix).filter(e=>e.event==='request'&&e.id===c.exchange.id).length,1);}});
check('Health 200 before/after; stable container identity/start/restart counts',()=>{for(const d of [diagnosis,postfix])for(const c of d.cases){assert.equal(c.healthBefore.status,200);assert.equal(c.healthAfter.status,200);for(const k of ['gateway','proxy']){const a=c.before.containers[k],b=c.after.containers[k];assert.equal(a.id,b.id);assert.equal(a.startedAt,b.startedAt);assert.equal(b.restartCount,0);assert.equal(b.running,true);assert.equal(b.oomKilled,false);}}});
check('Postfix routes present, unchanged in every case, including at all failures',()=>{for(const c of postfix.cases){assert.ok(c.before.gatewayRoutes.includes('unreachable default'));assert.equal(c.before.gatewayRoutes,c.after.gatewayRoutes);if(c.exchange?.atErrorState)assert.equal(c.before.gatewayRoutes,c.exchange.atErrorState.gatewayRoutes);}});
check('All diagnostic responses retain no-store; no full-matrix certification implied',()=>{for(const d of [diagnosis,postfix])assert.ok(d.calls.filter(c=>c.httpResponse).every(c=>c.cacheControl.includes('no-store')));});
check('Postfix has exactly the three expected negative controls and no warm/health errors',()=>{const failures=postfix.calls.filter(c=>!c.httpResponse);assert.equal(failures.length,3);assert.ok(failures.every(c=>c.case.startsWith('E-block')&&c.id.endsWith('-exchange')));assert.ok(postfix.cases.every(c=>!c.warm||c.warm.every(r=>r.status===200)));});
check('Both QA cleanups complete',()=>{for(const d of [diagnosis,postfix])assert.equal(d.complete,true);});
const report={status:'PASS',scope:'targeted transport only; not R4.2 certification',inputs:[artifact(diagnosisPath),artifact(postfixPath)],checks,failures,baselineRepeat:{status:diagnosis.cases.find(c=>c.name==='B-repeat').exchange.status,note:'Original pool scheduling chose a new connection; no retry. E explicitly prewarms the pool for deterministic control.'},routeCaptureLimitation:'Initial diagnosis used unsupported ip -j; its gatewayRoutesAndTCP field contains TCP only. Corrected plain ip -f inet route is verified in postfix.'};
console.log(writeEvidence('r42-transport-verification',report,utc()));console.log(JSON.stringify({status:report.status,checks:checks.length}));
