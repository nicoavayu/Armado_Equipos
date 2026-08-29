// F-1: the worker may only ever reach the project it was authorized to reach.
//
// The failure this pins is not exotic. A service-role key is unconditional
// authority over whatever project receives it, and it rides on every request in
// two headers. Before `target.mjs`, `readConfig` paired that key with whatever
// `SUPABASE_URL` happened to say — so one stale environment variable was enough
// to hand Production's authority to a process that believed it was talking to
// Staging, and the disclosure was complete on the first request.
//
// So the tests below are mostly negative, and the important ones assert an
// ordering rather than a value: the refusal has to happen while the credential
// is still an unread environment variable.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPILED_FORBIDDEN_API_HOSTS,
  COMPILED_FORBIDDEN_PROJECT_REFS,
  PRODUCTION_API_HOST,
  PRODUCTION_PROJECT_REF,
  TargetError,
  assertAuthorizedUrl,
  createSupabaseTarget,
  hostCarriesForbiddenRef,
  normalizeHost,
} from '../src/target.mjs';
import { createDbClient, createStorageClient, readConfig } from '../src/supabase.mjs';

const STAGING_REF = 'hhyvmhgpapyuzjgxfnqv';
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
const PROD_REF = PRODUCTION_PROJECT_REF;

/** The code of the TargetError a call throws, or null if it did not throw. */
function codeOf(build) {
  try {
    build();
    return null;
  } catch (error) {
    assert.ok(error instanceof TargetError, `expected a TargetError, got ${error}`);
    return error.code;
  }
}

const staging = (overrides = {}) => createSupabaseTarget({
  url: STAGING_URL, expectedProjectRef: STAGING_REF, ...overrides,
});

// --- the authorized case ----------------------------------------------------

test('the authorized Staging project is accepted and frozen', () => {
  const target = staging();
  assert.equal(target.origin, STAGING_URL);
  assert.equal(target.hostname, `${STAGING_REF}.supabase.co`);
  assert.equal(target.projectRef, STAGING_REF);
  assert.equal(target.loopback, false);
  assert.ok(Object.isFrozen(target));
});

test('a trailing slash on SUPABASE_URL is not a different target', () => {
  const target = createSupabaseTarget({
    url: `${STAGING_URL}/`, expectedProjectRef: STAGING_REF,
  });
  assert.equal(target.origin, STAGING_URL);
});

// --- Production ------------------------------------------------------------

test('Production is refused as the URL even when it is also the expected ref', () => {
  // Agreement is not authorization: two copies of the same mistake still name
  // Production, which is exactly the case a "does the URL match the config?"
  // check would have waved through.
  assert.equal(codeOf(() => createSupabaseTarget({
    url: `https://${PROD_REF}.supabase.co`, expectedProjectRef: PROD_REF,
  })), 'TARGET_FORBIDDEN');
});

test('a process configured for Staging cannot be pointed at Production', () => {
  assert.equal(codeOf(() => createSupabaseTarget({
    url: `https://${PROD_REF}.supabase.co`, expectedProjectRef: STAGING_REF,
  })), 'TARGET_FORBIDDEN');
});

test('naming Production only in the expected ref is refused too', () => {
  assert.equal(codeOf(() => createSupabaseTarget({
    url: STAGING_URL, expectedProjectRef: PROD_REF,
  })), 'TARGET_FORBIDDEN');
});

test('the compiled block cannot be emptied by the environment', () => {
  // The one-way rule: every one of these is an operator trying, deliberately or
  // by accident, to hand back an empty policy.
  for (const raw of ['', '   ', ',,,', [], ['something-else'], undefined, null]) {
    assert.equal(codeOf(() => createSupabaseTarget({
      url: `https://${PROD_REF}.supabase.co`,
      expectedProjectRef: STAGING_REF,
      forbiddenHosts: raw,
      forbiddenProjectRefs: raw,
    })), 'TARGET_FORBIDDEN', `an empty policy of ${JSON.stringify(raw)} must not un-forbid`);
  }
});

test('Production is refused in any DNS label, not just the first', () => {
  for (const host of [
    `db.${PROD_REF}.supabase.co`,
    `api.${PROD_REF}.supabase.co`,
    `gateway.${PROD_REF}.example.test`,
    `${PROD_REF}.pooler.supabase.com`,
  ]) {
    assert.equal(
      codeOf(() => createSupabaseTarget({ url: `https://${host}`, expectedProjectRef: STAGING_REF })),
      'TARGET_FORBIDDEN', `${host} names Production`,
    );
  }
});

test('a forbidden ref is matched as a whole label, never as a substring', () => {
  // The block must depend on DNS, not on text: a different project whose ref
  // merely contains Production's is a different host and stays reachable.
  assert.equal(hostCarriesForbiddenRef(`${PROD_REF}2.supabase.co`), false);
  assert.equal(hostCarriesForbiddenRef(`x${PROD_REF}.example.test`), false);
  assert.equal(hostCarriesForbiddenRef(`${PROD_REF}.supabase.co`), true);
});

test('a trailing root dot does not walk past the block', () => {
  // `new URL('https://host.').hostname` keeps the dot, so an unnormalised
  // comparison against the block list simply misses.
  assert.equal(normalizeHost(`${PROD_REF}.supabase.co.`), PRODUCTION_API_HOST);
  assert.equal(codeOf(() => createSupabaseTarget({
    url: `https://${PROD_REF}.supabase.co.`, expectedProjectRef: STAGING_REF,
  })), 'TARGET_FORBIDDEN');
});

test('case is not a bypass', () => {
  assert.equal(codeOf(() => createSupabaseTarget({
    url: `https://${PROD_REF.toUpperCase()}.SUPABASE.CO`, expectedProjectRef: STAGING_REF,
  })), 'TARGET_FORBIDDEN');
  assert.equal(codeOf(() => createSupabaseTarget({
    url: STAGING_URL, expectedProjectRef: PROD_REF.toUpperCase(),
  })), 'TARGET_FORBIDDEN');
});

// --- lookalikes ------------------------------------------------------------

test('lookalike hosts carrying the authorized ref are refused', () => {
  for (const host of [
    `${STAGING_REF}.supabase.co.evil.test`,   // suffix-extended
    `${STAGING_REF}.supabase.co.br`,          // plausible ccTLD
    `${STAGING_REF}.supabase.io`,             // wrong TLD
    `${STAGING_REF}.supabase-co.test`,        // dash for dot
    `${STAGING_REF}.supabase.com`,            // wrong domain
    `evil-${STAGING_REF}.supabase.co`,        // prefixed label
    `${STAGING_REF}x.supabase.co`,            // suffixed label
    `db.${STAGING_REF}.supabase.co`,          // extra label
    `supabase.co`,                            // no ref at all
  ]) {
    assert.equal(
      codeOf(() => createSupabaseTarget({ url: `https://${host}`, expectedProjectRef: STAGING_REF })),
      'TARGET_HOST', `${host} is not the authorized host`,
    );
  }
});

test('the authorized ref in the wrong position does not authorize the host', () => {
  assert.equal(codeOf(() => createSupabaseTarget({
    url: `https://attacker.test/${STAGING_REF}`, expectedProjectRef: STAGING_REF,
  })), 'TARGET_HOST');
});

// --- shape of the URL ------------------------------------------------------

test('userinfo is refused, and never echoed', () => {
  let thrown = null;
  try {
    createSupabaseTarget({
      url: `https://user:hunter2@${STAGING_REF}.supabase.co`, expectedProjectRef: STAGING_REF,
    });
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown?.code, 'TARGET_CREDENTIALS');
  // A URL password is a credential, and error strings end up in logs.
  assert.equal(/hunter2/.test(String(thrown?.message)), false);
});

test('plain http is refused for a remote host', () => {
  assert.equal(codeOf(() => createSupabaseTarget({
    url: `http://${STAGING_REF}.supabase.co`, expectedProjectRef: STAGING_REF,
  })), 'TARGET_INSECURE');
});

test('a non-http scheme is refused', () => {
  for (const url of ['ftp://x.supabase.co', 'file:///etc/passwd', 'javascript:alert(1)']) {
    assert.ok(
      ['TARGET_INSECURE', 'TARGET_INVALID', 'TARGET_HOST'].includes(
        codeOf(() => createSupabaseTarget({ url, expectedProjectRef: STAGING_REF })),
      ),
      `${url} must not be accepted`,
    );
  }
});

test('an unexpected port is refused', () => {
  assert.equal(codeOf(() => createSupabaseTarget({
    url: `https://${STAGING_REF}.supabase.co:8443`, expectedProjectRef: STAGING_REF,
  })), 'TARGET_PORT');
});

test('a query string or fragment is refused', () => {
  assert.equal(codeOf(() => createSupabaseTarget({
    url: `${STAGING_URL}/?x=1`, expectedProjectRef: STAGING_REF,
  })), 'TARGET_INVALID');
  assert.equal(codeOf(() => createSupabaseTarget({
    url: `${STAGING_URL}/#x`, expectedProjectRef: STAGING_REF,
  })), 'TARGET_INVALID');
});

test('a malformed URL is refused', () => {
  for (const url of ['not a url', 'https://', '://x', '   ']) {
    assert.ok(
      ['TARGET_INVALID', 'TARGET_MISSING'].includes(
        codeOf(() => createSupabaseTarget({ url, expectedProjectRef: STAGING_REF })),
      ),
      `${JSON.stringify(url)} must not be accepted`,
    );
  }
});

// --- fail closed on the expected ref ---------------------------------------

test('a remote target with no expected ref is refused', () => {
  // Silence is the mistake the module exists to catch, so it cannot be the
  // permissive case.
  assert.equal(codeOf(() => createSupabaseTarget({ url: STAGING_URL })), 'TARGET_REF_REQUIRED');
  assert.equal(codeOf(() => createSupabaseTarget({
    url: STAGING_URL, expectedProjectRef: '  ',
  })), 'TARGET_REF_REQUIRED');
});

test('a malformed expected ref is refused rather than coerced', () => {
  for (const ref of ['short', `${STAGING_REF}x`, 'UPPER_CASE_NOT_A_REF', 'has-a-dash-in-it!!']) {
    assert.ok(
      ['TARGET_REF_INVALID', 'TARGET_HOST'].includes(
        codeOf(() => createSupabaseTarget({ url: STAGING_URL, expectedProjectRef: ref })),
      ),
      `${ref} is not a project ref`,
    );
  }
});

// --- loopback --------------------------------------------------------------

test('a loopback literal is its own mode: no ref, any port, http allowed', () => {
  const target = createSupabaseTarget({ url: 'http://127.0.0.1:54321' });
  assert.equal(target.loopback, true);
  assert.equal(target.projectRef, null);
  assert.equal(target.origin, 'http://127.0.0.1:54321');
});

test('localhost is not a loopback literal', () => {
  // It resolves through the resolver, so what it reaches is not knowable here.
  assert.equal(codeOf(() => createSupabaseTarget({ url: 'http://localhost:54321' })), 'TARGET_INSECURE');
});

test('a forbidden name mapped onto loopback is still forbidden', () => {
  assert.equal(codeOf(() => createSupabaseTarget({
    url: `http://${PROD_REF}.supabase.co`, expectedProjectRef: STAGING_REF,
  })), 'TARGET_INSECURE');
});

// --- the ordering that actually protects the key ---------------------------

test('readConfig refuses the target before it reads the credential', () => {
  // The whole point of F-1: the key must still be an unread environment
  // variable when the refusal happens.
  let read = 0;
  const env = {
    SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
    TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF: STAGING_REF,
    get SUPABASE_SERVICE_ROLE_KEY() { read += 1; return 'service-role-secret'; },
    get SUPABASE_SECRET_KEY() { read += 1; return 'secret'; },
  };
  let thrown = null;
  try {
    readConfig(env);
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown?.code, 'TARGET_FORBIDDEN');
  assert.equal(read, 0, 'the credential must not have been read');
  assert.equal(/service-role-secret/.test(String(thrown?.message)), false);
});

test('readConfig accepts the authorized project and carries the descriptor', () => {
  const config = readConfig({
    SUPABASE_URL: `${STAGING_URL}/`,
    TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF: STAGING_REF,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  });
  assert.equal(config.url, STAGING_URL);
  assert.equal(config.target.projectRef, STAGING_REF);
  assert.equal(config.key, 'service-role-key');
});

test('readConfig still refuses a missing credential for an authorized target', () => {
  assert.throws(() => readConfig({
    SUPABASE_URL: STAGING_URL,
    TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF: STAGING_REF,
  }), /WORKER_MISCONFIGURED/);
});

test('the environment may add forbidden targets but not remove them', () => {
  const other = 'aaaabbbbccccddddeeee';
  assert.equal(codeOf(() => createSupabaseTarget({
    url: `https://${other}.supabase.co`,
    expectedProjectRef: other,
    forbiddenProjectRefs: other,
  })), 'TARGET_FORBIDDEN');
});

// --- the request-time gate -------------------------------------------------

test('no client may be built on a config that never went through readConfig', () => {
  // Fail closed: a descriptor-less config is a config whose target nobody
  // checked, so it gets no requests rather than unchecked ones.
  const bare = { url: STAGING_URL, key: 'k' };
  assert.rejects(
    () => createStorageClient(bare, async () => {}).download('a/b/c/d.jpg'),
    /WORKER_TARGET_UNVERIFIED/,
  );
  assert.rejects(
    () => createDbClient(bare, async () => {}).sweep(10),
    /WORKER_TARGET_UNVERIFIED/,
  );
});

test('the request URL is re-checked against the descriptor before every call', () => {
  // Configuration-time validation is not enough on its own: request URLs are
  // built by concatenation, and this is the check that runs at the moment the
  // credential would go on the wire.
  const target = staging();
  assert.equal(codeOf(() => assertAuthorizedUrl(
    `https://${PROD_REF}.supabase.co/rest/v1/rpc/x`, target,
  )), 'TARGET_HOST');
  assert.equal(codeOf(() => assertAuthorizedUrl(
    `https://${STAGING_REF}.supabase.co:8443/rest/v1/rpc/x`, target,
  )), 'TARGET_HOST');
  assert.equal(codeOf(() => assertAuthorizedUrl(
    `http://${STAGING_REF}.supabase.co/rest/v1/rpc/x`, target,
  )), 'TARGET_PROTOCOL');
  assert.equal(codeOf(() => assertAuthorizedUrl(
    `https://u:p@${STAGING_REF}.supabase.co/rest/v1/rpc/x`, target,
  )), 'TARGET_CREDENTIALS');
  // The authorized call still goes through.
  assert.equal(
    assertAuthorizedUrl(`${STAGING_URL}/rest/v1/rpc/x`, target).toString(),
    `${STAGING_URL}/rest/v1/rpc/x`,
  );
});

test('a credentialed request only ever reaches the authorized origin', async () => {
  const seen = [];
  const config = readConfig({
    SUPABASE_URL: STAGING_URL,
    TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF: STAGING_REF,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  });
  const fetchImpl = async (url) => {
    seen.push(url);
    return { status: 200, ok: true, text: async () => '{}' };
  };
  await createDbClient(config, fetchImpl).sweep(10);
  await createStorageClient(config, fetchImpl).remove(['a/b/c/d.jpg']);
  assert.equal(seen.length, 2);
  for (const url of seen) assert.ok(url.startsWith(`${STAGING_URL}/`), url);
});

test('an object name may not climb out of the bucket', async () => {
  const config = readConfig({
    SUPABASE_URL: STAGING_URL,
    TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF: STAGING_REF,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  });
  const storage = createStorageClient(config, async () => {
    throw new Error('the request must never be made');
  });
  for (const name of ['../../other-bucket/x.jpg', '/absolute.jpg', 'a/../../b.jpg', '']) {
    await assert.rejects(() => storage.download(name), /STORAGE_OBJECT_NAME_INVALID/);
  }
});

// --- the copy stays a copy -------------------------------------------------

test('the compiled policy still names Production exactly once', () => {
  // This file is the processor's copy of a policy the signer-renewer also
  // carries. The constants are pinned so the two cannot drift apart in silence.
  assert.deepEqual(COMPILED_FORBIDDEN_PROJECT_REFS, ['rcyuuoaqfwcembdajcss']);
  assert.deepEqual(COMPILED_FORBIDDEN_API_HOSTS, ['rcyuuoaqfwcembdajcss.supabase.co']);
  assert.ok(Object.isFrozen(COMPILED_FORBIDDEN_PROJECT_REFS));
  assert.ok(Object.isFrozen(COMPILED_FORBIDDEN_API_HOSTS));
});
