import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import TeamMatchDetailPage from '../pages/TeamMatchDetailPage';
import {
  getTeamMatchById,
  listTeamMatchMembers,
  listChallengeTeamSquad,
  getChallengeHeadToHeadStats,
} from '../services/db/teamChallenges';

jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
  SURVEY_REMINDER_12H_LEAD_MS: 12 * 60 * 60 * 1000,
  SURVEY_REMINDER_1H_LEAD_MS: 60 * 60 * 1000,
  SURVEY_REMINDER_LEAD_MS: 60 * 60 * 1000,
  SURVEY_MIN_VOTERS_FOR_AWARDS: 3,
  SURVEY_MIN_VOTERS_IMMEDIATE_FINALIZE: 3,
}));

const mockUserId = { current: 'creator-user' };

jest.mock('../services/db/teamChallenges', () => ({
  getTeamMatchById: jest.fn(),
  listTeamMatchMembers: jest.fn(),
  listChallengeTeamSquad: jest.fn(),
  getChallengeHeadToHeadStats: jest.fn(),
  reportChallengeResult: jest.fn(),
  setChallengeAvailability: jest.fn(),
  setChallengeSquadStatus: jest.fn(),
  upsertChallengeTeamSelection: jest.fn(),
  updateTeamMatchDetails: jest.fn(),
}));

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => ({ user: { id: mockUserId.current } }),
}));

jest.mock('../components/ProfileCardModal', () => () => null);

jest.mock('../utils/notifyBlockingError', () => ({
  notifyBlockingError: jest.fn(),
}));

// scheduled_at en el futuro lejano para que NO sea un partido pasado.
const FUTURE_AT = '2099-01-01T20:00:00.000Z';

const buildMatch = (overrides = {}) => ({
  id: 'match-1',
  challenge_id: 'challenge-1',
  origin_type: 'challenge',
  team_a_id: 'team-a',
  team_b_id: 'team-b',
  team_a: { id: 'team-a', name: 'Napoli' },
  team_b: { id: 'team-b', name: 'Bico' },
  status: 'confirmed',
  scheduled_at: FUTURE_AT,
  format: 5,
  mode: 'Masculino',
  location: 'Parque Chas',
  cancha_cost: 3500,
  result_status: null,
  challenge: { id: 'challenge-1', created_by_user_id: 'creator-user', status: 'accepted' },
  ...overrides,
});

const renderDetail = async ({ match = buildMatch(), squadChallenge = null } = {}) => {
  getTeamMatchById.mockResolvedValue(match);
  listTeamMatchMembers.mockResolvedValue({});
  listChallengeTeamSquad.mockResolvedValue({ byTeamId: {}, challenge: squadChallenge });
  getChallengeHeadToHeadStats.mockResolvedValue({});

  render(
    <MemoryRouter initialEntries={['/desafios/equipos/partidos/match-1']}>
      <Routes>
        <Route path="/desafios/equipos/partidos/:matchId" element={<TeamMatchDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );

  await waitFor(() => expect(screen.getByText('VS')).toBeInTheDocument());
};

describe('detalle de desafío - menú de acciones (tres puntitos)', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockUserId.current = 'creator-user';
  });

  test('el creador ve los tres puntitos en un desafío futuro', async () => {
    mockUserId.current = 'creator-user';
    await renderDetail();
    expect(screen.getByRole('button', { name: 'Mas acciones' })).toBeInTheDocument();
  });

  test('un usuario que NO es el creador no ve los tres puntitos', async () => {
    mockUserId.current = 'otro-user';
    await renderDetail();
    expect(screen.queryByRole('button', { name: 'Mas acciones' })).not.toBeInTheDocument();
  });

  // Regresión: cuando el embed match.challenge llega sin created_by_user_id,
  // el creador igual debe ver los tres puntitos gracias al challenge que la
  // pantalla carga aparte (challengeSquadMeta).
  test('el creador ve los tres puntitos aunque el embed challenge llegue sin creador (fallback al challenge cargado)', async () => {
    mockUserId.current = 'creator-user';
    await renderDetail({
      match: buildMatch({ challenge: { id: 'challenge-1', status: 'accepted' } }),
      squadChallenge: { id: 'challenge-1', created_by_user_id: 'creator-user', status: 'accepted' },
    });
    expect(await screen.findByRole('button', { name: 'Mas acciones' })).toBeInTheDocument();
  });
});
