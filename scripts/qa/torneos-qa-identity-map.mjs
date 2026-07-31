import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const QA_IDENTITY_ROLES = Object.freeze([
  'owner',
  'admin',
  'collaborator',
  'delegate',
  'player',
  'outsider',
]);

function relations(...values) {
  return Object.freeze(values.sort());
}

export const QA_IDENTITY_RELATIONS = Object.freeze({
  owner: relations(
    'dataset_creator:tournament_organizations:1',
    'organization_membership:owner:active:1',
    'reference:tournament_audit_log.actor_user_id:2',
    'reference:tournament_fixture_versions.created_by:1',
    'reference:tournament_match_events.created_by:14',
    'reference:tournament_match_operations.official_by:28',
    'reference:tournament_match_operations.opened_by:31',
    'reference:tournament_match_operations.submitted_by:30',
    'reference:tournament_match_reviews.requested_by:2',
    'reference:tournament_matches.created_by:31',
    'reference:tournament_organization_members.invited_by:2',
    'reference:tournament_organization_members.user_id:1',
    'reference:tournament_organizations.created_by:1',
    'reference:tournament_participant_sets.frozen_by:1',
    'reference:tournament_provisional_players.created_by:78',
    'reference:tournament_roster_players.added_by:80',
    'reference:tournament_rosters.created_by:8',
    'reference:tournament_seasons.created_by:1',
    'reference:tournament_standings_revisions.calculated_by:1',
    'reference:tournament_standings_revisions.published_by:1',
    'reference:tournament_suspension_served_matches.marked_by:1',
    'reference:tournament_team_entries.created_by:8',
    'reference:tournament_team_entries.submitted_by:8',
    'reference:tournament_team_managers.invited_by:9',
    'reference:tournament_team_managers.user_id:7',
    'reference:tournaments.created_by:4',
    'team_manager:BNO:captain:active',
    'team_manager:EDS:captain:active',
    'team_manager:FER:captain:active',
    'team_manager:PPC:captain:active',
    'team_manager:RIB:captain:active',
    'team_manager:SDC:captain:active',
    'team_manager:VIL:captain:active',
  ),
  admin: relations(
    'match_operation_validator:official:28',
    'organization_membership:admin:active:1',
    'reference:tournament_match_operations.validated_by:28',
    'reference:tournament_organization_members.user_id:1',
    'reference:tournament_team_entries.reviewed_by:8',
    'reference:tournament_team_managers.user_id:1',
    'team_manager:HOR:captain:active',
  ),
  collaborator: relations(
    'organization_membership:collaborator:active:1',
    'reference:tournament_organization_members.user_id:1',
  ),
  delegate: relations(
    'reference:tournament_roster_players.arma2_user_id:1',
    'reference:tournament_team_managers.user_id:1',
    'roster_link:BNO:active',
    'team_manager:BNO:delegate:active',
  ),
  player: relations(
    'reference:tournament_roster_players.arma2_user_id:1',
    'roster_link:BNO:active',
  ),
  outsider: relations(),
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const FORBIDDEN_KEY_PATTERN = /(?:password|refresh[_-]?token|access[_-]?token|service[_-]?role|secret[_-]?key)/i;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertNoSecretFields(value, path = 'identity_map') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretFields(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      throw new Error(`Forbidden credential field in ${path}: ${key}`);
    }
    assertNoSecretFields(entry, `${path}.${key}`);
  }
}

function normalizeRelations(role, relations) {
  if (!Array.isArray(relations)) {
    throw new Error(`Identity ${role} must declare projected_relations.`);
  }
  const declared = relations.map((value) => String(value).trim());
  if (new Set(declared).size !== declared.length) {
    throw new Error(`Identity ${role} contains duplicate projected_relations.`);
  }
  const normalized = declared.sort();
  const expected = [...QA_IDENTITY_RELATIONS[role]].sort();
  if (canonicalJson(normalized) !== canonicalJson(expected)) {
    throw new Error(`Identity ${role} has incompatible projected_relations.`);
  }
  return expected;
}

function normalizeIdentity(role, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Identity ${role} must be an object.`);
  }
  const allowed = new Set([
    'auth_user_id',
    'expected_email',
    'logical_role',
    'projected_relations',
  ]);
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`Identity ${role} contains unsupported fields: ${unknown.join(', ')}`);
  }
  const authUserId = String(raw.auth_user_id || '').trim().toLowerCase();
  const expectedEmail = String(raw.expected_email || '').trim().toLowerCase();
  const logicalRole = String(raw.logical_role || '').trim();
  if (!UUID_PATTERN.test(authUserId)) {
    throw new Error(`Identity ${role} has an invalid auth_user_id.`);
  }
  if (!EMAIL_PATTERN.test(expectedEmail)) {
    throw new Error(`Identity ${role} has an invalid expected_email.`);
  }
  if (logicalRole !== role) {
    throw new Error(`Identity ${role} must use logical_role=${role}.`);
  }
  return Object.freeze({
    auth_user_id: authUserId,
    expected_email: expectedEmail,
    logical_role: role,
    projected_relations: Object.freeze(normalizeRelations(role, raw.projected_relations)),
  });
}

export class QAIdentityMap {
  constructor(raw) {
    assertNoSecretFields(raw);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('QAIdentityMap must be an object keyed by logical role.');
    }
    const unknown = Object.keys(raw).filter((role) => !QA_IDENTITY_ROLES.includes(role));
    const missing = QA_IDENTITY_ROLES.filter((role) => !raw[role]);
    if (unknown.length > 0 || missing.length > 0) {
      throw new Error(
        `QAIdentityMap roles mismatch (missing: ${missing.join(', ') || 'none'}; `
        + `unknown: ${unknown.join(', ') || 'none'}).`,
      );
    }
    const entries = Object.fromEntries(
      QA_IDENTITY_ROLES.map((role) => [role, normalizeIdentity(role, raw[role])]),
    );
    const ids = Object.values(entries).map((identity) => identity.auth_user_id);
    const emails = Object.values(entries).map((identity) => identity.expected_email);
    if (new Set(ids).size !== ids.length || new Set(emails).size !== emails.length) {
      throw new Error('QAIdentityMap auth_user_id and expected_email values must be unique.');
    }
    this.identities = Object.freeze(entries);
    Object.freeze(this);
  }

  get(role) {
    return this.identities[role];
  }

  toJSON() {
    return this.identities;
  }

  fingerprint() {
    return sha256(canonicalJson(Object.fromEntries(
      QA_IDENTITY_ROLES.map((role) => {
        const identity = this.get(role);
        return [role, {
          auth_user_id: identity.auth_user_id,
          email_fingerprint: sha256(identity.expected_email),
          logical_role: identity.logical_role,
          projected_relations: identity.projected_relations,
        }];
      }),
    )));
  }

  report() {
    return QA_IDENTITY_ROLES.map((role) => {
      const identity = this.get(role);
      return {
        role,
        auth_user_id_fingerprint: sha256(identity.auth_user_id).slice(0, 16),
        email_fingerprint: sha256(identity.expected_email).slice(0, 16),
        projected_relations: identity.projected_relations,
      };
    });
  }
}

export function identityMapFromEnv(env = process.env) {
  return new QAIdentityMap(Object.fromEntries(QA_IDENTITY_ROLES.map((role) => {
    const prefix = `QA_IDENTITY_${role.toUpperCase()}`;
    return [role, {
      auth_user_id: env[`${prefix}_AUTH_USER_ID`],
      expected_email: env[`${prefix}_EMAIL`],
      logical_role: role,
      projected_relations: QA_IDENTITY_RELATIONS[role],
    }];
  })));
}

export async function identityMapFromFile(filePath) {
  if (!filePath) throw new Error('QA_IDENTITY_MAP_FILE is required.');
  const absolutePath = resolve(filePath);
  const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', absolutePath], {
    cwd: process.cwd(),
    stdio: 'ignore',
  });
  if (ignored.status !== 0) {
    throw new Error('QA_IDENTITY_MAP_FILE must be covered by .gitignore.');
  }
  const parsed = JSON.parse(await readFile(absolutePath, 'utf8'));
  return new QAIdentityMap(parsed);
}

export async function loadQAIdentityMap({
  env = process.env,
  filePath = env.QA_IDENTITY_MAP_FILE,
} = {}) {
  const hasAnyEnvIdentity = QA_IDENTITY_ROLES.some((role) => (
    env[`QA_IDENTITY_${role.toUpperCase()}_AUTH_USER_ID`]
    || env[`QA_IDENTITY_${role.toUpperCase()}_EMAIL`]
  ));
  if (filePath && hasAnyEnvIdentity) {
    throw new Error('Choose exactly one identity source: ignored file or secure environment.');
  }
  if (filePath) return identityMapFromFile(filePath);
  if (hasAnyEnvIdentity) return identityMapFromEnv(env);
  throw new Error(
    'QAIdentityMap is unresolved. Set QA_IDENTITY_MAP_FILE to a Git-ignored file '
    + 'or provide all QA_IDENTITY_<ROLE>_AUTH_USER_ID/EMAIL variables.',
  );
}

export function buildIdentityMap(records) {
  return new QAIdentityMap(Object.fromEntries(QA_IDENTITY_ROLES.map((role) => [
    role,
    {
      auth_user_id: records[role]?.auth_user_id,
      expected_email: records[role]?.expected_email,
      logical_role: role,
      projected_relations: QA_IDENTITY_RELATIONS[role],
    },
  ])));
}
