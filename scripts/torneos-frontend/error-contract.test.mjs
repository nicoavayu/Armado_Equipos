// ERROR-CONTRACT-V1 — offline guards that keep the three layers of the domain error contract equal:
//   • backend/torneos/error-contract-v1/contract.json (`http`, `postgrest.legacy_5xx_sqlstates`) = the gateway's
//     DOMAIN_ERROR_STATUS / LEGACY_DOMAIN_SQLSTATES (torneos-gateway/competition.ts, read as source text so this
//     runs on any Node);
//   • every contract code has product copy (ERROR_MESSAGES), so a 409/422/429 never falls back to a generic text;
//   • the generated migration 0006 changes exactly the contract's RAISE literals and nothing that is out of scope.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime } from './sandbox.mjs';
import { read } from './audit.mjs';

const CONTRACT = JSON.parse(read('backend/torneos/error-contract-v1/contract.json'));
const COMPETITION = read('backend/torneos/supabase/functions/torneos-gateway/competition.ts');
const MIGRATION = read('backend/torneos/supabase/migrations/00000000000006_domain_error_contract.sql');

function frozenRecord(source, name) {
  const match = new RegExp(`export const ${name}[^=]*= Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\)`).exec(source);
  assert.ok(match, `${name} not found`);
  return Object.fromEntries([...match[1].matchAll(/([A-Z0-9_]+): (\d{3})/g)].map((m) => [m[1], Number(m[2])]));
}

test('gateway DOMAIN_ERROR_STATUS = contract.json http; legacy SQLSTATEs = contract', () => {
  assert.deepEqual(frozenRecord(COMPETITION, 'DOMAIN_ERROR_STATUS'), CONTRACT.http);
  const legacy = /export const LEGACY_DOMAIN_SQLSTATES[^=]*= new Set\(\[([^\]]*)\]\)/.exec(COMPETITION);
  assert.deepEqual(JSON.parse(`[${legacy[1]}]`), CONTRACT.postgrest.legacy_5xx_sqlstates);
  for (const status of Object.values(CONTRACT.http)) assert.ok([409, 422, 429].includes(status), `domain status ${status}`);
  const messages = new Set(CONTRACT.changes.flatMap((c) => c.raises.map((r) => r.message)));
  assert.deepEqual([...messages].sort(), Object.keys(CONTRACT.http).sort(), 'every changed message has one status and vice versa');
  for (const c of CONTRACT.changes) for (const r of c.raises) assert.notEqual(r.from, 'PT' + CONTRACT.http[r.message]);
});

test('every contract code has product copy; the transport surfaces it instead of the outage copy', () => {
  const { ERROR_MESSAGES } = runtime().load('src/features/torneos/api/tournamentWorkspaceErrors.js');
  for (const code of Object.keys(CONTRACT.http)) assert.equal(typeof ERROR_MESSAGES[code], 'string', `${code} has copy`);
  const { BOUNDARY_MESSAGES } = runtime({ modules: { uuid: { v4: () => 'x' } } }).load('src/features/torneos/stagingV1/stagingV1WorkspaceService.js');
  for (const code of Object.keys(CONTRACT.http)) assert.notEqual(ERROR_MESSAGES[code], BOUNDARY_MESSAGES.TORNEOS_UNAVAILABLE);
});

test('migration 0006 is the generated contract: pins, header table, no 40001 left in its bodies, commerce and invariants untouched', () => {
  const pins = CONTRACT.migration.pins;
  assert.equal(pins.length, CONTRACT.changes.length);
  for (const [i, pin] of pins.entries()) {
    assert.equal(pin.function, CONTRACT.changes[i].function);
    assert.match(pin.md5_before, /^[0-9a-f]{32}$/); assert.match(pin.md5_after, /^[0-9a-f]{32}$/);
    assert.ok(MIGRATION.includes(`array['${pin.function}', '${pin.md5_before}', '${pin.md5_after}']`), `${pin.function} pinned`);
  }
  const bodies = MIGRATION.slice(MIGRATION.indexOf('replaced bodies'), MIGRATION.indexOf('DO $post$'));
  assert.equal((bodies.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, CONTRACT.changes.length);
  assert.doesNotMatch(bodies, /errcode\s*=\s*'40001'/i, 'no domain 40001 left');
  for (const [message, status] of Object.entries(CONTRACT.http)) {
    const expected = CONTRACT.changes.flatMap((c) => c.raises).filter((r) => r.message === message).reduce((a, r) => a + r.count, 0);
    const found = [...bodies.matchAll(/raise\s+exception\b[^;]*;/gi)].map((m) => m[0]).filter((s) => s.includes(`'${message}'`));
    assert.equal(found.length, expected, message);
    for (const stmt of found) assert.match(stmt, new RegExp(`errcode\\s*=\\s*'PT${status}'`, 'i'), message);
  }
  for (const untouched of ['TORNEOS_MATCH_REVIEW_OPEN', 'TORNEOS_MATCH_CORRECTION_STALE', 'TORNEOS_MEDIA_PIPELINE_NOT_READY', 'TORNEOS_PURCHASE_TRANSITION_INVALID']) {
    assert.ok(!bodies.includes(`'${untouched}'`), `${untouched} is out of scope (invariant / readiness / commerce)`);
  }
  assert.ok(!CONTRACT.changes.some((c) => /make_tournament_match_official|purchase|payment|media/.test(c.function)), 'no invariant, commerce or media function replaced');
  const outsideBodies = bodies.replace(/AS \$function\$[\s\S]*?\$function\$;/g, '').replace(/--.*$/gm, '');
  assert.doesNotMatch(outsideBodies, /^\s*(GRANT|REVOKE|ALTER\s+(TABLE|FUNCTION)|DROP)\b/im, 'bodies only: no grant, revoke, ALTER or DROP statement');
});
