// Read-only final state after STOP. Does not execute any targeted case.
import fs from 'node:fs';
import {d,r2Snapshot,writeEvidence,fileSHA,evidence,r4} from './lib.mjs';
const before=JSON.parse(fs.readFileSync(evidence+'/r42-worker-fix-source-before.json'));
const changed=Object.keys(before).filter(p=>fileSHA(p)!==before[p]);
const now=r2Snapshot();
const baseline=JSON.parse(fs.readFileSync(evidence+'/r4-isolation-design-20260920T170508Z.json')).baselineAfter;
const doc={status:'STOP_AFTER_TARGETED_FAILURE',productionRequests:0,fullR42Executed:false,
 changedSources:changed,
 cleanup:{containers:d(['ps','-a','--filter','label=arma2.r4.run','--format','{{.Names}}']).stdout.trim(),networks:d(['network','ls','--filter','label=arma2.r4.run','--format','{{.Name}}']).stdout.trim(),authorizationAbsent:!fs.existsSync(r4+'/.runtime/authorization.json'),runJsonAbsent:!fs.existsSync(r4+'/.runtime/run.json'),qaCreated:false},
 r2:{dbHealthy:now.db.health==='healthy',dbRunning:now.db.running,restRunning:now.rest.running,dbId:now.db.id===baseline.db.id,dbStarted:now.db.started===baseline.db.started,restId:now.rest.id===baseline.rest.id,restStarted:now.rest.started===baseline.rest.started,catalog:now.catalogSHA256===baseline.catalogSHA256,ring:now.ringSHA256===baseline.ringSHA256,jwks:now.jwksSHA256===baseline.jwksSHA256}};
doc.cleanup.pass=!doc.cleanup.containers&&!doc.cleanup.networks&&doc.cleanup.authorizationAbsent&&doc.cleanup.runJsonAbsent;
console.log(JSON.stringify({doc,path:writeEvidence('r42-worker-fix-final-state',doc)},null,2));
