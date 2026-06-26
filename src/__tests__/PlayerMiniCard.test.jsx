import { render, screen } from '@testing-library/react';
import PlayerMiniCard from '../components/PlayerMiniCard';

const profile = {
  nombre: 'Lionel Messi',
  ranking: 8.4,
  posicion: 'DEL',
};

describe('PlayerMiniCard — compact card keeps data', () => {
  test('muestra nombre, rating y posición (searching / JUGADORES)', () => {
    render(<PlayerMiniCard profile={profile} variant="searching" />);
    expect(screen.getByText('Lionel Messi')).toBeInTheDocument();
    expect(screen.getByText('8.4')).toBeInTheDocument();
    expect(screen.getByText('DEL')).toBeInTheDocument();
  });

  test('muestra nombre, rating y posición (friend / AMIGOS)', () => {
    render(<PlayerMiniCard profile={profile} variant="friend" />);
    expect(screen.getByText('Lionel Messi')).toBeInTheDocument();
    expect(screen.getByText('8.4')).toBeInTheDocument();
    expect(screen.getByText('DEL')).toBeInTheDocument();
  });

  test('muestra la distancia cuando está disponible (searching)', () => {
    render(<PlayerMiniCard profile={profile} variant="searching" distanceKm={3} />);
    expect(screen.getByText(/3 km/i)).toBeInTheDocument();
  });
});
