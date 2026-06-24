import { render, screen } from '@testing-library/react';
import MatchSelectionCard from '../components/MatchSelectionCard';

const baseMatch = {
  id: 55,
  nombre: 'Partido test',
  fecha_display: 'Vie 20 mar',
  hora: '20:00',
  sede: 'Cancha Norte',
  modalidad: 'F7',
  tipo_partido: 'Mixto',
  jugadores_count: 5,
  cupo_jugadores: 14,
};

describe('MatchSelectionCard invite permission states', () => {
  test('muestra copy claro cuando sólo el organizador puede invitar', () => {
    render(
      <MatchSelectionCard
        match={baseMatch}
        inviteStatus="player_invites_disabled"
      />,
    );

    expect(screen.getByText('Sólo organizador')).toBeInTheDocument();
    expect(screen.getByText('El organizador no habilitó invitaciones de jugadores.')).toBeInTheDocument();
  });
});
