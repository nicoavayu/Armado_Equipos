import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('MatchCard "Limpiar partido" contract', () => {
  // Regresión: el handler de ProximosPartidos espera recibir el partido como
  // PRIMER argumento (onClear(partido)). Si MatchCard cambia a onClear(e, partido)
  // el partidoTarget queda undefined, el modal abre pero la card nunca se oculta.
  test('clicking "Limpiar partido" calls onClear with the partido as the first arg', () => {
    const onClear = jest.fn();
    const partido = { ...basePartido, id: 42, source_type: 'legacy_match' };

    render(
      <MatchCard
        partido={partido}
        isFinished
        isMenuOpen
        onClear={onClear}
      />,
    );

    fireEvent.click(screen.getByText('Limpiar partido'));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onClear.mock.calls[0][0]).toBe(partido);
  });

  test('does not render "Limpiar partido" for unfinished matches', () => {
    const onClear = jest.fn();

    render(
      <MatchCard
        partido={{ ...basePartido, id: 7, source_type: 'legacy_match' }}
        isMenuOpen
        onClear={onClear}
      />,
    );

    expect(screen.queryByText('Limpiar partido')).not.toBeInTheDocument();
  });
});

describe('MatchCard post-match presentation', () => {
  test('uses a differentiated post-match class and keeps survey/payment actions working', () => {
    const onSurvey = jest.fn();
    const onPayment = jest.fn();

    const { container } = render(
      <MatchCard
        partido={{ ...basePartido, id: 88, source_type: 'legacy_match' }}
        isFinished
        isPostMatch
        postMatchInfo={{
          encuestaLabel: 'Encuesta pendiente',
          pagoLabel: 'Pago pendiente · $1.500',
          encuestaAction: { label: 'Encuesta', onClick: onSurvey },
          pagosAction: { label: 'Pagar', primary: true, onClick: onPayment },
        }}
      />,
    );

    expect(screen.getByText('POST PARTIDO')).toBeInTheDocument();
    expect(container.querySelector('.match-card-post-match')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Encuesta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pagar' }));

    expect(onSurvey).toHaveBeenCalledTimes(1);
    expect(onPayment).toHaveBeenCalledTimes(1);
  });
});
