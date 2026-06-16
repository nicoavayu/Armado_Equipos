import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import TeamMatchDetailPage from '../pages/TeamMatchDetailPage';
import {
  getTeamMatchById,
  listTeamMatchMembers,
  listChallengeTeamSquad,
  getChallengeHeadToHeadStats,
  updateTeamMatchDetails,
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

// LocationAutocomplete arrastra dependencias de geocoding; lo reemplazamos por
// un input controlado simple para poder editar la sede dentro del modal.
jest.mock('../features/equipos/components/LocationAutocomplete', () => {
  const ReactLib = require('react');
  return {
    __esModule: true,
    default: ({ value, onChange, placeholder }) => ReactLib.createElement('input', {
      'aria-label': 'sede-input',
      placeholder,
      value: value || '',
      onChange: (event) => onChange(event.target.value),
    }),
  };
});

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

const renderDetail = async ({ match = buildMatch(), squadChallenge = null, membersByTeamId = {} } = {}) => {
  getTeamMatchById.mockResolvedValue(match);
  listTeamMatchMembers.mockResolvedValue(membersByTeamId);
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

  // Regresión del bug del teléfono: el kebab debe vivir en la barra fija
  // superior (junto al botón de chat), NO como primer hijo del contenido. En
  // dispositivos con notch/safe-area ese primer hijo queda detrás del header
  // fijo y el usuario no veía los tres puntitos aunque los tests (safe-top=0)
  // pasaran. Comprobamos que comparten contenedor con el botón de chat.
  test('los tres puntitos viven en el header, junto al chat (no en un contenedor del contenido que el header tapa)', async () => {
    mockUserId.current = 'creator-user';
    await renderDetail();
    const kebab = screen.getByRole('button', { name: 'Mas acciones' });
    const chat = screen.getByRole('button', { name: 'Abrir chat' });
    expect(kebab.parentElement).toBe(chat.parentElement);
  });

  test('el creador ve los tres puntitos en un desafío confirmed sin resultado', async () => {
    mockUserId.current = 'creator-user';
    await renderDetail({
      match: buildMatch({
        status: 'confirmed',
        result_status: null,
        challenge: { id: 'challenge-1', created_by_user_id: 'creator-user', status: 'confirmed' },
      }),
    });
    expect(screen.getByRole('button', { name: 'Mas acciones' })).toBeInTheDocument();
  });

  test('un admin del equipo ve los tres puntitos aunque no sea el creador', async () => {
    mockUserId.current = 'admin-user';
    await renderDetail({
      match: buildMatch({
        challenge: { id: 'challenge-1', created_by_user_id: 'creator-user', status: 'accepted' },
      }),
      membersByTeamId: {
        'team-a': [{
          id: 'member-admin',
          team_id: 'team-a',
          user_id: 'admin-user',
          permissions_role: 'admin',
          is_captain: false,
        }],
      },
    });
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

  // Regresión del bug reportado: el desafío ya aceptado/confirmado cuyo horario
  // original ya pasó debe seguir mostrando el menú para poder reprogramar,
  // mientras no haya resultado cargado ni esté cancelado/cerrado.
  test('el creador ve los tres puntitos aunque el horario ya haya pasado (sin resultado)', async () => {
    mockUserId.current = 'creator-user';
    await renderDetail({
      match: buildMatch({ scheduled_at: '2020-01-01T20:00:00.000Z' }),
    });
    expect(screen.getByRole('button', { name: 'Mas acciones' })).toBeInTheDocument();
  });

  test('el creador ve los tres puntitos si el match esta played pero sin resultado', async () => {
    mockUserId.current = 'creator-user';
    await renderDetail({
      match: buildMatch({
        status: 'played',
        scheduled_at: '2020-01-01T20:00:00.000Z',
        result_status: null,
        result_confirmed: false,
        result_conflict: false,
      }),
    });
    expect(screen.getByRole('button', { name: 'Mas acciones' })).toBeInTheDocument();
  });

  test('no muestra los tres puntitos cuando ya hay result_status cargado', async () => {
    mockUserId.current = 'creator-user';
    await renderDetail({
      match: buildMatch({ result_status: 'team_a_win' }),
    });
    expect(screen.queryByRole('button', { name: 'Mas acciones' })).not.toBeInTheDocument();
  });

  test('al tocar los tres puntitos aparece "Editar partido" y abre el modal existente', async () => {
    mockUserId.current = 'creator-user';
    await renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Mas acciones' }));
    const editItem = await screen.findByRole('button', { name: 'Editar partido' });
    expect(editItem).toBeInTheDocument();

    fireEvent.click(editItem);
    expect(await screen.findByText('Editar datos del partido')).toBeInTheDocument();
  });

  test('permite editar sede y fecha/hora y actualiza el Match Info Header al guardar', async () => {
    mockUserId.current = 'creator-user';
    await renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Mas acciones' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Editar partido' }));
    await screen.findByText('Editar datos del partido');

    // El header arranca mostrando la sede original ("Parque Chas").
    const headerBefore = within(screen.getByTestId('match-info-section'));
    expect(headerBefore.getByText('Parque')).toBeInTheDocument();

    // Editar sede.
    const sedeInput = screen.getByLabelText('sede-input');
    fireEvent.change(sedeInput, { target: { value: 'Cancha Nueva' } });

    // Editar fecha/hora.
    const fechaInput = screen.getByLabelText('Fecha y hora');
    fireEvent.change(fechaInput, { target: { value: '2099-02-02T12:30' } });

    const updatedMatch = buildMatch({
      location: 'Cancha Nueva',
      location_name: 'Cancha Nueva',
      scheduled_at: '2099-02-02T15:30:00.000Z',
    });
    updateTeamMatchDetails.mockResolvedValue(updatedMatch);
    // La hidratación posterior al guardado vuelve a leer el partido actualizado.
    getTeamMatchById.mockResolvedValue(updatedMatch);

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(updateTeamMatchDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'match-1',
        location: 'Cancha Nueva',
        scheduledAt: new Date('2099-02-02T12:30').toISOString(),
      }),
    ));

    // El Match Info Header refleja la nueva sede.
    await waitFor(() => {
      const headerAfter = within(screen.getByTestId('match-info-section'));
      expect(headerAfter.getByText('Cancha')).toBeInTheDocument();
    });
  });
});
