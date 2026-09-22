import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAuthorization,validatePublicCoreKey} from './authorization.mjs';
import {validateMatrix,REQUIRED_CASES} from './certification.mjs';
test('R4.2 requires explicit operation, matching seal and unexpired authorization',()=>{
 for(const value of [null,{}, {phase:'R4.2',userAuthorized:true,commands:['start-gateway'],r41aSealSHA256:'a',expiresAt:'2000-01-01'}])assert.throws(()=>validateAuthorization(value,'start-gateway','a'),/NOT_AUTHORIZED/);
 const doc={phase:'R4.2',userAuthorized:true,commands:['start-gateway'],r41aSealSHA256:'a',expiresAt:new Date(Date.now()+10000).toISOString()};
 assert.equal(validateAuthorization(doc,'start-gateway','a'),doc);
 assert.throws(()=>validateAuthorization(doc,'certify','a'));
 assert.throws(()=>validateAuthorization(doc,'start-gateway','b'));
});
test('certification rejects empty, mismatched and incomplete coverage without running a matrix',()=>{
 const run={run:'unit-only',gatewayBundleSHA256:'x'};
 assert.throws(()=>validateMatrix({status:'PASS'},run,[],[]));
 const doc={schema:'R4.2.matrix.v1',run:'unit-only',gatewayBundleSHA256:'x',status:'PASS',cleanup:{qa:true,fixtures:true,sessions:true},cases:REQUIRED_CASES.map(name=>({name,status:'PASS',artifacts:[{path:'unit-only',sha256:'x'}]})),allowlistCovered:['a'],gatedCovered:['b']};
 assert.equal(validateMatrix(doc,run,['a'],['b']).length,REQUIRED_CASES.length);
 assert.throws(()=>validateMatrix({...doc,allowlistCovered:[]},run,['a'],['b']));
 assert.throws(()=>validateMatrix({...doc,cases:doc.cases.slice(1)},run,['a'],['b']));
 assert.throws(()=>validateMatrix({...doc,gatewayBundleSHA256:'wrong'},run,['a'],['b']));
});

test('Core admin secrets and wrong-project legacy keys never enter the gateway',()=>{
 for(const key of [undefined,'sb_secret_do_not_accept','x.'+Buffer.from(JSON.stringify({role:'service_role',ref:'hhyvmhgpapyuzjgxfnqv'})).toString('base64url')+'.x','x.'+Buffer.from(JSON.stringify({role:'anon',ref:'other'})).toString('base64url')+'.x'])assert.throws(()=>validatePublicCoreKey(key));
});
