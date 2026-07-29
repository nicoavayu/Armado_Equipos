import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseSecurityAdvisorHttpResponse,
  parseSecurityAdvisorPayload,
  summarizeSecurityAdvisorLints,
} from './response.mjs';

const response = ({ ok = true, status = 200, body = '' } = {}) => ({
  ok,
  status,
  text: async () => body,
});

test('reads the current response.result.lints collection', () => {
  const lints = [{ name: '0029_authenticated_security_definer_function_executable', level: 'WARN' }];
  assert.deepEqual(parseSecurityAdvisorPayload({ result: { lints } }), lints);
});

test('accepts a valid empty lint collection', () => {
  assert.deepEqual(parseSecurityAdvisorPayload({ result: { lints: [] } }), []);
});

test('fails closed on HTTP and authentication errors', async () => {
  await assert.rejects(
    parseSecurityAdvisorHttpResponse(response({ ok: false, status: 500 })),
    /SECURITY_ADVISOR_HTTP_ERROR:500/,
  );
  await assert.rejects(
    parseSecurityAdvisorHttpResponse(response({ ok: false, status: 401 })),
    /SECURITY_ADVISOR_AUTH_ERROR:401/,
  );
});

test('fails closed on invalid JSON', async () => {
  await assert.rejects(
    parseSecurityAdvisorHttpResponse(response({ body: '{not-json' })),
    /SECURITY_ADVISOR_JSON_INVALID/,
  );
});

test('rejects an unknown wrapper instead of returning zero', () => {
  assert.throws(
    () => parseSecurityAdvisorPayload({ data: { lints: [] } }),
    /SECURITY_ADVISOR_UNKNOWN_RESPONSE/,
  );
});

test('rejects a response with lints missing', () => {
  assert.throws(
    () => parseSecurityAdvisorPayload({ result: {} }),
    /SECURITY_ADVISOR_LINTS_MISSING/,
  );
});

test('rejects a non-array lints value', () => {
  assert.throws(
    () => parseSecurityAdvisorPayload({ result: { lints: {} } }),
    /SECURITY_ADVISOR_LINTS_INVALID/,
  );
});

test('counts lints by code and level without silent fallbacks', () => {
  const summary = summarizeSecurityAdvisorLints([
    { name: '0029_authenticated_security_definer_function_executable', level: 'WARN' },
    { code: '0029', name: 'authenticated_security_definer_function_executable', level: 'ERROR' },
    { name: '0008_rls_enabled_no_policy', level: 'WARN' },
  ]);

  assert.deepEqual(summary, {
    total: 3,
    byCode: { '0008': 1, '0029': 2 },
    byLevel: { error: 1, warn: 2 },
  });
});
