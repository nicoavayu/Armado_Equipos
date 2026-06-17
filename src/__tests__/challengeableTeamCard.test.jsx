import { render, screen, fireEvent } from '@testing-library/react';
import ChallengeableTeamCard from '../features/equipos/components/ChallengeableTeamCard';

const team = {
  team_id: 'rival-1',
  team_name: 'Napoli',
  format: 5,
  zone: 'Devoto',
  country_code: 'AR',
  played_count: 4,
  wins: 2,
  draws: 1,
  losses: 1,
};

const cardFor = (name) => screen.getByText(name).closest('.rounded-card');
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Acciones' }));

describe('ChallengeableTeamCard — acciones', () => {
  test('rival no muestra un botón "Desafiar" suelto en la card', () => {
    render(<ChallengeableTeamCard team={team} onChallenge={() => {}} />);
    // The big repeated CTA is gone: the only entry point is the ⋮ overflow menu.
    expect(screen.queryByRole('button', { name: /Desafiar/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acciones' })).toBeInTheDocument();
  });

  test('el menú ⋮ revela "Desafiar" y llama a onChallenge con el equipo', () => {
    const onChallenge = jest.fn();
    render(<ChallengeableTeamCard team={team} onChallenge={onChallenge} />);

    openMenu();
    const item = screen.getByRole('menuitem', { name: /Desafiar/ });
    fireEvent.click(item);

    expect(onChallenge).toHaveBeenCalledWith(team);
  });

  test('own team se resalta, muestra "Tu equipo" y NO tiene menú de acciones', () => {
    render(<ChallengeableTeamCard team={team} isOwnTeam />);
    expect(screen.getByText('Tu equipo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acciones' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Desafiar/ })).not.toBeInTheDocument();

    // The whole card carries the "my team" treatment (purple border/glow).
    const card = cardFor('Napoli');
    expect(card.className).toMatch(/125,90,255/);
  });

  test('desafío pendiente muestra "Desafío pendiente" y oculta el menú', () => {
    render(<ChallengeableTeamCard team={team} isPendingChallenge />);
    expect(screen.getByText('Desafío pendiente')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acciones' })).not.toBeInTheDocument();
  });

  test('sin equipos manejables no hay menú de acciones', () => {
    render(<ChallengeableTeamCard team={team} canChallenge={false} />);
    expect(screen.queryByRole('button', { name: 'Acciones' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Desafiar/ })).not.toBeInTheDocument();
  });

  test('nunca renderiza un CTA "Publicar desafío"', () => {
    render(<ChallengeableTeamCard team={team} onChallenge={() => {}} />);
    expect(screen.queryByText('Publicar desafío')).not.toBeInTheDocument();
  });
});
