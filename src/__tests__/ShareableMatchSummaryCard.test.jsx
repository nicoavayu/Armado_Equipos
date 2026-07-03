import { render, screen } from '@testing-library/react';
import ShareableMatchSummaryCard from '../components/share/ShareableMatchSummaryCard';

const award = (kind, label, playerName, color) => ({
  kind,
  label,
  playerName,
  playerInitial: playerName.charAt(0),
  playerAvatarUrl: null,
  icon: `/${kind}.webp`,
  color,
});

const data = {
  title: 'RESUMEN DEL PARTIDO',
  website: 'arma2.com.ar',
  matchName: 'Jueves F5',
  format: 'F5',
  dateTime: '03/07/26 · 12:00',
  venue: 'Garden',
  result: {
    outcome: 'winner',
    winnerTeam: 'A',
    heading: 'EQUIPO GANADOR',
    players: ['Nico', 'nixonbuddy', 'Juan Pablo Largo', 'Fede', 'Mati'],
    label: 'Nico · nixonbuddy · Juan Pablo Largo · Fede · Mati',
    scoreline: null,
  },
  awards: [
    award('mvp', 'MVP', 'Nico', '#FFD700'),
    award('glove', 'MEJOR ARQUERO', 'nixonbuddy', '#22d3ee'),
    award('dirty', 'MÁS SUCIO', 'Fede', '#f87171'),
  ],
};

describe('ShareableMatchSummaryCard', () => {
  test('keeps only the footer logo and renders every winning player', () => {
    render(<ShareableMatchSummaryCard data={data} />);

    expect(screen.getAllByAltText('Arma2')).toHaveLength(1);
    expect(screen.getByText('EQUIPO GANADOR')).toBeInTheDocument();
    data.result.players.forEach((name) => {
      expect(screen.getAllByText(name).length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText(/Victoria del equipo/i)).not.toBeInTheDocument();
  });

  test('renders each award once in the three-award mosaic', () => {
    render(<ShareableMatchSummaryCard data={data} />);

    expect(screen.getAllByText('MVP')).toHaveLength(1);
    expect(screen.getAllByText('MEJOR ARQUERO')).toHaveLength(1);
    expect(screen.getAllByText('MÁS SUCIO')).toHaveLength(1);
  });
});
