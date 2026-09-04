import assert from 'node:assert/strict';import pg from 'pg';
const client=new pg.Client({connectionString:'postgresql://postgres@127.0.0.1:58332/postgres'});await client.connect();let checks=0;
const ok=(x,label)=>{assert.ok(x,label);checks++;console.log('PASS',label);};
const scalar=async(q,p=[])=>Object.values((await client.query(q,p)).rows[0]||{})[0];
const org='a5627c00-6b91-59b8-a366-455261e6e8de',tournament='439fd0cf-ce9d-53b7-9d6d-d64d680dafd0',category='6e91bbd4-db52-514e-a0b7-db44b6c91aa7',phase='a05ccc3d-7ce4-5a01-9bae-844ccce0b87a';
const owner='9d000000-0000-4000-8000-000000000001',outsider='9d000000-0000-4000-8000-000000000006';
async function role(name,user=''){await client.query('reset role');await client.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);await client.query('set local role '+name);}
async function denied(q,p,label){await client.query('savepoint denied');let code;try{await client.query(q,p);}catch(e){code=e.code;}await client.query('rollback to savepoint denied');ok(code==='42501',label);}
try{await client.query('begin');
 const round=await scalar('select id from public.tournament_rounds where phase_id=$1 order by round_number limit 1',[phase]);
 await role('authenticated',owner);
 for(const piece of ['next_fixture','round_results','standings','scorers','discipline','best_eleven','mvp','round_summary','semifinals','final','champion']){
  const data=await scalar('select public.get_tournament_social_snapshot($1,$2,$3,$4,$5,$6,null)',[org,tournament,category,phase,piece,round]);
  ok(data?.piece===piece&&data?.source?.organizationId===org,'Social published preview '+piece);
  ok(!/internalPath|checksum|reporterId|internalNotes/.test(JSON.stringify(data)),'Social private data excluded '+piece);
 }
 await role('authenticated',outsider);
 await denied('select public.get_tournament_social_snapshot($1,$2,$3,$4,$5,$6,null)',[org,tournament,category,phase,'standings',round],'Social outsider denied');
 await denied('select public.set_tournament_social_permission($1,$2,true)',[org,outsider],'Outsider cannot grant Social access');
 await denied('select * from public.tournament_social_permissions',[],'Authenticated cannot read Social grants directly');
 for(const f of ['tournament_social_role_capabilities(text)','current_user_tournament_social_capabilities(uuid)','has_tournament_social_capability(uuid,text)','tournament_social_published_scope(uuid,uuid,uuid,uuid)','tournament_social_match_rows(uuid,uuid,uuid,boolean)'])ok(!(await scalar("select has_function_privilege('authenticated',$1,'EXECUTE')",['public.'+f])),'Social helper client denied '+f);
 await role('anon');await denied('select public.get_tournament_social_studio_context($1)',[org],'Anon cannot enter Social Studio');await denied('select * from public.tournament_social_permissions',[],'Anon cannot read Social grants');
 await role('authenticated',owner);
 for(const format of ['F5','F6','F7','F8','F9','F11']){const row=(await client.query('select public.auto_match_required_players($1) required,public.auto_match_final_roster_capacity($1) roster,public.auto_match_invitation_capacity($1) invitations',[format])).rows[0];ok(row.required===2*Number(format.slice(1)),'Auto-Match required '+format);ok(row.roster===row.required+4,'Auto-Match roster '+format);ok(row.invitations===Math.ceil(row.required*1.5),'Auto-Match invitations '+format);}
 await role('service_role');await denied("select public.auto_match_duration('F5')",[],'Legacy Auto-Match service-role denial remains');
 await role('authenticated',owner);
 const constraints=await scalar("select string_agg(pg_get_constraintdef(oid),' ') from pg_constraint where conrelid='public.tournament_purchases'::regclass and conname in ('tournament_purchases_provider_check','tournament_purchases_environment_check')");ok(constraints.includes('FAKE')&&!constraints.includes('MERCADO_PAGO'),'Provider constraint remains FAKE-only');
 console.log(checks+' live Social/Auto-Match checks PASS');
}finally{await client.query('rollback');await client.end();}
