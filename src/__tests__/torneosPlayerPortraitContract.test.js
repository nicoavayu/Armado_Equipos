import {
  isPlayerPortraitRef,
  playerPortraitRef,
  PLAYER_PORTRAIT_ENABLED_AUDIENCES,
  PLAYER_PORTRAIT_VARIANTS,
} from '../features/torneos/domain/playerPortraits';

const ID = '10000000-0000-4000-8000-000000000001';

test('player portrait ImageRef is durable and contains no storage detail', () => {
  const ref = playerPortraitRef(ID, 'portrait');
  expect(ref).toEqual({ kind: 'player_portrait', id: ID, variant: 'portrait' });
  expect(JSON.stringify(ref)).not.toMatch(/bucket|path|url|signed/i);
  expect(isPlayerPortraitRef(ref)).toBe(true);
  expect(PLAYER_PORTRAIT_VARIANTS).toEqual(['original', 'square', 'portrait', 'social']);
});

test('1C.2A only enables the private authenticated roster audience', () => {
  expect(PLAYER_PORTRAIT_ENABLED_AUDIENCES).toEqual(['authenticated_roster']);
  expect(() => playerPortraitRef('not-a-uuid')).toThrow('Invalid player portrait reference');
});
