import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import VotingView from '../pages/VotingView';

const mockRpc = jest.fn();
const mockCheckIfAlreadyVoted = jest.fn();
const mockIsMatchVotingOpen = jest.fn();
const mockSubscribeToMatchUpdates = jest.fn();
const mockGetUser = jest.fn();
const mockGetGuestSessionId = jest.fn();
const mockResolveMatchId = jest.fn();

jest.mock('../supabase', () => ({
  checkIfAlreadyVoted: (...args) => mockCheckIfAlreadyVoted(...args),
  uploadFoto: jest.fn(),
  submitVotos: jest.fn(),
  isMatchVotingOpen: (...args) => mockIsMatchVotingOpen(...args),
  getGuestSessionId: (...args) => mockGetGuestSessionId(...args),
  supabase: {
    auth: {
      getUser: (...args) => mockGetUser(...args),
    },
    rpc: (...args) => mockRpc(...args),
    from: jest.fn(),
  },
}));

jest.mock('../utils/matchResolver', () => ({
  resolveMatchIdFromQueryParams: (...args) => mockResolveMatchId(...args),
}));

jest.mock('../services/realtimeService', () => ({
  subscribeToMatchUpdates: (...args) => mockSubscribeToMatchUpdates(...args),
}));

jest.mock('../components/ProfileComponents', () => ({
  AvatarFallback: ({ name }) => <div data-testid="avatar-fallback">{name}</div>,
}));

jest.mock('../hooks/useScrollReset', () => ({
  useScrollResetContainer: jest.fn(() => ({ current: null })),
  useScrollResetOnChange: jest.fn(),
}));

const jugadores = [
  { id: 7, uuid: 'guest-ana', nombre: 'Ana', usuario_id: null, avatar_url: null },
  { id: 8, uuid: 'guest-beto', nombre: 'Beto', usuario_id: null, avatar_url: null },
];

const renderPublicVoting = () => render(
  <VotingView
    jugadores={jugadores}
    partidoActual={{ id: 321, codigo: 'H03G61', jugadores }}
    onReset={jest.fn()}
    onCancel={jest.fn()}
  />,
);

describe('public guest voting flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, '', '/votar-equipos?codigo=H03G61');
    window.localStorage.clear();
    mockCheckIfAlreadyVoted.mockResolvedValue(false);
    mockIsMatchVotingOpen.mockResolvedValue(true);
    mockSubscribeToMatchUpdates.mockReturnValue(jest.fn());
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockGetGuestSessionId.mockReturnValue('guest-session-321');
    mockResolveMatchId.mockResolvedValue({ partidoId: 321, error: null });
    mockRpc.mockImplementation(async (name) => {
      if (name === 'public_has_voter_already_voted') return { data: false, error: null };
      if (name === 'public_submit_player_rating') return { data: 'ok', error: null };
      if (name === 'public_submit_no_lo_conozco') return { data: 'ok', error: null };
      if (name === 'public_mark_voter_completed') return { data: 'ok', error: null };
      return { data: null, error: null };
    });
  });

  test('un visitante sin cuenta completa un voto válido y ve la confirmación', async () => {
    renderPublicVoting();

    expect(await screen.findByText('¿QUIÉN SOS?')).toBeInTheDocument();
    expect(screen.queryByText(/iniciar sesión|registr/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ana' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText('¡HOLA, Ana!')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar sin foto' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Calificar 8 de 10' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText('¡GRACIAS POR VOTAR!')).toBeInTheDocument();
    expect(screen.getByText(/Tus votos fueron registrados/)).toBeInTheDocument();
    expect(screen.getByText(/Podés cerrar esta ventana/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Volver' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Home|Perfil|Iniciar sesión/i)).not.toBeInTheDocument();

    expect(mockRpc).toHaveBeenCalledWith('public_submit_player_rating', {
      p_partido_id: 321,
      p_codigo: 'H03G61',
      p_votante_nombre: 'Ana',
      p_votado_jugador_id: 8,
      p_puntaje: 8,
    });
    expect(mockRpc).toHaveBeenCalledWith('public_mark_voter_completed', {
      p_partido_id: 321,
      p_codigo: 'H03G61',
      p_votante_nombre: 'Ana',
    });
  });

  test('una votación vencida conserva el bloqueo existente', async () => {
    mockIsMatchVotingOpen.mockResolvedValue(false);
    renderPublicVoting();

    expect(await screen.findByText('Votación no disponible')).toBeInTheDocument();
    expect(screen.getByText('La votación no está abierta en este momento.')).toBeInTheDocument();
    expect(screen.queryByText(/iniciar sesión|contraseña|registr/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
