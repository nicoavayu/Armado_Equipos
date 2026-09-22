export const REQUIRED_CASES=['exchange_valid','token_valid','wrong_issuer','wrong_audience','wrong_kid','expired','wrong_ttl','claim_validation','session_identity_binding','request_binding','replay','logout_revocation','core_session_inactive','core_contract_unavailable','core_response_stale','core_auth_unavailable','torneos_rest_unavailable','allowlist','gated','p0_review_tournament_team_entry','cross_user','cross_workspace','cross_season','no_cache','secret_boundary','isolation'];
export function validateMatrix(matrix,run,allowed,gated){
 const fail=()=>{throw new Error('MATRIX_INCOMPLETE_OR_UNBOUND');};
 if(matrix?.schema!=='R4.2.matrix.v1'||matrix.run!==run.run||matrix.gatewayBundleSHA256!==run.gatewayBundleSHA256||matrix.status!=='PASS'||matrix.cleanup?.qa!==true||matrix.cleanup?.fixtures!==true||matrix.cleanup?.sessions!==true)fail();
 const cases=matrix.cases||[];
 if(cases.length!==new Set(cases.map(c=>c.name)).size||cases.some(c=>c.status!=='PASS')||!REQUIRED_CASES.every(n=>cases.some(c=>c.name===n&&Array.isArray(c.artifacts)&&c.artifacts.length>0)))fail();
 const same=(a,b)=>Array.isArray(a)&&a.length===new Set(a).size&&JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
 if(!same(matrix.allowlistCovered,allowed)||!same(matrix.gatedCovered,gated))fail();
 return cases.flatMap(c=>c.artifacts);
}
