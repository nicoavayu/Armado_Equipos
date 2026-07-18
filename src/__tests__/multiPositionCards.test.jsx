import { render, screen } from '@testing-library/react';
import PlayerMiniCard from '../components/PlayerMiniCard';
import ProfileCard from '../components/ProfileCard';

describe('PlayerMiniCard positions', () => {
  test('one position renders a single badge', () => {
    render(<PlayerMiniCard profile={{ nombre: 'Uno', posiciones: ['DEF'] }} variant="searching" />);
    expect(screen.getByText('DEF')).toBeInTheDocument();
    expect(screen.queryByText('ARQ')).not.toBeInTheDocument();
  });

  test('two positions render two badges', () => {
    render(<PlayerMiniCard profile={{ nombre: 'Dos', posiciones: ['ARQ', 'DEL'] }} variant="searching" />);
    expect(screen.getByText('ARQ')).toBeInTheDocument();
    expect(screen.getByText('DEL')).toBeInTheDocument();
  });

  test('legacy single posicion still renders', () => {
    render(<PlayerMiniCard profile={{ nombre: 'Legacy', posicion: 'MED' }} variant="searching" />);
    expect(screen.getByText('MED')).toBeInTheDocument();
  });
});

describe('ProfileCard positions', () => {
  const baseProfile = {
    nombre: 'Jugador',
    pais_codigo: 'AR',
    ranking: 5,
    partidos_jugados: 10,
  };

  test('one position shows a single (non-stacked) badge', () => {
    render(<ProfileCard profile={{ ...baseProfile, posiciones: ['DEF'] }} isVisible performanceMode />);
    expect(screen.getByText('DEF')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Posiciones/i)).not.toBeInTheDocument();
  });

  test('two positions render stacked badges without dropping other data', () => {
    render(<ProfileCard profile={{ ...baseProfile, posiciones: ['ARQ', 'DEL'] }} isVisible performanceMode />);
    const stack = screen.getByLabelText('Posiciones ARQ, DEL');
    expect(stack).toBeInTheDocument();
    expect(screen.getByText('ARQ')).toBeInTheDocument();
    expect(screen.getByText('DEL')).toBeInTheDocument();
    // Other card data still present (PJ label + value).
    expect(screen.getByText('PJ')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });
});
