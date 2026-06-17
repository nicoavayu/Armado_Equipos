import { fireEvent, render, screen } from '@testing-library/react';
import ChallengeTeamModal from '../features/equipos/components/ChallengeTeamModal';

jest.mock('../features/equipos/components/NeighborhoodAutocomplete', () => function MockNeighborhoodAutocomplete({
  value,
  onChange,
}) {
  return (
    <input
      aria-label="zona-cancha"
      value={value || ''}
      onChange={(event) => onChange(event.target.value)}
    />
  );
});

const challengedTeam = { team_id: 'rival-1', team_name: 'Napoli', format: 5 };
const myTeams = [
  { id: 't1', name: 'Fulbo FC', format: 5, base_zone: 'Palermo', is_active: true },
];

const renderModal = (props = {}) => render(
  <ChallengeTeamModal
    isOpen
    challengedTeam={challengedTeam}
    myTeams={myTeams}
    onClose={jest.fn()}
    onSubmit={jest.fn()}
    {...props}
  />,
);

describe('ChallengeTeamModal', () => {
  test('shows the rival name in the title and the format', () => {
    renderModal();
    expect(screen.getByText('Desafiar a Napoli')).toBeInTheDocument();
    expect(screen.getByText('F5')).toBeInTheDocument();
    expect(screen.getByText(/Fulbo FC/)).toBeInTheDocument();
  });

  test('confirming calls onSubmit with my team, rival, date, format-matched team and message', () => {
    const onSubmit = jest.fn();
    renderModal({ onSubmit });

    fireEvent.change(screen.getByLabelText(/Fecha y hora/i), {
      target: { value: '2026-06-20T21:00' },
    });
    fireEvent.change(screen.getByLabelText(/Mensaje/i), {
      target: { value: '¿Juegan este jueves?' },
    });

    fireEvent.submit(document.getElementById('challenge-team-form'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toMatchObject({
      challengerTeamId: 't1',
      challengedTeamId: 'rival-1',
      notes: '¿Juegan este jueves?',
    });
    expect(payload.scheduledAt).toBeTruthy();
  });

  test('renders a clear error message when the service fails', () => {
    renderModal({ errorMessage: 'Ya tenés 2 desafíos abiertos. Cerrá uno pendiente para crear otro.' });
    expect(screen.getByText(/Ya tenés 2 desafíos abiertos/)).toBeInTheDocument();
  });

  test('disables submit + warns when I have no team of the rival format', () => {
    const onSubmit = jest.fn();
    render(
      <ChallengeTeamModal
        isOpen
        challengedTeam={{ team_id: 'rival-2', team_name: 'Roma', format: 7 }}
        myTeams={myTeams}
        onClose={jest.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText(/No tenés un equipo F7 para desafiar/)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: /Enviar desafío/ });
    expect(submit).toBeDisabled();
  });

  test('does not render a "Publicar desafío" CTA', () => {
    renderModal();
    expect(screen.queryByText('Publicar desafío')).not.toBeInTheDocument();
  });
});
