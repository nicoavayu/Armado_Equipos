// Local-only replay. Never invokes Supabase remote commands or discovers credentials.
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';
import {root,evidence,sql,save,hash} from './production-upgrade-local.mjs';
import {statements,bare} from './production-specific-sql.mjs';
import {capture,diff} from './production-specific-catalog.mjs';
if(!['r3','r4','r5'].includes(process.env.PRODUCTION_REHEARSAL_RUN))throw Error('Explicit local run required');
const old='artifacts/production-upgrade-20260903';
const plan=JSON.parse(fs.readFileSync(old+'/migration-classification.json'));
const before=JSON.parse(fs.readFileSync(path.join(evidence,'before.json')));
if(before.ledger.length!==200)throw Error('Expected exactly 200 original ledger rows');
const audit=fs.readFileSync('scripts/db-integration/authenticated-rpc-grants.mjs','utf8');
const core=fs.readFileSync('supabase/migrations/20260727215106_canonical_core_rls_contracts.sql','utf8');
function array(name){return vm.runInNewContext(audit.match(new RegExp('const '+name+' = ([\\s\\S]*?);'))[1]);}
const baseAuth=[...core.match(/-- BEGIN AUTHENTICATED EXECUTE ALLOWLIST([\s\S]*?)-- END AUTHENTICATED EXECUTE ALLOWLIST/)[1].matchAll(/\('([^']+)', '(?:frontend_legitimate|rls_helper_required)'\)/g)].map(m=>m[1]);
const contract={authenticated:[...baseAuth,...array('POST_CANONICAL_AUTHENTICATED_ALLOWLIST').map(x=>x[0])],anon:array('ANON_ALLOWLIST'),sources:{audit:hash(audit),core:hash(core)}};
save('canonical-execute-contract.json',JSON.stringify(contract,null,2));
const q=s=>"'"+s.replaceAll("'","''")+"'";
const newFunctions=()=>JSON.parse(sql(`select coalesce(json_agg(t),'[]') from (select format('%I.%I(%s)',n.nspname,p.proname,oidvectortypes(p.proargtypes)) signature,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1) t;`)).filter(a=>!before.functions.some(b=>a.nspname===b.nspname&&a.proname===b.proname&&a.args===b.args));
const ran=fs.existsSync(path.join(evidence,'applied.json'))?JSON.parse(fs.readFileSync(path.join(evidence,'applied.json'))):[];
function apply(file,version,normalize=false){
 const source=fs.readFileSync(file,'utf8');
 const done=ran.find(x=>x.version===version);if(done){if(done.sourceSha256!==hash(source))throw Error('Applied source drift');return;}
 const chunks=statements(source).filter(s=>!(/^(begin|commit|start transaction)\s*;$/i.test(bare(s))));
 const closeDefaults=`DO $local_function_defaults$ DECLARE r record; BEGIN FOR r IN SELECT p.oid,p.oid::regprocedure AS identity FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_temp.local_existing_functions e WHERE e.oid=p.oid) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',r.identity); INSERT INTO pg_temp.local_existing_functions VALUES(r.oid); END LOOP; END $local_function_defaults$;`;
 const exec=normalize?'CREATE TEMP TABLE local_existing_functions ON COMMIT DROP AS SELECT oid FROM pg_proc;\n'+chunks.map(s=>s+(/^create(?:\s+or\s+replace)?\s+function\b/i.test(bare(s))?'\n'+closeDefaults:'')).join('\n'):chunks.join('\n');
 const wrapped=`BEGIN;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='60s';\n${exec}\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (${q(version)},${q(path.basename(file).slice(15,-4))},ARRAY[${q(exec)}]);COMMIT;`;
 save('executed-'+version+'.sql',wrapped);
 sql(wrapped,'postgres','apply-'+version+'.log');
 ran.push({file,version,sourceSha256:hash(source),executedSha256:hash(wrapped)});save('applied.json',JSON.stringify(ran,null,2));console.log('APPLIED',version);
 const state=capture('latest'); const d=diff(before,state);
 if(d.changed.length||d.removed.length){save('legacy-blocker.json',JSON.stringify(d,null,2));throw Error('STOP: legacy changed or removed');}
}
apply('docs/operations/production-upgrade-proposals/20260903205715_production_torneos_pgcrypto_compatibility.sql','20260903205715');
for(const p of plan.filter(p=>p.file.includes('migrations_history')&&p.decision==='rehearse')) apply(p.file,p.version);
// Expand the canonical baseline's relation and EXECUTE rules ONLY into exact
// identities that are absent in BEFORE. Frozen expansion is independently gated.
const bridgeAlreadyApplied=ran.some(x=>x.version==='20260903213456');
const funcs=newFunctions().filter(f=>!['public.digest(text, text)','public.gen_random_bytes(integer)'].includes(f.signature));
let bridge='-- LOCAL ONLY. Exact canonical baseline delta; no legacy/default ACL changes.\n';
for(const f of funcs){const key=f.signature.replaceAll(', ', ',');bridge+=`REVOKE EXECUTE ON FUNCTION ${f.signature} FROM PUBLIC,anon,authenticated;\n`;if(baseAuth.includes(key))bridge+=`GRANT EXECUTE ON FUNCTION ${f.signature} TO authenticated;\n`;if(contract.anon.includes(key))bridge+=`GRANT EXECUTE ON FUNCTION ${f.signature} TO anon,authenticated,service_role;\n`;}
const latest=JSON.parse(fs.readFileSync(path.join(evidence,'latest.json')));
for(const r of latest.relations.filter(r=>r.nspname==='public'&&['r','p','S'].includes(r.relkind)&&!before.relations.some(b=>b.nspname===r.nspname&&b.relname===r.relname))){const name='public."'+r.relname+'"';if(r.relkind==='S')bridge+=`GRANT USAGE,SELECT ON SEQUENCE ${name} TO authenticated,service_role;\nREVOKE USAGE,UPDATE ON SEQUENCE ${name} FROM anon;\n`;else bridge+=`GRANT SELECT ON TABLE ${name} TO anon,authenticated,service_role;\nGRANT INSERT,UPDATE,DELETE ON TABLE ${name} TO authenticated,service_role;\nREVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON TABLE ${name} FROM anon;\nALTER TABLE ${name} ENABLE ROW LEVEL SECURITY;\n`;}
const bridgeFile='docs/operations/production-upgrade-proposals/20260903213456_production_torneos_explicit_acl_contract.sql';
if(!bridgeAlreadyApplied){if(process.env.PRODUCTION_REHEARSAL_RUN==='r3')fs.writeFileSync(bridgeFile,bridge);else if(fs.readFileSync(bridgeFile,'utf8')!==bridge)throw Error('Frozen bridge changed');}
apply(bridgeFile,'20260903213456');
for(const p of plan.filter(p=>p.file.includes('/migrations/')&&p.decision==='rehearse')){
 let file=p.file,version=p.version;
 if(version==='20260828163326'){apply('docs/operations/production-upgrade-proposals/20260903214331_production_fake_purchase_preference_dependency.sql','20260903214331',true);file='docs/operations/production-upgrade-proposals/20260903213454_production_season_optional_legacy_purchase_revoke.sql';version='20260903213454';}
 apply(file,version,true);
}
apply('docs/operations/production-upgrade-proposals/20260903214514_production_fake_activation_season_dispatch.sql','20260903214514',true);
const after=capture('after');save('structural-diff.json',JSON.stringify(diff(before,after),null,2));
console.log('UPGRADE COMPLETED',ran.length);
