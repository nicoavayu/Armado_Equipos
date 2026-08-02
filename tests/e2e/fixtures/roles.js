const fs = require('node:fs');
const path = require('node:path');

const ROLE_NAMES = Object.freeze([
  'owner',
  'admin',
  'delegate',
  'player',
  'outsider',
  'collaborator',
]);

const ROLE_FIXTURES = Object.freeze({
  owner: {
    label: 'Owner',
    expectedScope: 'full organization administration',
  },
  admin: {
    label: 'Admin',
    expectedScope: 'delegated organization administration',
  },
  delegate: {
    label: 'Delegate',
    expectedScope: 'team and match operations explicitly delegated',
  },
  player: {
    label: 'Player',
    expectedScope: 'participant read and response surfaces',
  },
  outsider: {
    label: 'Outsider',
    expectedScope: 'authenticated user without tournament membership',
  },
  collaborator: {
    label: 'Collaborator',
    expectedScope: 'explicitly assigned collaboration surfaces',
  },
});

function getRoleState(role, env = process.env) {
  if (!ROLE_NAMES.includes(role)) {
    throw new Error(`Unknown QA role "${role}".`);
  }

  const authStateDirectory = String(env.QA_AUTH_STATE_DIR || '').trim();
  if (!authStateDirectory) {
    return {
      role,
      ready: false,
      storageState: undefined,
      reason: 'QA_AUTH_STATE_DIR is not configured; no session is being simulated.',
    };
  }

  const storageState = path.resolve(authStateDirectory, `${role}.json`);
  if (!fs.existsSync(storageState)) {
    return {
      role,
      ready: false,
      storageState: undefined,
      reason: `Missing non-versioned storage state for ${role}.`,
    };
  }

  return {
    role,
    ready: true,
    storageState,
    reason: null,
  };
}

module.exports = {
  ROLE_FIXTURES,
  ROLE_NAMES,
  getRoleState,
};
