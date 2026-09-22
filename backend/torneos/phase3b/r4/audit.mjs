import {requireAuthorization,validatePublicCoreKey} from './authorization.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(root,'../../../..');
const docker='/Applications/Docker.app/Contents/Resources/bin/docker';
const EDGE='sha256:a82676277615aee03c4f288cbbbf68dedb5ba8693073e567ab8dbfdd11ba5d45';
const NODE=JSON.parse(spawnSync('/Applications/Docker.app/Contents/Resources/bin/docker',['image','inspect','node:22.22.0-bookworm-slim'],{encoding:'utf8'}).stdout)[0].Id;
const db='arma2-torneos-isolated-local-torneos-db-1', rest='arma2-torneos-isolated-local-torneos-rest-1';
const isolated='arma2-torneos-isolated-local_isolated';
const CORE='hhyvmhgpapyuzjgxfnqv.supabase.co';
const utc=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z/,'Z');
const operation=process.argv[2]||'isolation';
if(!['isolation','start-gateway'].includes(operation))throw new Error('UNKNOWN_OPERATION');
const realGateway=operation==='start-gateway';
const prefix=`arma2-${realGateway?'r42':'r41a'}-${utc.toLowerCase()}`;
const ev=path.resolve(root,'../evidence');fs.mkdirSync(root+'/.runtime',{recursive:true,mode:0o700});
const known=[];const outputs=[];const containers=[];const networks=[];
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function call(bin,args,input,ok=false,timeout=45000){const r=spawnSync(bin,args,{input,encoding:'utf8',timeout,killSignal:'SIGKILL',maxBuffer:32*1024*1024});if(!ok&&(r.status!==0||r.error))throw new Error('COMMAND_FAILED:'+path.basename(bin)+':'+args[0]+':'+(r.status??'timeout')+':'+known.reduce((t,v)=>v?t.split(v).join('[REDACTED]'):t,r.stderr||'').slice(-1500));return r;}
function d(args,input,ok=false,timeout){return call(docker,args,input,ok,timeout);}
function inspect(name){return JSON.parse(d(['inspect',name]).stdout)[0];}
function safe(s){for(const secret of known)if(secret&&s.includes(secret))throw new Error('SECRET_IN_EVIDENCE');return s;}
function write(kind,doc){const f=path.join(ev,`${kind}-${utc}.json`);fs.writeFileSync(f,safe(JSON.stringify({utc,...doc},null,2)+'\n'),{mode:0o600});outputs.push(f);return f;}
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
function manifest(dir){return files(dir).map(f=>({path:path.relative(dir,f),sha256:sha(fs.readFileSync(f)),bytes:fs.statSync(f).size}));}
function snapshot(){
 const a=inspect(db),b=inspect(rest);
 const catalog=d(['exec',db,'psql','-U','supabase_admin','-d','postgres','-At','-c',`BEGIN READ ONLY; SELECT json_build_object('roles',(SELECT json_agg(r ORDER BY rolname) FROM (SELECT rolname,rolsuper,rolinherit,rolcanlogin,rolbypassrls FROM pg_roles)r),'functions',(SELECT json_agg(r ORDER BY oid) FROM (SELECT oid,proname,proacl,prosrc FROM pg_proc WHERE pronamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN ('public','private')))r),'tables',(SELECT json_agg(r ORDER BY oid) FROM (SELECT oid,relname,relacl,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN ('public','private')))r),'policies',(SELECT json_agg(p ORDER BY schemaname,tablename,policyname) FROM pg_policies p),'foreign_servers',(SELECT count(*) FROM pg_foreign_server)); COMMIT;`]).stdout;
 return {db:{id:a.Id,image:a.Image,started:a.State.StartedAt,mounts:a.Mounts,networks:a.NetworkSettings.Networks,health:a.State.Health?.Status},rest:{id:b.Id,image:b.Image,started:b.State.StartedAt,networks:b.NetworkSettings.Networks},catalogSHA256:sha(catalog),ringSHA256:sha(fs.readFileSync(repo+'/integration/torneos-isolated-local/.runtime/config.json')),jwksSHA256:sha(fs.readFileSync(repo+'/integration/torneos-isolated-local/.runtime/public/jwks.json'))};
}
const initialSources=manifest(root).filter(f=>!f.path.startsWith('offline-cache/')&&!f.path.startsWith('.runtime/'));
let before,after,result,secretScan,cleanup,blocker,offline,keepResources=false,authorization,prepared;
try{
 if(realGateway){
   prepared=JSON.parse(fs.readFileSync(root+'/.runtime/prepared.json'));
   authorization=requireAuthorization(root,'start-gateway',prepared.r41aSealSHA256);
   if(fs.existsSync(root+'/.runtime/run.json'))throw new Error('EXISTING_RUNTIME');
   for(const item of prepared.sourceManifest)if(sha(fs.readFileSync(root+'/'+item.path))!==item.sha256)throw new Error('PREPARED_SOURCE_DRIFT');
   if(sha(fs.readFileSync(root+'/.runtime/gateway.eszip'))!==prepared.gatewayBundleSHA256)throw new Error('PREPARED_BUNDLE_DRIFT');
   validatePublicCoreKey(authorization.coreAnonKey);
 }
 before=snapshot();if(before.db.health!=='healthy')throw new Error('R2_UNHEALTHY');
 const net=JSON.parse(d(['network','inspect',isolated]).stdout)[0];if(!net.Internal)throw new Error('R2_NOT_INTERNAL');
 const cache=root+'/offline-cache';
 const specs=['jose@6.2.12','postgres@3.4.7'];
 const packages=specs.map(s=>{const [name,version]=s.split('@');const dir=`${cache}/npm/registry.npmjs.org/${name}/${version}`;const doc=JSON.parse(fs.readFileSync(dir+'/package.json'));if(doc.version!==version||Object.keys(doc.dependencies||{}).length)throw new Error('UNEXPECTED_DEPENDENCIES');return {specifier:'npm:'+s,version,origin:'https://registry.npmjs.org/'+name,localSource:'read-only copy of arma2-core-contracts-phase3a_torneos-deno-cache',dependencies:doc.dependencies||{},files:manifest(dir)};});
 const sourceFiles=manifest(repo+'/backend/torneos/supabase/functions/torneos-gateway');
 const imports=files(repo+'/backend/torneos/supabase/functions/torneos-gateway').filter(f=>f.endsWith('.ts')).flatMap(f=>[...fs.readFileSync(f,'utf8').matchAll(/(?:from\s*|import\s*\()?['"]((?:npm:|jsr:|https?:|node:|\.\/)[^'"]+)['"]/g)].map(m=>({file:path.basename(f),specifier:m[1]})));
 const bundle=d(['run','--rm','--pull','never','--network','none','-e','DENO_DIR=/cache','-v',cache+':/cache','-v',root+':/r4','-v',repo+'/backend/torneos/supabase/functions/torneos-gateway:/gateway:ro',EDGE,'bundle','--entrypoint','/r4/harness/index.ts','--output','/r4/.runtime/harness.eszip','--checksum','sha256','--timeout','30'],undefined,true);
 offline={status:bundle.status===0?'BUNDLED_OFFLINE':'BLOCKED',packages,imports,jsr:[],httpsImports:[],sourceFiles,transitives:{'npm:jose@6.2.12':{entrypoint:'dist/webapi/index.js',external:[]},'npm:postgres@3.4.7':{entrypoint:'src/index.js',runtimeBuiltins:['node:crypto','node:fs','node:net','node:os','node:perf_hooks','node:stream','node:tls'],external:[],excludedExportConditions:['workerd','bun','require']}},cacheManifest:manifest(cache).filter(f=>!/^dep_analysis_cache_v2(?:-(?:wal|shm))?$/.test(f.path)),bundleExit:bundle.status,networkDuringBundle:'none',certifiedEdgeImage:EDGE,proxyImage:NODE};
 if(bundle.status!==0){offline.diagnostic=bundle.stderr.slice(-4000);throw new Error('OFFLINE_BUNDLE_FAILED');}
 offline.bundleSHA256=sha(fs.readFileSync(root+'/.runtime/harness.eszip'));
 const key=crypto.generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
 known.push(key);
 const conf=root+'/.runtime/cert.conf';fs.writeFileSync(conf,`[req]\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\n[ext]\nsubjectAltName=DNS:${CORE}\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n`);
 const caKey=crypto.generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;known.push(caKey);
 const cert=call('/usr/bin/openssl',['req','-new','-x509','-key','/dev/stdin','-subj','/CN=R4 ephemeral transport CA','-days','1','-config',conf],caKey).stdout;
 fs.writeFileSync(root+'/.runtime/ca.pem',cert);
 const csr=call('/usr/bin/openssl',['req','-new','-key','/dev/stdin','-subj','/CN='+CORE],key).stdout;
 fs.writeFileSync(root+'/.runtime/leaf.csr',csr);
 fs.writeFileSync(root+'/.runtime/leaf.ext',`subjectAltName=DNS:${CORE}\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`);
 const leaf=call('/usr/bin/openssl',['x509','-req','-in',root+'/.runtime/leaf.csr','-CA',root+'/.runtime/ca.pem','-CAkey','/dev/stdin','-set_serial','1','-days','1','-extfile',root+'/.runtime/leaf.ext'],caKey).stdout;
 // The HMAC is never requested until offline resolution and R2 baseline checks pass.
 const secret=call('/usr/bin/security',['find-generic-password','-s','arma2-torneos-nonprod-core','-a','contract-secret','-w']).stdout.trim();known.push(secret);
 if(!/^[0-9a-f]{64,}$/.test(secret))throw new Error('KEYCHAIN_SECRET_INVALID');
 const cfg=JSON.parse(fs.readFileSync(repo+'/integration/torneos-isolated-local/.runtime/config.json'));
 known.push(cfg.writerPassword,cfg.adapterPassword,cfg.dbPassword,...cfg.keys.map(k=>k.privateKey).filter(Boolean));
 const internal=prefix+'-internal',external=prefix+'-egress';
 d(['network','create','--label','arma2.r4.run='+prefix,'--internal',internal]);networks.push(internal);
 d(['network','create','--label','arma2.r4.run='+prefix,external]);networks.push(external);
 const proxy=prefix+'-proxy';containers.push(proxy);
 d(['create','--pull','never','--name',proxy,'--label','arma2.r4.run='+prefix,'--network',internal,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--sysctl','net.ipv4.ip_forward=0',...(realGateway?['--tmpfs','/fault:rw,noexec,nosuid,nodev,mode=0700,size=64k','-p','127.0.0.1:58431:9000']:[]),'--log-driver','local','-i','-v',root+'/proxy.mjs:/proxy.mjs:ro',NODE,'node','/proxy.mjs']);
 d(['network','connect',external,proxy]);
 
 d(['start',proxy]);d(['attach','--sig-proxy=false',proxy],JSON.stringify({key,cert:leaf,...(realGateway?{gatewayHost:prefix+'-gateway'}:{})}),true,1500);
 if(!d(['logs',proxy]).stdout.includes('PROXY_READY'))throw new Error('PROXY_NOT_READY');
 const proxyIP=inspect(proxy).NetworkSettings.Networks[internal].IPAddress;
 const harness=prefix+(realGateway?'-gateway':'-harness');containers.push(harness);
 const hostArgs=['--add-host',CORE+':'+proxyIP,'--add-host','torneos-db:'+before.db.networks[isolated].IPAddress,'--add-host','torneos-rest:'+before.rest.networks[isolated].IPAddress];
 // Denied names map to TEST-NET-1: deny probes cannot send traffic to Production, even on a broken firewall.
 for(const name of ['rcyuuoaqfwcembdajcss.supabase.co','abcdefghijklmnopqrst.supabase.co','google.com','github.com','registry.npmjs.org','esm.sh','deno.land'])hostArgs.push('--add-host',name+':192.0.2.1');
 const command='i=0; while [ ! -f /custody/input ]; do i=$((i+1)); if [ "$i" -ge 150 ]; then echo R4_FAIL_CLOSED_MISSING_SECRET; exit 78; fi; sleep 0.1; done; exec edge-runtime start --main-service /r4/.runtime/'+(realGateway?'gateway':'harness')+'.eszip --ip '+(realGateway?'0.0.0.0':'127.0.0.1')+' --port 9000';
 d(['create','--pull','never','--name',harness,'--label','arma2.r4.run='+prefix,'--network',internal,'--dns','127.0.0.1',...hostArgs,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/custody:rw,noexec,nosuid,nodev,mode=0700,size=1m','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=32m','-e','DENO_DIR=/cache','-v',root+':/r4:ro','-v',cache+':/cache:ro','--entrypoint','sh',EDGE,'-c',command]);
 d(['network','connect',isolated,harness]);d(['start',harness]);
 // Remove connected subnet routes only inside this new namespace; keep exact peers only.
 // The application has no NET_ADMIN. R2 namespaces/networks remain unchanged.
 const routeImage='sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453';
 const routeArgs=['run','--rm','--pull','never','--network','container:'+harness,'--cap-drop','ALL','--cap-add','NET_ADMIN','--security-opt','no-new-privileges','--entrypoint','sh',routeImage];
 const parseRoutes=text=>text.trim().split('\n').filter(Boolean).map(line=>({dst:line.split(' ')[line.startsWith('unreachable ')?1:0],type:line.startsWith('unreachable ')?'unreachable':'unicast',dev:line.match(/dev (\S+)/)?.[1],scope:line.includes('scope link')?'link':undefined}));
 const routes=parseRoutes(d([...routeArgs,'-c','ip -f inet route']).stdout);
 const peers=[proxyIP,before.db.networks[isolated].IPAddress,before.rest.networks[isolated].IPAddress];
 const commands=[];
 for(const route of routes){
   if(route.scope!=='link'||!route.dst.includes('/'))continue;
   const [addr,bits]=route.dst.split('/');const toInt=ip=>ip.split('.').reduce((a,b)=>(a*256+Number(b))>>>0,0);
   const mask=(0xffffffff << (32-Number(bits)))>>>0;
   for(const ip of peers)if((toInt(ip)&mask)===(toInt(addr)&mask))commands.push(`ip route replace ${ip}/32 dev ${route.dev}`);
   commands.push(`ip route del ${route.dst} dev ${route.dev}`);
 }
 commands.push('ip route replace unreachable default','ip -f inet6 route replace unreachable default');
 d([...routeArgs,'-c',commands.join(' && ')]);
 const finalRoutes=parseRoutes(d([...routeArgs,'-c','ip -f inet route']).stdout);
 if(finalRoutes.some(r=>r.dst!=='default'&&!peers.includes(r.dst.replace('/32','')))||!finalRoutes.some(r=>r.dst==='default'&&r.type==='unreachable'))throw new Error('ROUTE_POLICY_INVALID');

 const dnsProbe=JSON.parse(d(['run','--rm','--pull','never','--network','container:'+harness,'--cap-drop','ALL','--read-only',NODE,'node','-e',`const dns=require('dns');dns.setServers(['127.0.0.11']);dns.resolve4('example.org',(e,a)=>{console.log(JSON.stringify({code:e?.code,records:a?.length||0}));process.exit(e&&['ESERVFAIL','ECONNREFUSED','ETIMEOUT'].includes(e.code)?0:1)});setTimeout(()=>{console.log(JSON.stringify({code:'TIMEOUT',records:0}));process.exit(0)},3000)`]).stdout);
 const coreIP=call('/opt/homebrew/bin/node',['-e',`require('dns').lookup('${CORE}',{family:4},(e,a)=>{if(e)process.exit(1);console.log(a)})`]).stdout.trim();
 d(['exec','-i',harness,'sh','-c','umask 077; cat > /custody/input.tmp && chmod 600 /custody/input.tmp && mv /custody/input.tmp /custody/input'],JSON.stringify({secret,cert,...(realGateway?{coreAnonKey:authorization.coreAnonKey}:{}),bridge:{keys:cfg.keys,activeKid:cfg.activeKid,trustedKids:cfg.trustedKids},writerPassword:cfg.writerPassword,adapterPassword:cfg.adapterPassword,coreIP,proxyIP,localGateway:before.db.networks[isolated].Gateway||net.IPAM.Config[0].Gateway,proxyGateway:JSON.parse(d(['network','inspect',internal]).stdout)[0].IPAM.Config[0].Gateway}));
 const rawInspect=d(['inspect',harness,proxy]).stdout;
 const initialScan=!known.some(v=>v&&rawInspect.includes(v));
 const processArgs=d(['top',harness,'-eo','pid,args']).stdout;safe(processArgs);
 for(const file of [...files(root),...files(ev).filter(f=>path.basename(f).startsWith('r4-'))]){const content=fs.readFileSync(file);if(content.includes(Buffer.from(secret)))throw new Error('SECRET_PERSISTED');}
 if(realGateway){
   await new Promise(resolve=>setTimeout(resolve,500));
   if(!initialScan||!inspect(harness).State.Running)throw new Error('GATEWAY_START_FAILED');
   const inputAbsent=d(['exec',harness,'sh','-c','test ! -e /custody/input'],undefined,true).status===0;
   if(!inputAbsent)throw new Error('CUSTODY_NOT_CONSUMED');
   safe(d(['logs',harness],undefined,true).stdout);
   const runState={run:prefix,utc,containers:[...containers],networks:[...networks],gateway:harness,proxy,routes:finalRoutes,gatewayBundleSHA256:prepared.gatewayBundleSHA256,r41aSealSHA256:prepared.r41aSealSHA256,r2Baseline:before,secretMetadataScanPassed:initialScan,custodyRemoved:inputAbsent};
   fs.writeFileSync(root+'/.runtime/run.json',JSON.stringify(runState,null,2)+'\n',{mode:0o600,flag:'wx'});
   keepResources=true;
 }else{
 d(['wait',harness],undefined,false,45000);
 const logs=d(['logs',harness],undefined,true);safe(logs.stdout+logs.stderr);
 const line=logs.stdout.split('\n').find(s=>s.startsWith('R4_RESULT '));
 if(!line){offline.runtimeDiagnostic=(logs.stdout+logs.stderr).slice(-3500);throw new Error('HARNESS_NO_RESULT');}
 result=JSON.parse(line.slice(10));
 result.tests.push({name:'raw_dns_same_namespace',pass:dnsProbe.records===0,detail:dnsProbe});result.pass=result.tests.every(t=>t.pass);
 const hs=inspect(harness);
 secretScan={dockerInspectContainsSecret:!initialScan,logsContainSecret:false,processArgvContainsSecret:false,persistentArtifactsContainSecret:false,imageLayers:'unchanged pinned images; no image build/commit',configEnvNames:hs.Config.Env.map(s=>s.split('=')[0]),stdinInjection:true,tmpfs:hs.HostConfig.Tmpfs,readOnce:result.custody.readOnce,artifactRemoved:result.custody.artifactRemoved,mode:result.custody.mode};
 d(['start',harness]);d(['wait',harness],undefined,false,20000);
 secretScan.restartExitCode=inspect(harness).State.ExitCode;secretScan.restartFailsClosed=secretScan.restartExitCode===78;
 safe(d(['logs',harness],undefined,true).stdout);
 secretScan.pass=initialScan&&result.custody.artifactRemoved&&secretScan.restartFailsClosed;
 result.routes=finalRoutes;
 offline.runtimeLoad=result.tests.find(t=>t.name==='load_all_gateway_modules_offline');
 offline.status=offline.runtimeLoad.pass?'PASS':'BLOCKED';
 if(!result.pass||!secretScan.pass)throw new Error('REQUIRED_RUNTIME_TEST_FAILED');
 }
}catch(e){blocker=e.message;}
finally{
 if(!keepResources)for(const name of containers.reverse())d(['rm','-f',name],undefined,true);
 if(!keepResources)for(const name of networks.reverse())d(['network','rm',name],undefined,true);
 for(const name of ['cert.conf','ca.pem','leaf.csr','leaf.ext'])fs.rmSync(root+'/.runtime/'+name,{force:true});
 cleanup={ephemeralCertificateFilesRemoved:['cert.conf','ca.pem','leaf.csr','leaf.ext'].every(n=>!fs.existsSync(root+'/.runtime/'+n)),containersRemoved:containers.every(n=>d(['inspect',n],undefined,true).status!==0),networksRemoved:networks.every(n=>d(['network','inspect',n],undefined,true).status!==0)};
 try{after=snapshot();}catch{blocker=blocker||'R2_POST_SNAPSHOT_FAILED';}
}
const unchanged=JSON.stringify(before)===JSON.stringify(after);
const sourceUnchanged=JSON.stringify(initialSources)===JSON.stringify(manifest(root).filter(f=>!f.path.startsWith('offline-cache/')&&!f.path.startsWith('.runtime/')));
if(!sourceUnchanged)blocker='SOURCE_CHANGED_DURING_AUDIT';
if(realGateway){
 if(!unchanged||!sourceUnchanged){blocker=blocker||'POST_START_DRIFT';for(const name of containers)d(['rm','-f',name],undefined,true);for(const name of networks)d(['network','rm',name],undefined,true);fs.rmSync(root+'/.runtime/run.json',{force:true});keepResources=false;}
 const status=keepResources&&!blocker?'STARTED_PENDING_SMOKE':'BLOCKED';
 const file=write('r4-gateway-start',{status,utc,run:prefix,gatewayStarted:keepResources,blocker,baselinePreserved:unchanged});
 console.log(JSON.stringify({status,evidence:file,gatewayStarted:keepResources}));process.exit(keepResources&&!blocker?0:1);
}
const pass=!blocker&&unchanged&&cleanup.containersRemoved&&cleanup.networksRemoved;
write('r4-isolation-design',{status:pass?'PASS':'BLOCKED',architecture:{gatewayNetworks:[isolated,'temporary internal bridge'],proxyNetworks:['temporary internal bridge','temporary egress bridge'],gatewayDNS:'loopback only; local names pinned',proxy:'TLS-terminating reverse proxy; exact SNI + HTTP Host; fixed upstream hostname; verified upstream TLS; dynamic public IPv4 DNS fail-closed',redirects:'all upstream 3xx/Location refused; fetch redirect:error; raw follow cannot leave internal networks',gatewayRealStarted:false,capabilities:'ALL dropped; no-new-privileges; read-only filesystem',proxyIPForwarding:false,routing:'gateway namespace: only DB /32, REST /32, proxy /32; unreachable IPv4/IPv6 default; temporary NET_ADMIN helper removed before injection'},baselineBefore:before,baselineAfter:after,r2Unchanged:unchanged,cleanup,blocker});
write('r4-offline-deps',offline||{status:'BLOCKED',blocker});
write('r4-secret-custody',{status:secretScan?.pass?'PASS':'BLOCKED',source:'Keychain arma2-torneos-nonprod-core / contract-secret',mechanism:'one stdin write via docker exec into 0600 tmpfs; atomic rename; one read; immediate unlink; isolate memory only; no secret in Docker launch env or argv',...secretScan,cleanup,blocker});
write('r4-egress-test',{status:result?.pass?'PASS':'BLOCKED',...result,productionRequests:0,deniedDNSNames:'Pinned to TEST-NET-1; no Production lookup or request',cleanup,blocker});
write('r4-preflight',{status:pass?'R4_1A_PASS':'BLOCKED',r41bExecuted:false,reason:pass?'R4.1B may now be implemented':'R4.1B gated on R4.1A PASS',r2Unchanged:unchanged,gatewayStarted:false,matrixExecuted:false,blocker,cleanup});
const hashFile=path.join(ev,`r4-hashes-${utc}.json`);fs.writeFileSync(hashFile,JSON.stringify({utc,files:outputs.map(f=>({file:path.basename(f),sha256:sha(fs.readFileSync(f))})),sources:initialSources},null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({pass,blocker,r2Unchanged:unchanged,cleanup,evidence:outputs,hashFile}));process.exitCode=pass?0:1;
