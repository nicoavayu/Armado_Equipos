import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import TeamMatchDetailPage from '../pages/TeamMatchDetailPage';
import {
  getTeamMatchById,
  listTeamMatchMembers,
  listChallengeTeamSquad,
  getChallengeHeadToHeadStats,
} from '../services/db/teamChallenges';

// surveyConfig usa import.meta.env (Vite), que Jest no parsea. Los jest.mock se
// hoistean por encima de los imports, así que el módulo real nunca se carga.
jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
  SURVEY_REMINDER_12H_LEAD_MS: 12 * 60 * 60 * 1000,
  SURVEY_REMINDER_1H_LEAD_MS: 60 * 60 * 1000,
  SURVEY_REMINDER_LEAD_MS: 60 * 60 * 1000,
  SURVEY_MIN_VOTERS_FOR_AWARDS: 3,
  SURVEY_MIN_VOTERS_IMMEDIATE_FINALIZE: 3,
}));

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
  useAuth: () => ({ user: { id: 'viewer-user' } }),
}));

// El modal de perfil arrastra NotificationContext/useAmigos, irrelevante para
// el header. Lo anulamos para aislar el render del detalle.
jest.mock('../components/ProfileCardModal', () => () => null);

jest.mock('../utils/notifyBlockingError', () => ({
  notifyBlockingError: jest.fn(),
}));

const baseChallengeMatch = {
  id: 'match-1',
  challenge_id: 'challenge-1',
  origin_type: 'challenge',
  team_a_id: 'team-a',
  team_b_id: 'team-b',
  team_a: { id: 'team-a', name: 'Napoli' },
  team_b: { id: 'team-b', name: 'Bico' },
  status: 'confirmed',
  scheduled_at: '2026-06-14T20:00:00.000Z',
  format: 5,
  mode: 'Masculino',
  location: 'Parque Chas',
  cancha_cost: 3500,
  result_status: null,
};

const renderDetail = async ({
  match = baseChallengeMatch,
  initialEntry = `/desafios/equipos/partidos/${baseChallengeMatch.id}`,
} = {}) => {
  getTeamMatchById.mockResolvedValue(match);
  listTeamMatchMembers.mockResolvedValue({});
  listChallengeTeamSquad.mockResolvedValue({ byTeamId: {}, challenge: null });
  getChallengeHeadToHeadStats.mockResolvedValue({});

  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/desafios/equipos/partidos/:matchId"
          element={<TeamMatchDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );

  // Wait until the match finished loading: the VS hero card only renders once
  // the match is present (and not cancelled).
  await waitFor(() => expect(screen.getByText('VS')).toBeInTheDocument());
};

describe('detalle de desafío - Match Info Header', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('renderiza MatchInfoSection en el detalle del desafío', async () => {
    await renderDetail();
    expect(screen.getByTestId('match-info-section')).toBeInTheDocument();
  });

  test('el header aparece debajo de los chips y ANTES de la card VS', async () => {
    await renderDetail();

    const chip = screen.getByText('Desafio');
    const header = screen.getByTestId('match-info-section');
    const vs = screen.getByText('VS');

    // Orden esperado en el DOM: chip "Desafio" -> header -> card VS.
    // eslint-disable-next-line no-bitwise
    const chipBeforeHeader = Boolean(
      chip.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // eslint-disable-next-line no-bitwise
    const headerBeforeVs = Boolean(
      header.compareDocumentPosition(vs) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(chipBeforeHeader).toBe(true);
    expect(headerBeforeVs).toBe(true);
  });

  test('muestra fecha, hora, formato, género, sede y precio', async () => {
    await renderDetail();

    const header = within(screen.getByTestId('match-info-section'));

    // fecha (DD/MM/YY) y hora (HH:MM) -- robustas ante zona horaria
    expect(header.getByText(/\d{2}\/\d{2}\/\d{2}/)).toBeInTheDocument();
    expect(header.getByText(/\d{2}:\d{2}/)).toBeInTheDocument();

    // formato F5
    expect(header.getByText('F5')).toBeInTheDocument();
    // género / tipo
    expect(header.getByText('Masculino')).toBeInTheDocument();
    // sede (primera palabra significativa de "Parque Chas")
    expect(header.getByText('Parque')).toBeInTheDocument();
    // precio (formato es-AR: $3.500)
    expect(header.getByText(/\$\s?3[.,\s]?500/)).toBeInTheDocument();
  });

  test('usa fallbacks "A definir" cuando faltan sede y precio', async () => {
    await renderDetail({
      match: {
        ...baseChallengeMatch,
        location: null,
        location_name: null,
        cancha_cost: null,
      },
    });

    const header = within(screen.getByTestId('match-info-section'));
    // Sede y precio caen al mismo fallback que el partido común/amistoso.
    expect(header.getAllByText('A definir').length).toBeGreaterThanOrEqual(2);
  });

  test('la ruta desde la notificación challenge_result_survey también muestra el header', async () => {
    await renderDetail({
      initialEntry: `/desafios/equipos/partidos/${baseChallengeMatch.id}?action=open_challenge_result_modal`,
    });

    const header = screen.getByTestId('match-info-section');
    const vs = screen.getByText('VS');
    expect(header).toBeInTheDocument();
    // eslint-disable-next-line no-bitwise
    expect(
      Boolean(header.compareDocumentPosition(vs) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });
});

describe('MatchInfoSection - partido común / amistoso no se rompe', () => {
  // eslint-disable-next-line global-require
  const MatchInfoSection = require('../components/MatchInfoSection').default;

  test('renderiza el mismo header con datos de un partido común', () => {
    render(
      <MatchInfoSection
        partido={{
          fecha: '2026-06-14',
          hora: '21:30',
          modalidad: 'F7',
          tipo_partido: 'Mixto',
          sede: 'Club River',
          precio_cancha_por_persona: 4000,
        }}
      />,
    );

    const header = within(screen.getByTestId('match-info-section'));
    expect(header.getByText('21:30')).toBeInTheDocument();
    expect(header.getByText('F7')).toBeInTheDocument();
    expect(header.getByText('Mixto')).toBeInTheDocument();
    expect(header.getByText('Club')).toBeInTheDocument();
    expect(header.getByText(/\$\s?4[.,\s]?000/)).toBeInTheDocument();
  });

  test('aplica fallback "A definir" cuando el partido común no tiene sede ni precio', () => {
    render(<MatchInfoSection partido={{ fecha: '2026-06-14', hora: '21:30' }} />);

    const header = within(screen.getByTestId('match-info-section'));
    expect(header.getAllByText('A definir').length).toBeGreaterThanOrEqual(2);
  });
});
