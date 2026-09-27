// Isolated PostgreSQL container, --network none, cached image only, no host ports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const docker=process.platform==='darwin'?'/Applications/Docker.app/Contents/Resources/bin/docker':'docker';
const args=['--host','unix:///var/run/docker.sock'];
const name='arma2-mpb12-migration-check-'+process.pid;
const root=new URL('../../',import.meta.url);
const migrations=['00000000000000_torneos_baseline_v1.sql','00000000000001_staging_v1_rpc_exposure.sql','00000000000002_mercadopago_checkout_pro_test.sql','00000000000003_mercadopago_provider_ordering.sql'].map(f=>readFileSync(new URL('backend/torneos/supabase/migrations/'+f,root),'utf8'));
const run=(a)=>execFileSync(docker,[...args,...a],{encoding:'utf8',stdio:['pipe','pipe','pipe']});
function sql(text) {
  const r=spawnSync(docker,[...args,'exec','-i',name,'psql','-U','supabase_admin','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8',maxBuffer:16*1024*1024});
  return {ok:r.status===0,out:r.stdout?.trim(),error:(r.stderr??'').split('\n').filter(x=>x.startsWith('ERROR:') || x.includes('FATAL:')).join('\n')};
}
for(const mode of ['fresh','upgrade']) test('migration '+mode+' 0000→0003; drift fail-closed',async()=>{
  try {
    const env={...process.env,POSTGRES_PASSWORD:randomBytes(32).toString('hex')};
    execFileSync(docker,[...args,'run','-d','--pull','never','--network','none','--name',name,'-e','POSTGRES_PASSWORD','public.ecr.aws/supabase/postgres:17.6.1.143'],{env,stdio:'pipe'});
    let ready=false;
    for(let i=0;i<90;i++) {
      let tcp=false; try {run(['exec',name,'pg_isready','-h','127.0.0.1']);tcp=true;} catch {}
      const r=tcp?sql("select exists(select 1 from pg_roles where rolname='authenticator')"):{ok:false};
      if(r.ok&&r.out==='t') {ready=true;break;}
      await new Promise(r=>setTimeout(r,500));
    }
    assert.ok(ready,'local postgres initialized');
    for(const source of migrations.slice(0,3)) {const r=sql(source);assert.ok(r.ok,r.error);}
    const before=sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and has_function_privilege('torneos_payment_service',p.oid,'EXECUTE')");
    assert.equal(before.out,'4');
    for(const drift of [
      'ALTER FUNCTION public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text) RENAME TO drifted_status;',
      'ALTER FUNCTION public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text) SECURITY INVOKER;',
      'REVOKE EXECUTE ON FUNCTION public.get_provider_tournament_purchase(text,text,text) FROM torneos_payment_service;',
    ]) {
      const r=sql(migrations[3].replace('BEGIN;',`BEGIN;\n${drift}`).replace('COMMIT;','ROLLBACK;'));
      assert.equal(r.ok,false); assert.match(r.error,/TORNEOS_MP_B1_2_PRECONDITION_FAILED/);
      assert.equal(sql("select to_regclass('public.tournament_payment_provider_watermarks') is null").out,'t');
    }
    if(mode==='upgrade') {
      run(['restart',name]);
      for(let i=0;i<90;i++) {if(sql('select 1').ok) break; await new Promise(r=>setTimeout(r,500));}
    }
    const applied=sql(migrations[3]);assert.ok(applied.ok,applied.error);
    assert.equal(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and has_function_privilege('torneos_payment_service',p.oid,'EXECUTE')").out,'4');
    assert.equal(sql("select to_regprocedure('public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text)') is null").out,'t');
  } finally {try {run(['rm','-f','-v',name]);} catch { /* creation may have failed */ }}
});
