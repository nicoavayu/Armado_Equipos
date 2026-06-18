import { render, screen } from '@testing-library/react';
import ChallengeCard from '../features/equipos/components/ChallengeCard';

// Regression guard for the challenge-card team names being clipped: the name
// must always render in full text in the DOM (AutoFitText shrinks the font to
// fit and only wraps as a last resort — it never replaces/splits the text or
// adds an ellipsis).
const buildChallenge = (challengerName, rivalName) => ({
  id: 'challenge-1',
  status: 'open',
  format: 8,
  skill_level: 'competitivo',
  scheduled_at: '2099-01-01T20:00:00.000Z',
  location: 'Tafí del Valle',
  challenger_team: { id: 'team-a', name: challengerName, base_zone: 'La Paz' },
  accepted_team: { id: 'team-b', name: rivalName, base_zone: 'Montevideo' },
});

describe('ChallengeCard — nombres de equipo completos (sin recorte)', () => {
  const realWorldNames = ['Aston Birra', 'Los Troncos', 'Banda del Sur', 'Tercer Tiempo'];

  test.each(realWorldNames)('renders "%s" in full without truncation', (name) => {
    render(<ChallengeCard challenge={buildChallenge(name, 'Rival FC')} />);
    // Exact-text match => the whole name is a single, unmodified text node.
    expect(screen.getByText(name)).toBeInTheDocument();
  });

  test('renders both team names of a matchup in full', () => {
    render(<ChallengeCard challenge={buildChallenge('Aston Birra', 'Banda del Sur')} />);
    expect(screen.getByText('Aston Birra')).toBeInTheDocument();
    expect(screen.getByText('Banda del Sur')).toBeInTheDocument();
  });

  test('does not clip even a very long invented team name', () => {
    const longName = 'Deportivo Asociación Atlética Argentinos del Sur Unidos';
    render(<ChallengeCard challenge={buildChallenge(longName, 'Rival FC')} />);
    const node = screen.getByText(longName);
    expect(node).toBeInTheDocument();
    // The full string is present verbatim — no ellipsis character was injected.
    expect(node.textContent).toBe(longName);
    expect(node.textContent).not.toContain('…');
  });

  test('falls back to "Equipo" only when a side has no team (not clipping a name)', () => {
    const challenge = buildChallenge('Aston Birra', 'Banda del Sur');
    challenge.accepted_team = null;
    render(<ChallengeCard challenge={challenge} />);
    expect(screen.getByText('Aston Birra')).toBeInTheDocument();
    // Missing rival shows the "busco rival" fallback, never a clipped name.
    expect(screen.getByText('Busco rival')).toBeInTheDocument();
  });
});
