import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PartidoInvitacion from '../pages/PartidoInvitacion';
import { supabase } from '../supabase';

const MATCH_ID = 321;
const MATCH_CODE = 'H03G61';
const INVITE_TOKEN = '0123456789abcdef0123456789abcdef';

let mockAuthUser = null;
let mockMatchRow;
let mockPlayersRows;
let mockInviteValidation;
let mockInviteValidationError;

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => ({ user: mockAuthUser }),
}));

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('../utils/membershipCheck', () => ({
  clearGuestMembership: jest.fn(),
  isUserMemberOfMatch: jest.fn(async () => ({ isMember: false, jugadorRow: null })),
}));

jest.mock('../components/ProfileComponents', () => ({
  PlayerCardTrigger: ({ children }) => children,
}));

jest.mock('../components/InviteAmigosModal', () => () => null);
jest.mock('../components/TabBar', () => () => null);

jest.mock('../hooks/useRefreshOnVisibility', () => ({
  useRefreshOnVisibility: jest.fn(),
}));

jest.mock('../hooks/useSupabaseRealtime', () => ({
  useSupabaseRealtime: jest.fn(),
}));

jest.mock('../hooks/useInterval', () => ({
  useInterval: () => ({
    setIntervalSafe: jest.fn(),
    clearIntervalSafe: jest.fn(),
  }),
}));

jest.mock('../hooks/useSmartBackNavigation', () => ({
  useSmartBackNavigation: () => jest.fn(),
}));

jest.mock('../hooks/useScrollReset', () => ({
  useScrollResetOnChange: jest.fn(),
}));

jest.mock('../utils/calendarInvite', () => ({
  openMatchCalendarInvite: jest.fn(),
}));

jest.mock('utils/notifyBlockingError', () => ({
  notifyBlockingError: jest.fn(),
}));

jest.mock('../services/db/matchScheduling', () => ({
  findUserScheduleConflicts: jest.fn(),
}));

jest.mock('../services/matchJoinNotificationService', () => ({
  notifyAdminJoinRequest: jest.fn(),
  notifyAdminPlayerJoined: jest.fn(),
}));

jest.mock('../services/pushDispatchService', () => ({
  requestImmediatePushDispatch: jest.fn(),
}));

const buildMatch = (overrides = {}) => ({
  id: MATCH_ID,
  codigo: MATCH_CODE,
  nombre: 'Fútbol del miércoles',
  fecha: '2099-01-01',
  hora: '20:00',
  sede: 'Club Test',
  modalidad: 'F5',
  tipo_partido: 'Masculino',
  cupo_jugadores: 10,
  creado_por: 'admin-user',
  estado: 'activo',
  player_invites_enabled: false,
  ...overrides,
});

const createQueryBuilder = (result) => {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    in: jest.fn(() => builder),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => result),
    single: jest.fn(async () => result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };

  return builder;
};

const renderInvite = (search = `?c=${MATCH_CODE}&i=${INVITE_TOKEN}`) => render(
  <MemoryRouter
    initialEntries={[`/partido/${MATCH_ID}/invitacion${search}`]}
    future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
  >
    <Routes>
      <Route path="/partido/:partidoId/invitacion" element={<PartidoInvitacion />} />
      <Route path="/" element={<main>Home privada</main>} />
    </Routes>
  </MemoryRouter>,
);

describe('public WhatsApp guest match invitation flow', () => {
  const originalSupabaseUrl = process.env.REACT_APP_SUPABASE_URL;
  const originalAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();

    mockAuthUser = null;
    mockMatchRow = buildMatch();
    mockPlayersRows = [];
    mockInviteValidation = { ok: true, reason: null };
    mockInviteValidationError = null;

    process.env.REACT_APP_SUPABASE_URL = 'https://supabase.example.test';
    process.env.REACT_APP_SUPABASE_ANON_KEY = 'anon-test-key';

    supabase.rpc.mockImplementation(async (name) => {
      if (name === 'validate_guest_match_invite') {
        return { data: [mockInviteValidation], error: mockInviteValidationError };
      }
      if (name === 'get_partido_by_invite') {
        return { data: [mockMatchRow], error: null };
      }
      return { data: null, error: null };
    });

    supabase.from.mockImplementation((table) => {
      if (table === 'jugadores') {
        return createQueryBuilder({
          data: mockPlayersRows,
          count: mockPlayersRows.length,
          error: null,
        });
      }
      return createQueryBuilder({ data: null, error: null });
    });

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        guest_uuid: '11111111-1111-4111-8111-111111111111',
        jugador: { id: 99, nombre: 'Juan Pérez' },
      }),
    }));
  });

  afterAll(() => {
    if (originalSupabaseUrl === undefined) {
      delete process.env.REACT_APP_SUPABASE_URL;
    } else {
      process.env.REACT_APP_SUPABASE_URL = originalSupabaseUrl;
    }
    if (originalAnonKey === undefined) {
      delete process.env.REACT_APP_SUPABASE_ANON_KEY;
    } else {
      process.env.REACT_APP_SUPABASE_ANON_KEY = originalAnonKey;
    }
  });

  test('un enlace válido abre sin sesión, login ni registro y muestra los datos necesarios', async () => {
    renderInvite();

    expect(await screen.findByRole('heading', { name: 'Sumarte rápido' })).toBeInTheDocument();
    expect(screen.getByText('Fútbol del miércoles')).toBeInTheDocument();
    expect(screen.getByText('20:00')).toBeInTheDocument();
    expect(screen.getByText('Club Test')).toBeInTheDocument();
    expect(screen.queryByText(/iniciar sesión|crear cuenta/i)).not.toBeInTheDocument();
    expect(supabase.rpc).toHaveBeenCalledWith('validate_guest_match_invite', {
      p_partido_id: MATCH_ID,
      p_codigo: MATCH_CODE,
      p_token: INVITE_TOKEN,
    });
  });

  test('una persona sin cuenta ni app puede sumarse como invitada con el token existente', async () => {
    renderInvite();

    fireEvent.change(await screen.findByPlaceholderText('Ej: Juan Pérez'), {
      target: { value: 'Juan Pérez' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar al partido' }));

    expect(await screen.findByRole('heading', { name: '¡Listo!' })).toBeInTheDocument();
    expect(screen.getByText(/Te sumaste al partido como/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      'https://supabase.example.test/functions/v1/join-match-guest',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }),
    );

    const request = global.fetch.mock.calls[0][1];
    expect(JSON.parse(request.body)).toEqual(expect.objectContaining({
      partido_id: MATCH_ID,
      codigo: MATCH_CODE,
      invite: INVITE_TOKEN,
      nombre: 'Juan Pérez',
    }));
  });

  test('un código vacío se rechaza antes de consultar datos del partido', async () => {
    renderInvite(`?c=&i=${INVITE_TOKEN}`);

    expect(await screen.findByRole('heading', { name: 'Invitación inválida' })).toBeInTheDocument();
    expect(screen.getByText('Este link de invitación no es válido.')).toBeInTheDocument();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test.each([
    ['inválido', 'invalid_code'],
    ['vencido', 'invalid_invite'],
  ])('un código o token %s muestra el mensaje público correcto', async (_label, reason) => {
    mockInviteValidation = { ok: false, reason };
    renderInvite();

    expect(await screen.findByRole('heading', { name: 'Invitación inválida' })).toBeInTheDocument();
    expect(screen.getByText('Este link de invitación no es válido.')).toBeInTheDocument();
    expect(supabase.rpc).not.toHaveBeenCalledWith('get_partido_by_invite', expect.anything());
  });

  test('un fallo de prevalidación cierra el flujo sin revelar datos por código', async () => {
    mockInviteValidationError = { code: 'NETWORK_ERROR', message: 'fetch failed' };
    renderInvite();

    expect(await screen.findByRole('heading', { name: 'Invitación inválida' })).toBeInTheDocument();
    expect(screen.getByText('Este link de invitación no es válido.')).toBeInTheDocument();
    expect(supabase.rpc).not.toHaveBeenCalledWith('get_partido_by_invite', expect.anything());
    expect(supabase.from).not.toHaveBeenCalledWith('jugadores');
  });

  test('un partido completo informa que no quedan cupos', async () => {
    mockMatchRow = buildMatch({ cupo_jugadores: 1 });
    mockPlayersRows = Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      nombre: `Jugador ${index + 1}`,
      partido_id: MATCH_ID,
    }));
    renderInvite();

    expect(await screen.findByRole('heading', { name: 'Partido completo' })).toBeInTheDocument();
    expect(screen.getByText('Ya no hay más cupos disponibles.')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('un partido cerrado informa su estado y no muestra el formulario de ingreso', async () => {
    mockMatchRow = buildMatch({ estado: 'finalizado' });
    renderInvite();

    expect(await screen.findByText('Este partido fue cancelado o cerrado.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sumarte rápido' })).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('un deep link tokenizado sigue abriendo el partido si la app ya tiene sesión', async () => {
    mockAuthUser = { id: 'signed-in-user', email: 'jugador@example.com' };
    renderInvite();

    expect(await screen.findByText(/Te invitaron a jugar/i)).toBeInTheDocument();
    expect(supabase.rpc).toHaveBeenCalledWith('get_partido_by_invite', {
      p_partido_id: MATCH_ID,
      p_codigo: MATCH_CODE,
    });
    expect(supabase.from).not.toHaveBeenCalledWith('notifications_ext');
    expect(supabase.from).not.toHaveBeenCalledWith('notifications');
  });

  test('la respuesta idempotente del backend conserva el estado de invitado ya anotado', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        already_joined: true,
        guest_uuid: '11111111-1111-4111-8111-111111111111',
        jugador: { id: 99, nombre: 'Juan Pérez' },
      }),
    });
    renderInvite();

    fireEvent.change(await screen.findByPlaceholderText('Ej: Juan Pérez'), {
      target: { value: 'Juan Pérez' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar al partido' }));

    expect(await screen.findByRole('heading', { name: 'Ya estás anotado' })).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  });
});
