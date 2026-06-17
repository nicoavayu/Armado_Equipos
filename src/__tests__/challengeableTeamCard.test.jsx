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

describe('ChallengeableTeamCard — CTA', () => {
  test('own team shows "Tu equipo" badge and no "Desafiar" button', () => {
    render(<ChallengeableTeamCard team={team} isOwnTeam />);
    expect(screen.getByText('Tu equipo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Desafiar/ })).not.toBeInTheDocument();
  });

  test('rival shows "Desafiar" and calls onChallenge with the team', () => {
    const onChallenge = jest.fn();
    render(<ChallengeableTeamCard team={team} onChallenge={onChallenge} />);
    const button = screen.getByRole('button', { name: /Desafiar/ });
    fireEvent.click(button);
    expect(onChallenge).toHaveBeenCalledWith(team);
  });

  test('pending challenge shows "Desafío pendiente" and hides the button', () => {
    render(<ChallengeableTeamCard team={team} isPendingChallenge />);
    expect(screen.getByText('Desafío pendiente')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Desafiar/ })).not.toBeInTheDocument();
  });

  test('hides the button when the user cannot challenge (no teams)', () => {
    render(<ChallengeableTeamCard team={team} canChallenge={false} />);
    expect(screen.queryByRole('button', { name: /Desafiar/ })).not.toBeInTheDocument();
  });

  test('never renders a "Publicar desafío" CTA', () => {
    render(<ChallengeableTeamCard team={team} onChallenge={() => {}} />);
    expect(screen.queryByText('Publicar desafío')).not.toBeInTheDocument();
  });
});
