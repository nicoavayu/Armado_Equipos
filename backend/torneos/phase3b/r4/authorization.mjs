import fs from 'node:fs';
export function validateAuthorization(doc,command,seal) {
  if(doc?.phase!=='R4.2'||doc?.userAuthorized!==true||!Array.isArray(doc.commands)||!doc.commands.includes(command)||doc.r41aSealSHA256!==seal||!Number.isFinite(Date.parse(doc.expiresAt))||Date.parse(doc.expiresAt)<=Date.now())throw new Error('R4_2_NOT_AUTHORIZED');
  return doc;
}
export function requireAuthorization(root,command,seal) {
  let doc;try{doc=JSON.parse(fs.readFileSync(root+'/.runtime/authorization.json','utf8'));}catch{throw new Error('R4_2_NOT_AUTHORIZED');}
  return validateAuthorization(doc,command,seal);
}
export function validatePublicCoreKey(key){
 if(typeof key!=='string')throw new Error('CORE_PUBLIC_KEY_REQUIRED');
 if(/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key))return key;
 try{const parts=key.split('.');if(parts.length!==3)throw 0;const doc=JSON.parse(Buffer.from(parts[1],'base64url'));if(doc.role==='anon'&&doc.ref==='hhyvmhgpapyuzjgxfnqv')return key;}catch{}
 throw new Error('ONLY_CORE_STAGING_PUBLIC_ANON_KEY_ALLOWED');
}
