import React from 'react';
import { render, screen } from '@testing-library/react';
import MatchCard from '../components/MatchCard';

const basePartido = {
  id: 1,
  modalidad: 'F5',
  cupo_jugadores: 10,
  jugadores: [],
  sede: 'A coordinar',
};

describe('MatchCard challenge/friendly separation', () => {
  test('renders challenge badge when challenge_id exists even with neutral origin_type', () => {
    render(
      <MatchCard
        partido={{
          ...basePartido,
          source_type: 'team_match',
          origin_type: 'individual',
          challenge_id: 'c-1',
        }}
      />,
    );

    expect(screen.getByText('Desafio')).toBeInTheDocument();
    expect(screen.queryByText('Amistoso')).not.toBeInTheDocument();
  });

  test('renders challenge badge for legacy challenge names', () => {
    render(
      <MatchCard
        partido={{
          ...basePartido,
          source_type: 'team_match',
          origin_type: 'individual',
          nombre: 'Desafio: Azul vs Rojo',
        }}
      />,
    );

    expect(screen.getByText('Desafio')).toBeInTheDocument();
    expect(screen.queryByText('Amistoso')).not.toBeInTheDocument();
  });

  test('keeps friendly badge for true friendly matches', () => {
    render(
      <MatchCard
        partido={{
          ...basePartido,
          source_type: 'legacy_match',
          origin_type: 'individual',
          nombre: 'Amistoso del viernes',
          tipo_partido: 'Masculino',
        }}
      />,
    );

    expect(screen.getByText('Amistoso')).toBeInTheDocument();
  });
});
