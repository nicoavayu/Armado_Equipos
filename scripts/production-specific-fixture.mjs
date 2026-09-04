// SQL-only synthetic data, isolated local target. No Auth HTTP or real users.
import pg from 'pg';import fs from 'node:fs';
import {buildIdentityMap,QA_IDENTITY_ROLES} from './qa/torneos-qa-identity-map.mjs';
import {buildCanonicalManifest,validateCanonicalManifest} from './qa/torneos-demo-manifest.mjs';
import {materializeManifest} from './qa/torneos-seed-db.mjs';
const client=new pg.Client({connectionString:'postgresql://postgres@127.0.0.1:58332/postgres'});await client.connect();
try{
 const records=Object.fromEntries(QA_IDENTITY_ROLES.map((role,i)=>[role,{auth_user_id:`9d000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,expected_email:`rehearsal-${role}@local.test`}]));
 for(const [role,r] of Object.entries(records))await client.query(`insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values($1,'authenticated','authenticated',$2,now(),$3,$4,now(),now()) on conflict(id) do nothing`,[r.auth_user_id,r.expected_email,{qa_seed_key:'torneos-demo-v4',qa_role:role},{full_name:'Rehearsal '+role}]);
 const manifest=buildCanonicalManifest({identityMap:buildIdentityMap(records)});validateCanonicalManifest(manifest);
 const result=await materializeManifest(client,manifest);
 const rows=t=>manifest.operations.filter(o=>o.table===t).flatMap(o=>o.rows);
 const admin=rows('tournament_organization_members').find(r=>r.role==='admin'),season=rows('tournament_seasons')[0];
 await client.query('insert into public.tournament_season_member_assignments(organization_id,season_id,membership_id) values($1,$2,$3) on conflict do nothing',[manifest.organizationId,season.id,admin.id]);
 console.log(JSON.stringify({status:result.status,rows:manifest.expectedRowCount,organizationId:manifest.organizationId,records},null,2));
}finally{await client.end();}
