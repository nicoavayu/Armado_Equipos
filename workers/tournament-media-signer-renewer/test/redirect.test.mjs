/**
 * Redirects, tested against real HTTP servers rather than a stubbed fetch.
 *
 * The property under test is not "the renewer reports an error". It is that the
 * attestation secret never reaches the host a `Location` header names. A stubbed
 * fetch cannot demonstrate that — only a second server that is running, is
 * reachable, and records everything it receives can, by receiving nothing.
 *
 * So every test here starts two servers on loopback:
 *
 *   sink        the redirect target. It records every request. Its record must
 *               stay empty. If a single byte of the attestation secret ever
 *               reaches it, `sink.requests` is non-empty and the test fails.
 *   redirector  the authorized host, which answers 3xx.
 *
 * All four redirect statuses are covered because they are not equivalent: 301
 * and 302 historically let clients rewrite POST to GET, while 307 and 308
 * require the method AND the body — and therefore the headers — to be replayed
 * verbatim. 307/308 are the dangerous pair, and they are the reason
 * `redirect: 'error'` is set rather than merely inspecting `response.redirected`
 * after the fact: by the time a response object exists, the credential has
 * already been sent.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { createLogger, renewOnce, secretValues } from '../src/renewer.mjs';
import {
  TargetError, assertAuthorizedUrl, createTarget, fetchAuthorized,
} from '../src/target.mjs';
import { okHealthBody, testConfig } from './fixtures.mjs';

const SECRET = 'attestation-secret-that-must-never-travel-onward';
const APIKEY = 'apikey-fixture-value-0123456789';
const BEARER = 'bearer-jwt-fixture-value-0123456789';

/** A server that records what it received and answers however the test says. */
async function startServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ url: req.url, method: req.method, headers: req.headers, body });
      handler(req, res);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    requests,
    port,
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const signerPath = '/functions/v1/tournament-media-signer';

const configFor = (origin) => {
  const target = createTarget({ origin, functionName: 'tournament-media-signer' });
  return testConfig({
    target,
    healthUrl: target.url,
    apikey: APIKEY,
    authorizationJwt: BEARER,
    attestationSecret: SECRET,
    timeoutMs: 3000,
  });
};

/** Every credential this process holds, as raw strings, for leak assertions. */
const credentials = [SECRET, APIKEY, BEARER];

const assertNoCredential = (text, label) => {
  for (const value of credentials) {
    assert.ok(!String(text).includes(value), `${label} leaked a credential`);
  }
};

for (const status of [301, 302, 307, 308]) {
  test(`a ${status} redirect is refused and no credential reaches the redirect target`, async () => {
    const sink = await startServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(okHealthBody()));
    });
    const redirector = await startServer((req, res) => {
      res.writeHead(status, { location: `${sink.origin}${signerPath}` });
      res.end();
    });
    try {
      const result = await renewOnce(configFor(redirector.origin));

      assert.equal(result.ok, false);
      assert.equal(result.code, 'SIGNER_REDIRECTED');
      // The whole point: the second host was live and willing, and got nothing.
      assert.equal(sink.requests.length, 0,
        `the ${status} target received a request; the secret may have been forwarded`);
      // The authorized host did get exactly one, so the harness is real.
      assert.equal(redirector.requests.length, 1);
      assert.equal(redirector.requests[0].headers['x-media-attestation-secret'], SECRET);
      // And nothing that came back names a credential.
      assertNoCredential(result.detail ?? '', 'the redirect error detail');
      assertNoCredential(JSON.stringify(result), 'the redirect result');
    } finally {
      await redirector.close();
      await sink.close();
    }
  });
}

test('a redirect chain is refused at the first hop, so no intermediate host is contacted', async () => {
  const sink = await startServer((req, res) => { res.writeHead(200); res.end('{}'); });
  const second = await startServer((req, res) => {
    res.writeHead(302, { location: `${sink.origin}${signerPath}` });
    res.end();
  });
  const first = await startServer((req, res) => {
    res.writeHead(302, { location: `${second.origin}${signerPath}` });
    res.end();
  });
  try {
    const result = await renewOnce(configFor(first.origin));
    assert.equal(result.code, 'SIGNER_REDIRECTED');
    assert.equal(second.requests.length, 0, 'the first redirect hop must not be followed');
    assert.equal(sink.requests.length, 0);
  } finally {
    await first.close();
    await second.close();
    await sink.close();
  }
});

test('the same server answering normally still works, so the refusal is specific', async () => {
  const signer = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(okHealthBody()));
  });
  try {
    const result = await renewOnce(configFor(signer.origin));
    assert.equal(result.ok, true, 'a non-redirecting host must still be reachable');
    assert.equal(result.release, '0.1.0');
    assert.equal(signer.requests.length, 1);
    // The credentials do travel to the AUTHORIZED host — that is the job.
    const sent = signer.requests[0];
    assert.equal(sent.headers.apikey, APIKEY);
    assert.equal(sent.headers.authorization, `Bearer ${BEARER}`);
    assert.equal(sent.headers['x-media-attestation-secret'], SECRET);
    // ...and never in the URL or the body.
    assertNoCredential(sent.url, 'the request URL');
    assertNoCredential(sent.body, 'the request body');
  } finally {
    await signer.close();
  }
});

test('an injected fetch that followed a redirect on its own is still refused', async () => {
  // A caller may supply `fetchImpl`. If that implementation followed the
  // redirect itself, `redirect: 'error'` never got a say, so the resolved
  // response is checked as well.
  const config = configFor('http://127.0.0.1:1');
  const followed = await renewOnce(config, {
    fetchImpl: async () => ({ status: 200, redirected: true, json: async () => okHealthBody() }),
  });
  assert.equal(followed.code, 'SIGNER_REDIRECTED');

  // And a 3xx surfaced as a resolved response, which `redirect: 'manual'`
  // semantics would produce.
  const manual = await renewOnce(config, {
    fetchImpl: async () => ({ status: 302, redirected: false, json: async () => ({}) }),
  });
  assert.equal(manual.code, 'SIGNER_REDIRECTED');
});

test('a redirect is not retried, so the credentials are offered exactly once', async () => {
  const sink = await startServer((req, res) => { res.writeHead(200); res.end('{}'); });
  const redirector = await startServer((req, res) => {
    res.writeHead(307, { location: `${sink.origin}${signerPath}` });
    res.end();
  });
  try {
    const { renewWithRetries } = await import('../src/renewer.mjs');
    const config = configFor(redirector.origin);
    const result = await renewWithRetries(
      { ...config, maxAttempts: 4 },
      { sleep: async () => 'elapsed' },
    );
    assert.equal(result.code, 'SIGNER_REDIRECTED');
    assert.equal(result.attempt, 1, 'a redirect is configuration or compromise, never transient');
    assert.equal(redirector.requests.length, 1);
    assert.equal(sink.requests.length, 0);
  } finally {
    await redirector.close();
    await sink.close();
  }
});

// --- target validation, before any I/O --------------------------------------

test('the URL is re-validated against the descriptor immediately before the call', () => {
  const target = createTarget({
    origin: 'https://stagingref0000000000.supabase.co',
    functionName: 'tournament-media-signer',
    projectRef: 'stagingref0000000000',
    forbiddenProjectRefs: ['prodref00000000000000'],
  });
  const rejects = (url, code) => assert.throws(
    () => assertAuthorizedUrl(url, target),
    (error) => error instanceof TargetError && error.code === code,
    `${url} should have been refused with ${code}`,
  );

  assert.equal(assertAuthorizedUrl(target.url, target).href, target.url);
  rejects('http://stagingref0000000000.supabase.co/functions/v1/tournament-media-signer', 'SIGNER_TARGET_PROTOCOL');
  rejects('https://evil.example/functions/v1/tournament-media-signer', 'SIGNER_TARGET_HOST');
  rejects('https://stagingref0000000000.supabase.co:8443/functions/v1/tournament-media-signer', 'SIGNER_TARGET_HOST');
  rejects('https://stagingref0000000000.supabase.co/functions/v1/other-function', 'SIGNER_TARGET_PATH');
  rejects('https://stagingref0000000000.supabase.co/functions/v1/tournament-media-signer?x=1', 'SIGNER_TARGET_PATH');
  rejects('https://user:pass@stagingref0000000000.supabase.co/functions/v1/tournament-media-signer', 'SIGNER_TARGET_CREDENTIALS');
});

test('production stays blocked by ref and by host, in the descriptor and at call time', () => {
  assert.throws(
    () => createTarget({
      origin: 'https://prodref00000000000000.supabase.co',
      functionName: 'tournament-media-signer',
      projectRef: 'prodref00000000000000',
      forbiddenProjectRefs: ['prodref00000000000000'],
    }),
    (error) => error instanceof TargetError && error.code === 'SIGNER_TARGET_FORBIDDEN',
  );
  assert.throws(
    () => createTarget({
      origin: 'https://prod.example.com',
      functionName: 'tournament-media-signer',
      forbiddenHosts: ['prod.example.com'],
    }),
    (error) => error instanceof TargetError && error.code === 'SIGNER_TARGET_FORBIDDEN',
  );
});

test('a plain-http target is refused unless it is a loopback literal', () => {
  assert.throws(
    () => createTarget({ origin: 'http://staging.example.com', functionName: 'tournament-media-signer' }),
    (error) => error instanceof TargetError && error.code === 'SIGNER_TARGET_INSECURE',
  );
  // `localhost` is a name the resolver answers, not a literal, so it does not
  // qualify for the loopback exception.
  assert.throws(
    () => createTarget({ origin: 'http://localhost:9999', functionName: 'tournament-media-signer' }),
    (error) => error instanceof TargetError && error.code === 'SIGNER_TARGET_INSECURE',
  );
  assert.equal(
    createTarget({ origin: 'http://127.0.0.1:9999', functionName: 'tournament-media-signer' }).protocol,
    'http:',
  );
});

test('fetchAuthorized refuses to run at all without a descriptor', async () => {
  await assert.rejects(
    () => fetchAuthorized('https://example.invalid/functions/v1/tournament-media-signer', {}),
    (error) => error instanceof TargetError && error.code === 'SIGNER_TARGET_INVALID',
  );
});

// --- nothing credential-shaped in the log stream ----------------------------

test('a redirect refusal logs nothing that names a credential', async () => {
  const sink = await startServer((req, res) => { res.writeHead(200); res.end('{}'); });
  const redirector = await startServer((req, res) => {
    res.writeHead(308, { location: `${sink.origin}${signerPath}` });
    res.end();
  });
  try {
    const config = configFor(redirector.origin);
    const lines = [];
    const log = createLogger({ write: (line) => lines.push(line), secrets: secretValues(config) });
    const { runRenewalCycle, createRenewerState } = await import('../src/renewer.mjs');
    await runRenewalCycle({
      state: createRenewerState(),
      config,
      deps: { log, sleep: async () => 'elapsed' },
    });
    const transcript = lines.join('\n');
    assert.ok(transcript.length > 0, 'the cycle must actually have logged something');
    assertNoCredential(transcript, 'the log transcript');
    assert.doesNotMatch(transcript, /"headers"/, 'no header container may be logged');
    assert.doesNotMatch(transcript, /Bearer\s+bearer-jwt/i);
    assert.match(transcript, /SIGNER_REDIRECTED/, 'the refusal must still be reported');
    assert.equal(sink.requests.length, 0);
  } finally {
    await redirector.close();
    await sink.close();
  }
});
