import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QAIdentityMap,
  QA_IDENTITY_RELATIONS,
  QA_IDENTITY_ROLES,
  identityMapFromEnv,
} from './torneos-qa-identity-map.mjs';

function rawMap() {
  return Object.fromEntries(QA_IDENTITY_ROLES.map((role, index) => [
    role,
    {
      auth_user_id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      expected_email: `qa-${role}@localhost.invalid`,
      logical_role: role,
      projected_relations: QA_IDENTITY_RELATIONS[role],
    },
  ]));
}

test('QAIdentityMap exposes six explicit roles and a privacy-safe fingerprint', () => {
  const identityMap = new QAIdentityMap(rawMap());
  assert.deepEqual(Object.keys(identityMap.toJSON()), QA_IDENTITY_ROLES);
  assert.equal(identityMap.fingerprint().length, 64);
  assert.equal(
    identityMap.report().some((entry) => JSON.stringify(entry).includes('@')),
    false,
  );
});

test('QAIdentityMap rejects credentials and incompatible projections', () => {
  const withPassword = rawMap();
  withPassword.owner.password = 'must-not-be-accepted';
  assert.throws(() => new QAIdentityMap(withPassword), /Forbidden credential field/);

  const incompatible = rawMap();
  incompatible.outsider.projected_relations = ['organization_membership:owner'];
  assert.throws(() => new QAIdentityMap(incompatible), /incompatible projected_relations/);

  const duplicate = rawMap();
  duplicate.owner.projected_relations = [
    ...duplicate.owner.projected_relations,
    duplicate.owner.projected_relations[0],
  ];
  assert.throws(() => new QAIdentityMap(duplicate), /duplicate projected_relations/);
});

test('secure environment contract resolves without legacy fixed-ID variables', () => {
  const env = {};
  for (const [role, identity] of Object.entries(rawMap())) {
    const prefix = `QA_IDENTITY_${role.toUpperCase()}`;
    env[`${prefix}_AUTH_USER_ID`] = identity.auth_user_id;
    env[`${prefix}_EMAIL`] = identity.expected_email;
  }
  assert.ok(identityMapFromEnv(env) instanceof QAIdentityMap);
  assert.equal('QA_USER_OWNER_ID' in env, false);
});
