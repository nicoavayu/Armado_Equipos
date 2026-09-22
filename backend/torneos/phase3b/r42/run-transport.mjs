// Existing credentials stay in process memory. This entrypoint cannot select matrix/certify.
import {call,utc,registerSecret} from './lib.mjs';
import {operate} from './operator.mjs';
const transportVariant=process.argv[2]??'diagnosis';
if(!['diagnosis','postfix','worker','route','route-loaded','route-postfix'].includes(transportVariant))throw new Error('usage: run-transport.mjs [diagnosis|postfix|worker|route|route-loaded|route-postfix]');
let stored=call('/usr/bin/security',['find-generic-password','-s','Supabase CLI','-w']).stdout.trim();
const pat=stored.startsWith('go-keyring-base64:')?Buffer.from(stored.slice('go-keyring-base64:'.length),'base64').toString():stored;
registerSecret(stored);registerSecret(pat);stored='';
const secret=call('/usr/bin/security',['find-generic-password','-s','arma2-torneos-nonprod-core','-a','contract-secret','-w']).stdout.trim();registerSecret(secret);
await operate({pat,secret,stamp:utc(),mode:'transport',transportVariant});
