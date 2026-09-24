// Local-only MP-B1.2 verification. Prints counts/hashes, never secret values.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { repo, dc } from './lab.mjs';
import { labSecrets } from './payments-lab.mjs';
const base='38c9669d60ee96020c64e5c0c83bb0fd636b100a';
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
const paths=[...new Set([git('diff','--name-only',base),git('ls-files','--others','--exclude-standard')].flatMap(x=>x.split('\n').filter(Boolean)))];
const protectedPaths=['src/','supabase/','server/','api/','backend/torneos/supabase/functions/torneos-gateway/'];
const harnessFiles=['compose.yaml','compose.mpa.yaml','lab.mjs','gateway.mjs','core-api.mjs','torneos-edge-main/index.ts','torneos-edge-main/env.ts'].map(p=>'integration/torneos-core-contracts/'+p);
assert.ok(!paths.some(p=>harnessFiles.includes(p)),'certified harness/topology changed');
assert.ok(!paths.some(p=>protectedPaths.some(prefix=>p.startsWith(prefix))),'frontend/Core/gateway changed');
const hashes={};
for(const name of ['00000000000000_torneos_baseline_v1.sql','00000000000001_staging_v1_rpc_exposure.sql','00000000000002_mercadopago_checkout_pro_test.sql']) {
  const path='backend/torneos/supabase/migrations/'+name;
  const actual=readFileSync(repo+path);
  const original=execFileSync('git',['show',base+':'+path],{cwd:repo,maxBuffer:32*1024*1024});
  assert.ok(actual.equals(original),name+' changed');
  hashes[name]=createHash('sha256').update(actual).digest('hex');
}
const secrets=labSecrets();
let bytes=0, fixtureDBUrls=0;
function scan(text,label) {
  bytes+=Buffer.byteLength(text);
  for(const secret of secrets) assert.ok(!text.includes(secret),'secret in '+label);
  for (const match of text.matchAll(/postgres(?:ql)?:\/\/[^\s"'@/]+:([^\s"'@]+)@/g)) {
    if (label.endsWith('payments-config.test.mjs') && match[1] === 'pw') { fixtureDBUrls++; continue; }
    assert.ok(match[1].includes('${'),'DB credential URL in '+label);
  }
  for(const pattern of [/APP_USR-[0-9A-Za-z-]{20,}/,/TEST-[a-f0-9]{24,}/,/eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{20,}/,/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,/lab-payer-[0-9]+@payer\.invalid/,/ts=\d{9,},v1=[a-f0-9]{64}/]) assert.ok(!pattern.test(text),'credential pattern in '+label);
}
for(const path of paths) scan(readFileSync(repo+path,'utf8'),path);
scan(dc(['logs','--no-color'],undefined,true),'local container logs');
const result={base,migrations:hashes,frontendCoreGatewayUnchanged:true,certifiedHarnessUnchanged:true,secrets:0,fixtureDBUrls,scannedFiles:paths.length,scannedBytes:bytes};
writeFileSync(repo+'backend/torneos/mp-b/evidence/mp-b1.2/invariants.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
