import { render, screen, fireEvent } from '@testing-library/react';
import ChallengeCard from '../features/equipos/components/ChallengeCard';

const buildChallenge = (overrides = {}) => ({
  id: 'challenge-1',
  status: 'open',
  format: 5,
  skill_level: 'intermedio',
  scheduled_at: '2099-01-01T20:00:00.000Z',
  location: 'Devoto',
  challenger_team: { id: 'team-a', name: 'Equipo A', base_zone: 'Devoto' },
  accepted_team: null,
  ...overrides,
});

describe('ChallengeCard - menú de edición en la card pública', () => {
  test('el dueño ve los tres puntitos y "Editar desafio", que dispara onEdit', () => {
    const onEdit = jest.fn();
    const challenge = buildChallenge();

    render(
      <ChallengeCard
        challenge={challenge}
        isOwnChallenge
        canEdit
        onEdit={onEdit}
      />,
    );

    const kebab = screen.getByRole('button', { name: 'Mas acciones' });
    expect(kebab).toBeInTheDocument();

    fireEvent.click(kebab);
    const editItem = screen.getByText('Editar desafio');
    expect(editItem).toBeInTheDocument();

    fireEvent.click(editItem);
    expect(onEdit).toHaveBeenCalledWith(challenge);
  });

  test('sin permiso de edición no se muestran los tres puntitos', () => {
    render(
      <ChallengeCard
        challenge={buildChallenge()}
        canEdit={false}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Mas acciones' })).not.toBeInTheDocument();
  });
});
