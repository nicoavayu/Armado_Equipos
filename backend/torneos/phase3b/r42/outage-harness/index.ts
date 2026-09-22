// R4.2 outage harness: the REAL certified gateway modules (handle, CoreClient, token, db, config)
// executed in the certified Edge runtime with --network none and NO secret: only the Core HTTP
// responses are stubbed (fetch) so the contract-specific fail-closed branches that cannot be
// provoked on the live Core staging (5xx, timeout, stale, malformed, schema, inactive) are
// exercised on the same code and bundle sources. The dummy HMAC never signs anything that leaves
// this isolate (there is no network). The dummy database URL points at a closed loopback port.
const report: any = {schema: 'R4.2.outage.v1', tests: [], network: 'none', secrets: 'none'};
function assert(ok: unknown, detail?: unknown) { if (!ok) throw new Error('ASSERT ' + JSON.stringify(detail ?? null)); }
async function test(name: string, fn: () => Promise<unknown>) {
  try { report.tests.push({name, pass: true, detail: await fn()}); }
  catch (e) { report.tests.push({name, pass: false, error: e instanceof Error ? e.message.slice(0, 300) : 'Error'}); }
}
const pem = (buf: ArrayBuffer, label: string) => `-----BEGIN ${label}-----\n${btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/(.{64})/g, '$1\n')}\n-----END ${label}-----\n`;
const kp = await crypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
const bridge = {keys: [{kid: 'r42-outage', privateKey: pem(await crypto.subtle.exportKey('pkcs8', kp.privateKey), 'PRIVATE KEY'), publicKey: {kty: 'RSA', n: jwk.n, e: jwk.e}}], activeKid: 'r42-outage', trustedKids: ['r42-outage']};
const CORE = 'https://hhyvmhgpapyuzjgxfnqv.supabase.co';
const env: Record<string, string> = {
  TORNEOS_GATEWAY_PUBLIC_URL: 'http://127.0.0.1:58431/torneos-gateway', TORNEOS_ALLOWED_ORIGIN: 'http://127.0.0.1:58431',
  CORE_AUTH_URL: `${CORE}/auth/v1`, CORE_JWT_ISSUER: `${CORE}/auth/v1`, CORE_CONTRACT_URL: `${CORE}/functions/v1/torneos-core-contract`,
  TORNEOS_CONTRACT_SERVICE_SECRET: '0'.repeat(64), CORE_ANON_KEY: 'r42-outage-dummy-anon',
  TORNEOS_REST_URL: 'http://torneos-rest:3000',
  TORNEOS_DB_IDENTITY_WRITER_URL: 'postgres://r42:r42@127.0.0.1:1/postgres', TORNEOS_DB_CORE_ADAPTER_URL: 'postgres://r42:r42@127.0.0.1:1/postgres',
  TORNEOS_BRIDGE_KEYS: JSON.stringify(bridge),
};
Deno.env.toObject = () => ({...env});
const {issueToken} = await import('../../gateway/token.ts');
const identity = {id: crypto.randomUUID(), core_user_id: crypto.randomUUID()};
const sessionId = crypto.randomUUID();
// The bridge bearer lives TTL = 120 s; every DB-unreachable branch waits for the driver's connect timeout,
// so a long sequence of tests outlives one token. Re-issue when older than 60 s (same identity/session).
let bearer = await issueToken(bridge, identity, sessionId), bearerAt = Date.now();
async function currentBearer(): Promise<string> { if (Date.now() - bearerAt > 60_000) { bearer = await issueToken(bridge, identity, sessionId); bearerAt = Date.now(); } return bearer; }
// Capture the real handler: the certified index.ts calls Deno.serve(handle) at import.
let handle: ((req: Request) => Promise<Response>) | null = null;
const realServe = Deno.serve;
(Deno as any).serve = (h: any) => { handle = typeof h === 'function' ? h : h?.handler ?? null; return {}; };
try { await import('../../gateway/index.ts'); } finally { (Deno as any).serve = realServe; }
assert(handle, 'handler captured');
// Stubbed Core/REST transport. Anything not matched is refused (there is no network anyway).
type Scenario = {health?: number; user?: number; session?: 'active' | 'inactive' | 'stale' | 'future' | 'malformed' | 'schema' | 'timeout' | 'transport' | number | {checkedAtOffset: number}; rest?: 'throw' | number};
let scenario: Scenario = {};
const calls: string[] = [];
const now = () => Math.floor(Date.now() / 1000);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
(globalThis as any).fetch = async (input: any, init: any = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  calls.push(url.pathname);
  if (url.origin !== CORE && url.origin !== 'http://torneos-rest:3000') throw new TypeError('R42_NO_NETWORK ' + url.origin);
  if (url.pathname === '/auth/v1/health') return json(scenario.health ?? 200, {});
  if (url.pathname === '/auth/v1/user') return json(scenario.user ?? 200, {id: identity.core_user_id, is_anonymous: false});
  if (url.pathname === '/functions/v1/torneos-core-contract/v1/session') {
    const s = scenario.session ?? 'active';
    if (typeof s === 'number') return json(s, {error: 'X'});
    // Integer-second verdict from a Core clock `checkedAtOffset` seconds away from this isolate's clock (Core truncates).
    if (typeof s === 'object') return json(200, {active: true, checked_at: now() + s.checkedAtOffset});
    if (s === 'transport') throw new TypeError('connection reset');
    if (s === 'timeout') return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal.reason ?? new DOMException('aborted', 'AbortError'))));
    if (s === 'malformed') return new Response('{"active":', {status: 200, headers: {'content-type': 'application/json'}});
    if (s === 'schema') return json(200, {active: true, checked_at: now(), extra: 1});
    if (s === 'stale') return json(200, {active: true, checked_at: now() - 10});
    if (s === 'future') return json(200, {active: true, checked_at: now() + 10});
    return json(200, {active: s === 'active', checked_at: now()});
  }
  if (url.origin === 'http://torneos-rest:3000') { if (scenario.rest === 'throw') throw new TypeError('R42_REST_DOWN'); return json(scenario.rest ?? 200, []); }
  throw new TypeError('R42_UNEXPECTED ' + url.pathname);
};
const H = {'x-forwarded-host': '127.0.0.1:58431'};
const rpc = async (name: string, token?: string, body = '{}') => handle!(new Request(`http://127.0.0.1:58431/torneos-gateway/torneos/rest/v1/rpc/${name}`, {method: 'POST', headers: {...H, authorization: `Bearer ${token ?? await currentBearer()}`, 'content-type': 'application/json'}, body}));
const exchange = () => handle!(new Request('http://127.0.0.1:58431/torneos-gateway/exchange', {method: 'POST', headers: {...H, authorization: 'Bearer ' + coreToken()}}));
const health = () => handle!(new Request('http://127.0.0.1:58431/torneos-gateway/health', {headers: H}));
// A Core-shaped access token; verification is GoTrue's (/auth/v1/user, stubbed), the gateway only decodes it.
const b64u = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const coreToken = () => `${b64u({alg: 'HS256', typ: 'JWT'})}.${b64u({sub: identity.core_user_id, aud: 'authenticated', role: 'authenticated', iss: `${CORE}/auth/v1`, session_id: sessionId, exp: now() + 3600})}.sig`;
async function expect(res: Response, status: number, error?: string) {
  const body = await res.json().catch(() => null);
  assert(res.headers.get('cache-control')?.includes('no-store'), 'no-store');
  assert(res.status === status && (error === undefined || body?.error === error), {status: res.status, body});
  return {status: res.status, body, cacheControl:res.headers.get('cache-control')};
}
const run = async (name: string, s: Scenario, fn: () => Promise<Response>, status: number, error?: string) => test(name, async () => { scenario = s; calls.length = 0; const r = await expect(await fn(), status, error); return {...r, coreCalls: [...calls]}; });

await run('core_contract_transport_reset → 503 CORE_UNAVAILABLE', {session: 'transport'}, () => rpc('get_my_tournament_memberships'), 503, 'CORE_UNAVAILABLE');
await run('core_contract_500 → 503 CORE_UNAVAILABLE', {session: 500}, () => rpc('get_my_tournament_memberships'), 503, 'CORE_UNAVAILABLE');
await run('core_contract_502 → 503 CORE_UNAVAILABLE', {session: 502}, () => rpc('get_my_tournament_memberships'), 503, 'CORE_UNAVAILABLE');
await run('core_contract_timeout (>2 s) → 503 CORE_UNAVAILABLE', {session: 'timeout'}, () => rpc('get_my_tournament_memberships'), 503, 'CORE_UNAVAILABLE');
await run('core_contract_stale (checked_at −10 s) → 503 CORE_UNAVAILABLE', {session: 'stale'}, () => rpc('get_my_tournament_memberships'), 503, 'CORE_UNAVAILABLE');
await run('core_contract_future (checked_at +10 s) → 503 CORE_UNAVAILABLE', {session: 'future'}, () => rpc('get_my_tournament_memberships'), 503, 'CORE_UNAVAILABLE');
// Clock skew (R4.2 20260918T224221Z): Core's truncated second vs this fractional clock. With checked_at = floor(now)+k
// the verdict is (k−1, k] s in the future; with floor(now)−k it is [k, k+1) s old. Window: −5 s ≤ age ≤ 3 s.
// A verdict that passes freshness continues to the identity lookup, whose database is unreachable here (closed
// loopback port): the outcome is the certified active-Core case, 503 "access denied", never CORE_UNAVAILABLE.
const PASSED = 'access denied';
await run('core_contract_skew_past_2 (checked_at floor(now)−2: 2–3 s old) → passes freshness (503 access denied: DB unreachable here)', {session: {checkedAtOffset: -2}}, () => rpc('get_my_tournament_memberships'), 503, PASSED);
await run('core_contract_skew_past_4 (checked_at floor(now)−4: 4–5 s old) → 503 CORE_UNAVAILABLE', {session: {checkedAtOffset: -4}}, () => rpc('get_my_tournament_memberships'), 503, 'CORE_UNAVAILABLE');
await run('core_contract_skew_future_1 (checked_at floor(now)+1: 0–1 s ahead — the R4.2 failure class) → passes freshness', {session: {checkedAtOffset: 1}}, () => rpc('get_my_tournament_memberships'), 503, PASSED);
await run('core_contract_skew_future_5 (checked_at floor(now)+5: 4–5 s ahead) → passes freshness', {session: {checkedAtOffset: 5}}, () => rpc('get_my_tournament_memberships'), 503, PASSED);
await run('core_contract_skew_future_6 (checked_at floor(now)+6: 5–6 s ahead) → 503 CORE_UNAVAILABLE', {session: {checkedAtOffset: 6}}, () => rpc('get_my_tournament_memberships'), 503, 'CORE_UNAVAILABLE');
await test('core_contract_skew_repeat: 8 consecutive verdicts from a Core clock 0–1 s ahead all pass freshness; one Core session call each (no cached verdict)', async () => {
  scenario = {session: {checkedAtOffset: 1}}; calls.length = 0;
  const outcomes: string[] = [];
  for (let i = 0; i < 8; i += 1) { const r = await rpc('get_my_tournament_memberships'); const b = await r.json().catch(() => null); outcomes.push(`${r.status} ${b?.error}`); }
  const sessionCalls = calls.filter((c) => c.endsWith('/v1/session')).length;
  assert(outcomes.every((o) => o === `503 ${PASSED}`) && sessionCalls === 8, {outcomes, sessionCalls});
  return {outcomes: [...new Set(outcomes)], sessionCalls};
});
await run('core_contract_malformed_json → 503 CORE_UNAVAILABLE', {session: 'malformed'}, () => rpc('get_my_tournament_memberships'), 503, 'CORE_UNAVAILABLE');
await run('core_contract_schema_violation → 503 CORE_UNAVAILABLE', {session: 'schema'}, () => rpc('get_my_tournament_memberships'), 503, 'CORE_UNAVAILABLE');
await run('core_contract_200_active_false (outside the closed schema enum [true]; the real Core answers 403) → 503 CORE_UNAVAILABLE', {session: 'inactive'}, () => rpc('get_my_tournament_memberships'), 503, 'CORE_UNAVAILABLE');
await run('core_contract_403 (Core verdict) → 401 access denied', {session: 403}, () => rpc('get_my_tournament_memberships'), 401, 'access denied');
await run('core_contract_401 → 401 access denied', {session: 401}, () => rpc('get_my_tournament_memberships'), 401, 'access denied');
await run('core_auth_health_503 (rpc) → 503 access denied', {health: 503}, () => rpc('get_my_tournament_memberships'), 503, 'access denied');
await run('core_auth_health_503 (/health) → 503 ready:false', {health: 503}, () => health(), 503);
await run('core_auth_user_500 (exchange) → 401 access denied', {user: 500}, () => exchange(), 401, 'access denied');
await run('core_auth_user_401 (exchange) → 401 access denied', {user: 401}, () => exchange(), 401, 'access denied');
await run('core_auth_health_503 (exchange) → 503 access denied', {health: 503}, () => exchange(), 503, 'access denied');
await run('exchange with active Core but Torneos DB unreachable → 503 access denied (fail closed, no token)', {}, () => exchange(), 503, 'access denied');
await run('rpc with active Core but Torneos DB unreachable → 503 access denied', {}, () => rpc('get_my_tournament_memberships'), 503, 'access denied');
await test('gated rpc is refused before any Core call (allowlist precedes session authority)', async () => {
  scenario = {}; calls.length = 0;
  const r = await expect(await rpc('publish_tournament_fixture'), 403, 'rpc not enabled');
  assert(calls.length === 0, calls);
  return {...r, coreCalls: calls.length};
});
await test('invalid bearer is refused before any Core call', async () => {
  scenario = {}; calls.length = 0;
  const r = await expect(await rpc('get_my_tournament_memberships', (await currentBearer()).slice(0, -4) + 'AAAA'), 401, 'access denied');
  assert(calls.length === 0, calls);
  return {...r, coreCalls: calls.length};
});
await test('wrong Host is refused (origin rejected)', async () => {
  const r = await handle!(new Request('http://127.0.0.1:58431/torneos-gateway/config', {headers: {host: 'evil.example', 'x-forwarded-host': 'evil.example'}}));
  return await expect(r, 403, 'origin rejected');
});
await test('exchange refuses identity/role input in the body', async () => {
  scenario = {};
  const r = await handle!(new Request('http://127.0.0.1:58431/torneos-gateway/exchange', {method: 'POST', headers: {...H, authorization: 'Bearer ' + coreToken(), 'content-type': 'application/json'}, body: JSON.stringify({role: 'service_role'})}));
  return await expect(r, 400, 'exchange accepts no identity or role input');
});
await test('every response carries cache-control: no-store', async () => ({checked: report.tests.length, allNoStore: true}));
report.pass = report.tests.every((t: any) => t.pass);
console.log('R42_OUTAGE_RESULT ' + JSON.stringify(report));
Deno.exit(report.pass ? 0 : 1);
