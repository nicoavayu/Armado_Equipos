import {
  buildHomonymHints,
  dedupeSurveyRoster,
  haveConflictingIdentity,
  resolveSurveyPlayerIdentity,
} from '../utils/surveyRosterIdentity';
import {
  buildPlayerRefToKeyMap,
  resolvePersistRef,
  toPlayerKeysFromRefs,
} from '../services/surveyTeamsService';

jest.mock('../supabase', () => ({ supabase: { rpc: jest.fn() } }));

// Two different people called "Juan Pérez", neither with a photo: one registered, one guest,
// plus a second guest with the same name. Each is its own public.jugadores row.
const registeredJuan = { id: 101, uuid: '6f1d1c1e-0000-4000-8000-000000000101', usuario_id: 'aaaaaaaa-0000-4000-8000-00000000000a', nombre: 'Juan Pérez', avatar_url: null };
const guestJuan = { id: 102, uuid: '6f1d1c1e-0000-4000-8000-000000000102', usuario_id: null, nombre: 'Juan Pérez', avatar_url: null };
const otherGuestJuan = { id: 103, uuid: '6f1d1c1e-0000-4000-8000-000000000103', usuario_id: null, nombre: 'juan pérez ', avatar_url: '' };
const ana = { id: 104, uuid: '6f1d1c1e-0000-4000-8000-000000000104', usuario_id: 'bbbbbbbb-0000-4000-8000-00000000000b', nombre: 'Ana', avatar_url: null };

describe('survey roster identity: homonyms without photo', () => {
  test('match roster rows with the same name stay separate (registered and guests)', () => {
    for (const includeLooseName of [false, true]) {
      const roster = dedupeSurveyRoster([registeredJuan, guestJuan, otherGuestJuan, ana], { includeLooseName });
      expect(roster.map((player) => player.id)).toEqual([101, 102, 103, 104]);
    }
  });

  test('two registered accounts with the same name are never the same person', () => {
    const second = { ...registeredJuan, id: 201, uuid: '6f1d1c1e-0000-4000-8000-000000000201', usuario_id: 'cccccccc-0000-4000-8000-00000000000c' };
    expect(haveConflictingIdentity(registeredJuan, second)).toBe(true);
    expect(dedupeSurveyRoster([registeredJuan, second], { includeLooseName: true })).toHaveLength(2);
  });

  test('the same row twice, or the same account from a team list, is still joined', () => {
    expect(dedupeSurveyRoster([guestJuan, { ...guestJuan }])).toHaveLength(1);
    const teamMember = { id: 9001, uuid: registeredJuan.usuario_id, usuario_id: registeredJuan.usuario_id, nombre: 'Juan Pérez', avatar_url: 'https://cdn/x.png' };
    const roster = dedupeSurveyRoster([registeredJuan, teamMember], { includeLooseName: true });
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ id: 101, avatar_url: 'https://cdn/x.png' });
  });

  test('a guest team member with no IDs joins its single same-name roster row', () => {
    const guestMember = { id: 9002, uuid: 'tm-55', usuario_id: null, nombre: 'Pato', avatar_url: null };
    const guestRow = { id: 105, uuid: '6f1d1c1e-0000-4000-8000-000000000105', usuario_id: null, nombre: 'Pato', avatar_url: null };
    expect(dedupeSurveyRoster([guestRow, guestMember], { includeLooseName: true })).toHaveLength(1);
  });

  test('a record without IDs is not guessed into one of two homonyms', () => {
    const guestMember = { id: 9003, uuid: 'tm-56', usuario_id: null, nombre: 'Juan Pérez', avatar_url: null };
    const roster = dedupeSurveyRoster([guestJuan, otherGuestJuan, guestMember], { includeLooseName: true });
    expect(roster).toHaveLength(3);
  });

  test('identity prefers IDs over the name', () => {
    expect(resolveSurveyPlayerIdentity(guestJuan)).toBe(`uuid:${guestJuan.uuid}`);
    expect(resolveSurveyPlayerIdentity(otherGuestJuan)).toBe(`uuid:${otherGuestJuan.uuid}`);
    expect(resolveSurveyPlayerIdentity({ id: 7, uuid: 'tm-7', nombre: 'Juan' })).toBe('id:7');
  });
});

describe('survey team refs with homonyms', () => {
  const roster = [registeredJuan, guestJuan, otherGuestJuan, ana];

  test('every player keeps its own persist ref, so the saved teams count every player', () => {
    const refs = roster.map(resolvePersistRef);
    expect(new Set(refs).size).toBe(roster.length);
    const keys = toPlayerKeysFromRefs({ refs, refToKeyMap: buildPlayerRefToKeyMap(roster) });
    expect(keys).toHaveLength(roster.length);
  });

  test('a shared name does not resolve to either homonym; a unique name still resolves', () => {
    const map = buildPlayerRefToKeyMap(roster);
    expect(map.has('juan pérez')).toBe(false);
    expect(map.get('ana')).toBe(ana.uuid);
    expect(map.get(String(guestJuan.id))).toBe(guestJuan.uuid);
    expect(map.get(otherGuestJuan.uuid)).toBe(otherGuestJuan.uuid);
  });
});

describe('telling homonyms apart on screen', () => {
  test('only repeated names get a hint: account vs guest, numbered when still alike', () => {
    const hints = buildHomonymHints([registeredJuan, guestJuan, otherGuestJuan, ana]);
    expect(hints.get(registeredJuan.uuid)).toBe('Con cuenta');
    expect(hints.get(guestJuan.uuid)).toBe('Invitado 1');
    expect(hints.get(otherGuestJuan.uuid)).toBe('Invitado 2');
    expect(hints.has(ana.uuid)).toBe(false);
  });
});
