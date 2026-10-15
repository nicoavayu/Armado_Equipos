// PREMIUM SPONSORS (0020) — the pure half shared by both compositions (LOCAL service, hybrid adapter), the settings
// page and the Estudio Social. No client and no network: the server decides who may read, change or export, and
// whether the season (or the organization) has `sponsors`; this module only shapes and checks its answers.
//
// The RPC contract: backend/torneos/sponsors-v1/README.md.

export const SPONSOR_LIMITS = Object.freeze({ maxActive: 20, maxPerExport: 3, nameMaxLength: 60 });
// Sort order range accepted by the server (tournament_organization_sponsors.sort_order).
export const SPONSOR_SORT_ORDER_MAX = 999;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Same rule as the server: trimmed 1..60 characters, no control characters.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export const isSponsorId = (value) => typeof value === 'string' && UUID.test(value);

export function validateSponsorName(name) {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!value) return { valid: false, value, message: 'Escribí el nombre del sponsor.' };
  if (value.length > SPONSOR_LIMITS.nameMaxLength || CONTROL.test(value)) {
    return { valid: false, value, message: 'El nombre del sponsor tiene que tener entre 1 y 60 caracteres.' };
  }
  return { valid: true, value, message: '' };
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeSponsor(entry, resolveLogoUrl) {
  if (!entry || typeof entry !== 'object' || !isSponsorId(entry.id) || typeof entry.name !== 'string') return null;
  const logoPath = typeof entry.logoPath === 'string' && entry.logoPath ? entry.logoPath : null;
  let logoUrl = null;
  if (logoPath) {
    try {
      logoUrl = resolveLogoUrl ? resolveLogoUrl(logoPath, entry) : null;
    } catch {
      logoUrl = null;
    }
  }
  return Object.freeze({
    id: entry.id,
    name: entry.name,
    logoPath,
    logoUrl: typeof logoUrl === 'string' && logoUrl ? logoUrl : null,
    sortOrder: Number.isInteger(entry.sortOrder) ? entry.sortOrder : null,
  });
}

/**
 * get_tournament_organization_sponsors → the page's shape. `resolveLogoUrl(path)` is the composition's only way to
 * turn a logo path into an image (hybrid: the URL the gateway signed; LOCAL: the branding resolver); without one the
 * logo URL is null and the logo shows as initials (and the sponsor cannot be selected for a piece).
 */
export function normalizeSponsorsAnswer(answer, { resolveLogoUrl = null } = {}) {
  const limits = answer?.limits || {};
  return Object.freeze({
    organizationId: answer?.organizationId || null,
    seasonId: answer?.seasonId || null,
    canManage: answer?.canManage === true,
    entitled: answer?.entitled === true,
    limits: Object.freeze({
      maxActive: positiveInteger(limits.maxActive, SPONSOR_LIMITS.maxActive),
      maxPerExport: Math.min(positiveInteger(limits.maxPerExport, SPONSOR_LIMITS.maxPerExport), SPONSOR_LIMITS.maxPerExport),
      nameMaxLength: positiveInteger(limits.nameMaxLength, SPONSOR_LIMITS.nameMaxLength),
    }),
    sponsors: Object.freeze((Array.isArray(answer?.sponsors) ? answer.sponsors : [])
      .map((entry) => normalizeSponsor(entry, resolveLogoUrl))
      .filter(Boolean)),
  });
}

/** authorize_tournament_social_sponsors → the authorized list, in the requested order, with its logo URLs. */
export function normalizeSponsorsAuthorization(answer, { resolveLogoUrl = null } = {}) {
  return Object.freeze({
    ...answer,
    authorized: answer?.authorized === true,
    sponsors: Object.freeze((Array.isArray(answer?.sponsors) ? answer.sponsors : [])
      .map((entry) => normalizeSponsor(entry, resolveLogoUrl))
      .filter(Boolean)),
  });
}

/** What a piece draws of a sponsor, and what its render key is made of: identity, name and the exact logo object. */
export function sponsorRenderEntry(sponsor) {
  return Object.freeze({
    id: sponsor.id,
    name: sponsor.name,
    logoPath: sponsor.logoPath || null,
    image: sponsor.logoUrl || sponsor.image || null,
  });
}

export function sponsorIdentity(entry) {
  return entry ? { id: entry.id || null, name: entry.name || null, logoPath: entry.logoPath || null } : null;
}

/** Same sponsors, same order, same names and the same logo objects. */
export function sameSponsorList(left = [], right = []) {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const a = sponsorIdentity(entry);
    const b = sponsorIdentity(right[index]);
    return a.id === b.id && a.name === b.name && a.logoPath === b.logoPath;
  });
}

/** A sponsor can be chosen for a piece only with a logo the composition can draw. */
export const isSelectableSponsor = (sponsor) => Boolean(sponsor?.logoPath && sponsor?.logoUrl);
