import {
  normalizeOrganizationSlug,
  validateOrganizationInput,
  validateOrganizationName,
  validateOrganizationSlug,
} from '../features/torneos/domain/organizationValidation';

describe('Torneos organization validation', () => {
  test.each([
    ['Liga Devoto', 'liga-devoto'],
    ['  Copa  El Potrero  ', 'copa-el-potrero'],
    ['Fútbol Ñandú', 'futbol-nandu'],
    ['A---B', 'a-b'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeOrganizationSlug(input)).toBe(expected);
  });

  test('rejects invalid and reserved values before submitting', () => {
    expect(validateOrganizationName('Li')).toMatch(/al menos 3/);
    expect(validateOrganizationName('x'.repeat(81))).toMatch(/hasta 80/);
    expect(validateOrganizationSlug('admin')).toMatch(/reservado/);
    expect(validateOrganizationSlug('a')).toMatch(/al menos 3/);
  });

  test('returns field-specific errors', () => {
    expect(validateOrganizationInput({ name: '', slug: 'www' })).toEqual({
      name: expect.any(String),
      slug: expect.any(String),
    });
    expect(validateOrganizationInput({
      name: 'Liga Segura',
      slug: 'liga-segura',
    })).toEqual({ name: '', slug: '' });
  });
});
