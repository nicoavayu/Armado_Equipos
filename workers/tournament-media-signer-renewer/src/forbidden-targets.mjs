/**
 * The canonical, compiled-in statement of which targets may never be reached.
 *
 * ---------------------------------------------------------------------------
 * Why this module exists
 * ---------------------------------------------------------------------------
 * Before this file, the Production block lived entirely in two environment
 * variables — `TOURNAMENT_MEDIA_FORBIDDEN_API_HOSTS` and
 * `TOURNAMENT_MEDIA_FORBIDDEN_PROJECT_REFS`. That made the strongest guarantee
 * in the system the weakest kind of configuration: an operator who simply never
 * exported them got a renewer that would happily accept a Production URL, as
 * long as `TOURNAMENT_MEDIA_EXPECTED_API_HOST` agreed with it. Agreement is not
 * authorization — two copies of the same mistake still name Production.
 *
 * So the block is compiled into the deployed artifact instead. The list below
 * is part of the source, ships inside the renewer package, and is what both
 * callers — the renewer loop and the one-shot gateway probe — consult.
 *
 * ---------------------------------------------------------------------------
 * The one-way rule
 * ---------------------------------------------------------------------------
 * The environment may only ADD. `resolveForbidden*` always returns the compiled
 * entries plus whatever the environment contributed; there is no input — absent,
 * empty, whitespace, an explicit empty string, a list that omits Production —
 * that can shrink the result. Un-forbidding is not an operation this module
 * offers, so there is no code path to reach for when someone wants it.
 *
 * ---------------------------------------------------------------------------
 * Why it does not read the manifest
 * ---------------------------------------------------------------------------
 * `ops/torneos-staging/manifest.json` is the repository's declaration of the
 * same fact, but `ops/**` and `docs/**` are not guaranteed to exist in a
 * deployed worker image — a policy that silently degrades when a file is absent
 * is not a policy. The manifest stays the human-facing source of truth and the
 * two are held together by a contract test (`forbidden-targets.test.mjs`) that
 * fails, and takes the Quality Gate with it, on any divergence.
 */

/** Production. Never a valid target for anything in this package. */
export const PRODUCTION_PROJECT_REF = 'rcyuuoaqfwcembdajcss';
export const PRODUCTION_API_HOST = 'rcyuuoaqfwcembdajcss.supabase.co';

/**
 * The compiled policy. Frozen, and deliberately exported as the only names the
 * rest of the package refers to, so a future second forbidden target is added
 * in exactly one place.
 */
export const COMPILED_FORBIDDEN_PROJECT_REFS = Object.freeze([PRODUCTION_PROJECT_REF]);
export const COMPILED_FORBIDDEN_API_HOSTS = Object.freeze([PRODUCTION_API_HOST]);

/** Lower-cased, trimmed, de-duplicated, empties dropped. */
const normalize = (values) => (values || [])
  .map((value) => String(value === undefined || value === null ? '' : value).trim().toLowerCase())
  .filter(Boolean);

/**
 * Parses one caller-supplied list. Accepts the comma-separated string an
 * environment variable carries, or an already-split array from an internal
 * caller. Never throws: a malformed value contributes nothing rather than
 * failing start-up, because the compiled policy already carries the part that
 * matters.
 */
export const parseForbiddenList = (raw) => normalize(
  Array.isArray(raw) ? raw : String(raw === undefined || raw === null ? '' : raw).split(','),
);

const union = (compiled, raw) => Object.freeze([...new Set([...compiled, ...parseForbiddenList(raw)])]);

/**
 * The effective forbidden host list: compiled first, caller's entries appended.
 * `raw` may be undefined, '', '   ', ',,,', [] or a real list — the compiled
 * entries are present in every one of those cases.
 */
export const resolveForbiddenApiHosts = (raw) => union(COMPILED_FORBIDDEN_API_HOSTS, raw);

/** The effective forbidden project-ref list. Same one-way rule. */
export const resolveForbiddenProjectRefs = (raw) => union(COMPILED_FORBIDDEN_PROJECT_REFS, raw);

/**
 * Membership tests against the compiled policy alone, for the callers that need
 * to answer "is this Production?" without having an env-derived list in hand.
 */
export const isCompiledForbiddenHost = (host) => COMPILED_FORBIDDEN_API_HOSTS
  .includes(String(host || '').trim().toLowerCase());

export const isCompiledForbiddenProjectRef = (ref) => COMPILED_FORBIDDEN_PROJECT_REFS
  .includes(String(ref || '').trim().toLowerCase());

/**
 * The first DNS label of a hostname, which is the project ref for a
 * `<ref>.supabase.co` address. Returns '' for anything unusable, so callers can
 * treat "no ref" and "forbidden ref" as different answers.
 */
export const projectRefFromHost = (host) => String(host || '').trim().toLowerCase().split('.')[0] || '';
