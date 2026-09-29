import {
  COMMUNITY_SEARCH_MIN_CHARS,
  countCommunitySearchChars,
  isCommunitySearchReady,
  normalizeCommunitySearchQuery,
} from '../utils/communitySearch';

describe('community search rules', () => {
  test('minimum is 3 useful characters', () => {
    expect(COMMUNITY_SEARCH_MIN_CHARS).toBe(3);
  });

  test.each([
    ['', false],
    ['T', false],
    ['Th', false],
    ['Tho', true],
    ['Thomas', true],
    ['   ', false],
    ['  Th  ', false],
    ['  Tho  ', true],
    ['T h', false],
    ['tHo', true],
  ])('%j ready = %s', (query, expected) => {
    expect(isCommunitySearchReady(query)).toBe(expected);
  });

  test('spaces never count as characters', () => {
    expect(countCommunitySearchChars('  T h ')).toBe(2);
    expect(countCommunitySearchChars(null)).toBe(0);
  });

  test('normalization trims and collapses inner whitespace, keeping case', () => {
    expect(normalizeCommunitySearchQuery('  Juan   Pérez ')).toBe('Juan Pérez');
    expect(normalizeCommunitySearchQuery(undefined)).toBe('');
  });
});
