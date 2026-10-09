#!/usr/bin/env node
// Read-only inspection of a Cloud Run service through the REST APIs, for hosts where `gcloud run` is broken
// (the local gcloud runs on Python 3.9 and `gcloud run …` dies with CommandLoadFailure, while
// `gcloud auth print-access-token` still works).
//
//   node backend/torneos/infra/torneos-cloudrun-readonly/cloudrun-readonly.mjs \
//     --project arma2-465223 --region southamerica-east1 --service torneos-gateway \
//     [--logs-minutes 60] [--expect-traffic-revision <rev>] [--expect-digest sha256:<hex>] [--expect-env K=V]...
//
// Guarantees:
//   • it can only send the three requests in ALLOWED below (GET service, GET revisions, Logging entries:list);
//     anything else throws ReadOnlyViolation before a socket is opened;
//   • project, region and service are always explicit (the gcloud default project on this host is another one);
//   • the access token is never printed, logged or written; env values are shown only for the flag keys in
//     PLAIN_ENV, every other value is reduced to sha256 prefix + length, secrets to their Secret Manager reference;
//   • a non-2xx answer is an error, never an empty result: "0 5xx" always means the Logging API answered.
//   • the gateway never logs CORE_UNAVAILABLE: it answers it as a 503, so `503` per revision is its upper bound; a boot
//     refused by configuration (an unknown TORNEOS_SOCIAL_MODE / TORNEOS_PLAN_READ_MODE, a commerce fault…) is logged
//     once per instance as "[torneos-gateway] disabled: <reason>" and is counted as `bootDisabled` (any ⇒ failure).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export class ReadOnlyViolation extends Error {}
export class ApiError extends Error {}

const ID = /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/;
const REGION = /^[a-z]+-[a-z]+[0-9]$/;
const SERVICE = /^[a-z][a-z0-9-]{0,48}[a-z0-9]$/;
const PLAIN_ENV = new Set([
  'TORNEOS_PLAN_READ_MODE', 'TORNEOS_SOCIAL_MODE', 'TORNEOS_COMMERCE_MODE', 'TORNEOS_COMMERCE_DEPLOYMENT',
  'TORNEOS_CONNECTED_MODE', 'TORNEOS_BRANDING_MODE', 'TORNEOS_MEDIA_MODE',
  'TORNEOS_ALLOWED_ORIGIN', 'TORNEOS_GATEWAY_PUBLIC_URL',
]);
const COMMERCIAL_ENV = /COMMERCE|BILLING|MERCADO|(^|_)MP(_|$)|PAYMENT|CHECKOUT/i;

export function parseArgs(argv) {
  const opts = { expectEnv: [], logsMinutes: 60, maxLogEntries: 5000 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    const take = () => { if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`); i += 1; return value; };
    if (flag === '--project') opts.project = take();
    else if (flag === '--region') opts.region = take();
    else if (flag === '--service') opts.service = take();
    else if (flag === '--logs-minutes') opts.logsMinutes = Number(take());
    else if (flag === '--max-log-entries') opts.maxLogEntries = Number(take());
    else if (flag === '--expect-traffic-revision') opts.expectTrafficRevision = take();
    else if (flag === '--expect-digest') opts.expectDigest = take();
    else if (flag === '--expect-env') opts.expectEnv.push(take());
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!ID.test(opts.project || '')) throw new Error('--project is required (explicit; never the gcloud default)');
  if (!REGION.test(opts.region || '')) throw new Error('--region is required');
  if (!SERVICE.test(opts.service || '')) throw new Error('--service is required');
  if (!Number.isInteger(opts.logsMinutes) || opts.logsMinutes < 0 || opts.logsMinutes > 7 * 24 * 60) throw new Error('--logs-minutes out of range');
  if (!Number.isInteger(opts.maxLogEntries) || opts.maxLogEntries < 1 || opts.maxLogEntries > 50000) throw new Error('--max-log-entries out of range');
  for (const pair of opts.expectEnv) if (!/^[A-Z][A-Z0-9_]*=.*$/.test(pair)) throw new Error(`--expect-env ${pair}: use KEY=VALUE`);
  return opts;
}

export function allowedRequests({ project, region, service }) {
  const base = `https://run.googleapis.com/v2/projects/${project}/locations/${region}/services/${service}`;
  return [
    { method: 'GET', test: (url) => url === base },
    { method: 'GET', test: (url) => url.startsWith(`${base}/revisions?`) && /^pageSize=\d+(&pageToken=[A-Za-z0-9_\-=%.]+)?$/.test(url.slice(base.length + 11)) },
    { method: 'POST', test: (url) => url === 'https://logging.googleapis.com/v2/entries:list' },
  ];
}

export function createReadOnlyClient({ target, token, fetchImpl = globalThis.fetch }) {
  const allowed = allowedRequests(target);
  return async function request(method, url, body) {
    if (!allowed.some((rule) => rule.method === method && rule.test(url))) {
      throw new ReadOnlyViolation(`refused ${method} ${url}`);
    }
    const response = await fetchImpl(url, {
      method,
      redirect: 'error',
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    if (!response.ok) throw new ApiError(`${method} ${new URL(url).pathname} → HTTP ${response.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  };
}

const short = (value) => `sha256:${createHash('sha256').update(String(value)).digest('hex').slice(0, 12)} len=${String(value).length}`;
const digestOf = (image) => (/@(sha256:[0-9a-f]{64})$/.exec(image || '') || [])[1] || null;

export function summarizeEnv(env = []) {
  return env.map((entry) => {
    if (entry.valueSource?.secretKeyRef) {
      const ref = entry.valueSource.secretKeyRef;
      return { name: entry.name, secret: `${String(ref.secret).split('/').pop()}@${ref.version}` };
    }
    if (PLAIN_ENV.has(entry.name)) return { name: entry.name, value: entry.value ?? '' };
    return { name: entry.name, value: short(entry.value ?? '') };
  });
}

function summarizeContainer(container = {}) {
  return {
    image: container.image,
    digest: digestOf(container.image),
    resources: container.resources ? {
      limits: container.resources.limits, cpuIdle: container.resources.cpuIdle, startupCpuBoost: container.resources.startupCpuBoost,
    } : null,
    env: summarizeEnv(container.env),
  };
}

export function summarizeService(service) {
  const container = summarizeContainer(service.template?.containers?.[0]);
  return {
    name: service.name,
    uri: service.uri,
    urls: service.urls,
    generation: service.generation,
    observedGeneration: service.observedGeneration,
    etag: service.etag,
    ingress: service.ingress,
    invokerIamDisabled: service.invokerIamDisabled === true,
    latestReadyRevision: service.latestReadyRevision?.split('/').pop(),
    latestCreatedRevision: service.latestCreatedRevision?.split('/').pop(),
    terminalCondition: service.terminalCondition ? { type: service.terminalCondition.type, state: service.terminalCondition.state } : null,
    traffic: (service.traffic || []).map(({ type, revision, percent, tag }) => ({ type, revision, percent: percent ?? 0, tag })),
    trafficStatuses: (service.trafficStatuses || []).map(({ type, revision, percent, tag, uri }) => ({ type, revision, percent: percent ?? 0, tag, uri })),
    template: {
      serviceAccount: service.template?.serviceAccount,
      scaling: service.template?.scaling,
      maxInstanceRequestConcurrency: service.template?.maxInstanceRequestConcurrency,
      timeout: service.template?.timeout,
      executionEnvironment: service.template?.executionEnvironment,
      labels: service.template?.labels,
      container,
    },
    commercialEnv: container.env.filter((entry) => COMMERCIAL_ENV.test(entry.name)).map((entry) => entry.name),
  };
}

export function summarizeRevision(revision) {
  const container = summarizeContainer(revision.containers?.[0]);
  const flags = Object.fromEntries(container.env.filter((entry) => PLAIN_ENV.has(entry.name) && entry.name !== 'TORNEOS_GATEWAY_PUBLIC_URL' && entry.name !== 'TORNEOS_ALLOWED_ORIGIN').map((entry) => [entry.name, entry.value]));
  return {
    name: revision.name?.split('/').pop(),
    createTime: revision.createTime,
    digest: container.digest,
    envCount: container.env.length,
    flags,
    ready: (revision.conditions || []).find((c) => c.type === 'Ready')?.state ?? null,
  };
}

export async function listRevisions(request, target, limit = 20) {
  const base = `https://run.googleapis.com/v2/projects/${target.project}/locations/${target.region}/services/${target.service}/revisions`;
  const out = [];
  let pageToken = '';
  do {
    const page = await request('GET', `${base}?pageSize=${Math.min(limit, 100)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    out.push(...(page.revisions || []).map(summarizeRevision));
    pageToken = page.nextPageToken || '';
  } while (pageToken && out.length < limit);
  return out.sort((a, b) => String(b.createTime).localeCompare(String(a.createTime))).slice(0, limit);
}

export async function countRequests(request, target, { minutes, maxEntries, now = new Date() }) {
  const since = new Date(now.getTime() - minutes * 60000).toISOString();
  const filter = [
    'resource.type="cloud_run_revision"',
    `resource.labels.service_name="${target.service}"`,
    `resource.labels.location="${target.region}"`,
    `timestamp>="${since}"`,
    'httpRequest.status>0',
  ].join(' AND ');
  const byRevision = {};
  let total = 0;
  let pageToken;
  let truncated = false;
  do {
    const page = await request('POST', 'https://logging.googleapis.com/v2/entries:list', {
      resourceNames: [`projects/${target.project}`], filter, orderBy: 'timestamp desc', pageSize: 1000,
      ...(pageToken ? { pageToken } : {}),
    });
    for (const entry of page.entries || []) {
      const revision = entry.resource?.labels?.revision_name || 'unknown';
      const status = Number(entry.httpRequest?.status) || 0;
      const bucket = (byRevision[revision] ||= { requests: 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, '503': 0 });
      bucket.requests += 1;
      const klass = `${Math.floor(status / 100)}xx`;
      if (klass in bucket) bucket[klass] += 1;
      if (status === 503) bucket['503'] += 1;
      total += 1;
    }
    pageToken = page.nextPageToken;
    if (pageToken && total >= maxEntries) { truncated = true; break; }
  } while (pageToken);
  const fiveXx = Object.values(byRevision).reduce((sum, b) => sum + b['5xx'], 0);
  const serviceUnavailable = Object.values(byRevision).reduce((sum, b) => sum + b['503'], 0);
  // Boot faults: the reason is a fixed configuration message (never a value), safe to report.
  const boot = await request('POST', 'https://logging.googleapis.com/v2/entries:list', {
    resourceNames: [`projects/${target.project}`],
    filter: [
      'resource.type="cloud_run_revision"',
      `resource.labels.service_name="${target.service}"`,
      `resource.labels.location="${target.region}"`,
      `timestamp>="${since}"`,
      'textPayload:"[torneos-gateway] disabled:"',
    ].join(' AND '),
    orderBy: 'timestamp desc', pageSize: 50,
  });
  const bootDisabled = (boot.entries || []).map((entry) => ({
    revision: entry.resource?.labels?.revision_name || 'unknown',
    reason: String(entry.textPayload || '').replace(/^.*\[torneos-gateway\] disabled: /, '').slice(0, 120),
  }));
  return { since, minutes, total, fiveXx, serviceUnavailable, bootDisabled, truncated, byRevision };
}

export function checkExpectations(summary, opts) {
  const failures = [];
  const served = summary.service.trafficStatuses.filter((t) => t.percent > 0);
  if (opts.expectTrafficRevision) {
    const ok = served.length === 1 && served[0].revision === opts.expectTrafficRevision && served[0].percent === 100
      && summary.service.traffic.every((t) => t.percent === 0 || t.type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION');
    if (!ok) failures.push(`traffic is not 100 % pinned to ${opts.expectTrafficRevision}`);
  }
  if (opts.expectDigest && summary.service.template.container.digest !== opts.expectDigest) {
    failures.push(`template digest ${summary.service.template.container.digest} ≠ ${opts.expectDigest}`);
  }
  for (const pair of opts.expectEnv) {
    const [key, ...rest] = pair.split('=');
    const expected = rest.join('=');
    const entry = summary.service.template.container.env.find((e) => e.name === key);
    const actual = entry ? (entry.secret ? `secret:${entry.secret}` : entry.value) : '<absent>';
    if (expected === '<absent>' ? Boolean(entry) : actual !== expected) failures.push(`env ${key}=${actual}, expected ${expected}`);
  }
  if (summary.service.commercialEnv.length) failures.push(`commercial env present: ${summary.service.commercialEnv.join(', ')}`);
  if (summary.logs?.fiveXx) failures.push(`${summary.logs.fiveXx} responses ≥ 500 in the last ${summary.logs.minutes} min`);
  if (summary.logs?.bootDisabled?.length) failures.push(`gateway boot disabled ${summary.logs.bootDisabled.length}× (${[...new Set(summary.logs.bootDisabled.map((b) => b.reason))].join('; ')})`);
  return failures;
}

export function accessTokenFromGcloud(exec = execFileSync) {
  // `gcloud auth print-access-token` works with Python 3.9; only the `run` command group is broken.
  const token = String(exec('gcloud', ['auth', 'print-access-token'], { stdio: ['ignore', 'pipe', 'ignore'] })).trim();
  if (!/^[A-Za-z0-9._\-]{20,}$/.test(token)) throw new Error('gcloud did not return an access token (run `gcloud auth login`)');
  return token;
}

export async function inspect(opts, { token, fetchImpl, now } = {}) {
  const target = { project: opts.project, region: opts.region, service: opts.service };
  const request = createReadOnlyClient({ target, token, fetchImpl });
  const service = summarizeService(await request('GET',
    `https://run.googleapis.com/v2/projects/${target.project}/locations/${target.region}/services/${target.service}`));
  const revisions = await listRevisions(request, target);
  const logs = opts.logsMinutes > 0 ? await countRequests(request, target, { minutes: opts.logsMinutes, maxEntries: opts.maxLogEntries, now }) : null;
  const summary = { readAt: (now || new Date()).toISOString(), target, service, revisions, logs };
  summary.failures = checkExpectations(summary, opts);
  return summary;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const summary = await inspect(opts, { token: accessTokenFromGcloud() });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exitCode = summary.failures.length ? 1 : 0;
  } catch (error) {
    process.stderr.write(`cloudrun-readonly: ${error.message}\n`);
    process.exitCode = 2;
  }
}
