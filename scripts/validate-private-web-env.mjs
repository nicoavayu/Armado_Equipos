import {
  hasValidPrivateWebSigningSecret,
  isPrivateWebPasswordHashValid,
} from '../server/privateWebAccess.mjs';

const failures = [];

if (!isPrivateWebPasswordHashValid(process.env.PRIVATE_WEB_ACCESS_PASSWORD_HASH)) {
  failures.push('PRIVATE_WEB_ACCESS_PASSWORD_HASH');
}

if (!hasValidPrivateWebSigningSecret(process.env.PRIVATE_WEB_ACCESS_SIGNING_SECRET)) {
  failures.push('PRIVATE_WEB_ACCESS_SIGNING_SECRET');
}

if (failures.length > 0) {
  console.error(`Private web access configuration is missing or invalid: ${failures.join(', ')}`);
  process.exit(1);
}

console.log('Private web access server-side configuration validated.');
