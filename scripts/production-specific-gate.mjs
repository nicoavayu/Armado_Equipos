import fs from 'node:fs';import path from 'node:path';import {isDeepStrictEqual} from 'node:util';
import {evidence,hash,save} from './production-upgrade-local.mjs';
import {diff,id} from './production-specific-catalog.mjs';
import {canonicalize,sourceContracts} from './production-specific-contracts.mjs';
export function evaluate(before,after,canonical,spec,frozen){
 const delta=diff(before,after),failures=[];let checks=0;
 const check=(v,label)=>{checks++;if(!v)failures.push(label);};
 for(const r of delta.changed)failures.push('Legacy changed: '+r.kind+' '+r.id);
 for(const r of delta.removed)failures.push('Legacy missing: '+r.kind+' '+r.id);
 const originals=new Set(before.functions.map(f=>id('functions',f)));
 const specs=new Map(spec.functions.map(f=>[f.signature,f]));
 const fresh=after.functions.filter(f=>!originals.has(id('functions',f)));
 const allExecute=new Map(after.function_execute.map(x=>[id('functions',x)+':'+x.rolname,x]));
 const existingSignatures=new Set(after.function_execute.map(x=>canonicalize(x.signature)));
 const execute=new Map(after.function_execute.filter(x=>x.rolname==='authenticated').map(x=>[id('functions',x),x]));
 for(const f of fresh){const key=canonicalize(execute.get(id('functions',f)).signature),s=specs.get(key);
  check(Boolean(s),'Source declaration: '+key);if(!s)continue;
  check(f.owner==='postgres','Owner postgres: '+key);
  check(f.prosecdef===s.securityDefiner,'SECURITY mode from source: '+key);
  check(f.proacl!==null&&!f.proacl.some(a=>a.startsWith('=')),'PUBLIC denied: '+key);
  for(const role of ['authenticated','anon','service_role']){
   const row=allExecute.get(id('functions',f)+':'+role);
   const wanted=role==='service_role'?s.service:canonical[role].includes(key);
   check(row?.execute===wanted,`${role} execute expected ${wanted}: ${key}`);
   check(row?.grant_option===false,`${role} has no grant option: ${key}`);
  }
 }
 const oldRelations=new Set(before.relations.map(r=>id('relations',r)));
 for(const r of after.relations.filter(r=>r.nspname==='public'&&!oldRelations.has(id('relations',r))&&['r','p'].includes(r.relkind))){
  check(r.owner==='postgres','Table owner: '+r.relname);check(r.relrowsecurity,'Table RLS: '+r.relname);
  check(!r.relacl?.some(a=>a.startsWith('=')),'No PUBLIC table ACL: '+r.relname);
  const anon=r.relacl?.find(a=>a.startsWith('anon='))?.split('=')[1].split('/')[0]||'';
  check(!/[awdDxt]/.test(anon),'No anon writes: '+r.relname);
 }
 for(const s of spec.functions){check(existingSignatures.has(s.signature),'Declared target exists: '+s.signature);}
 if(frozen){const expected=new Map(frozen.map(r=>[r.kind+':'+r.id,r.after]));const actualAdded=new Set(delta.added.map(r=>r.kind+':'+r.id));for(const r of delta.added){if(r.kind==='ledger')continue;check(isDeepStrictEqual(expected.get(r.kind+':'+r.id),r.after),'Exact authorized addition: '+r.kind+' '+r.id);}for(const r of frozen){if(r.kind==='ledger')continue;check(actualAdded.has(r.kind+':'+r.id),'Authorized addition exists: '+r.kind+' '+r.id);}}
 check(before.ledger.length===200,'200 original ledger rows');
 return {legacyPreservationChecks:delta.preserved+delta.changed.length+delta.removed.length,torneosContractChecks:checks,unexpectedFailures:failures.length,failures,delta};
}
if(process.argv[2]==='run'){
 const before=JSON.parse(fs.readFileSync(path.join(evidence,'before.json'))),after=JSON.parse(fs.readFileSync(path.join(evidence,'after.json')));
 const canonical=JSON.parse(fs.readFileSync(path.join(evidence,'canonical-execute-contract.json')));
 const spec=await sourceContracts(JSON.parse(fs.readFileSync(path.join(evidence,'applied.json'))));save('source-contracts.json',JSON.stringify(spec,null,2));
 const frozenPath='docs/operations/production-upgrade-proposals/expected-torneos-delta.json';
 const frozen=fs.existsSync(frozenPath)?JSON.parse(fs.readFileSync(frozenPath)):null;
 const result=evaluate(before,after,canonical,spec,frozen);
 const applied=JSON.parse(fs.readFileSync(path.join(evidence,'applied.json')));
 const originalVersions=new Set(before.ledger.map(r=>r.version));
 const newLedger=after.ledger.filter(r=>!originalVersions.has(r.version));
 const ledgerFailures=[];
 const anchor=JSON.parse(fs.readFileSync('docs/operations/production-upgrade-proposals/production-specific-baseline.json'));
 if(hash(JSON.stringify(before))!==anchor.beforeLogicalSha256)ledgerFailures.push('BEFORE differs from pinned Production restore');
 if(hash(fs.readFileSync(frozenPath))!==anchor.expectedDeltaSha256)ledgerFailures.push('Explicit expected delta changed');
 if(hash(fs.readFileSync('scripts/db-integration/authenticated-rpc-grants.mjs'))!==anchor.canonicalAuditSha256||hash(fs.readFileSync('supabase/migrations/20260727215106_canonical_core_rls_contracts.sql'))!==anchor.canonicalCoreSha256)ledgerFailures.push('Canonical contract edited');

 for(const item of applied){
  const row=newLedger.find(r=>r.version===item.version);
  const executed=fs.readFileSync(path.join(evidence,'executed-'+item.version+'.sql'),'utf8');
  const payload=executed.match(/,ARRAY\['((?:[^']|'')*)'\]\);COMMIT;/s)?.[1]?.replaceAll("''","'");
  if(!row||row.statements?.length!==1||row.statements[0]!==payload)ledgerFailures.push('New ledger payload: '+item.version);
  if(hash(fs.readFileSync(item.file,'utf8'))!==item.sourceSha256||hash(executed)!==item.executedSha256)ledgerFailures.push('Source/execution hash: '+item.version);
 }
 if(newLedger.length!==applied.length||new Set(newLedger.map(r=>r.version)).size!==applied.length)ledgerFailures.push('Unexpected new ledger entries');
 const inventory=JSON.parse(fs.readFileSync('artifacts/production-upgrade-20260903/migration-classification.json'));
 for(const item of inventory)if(hash(fs.readFileSync(item.file,'utf8'))!==item.sha256)ledgerFailures.push('Historical migration edited: '+item.file);
 const protectedHash=hash(fs.readFileSync('supabase/migrations/20260806120000_auto_match_stop_search_atomic_exit.sql'));
 if(protectedHash!=='88069592f5f10cad8b7f4c078b6697bff2c2f6fec428c91e35dc8954a31abcd4')ledgerFailures.push('Auto-Match file hash');
 result.ledgerValidation={originalRows:before.ledger.length,newRows:newLedger.length,totalRows:after.ledger.length,failures:ledgerFailures};
 result.failures.push(...ledgerFailures);result.unexpectedFailures=result.failures.length;
 save('gate.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({...result,delta:{changed:result.delta.changed.length,removed:result.delta.removed.length,added:result.delta.added.length}},null,2));
 if(result.unexpectedFailures)process.exitCode=1;
}
