import { supabase } from '../services/api/supabase';
import { loadPlayerTournamentMatches } from '../features/torneos/api/tournamentWorkspaceService';

jest.mock('../services/api/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

//
// "Mis partidos" une dos RPC distintas y el merge borraba de cuál venía cada
// fila. Como el permiso para responder asistencia depende exactamente de esa
// diferencia —plantel propio, no cargo— el origen viaja explícito.
//
const MATCH_A = 'a4000000-0000-4000-8000-000000000001';
const MATCH_B = 'a4000000-0000-4000-8000-000000000002';
const ENTRY_A = 'b4000000-0000-4000-8000-000000000001';
const ENTRY_B = 'b4000000-0000-4000-8000-000000000002';

function mockRpcs({ player = [], managed = [] }) {
  supabase.rpc.mockImplementation((name) => {
    if (name === 'get_player_tournament_matches') return Promise.resolve({ data: player, error: null });
    if (name === 'get_managed_tournament_matches') return Promise.resolve({ data: managed, error: null });
    throw new Error(`RPC inesperada: ${name}`);
  });
}

describe('los partidos del jugador declaran de qué relación vienen', () => {
  beforeEach(() => jest.clearAllMocks());

  test('la fila del plantel queda marcada como jugador y no como cuerpo técnico', async () => {
    mockRpcs({ player: [{ matchId: MATCH_A, teamEntryId: ENTRY_A, availability: null }] });
    const [match] = await loadPlayerTournamentMatches();
    expect(match).toMatchObject({ isRosteredPlayer: true, isTeamManager: false });
  });

  test('la fila de capitán o delegado no se declara jugador', async () => {
    mockRpcs({ managed: [{ matchId: MATCH_A, teamEntryId: ENTRY_A, canManageSquad: true }] });
    const [match] = await loadPlayerTournamentMatches();
    expect(match).toMatchObject({ isRosteredPlayer: false, isTeamManager: true });
  });

  test('quien tiene las dos relaciones sobre el mismo partido conserva las dos', async () => {
    mockRpcs({
      player: [{ matchId: MATCH_A, teamEntryId: ENTRY_A, availability: 'available' }],
      managed: [{ matchId: MATCH_A, teamEntryId: ENTRY_A, canManageSquad: true }],
    });
    const matches = await loadPlayerTournamentMatches();
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      isRosteredPlayer: true,
      isTeamManager: true,
      canManageSquad: true,
      availability: 'available',
    });
  });

  test('dirigir un equipo no contagia la condición de jugador a otro equipo', async () => {
    mockRpcs({
      player: [{ matchId: MATCH_A, teamEntryId: ENTRY_A }],
      managed: [{ matchId: MATCH_B, teamEntryId: ENTRY_B }],
    });
    const matches = await loadPlayerTournamentMatches();
    const byMatch = Object.fromEntries(matches.map((match) => [match.matchId, match]));
    expect(byMatch[MATCH_A].isRosteredPlayer).toBe(true);
    expect(byMatch[MATCH_B].isRosteredPlayer).toBe(false);
  });

  test('el mismo partido con dos inscripciones distintas no se fusiona', async () => {
    // La clave del merge es partido + inscripción: dirigir al rival no puede
    // colapsar contra el equipo propio.
    mockRpcs({
      player: [{ matchId: MATCH_A, teamEntryId: ENTRY_A }],
      managed: [{ matchId: MATCH_A, teamEntryId: ENTRY_B }],
    });
    const matches = await loadPlayerTournamentMatches();
    expect(matches).toHaveLength(2);
    expect(matches.filter((match) => match.isRosteredPlayer)).toHaveLength(1);
  });

  test('sin filas no inventa relaciones', async () => {
    mockRpcs({});
    expect(await loadPlayerTournamentMatches()).toEqual([]);
  });
});
