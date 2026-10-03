import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ApiError,
  ReadOnlyViolation,
  accessTokenFromGcloud,
  createReadOnlyClient,
  inspect,
  parseArgs,
} from './cloudrun-readonly.mjs';

const TARGET = ['--project', 'arma2-465223', '--region', 'southamerica-east1', '--service', 'torneos-gateway'];
const BASE = 'https://run.googleapis.com/v2/projects/arma2-465223/locations/southamerica-east1/services/torneos-gateway';
const DIGEST = `sha256:${'d'.repeat(64)}`;
const TOKEN = 'ya29.FAKE-ACCESS-TOKEN-never-printed-0123456789';
const SECRET_LOOKING = 'eyJhbGciOiJIUzI1NiJ9.fake-anon-key-value';

const service = {
  name: 'projects/arma2-465223/locations/southamerica-east1/services/torneos-gateway',
  uri: 'https://torneos-gateway-7fnauuvvxa-rj.a.run.app',
  generation: '4',
  observedGeneration: '4',
  etag: '"abc"',
  ingress: 'INGRESS_TRAFFIC_ALL',
  invokerIamDisabled: true,
  latestReadyRevision: `${BASE}/revisions/torneos-gateway-00003-b78`,
  latestCreatedRevision: `${BASE}/revisions/torneos-gateway-00003-b78`,
  terminalCondition: { type: 'Ready', state: 'CONDITION_SUCCEEDED' },
  traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'torneos-gateway-00003-b78', percent: 100 }],
  trafficStatuses: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'torneos-gateway-00003-b78', percent: 100 }],
  template: {
    serviceAccount: 'torneos-gateway-prod@arma2-465223.iam.gserviceaccount.com',
    scaling: { minInstanceCount: 0, maxInstanceCount: 3 },
    containers: [{
      image: `southamerica-east1-docker.pkg.dev/arma2-465223/torneos-gateway/gateway@${DIGEST}`,
      env: [
        { name: 'TORNEOS_PLAN_READ_MODE', value: 'on' },
        { name: 'TORNEOS_ANON_KEY', value: SECRET_LOOKING },
        { name: 'TORNEOS_BRIDGE_KEYS', valueSource: { secretKeyRef: { secret: 'projects/1/secrets/torneos-gw-shadow-bridge-keys', version: '1' } } },
      ],
    }],
  },
};

function fakeFetch({ entries = [], svc = service, failLogs = false, bootEntries = [] } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.authorization, body: init.body });
    if (url === BASE) return new Response(JSON.stringify(svc), { status: 200 });
    if (url.startsWith(`${BASE}/revisions?`)) {
      return new Response(JSON.stringify({ revisions: [{ name: `${BASE}/revisions/torneos-gateway-00003-b78`, createTime: '2026-10-02T15:30:00Z', containers: svc.template.containers, conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }] }] }), { status: 200 });
    }
    if (url === 'https://logging.googleapis.com/v2/entries:list') {
      if (failLogs) return new Response('{"error":{"code":403}}', { status: 403 });
      if (JSON.parse(init.body).filter.includes('textPayload:"[torneos-gateway] disabled:"')) return new Response(JSON.stringify({ entries: bootEntries }), { status: 200 });
      return new Response(JSON.stringify({ entries }), { status: 200 });
    }
    return new Response('nope', { status: 404 });
  };
  return { impl, calls };
}

const entry = (status, revision = 'torneos-gateway-00003-b78') => ({ resource: { labels: { revision_name: revision } }, httpRequest: { status } });

test('target must be explicit: no default project, region or service', () => {
  assert.throws(() => parseArgs([]), /--project is required/);
  assert.throws(() => parseArgs(['--project', 'arma2-465223', '--region', 'southamerica-east1']), /--service is required/);
  assert.throws(() => parseArgs([...TARGET, '--patch']), /unknown argument/);
  assert.deepEqual(parseArgs([...TARGET, '--expect-env', 'TORNEOS_SOCIAL_MODE=<absent>']).expectEnv, ['TORNEOS_SOCIAL_MODE=<absent>']);
});

test('the client refuses every request outside the three read endpoints, before any fetch', async () => {
  const { impl, calls } = fakeFetch();
  const request = createReadOnlyClient({ target: parseArgs(TARGET), token: TOKEN, fetchImpl: impl });
  for (const [method, url] of [
    ['PATCH', BASE], ['DELETE', BASE], ['POST', BASE], ['POST', `${BASE}:setIamPolicy`],
    ['GET', `${BASE.replace('torneos-gateway', 'tgw-sp-g1')}`], ['GET', `${BASE}/revisions/x`],
    ['GET', `${BASE}/revisions?pageSize=10&filter=x`], ['POST', 'https://logging.googleapis.com/v2/entries:write'],
    ['GET', 'https://run.googleapis.com/v2/projects/ruko-493223/locations/southamerica-east1/services/torneos-gateway'],
  ]) {
    await assert.rejects(request(method, url), ReadOnlyViolation, `${method} ${url}`);
  }
  assert.equal(calls.length, 0);
});

test('inspect: summary pins traffic, digest and flags; no token or env value leaks into the output', async () => {
  const { impl, calls } = fakeFetch({ entries: [entry(200), entry(200), entry(404), entry(503)] });
  const summary = await inspect(parseArgs([...TARGET, '--expect-traffic-revision', 'torneos-gateway-00003-b78',
    '--expect-digest', DIGEST, '--expect-env', 'TORNEOS_PLAN_READ_MODE=on', '--expect-env', 'TORNEOS_SOCIAL_MODE=<absent>']),
  { token: TOKEN, fetchImpl: impl, now: new Date('2026-10-02T18:00:00Z') });
  const text = JSON.stringify(summary);
  assert.ok(!text.includes(TOKEN) && !text.includes(SECRET_LOOKING), 'no secret material in the output');
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'GET', 'POST', 'POST']);
  assert.equal(summary.logs.serviceUnavailable, 1, 'CORE_UNAVAILABLE upper bound = the 503s');
  assert.deepEqual(summary.logs.bootDisabled, []);
  assert.ok(calls.every((c) => c.auth === `Bearer ${TOKEN}`));
  assert.equal(summary.service.template.container.digest, DIGEST);
  assert.deepEqual(summary.service.template.container.env.map((e) => e.secret || e.value.split(' ')[0]),
    ['on', 'sha256:' + summary.service.template.container.env[1].value.slice(7, 19), 'torneos-gw-shadow-bridge-keys@1']);
  assert.deepEqual(summary.revisions[0].flags, { TORNEOS_PLAN_READ_MODE: 'on' });
  assert.deepEqual(summary.logs.byRevision['torneos-gateway-00003-b78'], { requests: 4, '2xx': 2, '3xx': 0, '4xx': 1, '5xx': 1, 503: 1 });
  assert.equal(summary.logs.since, '2026-10-02T17:00:00.000Z');
  assert.match(JSON.parse(calls[2].body).filter, /service_name="torneos-gateway".*location="southamerica-east1"/);
  assert.deepEqual(summary.failures, ['1 responses ≥ 500 in the last 60 min']);
});

test('expectations fail closed: other revision, other digest, missing flag, commercial env', async () => {
  const svc = structuredClone(service);
  svc.trafficStatuses = [{ revision: 'torneos-gateway-00002-skw', percent: 100 }];
  svc.template.containers[0].env.push({ name: 'TORNEOS_COMMERCE_MODE', value: 'test' });
  const { impl } = fakeFetch({ svc });
  const summary = await inspect(parseArgs([...TARGET, '--logs-minutes', '0', '--expect-traffic-revision', 'torneos-gateway-00003-b78',
    '--expect-digest', `sha256:${'e'.repeat(64)}`, '--expect-env', 'TORNEOS_SOCIAL_MODE=on']), { token: TOKEN, fetchImpl: impl });
  assert.equal(summary.logs, null);
  assert.equal(summary.failures.length, 4);
  assert.match(summary.failures.join('\n'), /not 100 % pinned.*\n.*digest.*\n.*TORNEOS_SOCIAL_MODE=<absent>, expected on\n.*commercial env present: TORNEOS_COMMERCE_MODE/);
});

test('an API error is an error, never an empty log window', async () => {
  const { impl } = fakeFetch({ failLogs: true });
  await assert.rejects(inspect(parseArgs(TARGET), { token: TOKEN, fetchImpl: impl }), ApiError);
});

test('the token comes from `gcloud auth print-access-token` and is validated', () => {
  assert.equal(accessTokenFromGcloud(() => `${TOKEN}\n`), TOKEN);
  assert.throws(() => accessTokenFromGcloud(() => 'ERROR: (gcloud) reauth required'), /did not return an access token/);
});

test('a gateway boot refused by configuration (e.g. an unknown TORNEOS_SOCIAL_MODE) fails the inspection with its reason', async () => {
  const { impl } = fakeFetch({ bootEntries: [
    { resource: { labels: { revision_name: 'torneos-gateway-00005-xyz' } }, textPayload: '[torneos-gateway] disabled: TORNEOS_SOCIAL_MODE must be on or off' },
    { resource: { labels: { revision_name: 'torneos-gateway-00005-xyz' } }, textPayload: '[torneos-gateway] disabled: TORNEOS_SOCIAL_MODE must be on or off' },
  ] });
  const summary = await inspect(parseArgs(TARGET), { token: TOKEN, fetchImpl: impl, now: new Date('2026-10-02T18:00:00Z') });
  assert.deepEqual(summary.failures, ['gateway boot disabled 2× (TORNEOS_SOCIAL_MODE must be on or off)']);
  assert.equal(summary.logs.bootDisabled[0].revision, 'torneos-gateway-00005-xyz');
});
