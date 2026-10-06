// CONNECTED-V1 migrations, read statically against backend/torneos/connected-v1/contract.json:
//   • the isolated (0009) and the LOCAL (20261006120000) migrations expose the same functions with the same ACL;
//   • 0009 is additive and idempotent (the local lab re-applies migrations), never touches a certified body, never
//     reads Core (no auth.uid, no Core tables) and consumes the gateway's attestations for team authority;
//   • every RPC is SECURITY DEFINER with an empty search_path; every domain error keeps its contract errcode;
//   • the documented rollback removes exactly what 0009 creates.
// The behaviour itself is certified on real Postgres: scripts/db-integration/torneos-connected-product.mjs (LOCAL)
// and integration/torneos-core-contracts/connected.test.mjs (hybrid lab, Node and Edge gateways).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const CONTRACT = JSON.parse(fs.readFileSync('backend/torneos/connected-v1/contract.json', 'utf8'));
const ISOLATED = fs.readFileSync(CONTRACT.migrations.isolated, 'utf8');
const LOCAL = fs.readFileSync(CONTRACT.migrations.local, 'utf8');
const ROLLBACK = fs.readFileSync('backend/torneos/connected-v1/rollback/00000000000009_connected_product_v1.rollback.sql', 'utf8');
const ALL_PUBLIC = [...CONTRACT.rpcs, ...CONTRACT.public_rpcs, ...CONTRACT.service_only, ...CONTRACT.internal];

const strip = (sql) => sql.replace(/--[^\n]*/g, '');

function functions(sql) {
  const out = new Map();
  for (const match of strip(sql).matchAll(/create (?:or replace )?function (public|private)\.([a-z0-9_]+)\(([\s\S]*?)\)\s*returns ([\s\S]*?)\bas \$\$([\s\S]*?)\$\$;/gi)) {
    const args = match[3].split(',').map((arg) => arg.trim()).filter(Boolean)
      .map((arg) => arg.replace(/\s+default\s+[\s\S]*$/i, '').split(/\s+/).slice(1).join(' ').toLowerCase());
    out.set(`${match[1]}.${match[2]}`, { args, header: match[4], body: match[5] });
  }
  return out;
}

function grants(sql) {
  const out = { anon: new Set(), authenticated: new Set(), service_role: new Set(), torneos_core_adapter: new Set() };
  for (const match of strip(sql).matchAll(/grant execute on function([\s\S]*?)\bto ([a-z_, ]+);/gi)) {
    const names = [...match[1].matchAll(/(?:public|private)\.([a-z0-9_]+)\(/g)].map((m) => m[1]);
    for (const role of match[2].split(',').map((r) => r.trim())) for (const name of names) out[role]?.add(name);
  }
  return out;
}

test('both migrations define the same CONNECTED-V1 functions with the same signatures', () => {
  const isolated = functions(ISOLATED);
  const local = functions(LOCAL);
  for (const name of ALL_PUBLIC) {
    assert.ok(isolated.has(`public.${name}`), `isolated public.${name}`);
    assert.ok(local.has(`public.${name}`), `local public.${name}`);
    assert.deepEqual(isolated.get(`public.${name}`).args, local.get(`public.${name}`).args, name);
  }
  assert.deepEqual([...local.keys()].filter((name) => name.startsWith('public.')).sort(), ALL_PUBLIC.map((name) => `public.${name}`).sort());
  assert.deepEqual([...isolated.keys()].sort(), [...ALL_PUBLIC.map((name) => `public.${name}`), 'private.authorize_applicant_core_contract'].sort());
});

test('ACL: exactly the contract, in both migrations', () => {
  for (const [label, sql] of [['isolated', ISOLATED], ['local', LOCAL]]) {
    const g = grants(sql);
    assert.deepEqual([...g.anon].sort(), [...CONTRACT.public_rpcs].sort(), `${label} anon`);
    assert.deepEqual([...g.authenticated].sort(), [...CONTRACT.rpcs, ...CONTRACT.public_rpcs].sort(), `${label} authenticated`);
    assert.deepEqual([...g.service_role].sort(), [...CONTRACT.service_only].sort(), `${label} service_role`);
    for (const name of [...CONTRACT.internal, ...CONTRACT.service_only, ...CONTRACT.rpcs, ...CONTRACT.public_rpcs]) {
      assert.match(strip(sql), new RegExp(`revoke all on function[\\s\\S]*public\\.${name}\\(`, 'i'), `${label}: ${name} starts revoked`);
    }
    for (const table of CONTRACT.tables) {
      assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `${label}: RLS on ${table}`);
    }
    for (const statement of strip(sql).match(/grant (?:select|insert|update|delete|all)[^;]*;/gi) || []) {
      const ownTable = CONTRACT.tables.some((table) => statement.includes(`public.${table}`));
      if (ownTable) assert.doesNotMatch(statement, /\bto\b[^;]*\b(anon|authenticated)\b/i, `${label}: no table grant to API roles (${statement})`);
    }
  }
  assert.deepEqual([...grants(ISOLATED).torneos_core_adapter], ['authorize_applicant_core_contract']);
});

test('every function is SECURITY DEFINER with an empty search_path (except the immutable normalizer)', () => {
  for (const [label, sql] of [['isolated', ISOLATED], ['local', LOCAL]]) {
    for (const [name, fn] of functions(sql)) {
      assert.match(fn.header, /set search_path = ''/i, `${label} ${name} search_path`);
      if (name !== 'public.tournament_catalog_normalize') assert.match(fn.header, /security definer/i, `${label} ${name} definer`);
    }
  }
});

test('0009 is additive, idempotent and never touches a certified body', () => {
  const sql = strip(ISOLATED);
  assert.match(ISOLATED, /^BEGIN;$/m);
  assert.match(ISOLATED, /^COMMIT;$/m);
  assert.match(sql, /TORNEOS_CONNECTED_V1_PRECONDITION_FAILED/);
  assert.match(sql, /TORNEOS_CONNECTED_V1_POSTCONDITION_FAILED/);
  assert.doesNotMatch(sql, /\bcreate table public\./i, 'tables are created if not exists');
  assert.doesNotMatch(sql, /\bcreate index (?!if not exists)/i);
  assert.doesNotMatch(sql, /\bcreate function /i, 'functions are create or replace');
  for (const match of sql.matchAll(/create trigger (\w+)/gi)) {
    assert.match(sql, new RegExp(`drop trigger if exists ${match[1]} on`, 'i'), `${match[1]} re-creatable`);
  }
  assert.doesNotMatch(sql, /\bdrop (function|table)\b/i, 'nothing is dropped');
  for (const statement of sql.match(/\balter table [^;]*;/gi) || []) {
    assert.match(statement, new RegExp(`^alter table public\\.(?:${CONTRACT.tables.join('|')}) enable row level security;$`, 'i'),
      `only its own tables are altered (RLS): ${statement}`);
  }
  assert.doesNotMatch(sql, /\balter function\b/i);
  assert.doesNotMatch(sql, /function private\.authorize_core_contract\(/i, 'the certified authorizer is not replaced');
  for (const name of ['review_tournament_team_entry', 'submit_tournament_team_entry', 'create_tournament_team_entry',
    'withdraw_tournament_team_entry', 'get_tournament_communications_inbox', 'get_public_tournament_page']) {
    assert.doesNotMatch(sql, new RegExp(`function public\\.${name}\\(`, 'i'), `${name} untouched`);
  }
});

test('0009 never reads Core: identity is torneos_identity and team authority comes from attestations', () => {
  const sql = strip(ISOLATED);
  assert.doesNotMatch(sql, /auth\.uid\(\)|auth\.users|public\.teams\b|team_user_is_admin_or_owner|public\.usuarios/i);
  assert.match(sql, /references public\.torneos_identity\(id\)/i);
  const isolated = functions(ISOLATED);
  assert.match(isolated.get('public.search_my_applicable_core_teams').body, /private\.consume_core_attestation\(\s*'directory_teams'/);
  assert.match(isolated.get('public.start_tournament_application').body, /private\.consume_core_attestation\(\s*'team_snapshot'/);
  assert.doesNotMatch(isolated.get('public.search_my_applicable_core_teams').header, /\bstable\b/i, 'consuming an attestation writes');
  // The authorizer binds exactly what the RPCs consume.
  const authorizer = isolated.get('private.authorize_applicant_core_contract').body;
  assert.match(authorizer, /'applicantTournamentId', v_page\.tournament_id, 'query', v_query, 'limit', v_limit/);
  assert.match(isolated.get('public.search_my_applicable_core_teams').body, /'applicantTournamentId', v_page\.tournament_id, 'query', v_query, 'limit', v_limit/);
  assert.match(authorizer, /'applicationTournamentId', v_page\.tournament_id, 'categoryId', v_category\.id, 'coreTeamId', v_core_team_id/);
  assert.match(isolated.get('public.start_tournament_application').body, /'applicationTournamentId', v_tournament\.id, 'categoryId', v_category\.id, 'coreTeamId', p_core_team_id/);
  // LOCAL keeps the same authority, read in the same database.
  assert.match(functions(LOCAL).get('public.start_tournament_application').body, /public\.team_user_is_admin_or_owner\(id, v_uid\)/);
});

test('every domain error keeps its contract errcode in both migrations', () => {
  for (const [label, sql] of [['isolated', ISOLATED], ['local', LOCAL]]) {
    const raises = [...strip(sql).matchAll(/errcode = '([0-9A-Z]+)', message = '(TORNEOS_[A-Z_]+)'/g)];
    for (const [, errcode, message] of raises) {
      if (!Object.hasOwn(CONTRACT.errors, message)) continue;
      assert.equal(errcode, CONTRACT.errors[message], `${label} ${message}`);
    }
    for (const message of Object.keys(CONTRACT.errors)) {
      assert.ok(raises.some(([, , raised]) => raised === message), `${label} raises ${message}`);
    }
  }
});

test('the rollback removes exactly what 0009 creates', () => {
  const dropped = new Set([...ROLLBACK.matchAll(/DROP FUNCTION IF EXISTS (?:public|private)\.([a-z0-9_]+)\(/g)].map((m) => m[1]));
  assert.deepEqual([...dropped].sort(), [...ALL_PUBLIC, 'authorize_applicant_core_contract'].sort());
  const tables = [...ROLLBACK.matchAll(/DROP TABLE IF EXISTS public\.([a-z_]+);/g)].map((m) => m[1]);
  assert.deepEqual([...tables].sort(), [...CONTRACT.tables].sort());
  const triggers = [...ROLLBACK.matchAll(/DROP TRIGGER IF EXISTS ([a-z_]+) ON/g)].map((m) => m[1]);
  assert.deepEqual(triggers.sort(), Object.values(CONTRACT.triggers).flat().sort());
});
