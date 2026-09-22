// Sequential, fail-fast regression: no credentials, remote calls, or matrix.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {workerExecArgv} from './outage.mjs';
import {utc, writeEvidence} from './lib.mjs';
const stamp=utc(), report={stamp,node:process.version,cases:[],status:'FAIL'};
const outage=new URL('./outage.mjs',import.meta.url).href;
const fixture=new URL('./test-fixtures/worker-argv.mjs',import.meta.url).href;
function child(flags,source) {
 const p=spawnSync(process.execPath,[...flags,'-'],{input:source,encoding:'utf8',timeout:300000,
  env:{PATH:process.env.PATH,HOME:process.env.HOME,NO_COLOR:'1'}});
 assert.equal(p.status,0,p.stderr);
 return JSON.parse(p.stdout.trim().split('\n').at(-1));
}
try {
 assert.deepEqual(workerExecArgv(['--trace-warnings','--input-type','module','--conditions','test']),{execArgv:['--trace-warnings','--conditions','test'],removed:['--input-type','module']});
 assert.deepEqual(workerExecArgv(['--input-type=module','--trace-warnings']),{execArgv:['--trace-warnings'],removed:['--input-type=module']});
 report.filter='PASS';
 report.rootCause=child(['--input-type=module'],`
 import assert from 'node:assert/strict'; import {Worker} from 'node:worker_threads';
 const w=new Worker(new URL(${JSON.stringify(fixture)})); let error;
 w.on('error',e=>error=e.code); await new Promise(r=>w.once('exit',r));
 assert.equal(error,'ERR_INPUT_TYPE_NOT_ALLOWED');
 console.log(JSON.stringify({parent:process.execArgv,error,expected:true}));`);
 const preserved=child(['--input-type','module','--trace-warnings'],`
 import assert from 'node:assert/strict';import {Worker} from 'node:worker_threads';
 import {workerExecArgv} from ${JSON.stringify(outage)};
 const selected=workerExecArgv();const w=new Worker(new URL(${JSON.stringify(fixture)}),{execArgv:selected.execArgv});
 let observed;w.on('message',v=>observed=v);await new Promise((r,j)=>{w.on('error',j);w.once('exit',r);});
 assert.deepEqual(observed,['--trace-warnings']);console.log(JSON.stringify({parent:process.execArgv,...selected,observed}));`);
 report.preserved=preserved;
 for(const [name,flags] of [['normal',[]],['input-type-module',['--input-type=module']]]) {
  const result=child(flags,`(async()=>{
   const assert=(await import('node:assert/strict')).default;
   const {runOutageHarnessAsync,workerExecArgv}=await import(${JSON.stringify(outage)});
   const r=await runOutageHarnessAsync({label:'arma2-r42-worker-test-${stamp.toLowerCase()}-${name}'});
   assert.equal(r.pass,true);assert.equal(r.tests.length,29);
   console.log(JSON.stringify({name:${JSON.stringify(name)},parent:process.execArgv,...workerExecArgv(),harness:r}));
  })().catch(e=>{console.error(e);process.exitCode=1;});`);
  report.cases.push(result);console.log(JSON.stringify({case:name,parent:result.parent,worker:result.execArgv,removed:result.removed,pass:result.harness.pass,tests:result.harness.tests.length}));
 }
 report.status='PASS';
} catch(e) {report.error=e.message;process.exitCode=1;}
console.log(JSON.stringify({status:report.status,evidence:writeEvidence('r42-worker-invocation-tests',report,stamp)}));
