import fs from 'node:fs';import path from 'node:path';import {evidence,save,hash} from './production-upgrade-local.mjs';
import {canonicalize} from './production-specific-contracts.mjs';
const before=JSON.parse(fs.readFileSync(path.join(evidence,'before.json'))),after=JSON.parse(fs.readFileSync(path.join(evidence,'after.json')));
const b=new Map(before.function_execute.filter(x=>x.rolname==='authenticated').map(x=>[canonicalize(x.signature),x]));
const a=new Map(after.function_execute.filter(x=>x.rolname==='authenticated').map(x=>[canonicalize(x.signature),x]));
const personalAbsent=[
'public.cancel_partido_as_admin(bigint,text)','public.cleanup_voting_access_state_as_admin(bigint)',
'public.enqueue_match_participant_notification_as_actor(bigint,text,text,text,jsonb,uuid,boolean)',
'public.enqueue_partido_notification_as_actor(bigint,text,text,text,jsonb)',
'public.inc_numeric(text,text,uuid,numeric)','public.increment_matches_abandoned(uuid)','public.increment_matches_played(uuid)',
'public.prepare_challenge_team_squad_as_actor(uuid,boolean)','public.send_match_kicked_notification_as_admin(uuid,bigint)',
'public.sync_team_match_to_partido_as_actor(uuid)','public.set_my_global_availability(boolean)'];
const behavior={
'authenticated cannot cancel through internal RPC':'public.cancel_partido_with_notification(bigint,text)',
'authenticated cannot cleanup voting through internal RPC':'public.cleanup_voting_access_state(bigint)',
'authenticated cannot enqueue arbitrary partido notifications':'public.enqueue_partido_notification(bigint,text,text,text,jsonb)',
'authenticated cannot prepare an arbitrary challenge squad':'public.prepare_challenge_team_squad(uuid,boolean)',
'service_role executes required backend helpers inside rollback':'public.auto_match_duration(text)',
'legitimate match admin can use the actor-derived wrapper':'public.cleanup_voting_access_state_as_admin(bigint)'};
const aggregates=new Set(['authenticated has no signatures outside the exact allowlist','anon has exactly the 21 approved signatures','PUBLIC EXECUTE unexpected: 0','future public functions require an explicit EXECUTE allowlist','PUBLIC EXECUTE count remains 0','anon EXECUTE count remains 21','authenticated EXECUTE count remains 278']);
const finalLabels=new Set(fs.readFileSync(path.join(evidence,'canonical-grants.log'),'utf8').split('\n').filter(x=>x.includes('✘')).map(x=>x.split('✘ ')[1].split(' — ')[0]));
function classify(file){return fs.readFileSync(file,'utf8').split('\n').flatMap((line,i)=>{
 if(!line.includes('✘'))return [];const text=line.split('✘ ')[1],label=text.split(' — ')[0];
 const signatures=[...new Set([...text.matchAll(/public\.[a-z_0-9]+\([^)]*\)/g)].map(m=>canonicalize(m[0])))];
 if(behavior[label]&&!signatures.length)signatures.push(behavior[label]);
 const objects=signatures.map(sig=>({signature:sig,beforeExists:b.has(sig),afterExists:a.has(sig),classification:b.has(sig)?'legacy_baseline':personalAbsent.includes(sig)?'personal_canonical_contract_absent_in_BEFORE':'torneos_delta'}));
 let classification;
 if(objects.some(o=>o.classification==='torneos_delta'))classification=aggregates.has(label)?'mixed_legacy_and_real_new_acl_regressions_repaired':'torneos_contract_not_yet_installed_then_installed';
 else if(objects.length||aggregates.has(label))classification='canonical_incompatible_with_exact_legacy_baseline';
 else classification='UNEXPLAINED';
 return [{number:i+1,label,classification,stillFailsCanonicalAfter:finalLabels.has(label),objects,evidence:classification==='canonical_incompatible_with_exact_legacy_baseline'?'Exact BEFORE/AFTER structural and effective-privilege preservation; personalAbsent and default ACL are explicit inventories.':'Exact Torneos migrations and scoped ACL bridge; final canonical per-object assertions must pass.'}];
});}
const original=classify('artifacts/production-upgrade-20260903/authenticated-grants-partial.log');
const final=classify(path.join(evidence,'canonical-grants.log'));
if(original.length!==126)throw Error('Original failure count changed');
const counts=list=>Object.fromEntries([...new Set(list.map(x=>x.classification))].map(k=>[k,list.filter(x=>x.classification===k).length]));
const unexpected=final.filter(x=>x.classification!=='canonical_incompatible_with_exact_legacy_baseline');
const result={baselineSha256:hash(JSON.stringify(before)),personalAbsent:personalAbsent.map(signature=>({signature,beforeExists:b.has(signature),afterExists:a.has(signature)})),originalCount:original.length,originalCounts:counts(original),finalCount:final.length,finalCounts:counts(final),unexpectedFinal:unexpected.length,original,final};
save('canonical-failure-classification.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({originalCount:result.originalCount,originalCounts:result.originalCounts,finalCount:result.finalCount,finalCounts:result.finalCounts,unexpectedFinal:unexpected.length},null,2));
if(unexpected.length||result.personalAbsent.some(x=>x.beforeExists||x.afterExists))process.exitCode=1;
