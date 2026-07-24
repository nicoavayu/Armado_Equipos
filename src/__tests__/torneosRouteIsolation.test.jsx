import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';

describe('Arma2 Torneos route isolation', () => {
  test('redirects to the personal home when the product flag is disabled', () => {
    render(
      <MemoryRouter initialEntries={['/torneos/inicio']}>
        <Routes>
          <Route path="/" element={<div>Arma2 personal</div>} />
          <Route
            path="/torneos/*"
            element={<TorneosFeatureGate enabled={false} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Arma2 personal')).toBeInTheDocument();
    expect(screen.queryByText('Todo listo para la')).not.toBeInTheDocument();
  });

  test('mounts its own navigation shell when explicitly enabled', async () => {
    render(
      <MemoryRouter initialEntries={['/torneos/inicio']}>
        <Routes>
          <Route
            path="/torneos/*"
            element={<TorneosFeatureGate enabled />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: /todo listo para la fecha 08/i }))
      .toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Navegación de Torneos' }))
      .toBeInTheDocument();
    expect(screen.queryByText('Crear partido')).not.toBeInTheDocument();
    expect(screen.queryByText('Amigos')).not.toBeInTheDocument();
  });
});

