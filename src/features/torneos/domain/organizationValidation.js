export const ORGANIZATION_NAME_MIN_LENGTH = 3;
export const ORGANIZATION_NAME_MAX_LENGTH = 80;
export const ORGANIZATION_SLUG_MIN_LENGTH = 3;
export const ORGANIZATION_SLUG_MAX_LENGTH = 48;

export const RESERVED_ORGANIZATION_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'auth',
  'login',
  'logout',
  'profile',
  'torneos',
  'tournaments',
  'settings',
  'support',
  'www',
]);

export function normalizeOrganizationSlug(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, ORGANIZATION_SLUG_MAX_LENGTH)
    .replace(/-$/g, '');
}

export function validateOrganizationName(value = '') {
  const name = String(value).trim();
  if (name.length < ORGANIZATION_NAME_MIN_LENGTH) {
    return 'Ingresá un nombre de al menos 3 caracteres.';
  }
  if (name.length > ORGANIZATION_NAME_MAX_LENGTH) {
    return 'El nombre puede tener hasta 80 caracteres.';
  }
  return '';
}

export function validateOrganizationSlug(value = '') {
  const slug = normalizeOrganizationSlug(value);
  if (slug.length < ORGANIZATION_SLUG_MIN_LENGTH) {
    return 'El identificador debe tener al menos 3 caracteres.';
  }
  if (slug.length > ORGANIZATION_SLUG_MAX_LENGTH) {
    return 'El identificador puede tener hasta 48 caracteres.';
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(slug)) {
    return 'Usá sólo letras, números y guiones, sin guiones al inicio o al final.';
  }
  if (RESERVED_ORGANIZATION_SLUGS.has(slug)) {
    return 'Ese identificador está reservado. Elegí otro.';
  }
  return '';
}

export function validateOrganizationInput({ name, slug }) {
  return {
    name: validateOrganizationName(name),
    slug: validateOrganizationSlug(slug),
  };
}
