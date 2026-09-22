import {requireAuthorization} from './authorization.mjs';
import {validateMatrix} from './certification.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(root,'../../../..');
const evidence=path.resolve(root,'../evidence'),runtime=root+'/.runtime';
const docker='/Applications/Docker.app/Contents/Resources/bin/docker';
const EDGE='sha256:a82676277615aee03c4f288cbbbf68dedb5ba8693073e567ab8dbfdd11ba5d45';
const command=process.argv[2];
const commands=['prepare','preflight','start-gateway','smoke','certify','cleanup','status'];
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const utc=()=>new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z/,'Z');
function assert(v,code){if(!v)throw new Error(code);}
function run(bin,args){const r=spawnSync(bin,args,{encoding:'utf8',timeout:45000,killSignal:'SIGKILL',maxBuffer:16*1024*1024});assert(r.status===0,'COMMAND_FAILED_'+path.basename(bin)+'_'+args[0]);return r.stdout;}
const d=args=>run(docker,args);
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
function sourceManifest(){return walk(root).filter(f=>!f.startsWith(runtime+'/')&&!f.includes('/offline-cache/')).map(f=>({path:path.relative(root,f),sha256:sha(fs.readFileSync(f))}));}
function verifyFiles(base,manifest){for(const item of manifest)assert(sha(fs.readFileSync(path.join(base,item.path)))===item.sha256,'HASH_DRIFT_'+item.path);}
function gate(){
 const candidates=fs.readdirSync(evidence).filter(f=>/^r4-preflight-\d+T\d+Z\.json$/.test(f)).sort().reverse();
 const newest=candidates.map(f=>({f,doc:read(path.join(evidence,f))})).find(({doc})=>doc.r41bExecuted===false);
 assert(newest&&newest.doc.status==='R4_1A_PASS','R4_1A_NOT_PASS');
 const stamp=newest.doc.utc;
 const seal=read(`${evidence}/r4-hashes-${stamp}.json`);
 for(const item of seal.files)assert(sha(fs.readFileSync(`${evidence}/${item.file}`))===item.sha256,'EVIDENCE_HASH_DRIFT');
 verifyFiles(root,seal.sources);
 const offline=read(`${evidence}/r4-offline-deps-${stamp}.json`);
 verifyFiles(root+'/offline-cache',offline.cacheManifest);
 verifyFiles(repo+'/backend/torneos/supabase/functions/torneos-gateway',offline.sourceFiles);
 for(const kind of ['r4-isolation-design','r4-offline-deps','r4-secret-custody','r4-egress-test'])assert(read(`${evidence}/${kind}-${stamp}.json`).status==='PASS','R4_1A_SUBGATE_FAILED');
 return {stamp,offline,isolation:read(`${evidence}/r4-isolation-design-${stamp}.json`),sealSHA256:sha(fs.readFileSync(`${evidence}/r4-hashes-${stamp}.json`))};
}
function write(kind,value){fs.mkdirSync(evidence,{recursive:true});const p=`${evidence}/${kind}-${utc()}.json`;fs.writeFileSync(p,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});return p;}
async function prepare(){
 const certified=gate();
 fs.mkdirSync(runtime,{recursive:true,mode:0o700});
 const before=sourceManifest();
 d(['run','--rm','--pull','never','--network','none','-e','DENO_DIR=/cache','-v',root+'/offline-cache:/cache:ro','-v',root+':/r4','-v',repo+'/backend/torneos/supabase/functions/torneos-gateway:/gateway:ro',EDGE,'bundle','--entrypoint','/r4/gateway/index.ts','--output','/r4/.runtime/gateway.eszip','--checksum','sha256','--timeout','30']);
 verifyFiles(root+'/offline-cache',certified.offline.cacheManifest);
 const state={phase:'R4.1B',command:'prepare',status:'PASS',utc:utc(),r41aUTC:certified.stamp,r41aSealSHA256:certified.sealSHA256,sourceManifest:before,gatewayBundleSHA256:sha(fs.readFileSync(runtime+'/gateway.eszip')),edgeImage:EDGE,offline:true,gatewayStarted:false,authorizedOperations:['prepare','preflight'],r42Authorized:false};
 fs.writeFileSync(runtime+'/prepared.json',JSON.stringify(state,null,2)+'\n',{mode:0o600});
 return {status:'PASS',command:'prepare',evidence:write('r4-prepare',state),gatewayStarted:false};
}
async function preflight(){
 const certified=gate(),prepared=read(runtime+'/prepared.json');
 assert(prepared.r41aUTC===certified.stamp&&prepared.r41aSealSHA256===certified.sealSHA256,'CERTIFICATION_CHANGED');
 verifyFiles(root,prepared.sourceManifest);
 assert(prepared.gatewayBundleSHA256===sha(fs.readFileSync(runtime+'/gateway.eszip')),'BUNDLE_DRIFT');
 const ring=repo+'/integration/torneos-isolated-local/.runtime/config.json';
 assert((fs.statSync(ring).mode&0o777)===0o600,'RING_PERMISSIONS');
 assert(sha(fs.readFileSync(ring))===certified.isolation.baselineAfter.ringSHA256,'RING_DRIFT');
 assert(sha(fs.readFileSync(repo+'/integration/torneos-isolated-local/.runtime/public/jwks.json'))===certified.isolation.baselineAfter.jwksSHA256,'JWKS_DRIFT');
 const containers=JSON.parse(d(['inspect','arma2-torneos-isolated-local-torneos-db-1','arma2-torneos-isolated-local-torneos-rest-1']));
 for(const [i,name]of ['db','rest'].entries()){
   const current=containers[i],base=certified.isolation.baselineAfter[name];
   assert(current.Id===base.id&&current.Image===base.image&&current.State.StartedAt===base.started&&current.State.Running,'R2_CONTAINER_DRIFT');
   assert(JSON.stringify(current.NetworkSettings.Networks)===JSON.stringify(base.networks),'R2_NETWORK_DRIFT');
   if(name==='db')assert(current.State.Health.Status==='healthy'&&JSON.stringify(current.Mounts)===JSON.stringify(base.mounts),'R2_DB_DRIFT');
 }
 const r4containers=d(['ps','-a','--filter','label=arma2.r4.run','--format','{{.ID}}']).trim();assert(!r4containers,'TEMPORARY_R4_CONTAINER_REMAINS');
 const legacy=d(['ps','-a','--filter','label=com.docker.compose.project=arma2-torneos-isolated-local','--filter','label=com.docker.compose.service=torneos-functions','--format','{{.ID}}']).trim();assert(!legacy,'LEGACY_GATEWAY_PRESENT');
 const presence=spawnSync('/usr/bin/security',['find-generic-password','-s','arma2-torneos-nonprod-core','-a','contract-secret'],{encoding:'utf8',timeout:10000});assert(presence.status===0,'KEYCHAIN_ENTRY_MISSING');
 await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',()=>reject(new Error('GATEWAY_PORT_BUSY')));s.listen(58431,'127.0.0.1',()=>s.close(resolve));});
 const doc={utc:utc(),phase:'R4.1B',command:'preflight',status:'PASS',r41bExecuted:true,executed:['prepare','preflight'],r41aUTC:certified.stamp,r41aSealSHA256:certified.sealSHA256,sourceManifest:prepared.sourceManifest,gatewayBundleSHA256:prepared.gatewayBundleSHA256,r2Preserved:true,keychainPresence:true,keychainValueRead:false,gatewayPortAvailable:true,temporaryComponentsAbsent:true,secretInjectionCertified:true,offlineDepsCertified:true,egressCertified:true,gatewayStarted:false,matrixExecuted:false,r42Authorized:false,blockers:[]};
 return {status:'PASS',command:'preflight',evidence:write('r4-preflight',doc),gatewayStarted:false};
}
function liveRun(){
 const state=read(runtime+'/run.json');
 const rows=JSON.parse(d(['inspect',...state.containers]));
 for(const c of rows)assert(c.Config.Labels['arma2.r4.run']===state.run&&c.State.Running,'RUNTIME_NOT_OWNED_OR_STOPPED');
 assert(state.gatewayBundleSHA256===sha(fs.readFileSync(runtime+'/gateway.eszip')),'LIVE_BUNDLE_DRIFT');
 return state;
}
async function startGateway(){
 // Reuses the very same provisioning, route policy and custody exercised by the audit.
 await preflight();
 const output=run(process.execPath,[root+'/audit.mjs','start-gateway']);
 return JSON.parse(output.trim().split('\n').at(-1));
}
async function smoke(){
 const state=liveRun();const probes=[];
 const fetchJSON=async suffix=>{const r=await fetch('http://127.0.0.1:58431/torneos-gateway'+suffix,{redirect:'error',signal:AbortSignal.timeout(7000)});assert(r.status===200,'SMOKE_HTTP_'+r.status);assert(r.headers.get('cache-control')?.includes('no-store'),'SMOKE_CACHE_POLICY');const doc=await r.json();probes.push({path:suffix,status:r.status});return doc;};
 const config=await fetchJSON('/config');assert(config.coreUrl==='https://hhyvmhgpapyuzjgxfnqv.supabase.co'&&config.torneosUrl==='http://127.0.0.1:58431/torneos-gateway/torneos','SMOKE_TARGET_MISMATCH');
 const jwks=await fetchJSON('/.well-known/jwks.json');
 const expected=read(repo+'/integration/torneos-isolated-local/.runtime/public/jwks.json');
 assert(JSON.stringify(jwks)===JSON.stringify(expected),'SMOKE_JWKS_DRIFT');
 const health=await fetchJSON('/health');assert(health.ready===true,'SMOKE_NOT_READY');
 const doc={utc:utc(),status:'PASS',phase:'R4.2',run:state.run,gatewayBundleSHA256:state.gatewayBundleSHA256,probes,matrixExecuted:false};
 const evidencePath=write('r4-smoke',doc);state.smoke={path:evidencePath,sha256:sha(fs.readFileSync(evidencePath))};fs.writeFileSync(runtime+'/run.json',JSON.stringify(state,null,2)+'\n',{mode:0o600});
 return {status:'PASS',command:'smoke',evidence:evidencePath};
}
async function certify(){
 const state=liveRun();assert(state.smoke&&sha(fs.readFileSync(state.smoke.path))===state.smoke.sha256,'SMOKE_REQUIRED');
 const smokeEvidence=read(state.smoke.path);assert(smokeEvidence.status==='PASS'&&smokeEvidence.run===state.run,'SMOKE_BINDING');
 const matrixPath=process.argv[3];assert(matrixPath,'MATRIX_EVIDENCE_REQUIRED');
 const matrix=read(path.resolve(matrixPath));
 const allowed=[...new Set(Object.values(read(repo+'/backend/torneos/supabase/functions/torneos-gateway/staging-v1-rpc-allowlist.json').features).flat())];
 const gated=read(repo+'/backend/torneos/phase2d/staging-v1-rpc-gate.json').functions.map(f=>f.name);
 const artifacts=validateMatrix(matrix,state,allowed,gated);
 for(const item of artifacts){const file=path.resolve(evidence,item.path);assert(file.startsWith(evidence+'/')&&sha(fs.readFileSync(file))===item.sha256,'MATRIX_ARTIFACT_INVALID');}
 const doc={utc:utc(),phase:'R4.2',status:'PASS',run:state.run,gatewayBundleSHA256:state.gatewayBundleSHA256,matrixSHA256:sha(fs.readFileSync(matrixPath)),smokeSHA256:state.smoke.sha256,allowlistCount:allowed.length,gatedCount:gated.length,caseCount:matrix.cases.length,source:'validated external R4.2 matrix evidence; this command does not create QA/fixtures'};
 return {status:'PASS',command:'certify',evidence:write('r4-certify',doc)};
}
async function status(){
 if(!fs.existsSync(runtime+'/run.json'))return {phase:'R4.1B',prepared:fs.existsSync(runtime+'/prepared.json'),gatewayStarted:false};
 const state=read(runtime+'/run.json');const rows=JSON.parse(d(['inspect',...state.containers]));return {run:state.run,containers:rows.map(c=>({name:c.Name,state:c.State.Status})),gatewayStarted:rows.some(c=>c.Name==='/'+state.gateway&&c.State.Running)};
}
async function cleanup(){
 // No global prune/down/reset. Only a specifically recorded future run may be removed.
 const p=runtime+'/run.json';if(!fs.existsSync(p))return {status:'PASS',command:'cleanup',removed:[]};
 const runState=read(p);assert(/^arma2-r42-[a-z0-9-]+$/.test(runState.run),'INVALID_RUN');
 const removed=[];
 for(const name of runState.containers){const lookup=spawnSync(docker,['inspect',name],{encoding:'utf8'});if(lookup.status!==0){assert(lookup.stderr.includes('No such object'),'INSPECT_FAILED');continue;}const c=JSON.parse(lookup.stdout)[0];assert(c.Config.Labels['arma2.r4.run']===runState.run,'OWNERSHIP_MISMATCH');d(['rm','-f',name]);removed.push(name);}
 for(const name of runState.networks){assert(name.startsWith(runState.run+'-'),'NETWORK_OWNERSHIP_MISMATCH');const lookup=spawnSync(docker,['network','inspect',name],{encoding:'utf8'});if(lookup.status!==0){assert(lookup.stderr.includes('not found'),'NETWORK_INSPECT_FAILED');continue;}assert(JSON.parse(lookup.stdout)[0].Labels['arma2.r4.run']===runState.run,'NETWORK_OWNERSHIP_MISMATCH');d(['network','rm',name]);removed.push(name);}
 fs.unlinkSync(p);return {status:'PASS',command:'cleanup',removed};
}
try{
 assert(commands.includes(command),'USAGE: '+commands.join('|'));
 // An explicit, unexpired operator authorization bound to the R4.1A seal is required.
 // This task never creates that document or invokes the R4.2 commands.
 if(['start-gateway','smoke','certify'].includes(command)){const certified=gate();requireAuthorization(root,command,certified.sealSHA256);}
 const result=await ({prepare,preflight,'start-gateway':startGateway,smoke,certify,status,cleanup}[command])();console.log(JSON.stringify(result));
}catch(e){console.log(JSON.stringify({status:'BLOCKED',command,reason:e.message,gatewayStarted:false}));process.exitCode=1;}
