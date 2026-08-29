/**
 * The one place that decides which Supabase project this worker may reach.
 *
 * ---------------------------------------------------------------------------
 * Why this module exists
 * ---------------------------------------------------------------------------
 * `readConfig` used to accept whatever `SUPABASE_URL` named and pair it with
 * `SUPABASE_SERVICE_ROLE_KEY`. A service-role key is unconditional authority
 * over a project: it bypasses RLS, it reads and writes every bucket, and it is
 * sent on every single request this worker makes, in both the `apikey` and the
 * `Authorization` header. So a single wrong environment variable — a copied
 * deploy manifest, a shell that still had Production exported, a typo'd host
 * that someone else owns — was enough to hand that key to a project nobody
 * authorized, and nothing in the worker would have objected. The first request
 * is the disclosure; there is no "notice and recover" after it.
 *
 * The fix is to make the target a validated, frozen descriptor that is built
 * BEFORE the credential is read, and re-checked immediately before every
 * request. Configuration is not authorization: `SUPABASE_URL` agreeing with
 * itself proves nothing, so the authorized project has to be named separately,
 * by `TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF`, and the two have to agree.
 *
 * ---------------------------------------------------------------------------
 * Why the design is borrowed rather than invented
 * ---------------------------------------------------------------------------
 * `workers/tournament-media-signer-renewer/src/forbidden-targets.mjs` and
 * `target.mjs` already solved the canonicalisation half of this problem, and
 * paid for the lessons: match forbidden refs against EVERY DNS label rather
 * than the first, match whole labels rather than substrings, and strip the
 * trailing root dot before comparing anything. Those rules are reproduced here
 * because they are correct, not because the file was copied — the renewer ships
 * as its own npm package and its own container, so the processor cannot import
 * it, exactly as `contract.mjs` cannot import the browser's copy of the
 * geometry contract. `test/target.test.mjs` pins the shared constants so the
 * two copies cannot drift apart silently.
 *
 * ---------------------------------------------------------------------------
 * The one-way rule
 * ---------------------------------------------------------------------------
 * The Production block is compiled in, and the environment may only ADD to it.
 * There is no value of `TOURNAMENT_MEDIA_FORBIDDEN_*` — absent, empty, or a
 * list that deliberately omits Production — that produces a descriptor willing
 * to reach Production. Un-forbidding is not an operation this module offers.
 *
 * That does mean pointing this worker at Production is a deliberate source
 * change to `COMPILED_FORBIDDEN_PROJECT_REFS`, reviewed like any other, rather
 * than an environment flip. That is the intent: the mechanism is configurable
 * (the authorized project is an environment variable, and this file hardcodes
 * no Staging ref), but relaxing the block is not.
 */

/** Production. Never a valid target for anything in this package. */
export const PRODUCTION_PROJECT_REF = 'rcyuuoaqfwcembdajcss';
export const PRODUCTION_API_HOST = 'rcyuuoaqfwcembdajcss.supabase.co';

export const COMPILED_FORBIDDEN_PROJECT_REFS = Object.freeze([PRODUCTION_PROJECT_REF]);
export const COMPILED_FORBIDDEN_API_HOSTS = Object.freeze([PRODUCTION_API_HOST]);

/** The API host a Supabase project ref resolves to. */
export const SUPABASE_API_HOST_SUFFIX = 'supabase.co';

/** Supabase project refs are exactly twenty lower-case alphanumerics. */
const PROJECT_REF_RE = /^[a-z0-9]{20}$/;

export class TargetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TargetError';
    this.code = code;
  }
}

const fail = (code, message) => { throw new TargetError(code, message); };

const normalize = (values) => (values || [])
  .map((value) => String(value === undefined || value === null ? '' : value).trim().toLowerCase())
  .filter(Boolean);

/**
 * Parses one caller-supplied list: the comma-separated string an environment
 * variable carries, or an already-split array. Never throws — a malformed value
 * contributes nothing rather than failing start-up, because the compiled policy
 * already carries the part that matters.
 */
export const parseForbiddenList = (raw) => normalize(
  Array.isArray(raw) ? raw : String(raw === undefined || raw === null ? '' : raw).split(','),
);

const union = (compiled, raw) => Object.freeze([...new Set([...compiled, ...parseForbiddenList(raw)])]);

export const resolveForbiddenApiHosts = (raw) => union(COMPILED_FORBIDDEN_API_HOSTS, raw);
export const resolveForbiddenProjectRefs = (raw) => union(COMPILED_FORBIDDEN_PROJECT_REFS, raw);

/**
 * A hostname reduced to the form the policy is stated in: trimmed, lower-cased,
 * and with one trailing root dot removed. `example.com.` and `example.com` name
 * the same host to a resolver, so they have to name the same host to a block
 * list — WHATWG `URL` keeps that dot in `hostname`, and without this a single
 * typed character walked straight past every comparison below.
 */
export const normalizeHost = (host) => String(host === undefined || host === null ? '' : host)
  .trim().toLowerCase().replace(/\.$/, '');

/**
 * A hostname split into its DNS labels, empty labels dropped, so a doubled or
 * leading dot cannot shift the meaning of a position.
 */
export const hostLabels = (host) => normalizeHost(host).split('.').filter(Boolean);

/**
 * The canonical forbidden-target test: true when ANY DNS label of `host` is
 * exactly a forbidden project ref.
 *
 * Any label, because reading only the first one blocks `<prod>.supabase.co` and
 * nothing else — `db.<prod>.supabase.co` and `api.<prod>.supabase.co` both have
 * an innocent first label while naming Production in the next one, and prefixed
 * hostnames are ordinary infrastructure rather than an exotic input.
 *
 * Whole labels rather than a substring, because `host.includes(ref)` would make
 * the block depend on text instead of on DNS: a different project whose ref
 * merely contains Production's would be refused with no rule to appeal to,
 * while the guarantee would be no stronger. A label is the unit a host is made
 * of, so `<prod>2.supabase.co` and `x<prod>.example.com` are different hosts and
 * stay accepted.
 */
export const hostCarriesForbiddenRef = (host, forbiddenRefs = []) => {
  const refs = new Set([...COMPILED_FORBIDDEN_PROJECT_REFS, ...parseForbiddenList(forbiddenRefs)]);
  return hostLabels(host).some((label) => refs.has(label));
};

/** Loopback literals only. `localhost` resolves through the resolver, so it is not one. */
const isLoopbackLiteral = (hostname) => {
  const host = normalizeHost(hostname);
  return host === '127.0.0.1' || host === '[::1]' || host === '::1';
};

export { isLoopbackLiteral };

/**
 * Builds the immutable description of the single Supabase project this process
 * may reach, or throws. Nothing here touches the network and nothing here reads
 * a credential: this runs first precisely so that a refusal costs nothing.
 *
 * A loopback literal is its own mode — https is not required, any port is
 * allowed and no project ref is checked — because a loopback address cannot
 * reach Production and cannot exfiltrate to a remote host. That is what lets
 * `supabase start` and the test suite exercise the real client. Everything else
 * must be `https://<authorized-ref>.supabase.co` on the default port.
 *
 * @throws {TargetError} never with the raw URL in the message: a `SUPABASE_URL`
 *   may carry userinfo, and an error string ends up in logs.
 */
export function createSupabaseTarget({
  url: rawUrl, expectedProjectRef = null,
  forbiddenHosts = [], forbiddenProjectRefs = [],
} = {}) {
  const forbiddenHostList = resolveForbiddenApiHosts(forbiddenHosts);
  const forbiddenRefList = resolveForbiddenProjectRefs(forbiddenProjectRefs);

  const candidate = String(rawUrl === undefined || rawUrl === null ? '' : rawUrl).trim();
  if (!candidate) fail('TARGET_MISSING', 'SUPABASE_URL is not set.');

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return fail('TARGET_INVALID', 'SUPABASE_URL is not a URL.');
  }

  // Userinfo first: it is the one component that can carry a secret, so it is
  // refused before anything else has a chance to put the URL in a message.
  if (url.username || url.password) {
    fail('TARGET_CREDENTIALS', 'SUPABASE_URL may not carry userinfo.');
  }
  if (url.search || url.hash) {
    fail('TARGET_INVALID', 'SUPABASE_URL may not carry a query string or fragment.');
  }

  const hostname = normalizeHost(url.hostname);
  if (!hostname) fail('TARGET_INVALID', 'SUPABASE_URL has no host.');

  const loopback = isLoopbackLiteral(hostname);
  if (url.protocol !== 'https:' && !loopback) {
    fail('TARGET_INSECURE', 'SUPABASE_URL must be https unless it is a loopback literal.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    fail('TARGET_INSECURE', 'SUPABASE_URL must be an http(s) URL.');
  }

  // The block is applied even to a loopback host, so a hosts-file entry that
  // maps a forbidden name onto 127.0.0.1 cannot launder it into acceptance.
  if (forbiddenHostList.includes(hostname)) {
    fail('TARGET_FORBIDDEN', 'The target host is explicitly forbidden.');
  }
  if (hostCarriesForbiddenRef(hostname, forbiddenRefList)) {
    fail('TARGET_FORBIDDEN', 'The target host carries a forbidden project ref.');
  }

  const declaredRef = expectedProjectRef === null || expectedProjectRef === undefined
    ? '' : String(expectedProjectRef).trim().toLowerCase();

  if (declaredRef && forbiddenRefList.includes(declaredRef)) {
    fail('TARGET_FORBIDDEN', 'The expected project ref is explicitly forbidden.');
  }

  if (loopback) {
    return Object.freeze({
      origin: url.origin,
      hostname,
      protocol: url.protocol,
      projectRef: null,
      loopback: true,
      forbiddenHosts: forbiddenHostList,
      forbiddenProjectRefs: forbiddenRefList,
    });
  }

  // Fail closed: a remote target with no declared project is refused. Silence
  // is the configuration mistake this whole module exists to catch, so it can
  // never be the permissive case.
  if (!declaredRef) {
    fail('TARGET_REF_REQUIRED',
      'TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF must name the authorized project '
      + 'for any non-loopback SUPABASE_URL.');
  }
  if (!PROJECT_REF_RE.test(declaredRef)) {
    fail('TARGET_REF_INVALID', 'TOURNAMENT_MEDIA_EXPECTED_PROJECT_REF is not a project ref.');
  }

  // Exact equality against the host the authorized ref resolves to. This is
  // what refuses every lookalike at once: `<ref>.supabase.co.evil.test`,
  // `<ref>.supabase.co.br`, `evil-<ref>.supabase.co` and `<ref>.supabase.io`
  // are all simply not this string.
  const expectedHost = `${declaredRef}.${SUPABASE_API_HOST_SUFFIX}`;
  if (hostname !== expectedHost) {
    fail('TARGET_HOST', 'The target host is not the authorized project host.');
  }
  // An explicit port is refused rather than normalised: `:443` is harmless but
  // any other value redirects the credential to whatever listens there, and
  // there is no reason for this worker to ever need one.
  if (url.port !== '') {
    fail('TARGET_PORT', 'The target may not name an explicit port.');
  }

  return Object.freeze({
    origin: url.origin,
    hostname,
    protocol: url.protocol,
    projectRef: declaredRef,
    loopback: false,
    forbiddenHosts: forbiddenHostList,
    forbiddenProjectRefs: forbiddenRefList,
  });
}

/**
 * Re-validates a concrete request URL against the frozen descriptor, immediately
 * before the request is made.
 *
 * Validation at configuration time is not enough on its own: the request URL is
 * built by string concatenation from an object name that came out of the
 * database, and the check that actually protects the credential is the one that
 * runs at the moment of the call. Exact origin equality covers protocol, host
 * and port together; the forbidden lists are re-applied so a descriptor built
 * from a stale configuration cannot smuggle Production past a later-tightened
 * list.
 */
export function assertAuthorizedUrl(candidate, target) {
  if (!target || typeof target !== 'object' || typeof target.origin !== 'string') {
    fail('TARGET_INVALID', 'A frozen target descriptor is required.');
  }
  let url;
  try {
    url = new URL(String(candidate));
  } catch {
    return fail('TARGET_INVALID', 'The request URL is not a URL.');
  }
  if (url.username || url.password) {
    fail('TARGET_CREDENTIALS', 'The request URL may not carry userinfo.');
  }
  if (url.protocol !== target.protocol) {
    fail('TARGET_PROTOCOL', 'The request protocol is not the authorized one.');
  }
  if (normalizeHost(url.hostname) !== target.hostname) {
    fail('TARGET_HOST', 'The request host is not the authorized host.');
  }
  if (url.origin !== target.origin) {
    // Catches a changed port, which `hostname` alone does not.
    fail('TARGET_HOST', 'The request origin is not the authorized origin.');
  }
  if (target.forbiddenHosts.includes(normalizeHost(url.hostname))) {
    fail('TARGET_FORBIDDEN', 'The request host is explicitly forbidden.');
  }
  if (hostCarriesForbiddenRef(url.hostname, target.forbiddenProjectRefs)) {
    fail('TARGET_FORBIDDEN', 'The request host carries a forbidden project ref.');
  }
  return url;
}
