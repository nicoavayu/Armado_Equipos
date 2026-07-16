import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import PublicVotingRouteIsolation from '../components/PublicVotingRouteIsolation';

let mockNativePlatform = false;
let mockPlatform = 'web';

jest.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mockNativePlatform,
    getPlatform: () => mockPlatform,
  },
}));

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
};

const VotingScreen = () => {
  const navigate = useNavigate();
  return (
    <main>
      <h1>Votación pública</h1>
      <button type="button" onClick={() => navigate('/')}>Intentar Home</button>
      <button type="button" onClick={() => navigate('/profile')}>Intentar Perfil</button>
      <button type="button" onClick={() => navigate('/quiero-jugar')}>Intentar Partido automático</button>
      <button
        type="button"
        onClick={() => navigate('/partido/321/invitacion?c=H03G61&i=0123456789abcdef0123456789abcdef')}
      >
        Intentar Invitación
      </button>
      <LocationProbe />
    </main>
  );
};

const InviteScreen = () => {
  const navigate = useNavigate();
  return (
    <main>
      <h1>Invitación pública</h1>
      <button type="button" onClick={() => navigate('/profile')}>Intentar Perfil</button>
      <button type="button" onClick={() => navigate('/votar-equipos?codigo=H03G61')}>
        Intentar Votación
      </button>
      <button
        type="button"
        onClick={() => navigate('/partido/999/invitacion?c=OTRO99&i=ffffffffffffffffffffffffffffffff')}
      >
        Intentar Otra Invitación
      </button>
      <LocationProbe />
    </main>
  );
};

const PrivateHome = () => {
  const navigate = useNavigate();
  return (
    <main>
      <h1>Home privada</h1>
      <button type="button" onClick={() => navigate('/votar-equipos?codigo=H03G61')}>
        Abrir votación
      </button>
      <LocationProbe />
    </main>
  );
};

const renderRoutes = (initialEntry) => render(
  <MemoryRouter
    initialEntries={[initialEntry]}
    future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
  >
    <PublicVotingRouteIsolation>
      <Routes>
        <Route path="/votar-equipos" element={<VotingScreen />} />
        <Route path="/partido/:partidoId/invitacion" element={<InviteScreen />} />
        <Route path="/" element={<PrivateHome />} />
        <Route path="/profile" element={<main><h1>Perfil privado</h1><LocationProbe /></main>} />
        <Route path="/quiero-jugar" element={<main><h1>Partido automático privado</h1><LocationProbe /></main>} />
        <Route path="*" element={<main><h1>Ruta bloqueada</h1><LocationProbe /></main>} />
      </Routes>
    </PublicVotingRouteIsolation>
  </MemoryRouter>,
);

describe('PublicVotingRouteIsolation', () => {
  beforeEach(() => {
    mockNativePlatform = false;
    mockPlatform = 'web';
  });

  test.each([
    ['Home', 'Intentar Home'],
    ['Perfil', 'Intentar Perfil'],
    ['Partido automático', 'Intentar Partido automático'],
    ['Invitación', 'Intentar Invitación'],
  ])('una sesión pública web no puede navegar a %s', async (_label, buttonName) => {
    renderRoutes('/votar-equipos?codigo=H03G61&source=whatsapp');

    fireEvent.click(screen.getByRole('button', { name: buttonName }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/votar-equipos?codigo=H03G61&source=whatsapp',
      );
    });
    expect(screen.getByRole('heading', { name: 'Votación pública' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /privad[ao]/i })).not.toBeInTheDocument();
  });

  test('una ruta parecida no activa la sesión pública', () => {
    renderRoutes('/votar-equipos-extra?codigo=H03G61');

    expect(screen.getByRole('heading', { name: 'Ruta bloqueada' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/votar-equipos-extra?codigo=H03G61');
  });

  test('el aislamiento también se activa al entrar a la votación desde una ruta privada web', async () => {
    renderRoutes('/');

    fireEvent.click(screen.getByRole('button', { name: 'Abrir votación' }));
    expect(await screen.findByRole('heading', { name: 'Votación pública' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Intentar Perfil' }));
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/votar-equipos?codigo=H03G61');
    });
    expect(screen.queryByRole('heading', { name: 'Perfil privado' })).not.toBeInTheDocument();
  });

  test.each(['Intentar Perfil', 'Intentar Votación', 'Intentar Otra Invitación'])(
    'una invitación web válida no puede usar su excepción para %s',
    async (buttonName) => {
      const inviteEntry = '/partido/321/invitacion?c=H03G61&i=0123456789abcdef0123456789abcdef';
      renderRoutes(inviteEntry);

      fireEvent.click(screen.getByRole('button', { name: buttonName }));

      await waitFor(() => {
        expect(screen.getByTestId('location')).toHaveTextContent(inviteEntry);
      });
      expect(screen.getByRole('heading', { name: 'Invitación pública' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Perfil privado' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Votación pública' })).not.toBeInTheDocument();
    },
  );

  test('una invitación sin token no activa la sesión pública de invitado', () => {
    renderRoutes('/partido/321/invitacion?c=H03G61');

    expect(screen.getByRole('heading', { name: 'Invitación pública' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Intentar Perfil' }));
    expect(screen.getByRole('heading', { name: 'Perfil privado' })).toBeInTheDocument();
  });

  test.each(['ios', 'android'])('la navegación nativa de %s no cambia', async (platform) => {
    mockNativePlatform = true;
    mockPlatform = platform;
    renderRoutes('/votar-equipos?codigo=H03G61');

    fireEvent.click(screen.getByRole('button', { name: 'Intentar Perfil' }));

    expect(await screen.findByRole('heading', { name: 'Perfil privado' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/profile');
  });

  test.each(['ios', 'android'])(
    'el deep link de invitación conserva la navegación nativa de %s',
    async (platform) => {
      mockNativePlatform = true;
      mockPlatform = platform;
      renderRoutes('/partido/321/invitacion?c=H03G61&i=0123456789abcdef0123456789abcdef');

      fireEvent.click(screen.getByRole('button', { name: 'Intentar Perfil' }));

      expect(await screen.findByRole('heading', { name: 'Perfil privado' })).toBeInTheDocument();
      expect(screen.getByTestId('location')).toHaveTextContent('/profile');
    },
  );
});
