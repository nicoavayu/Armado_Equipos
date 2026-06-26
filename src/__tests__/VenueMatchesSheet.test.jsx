import { render, screen, fireEvent } from '@testing-library/react';
import VenueMatchesSheet from '../components/jugar/VenueMatchesSheet';

const venue = {
  key: 'place:p1',
  label: 'La Terraza Fútbol',
  sede: 'La Terraza Fútbol, Núñez, CABA',
  activeMatchCount: 2,
  matches: [
    {
      id: 'm1',
      fecha: '2026-07-01',
      hora: '20:00',
      modalidad: 'F5',
      tipo_partido: 'Mixto',
      cupo_jugadores: 10,
      jugadores_count: 6,
      falta_jugadores: 4,
      creado_por: 'someone-else',
    },
    {
      id: 'm2',
      fecha: '2026-07-02',
      hora: '21:00',
      modalidad: 'F7',
      tipo_partido: 'Masculino',
      cupo_jugadores: 14,
      jugadores_count: 14,
      falta_jugadores: 0,
      creado_por: 'me',
    },
  ],
};

describe('VenueMatchesSheet', () => {
  test('no renderiza nada sin venue', () => {
    const { container } = render(<VenueMatchesSheet venue={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('lista los partidos abiertos de la sede seleccionada', () => {
    render(<VenueMatchesSheet venue={venue} currentUserId="me" onClose={() => {}} onSelectMatch={() => {}} />);

    expect(screen.getByText('La Terraza Fútbol')).toBeInTheDocument();
    expect(screen.getByText('2 partidos abiertos')).toBeInTheDocument();
    // Two match rows → two "Ver partido" CTAs.
    expect(screen.getAllByRole('button', { name: 'Ver partido' })).toHaveLength(2);
    // Formats from both matches are shown.
    expect(screen.getByText('F5')).toBeInTheDocument();
    expect(screen.getByText('F7')).toBeInTheDocument();
    // Missing-players badge for the first match only.
    expect(screen.getByText('Faltan 4 jugadores')).toBeInTheDocument();
    // Owner badge for the match created by the current user.
    expect(screen.getByText('Tu partido')).toBeInTheDocument();
  });

  test('el CTA delega la navegación sin duplicar lógica de unirse', () => {
    const onSelectMatch = jest.fn();
    render(<VenueMatchesSheet venue={venue} currentUserId="me" onClose={() => {}} onSelectMatch={onSelectMatch} />);

    const ctas = screen.getAllByRole('button', { name: 'Ver partido' });
    fireEvent.click(ctas[1]); // m2, created by "me"

    expect(onSelectMatch).toHaveBeenCalledTimes(1);
    expect(onSelectMatch.mock.calls[0][0]).toMatchObject({ id: 'm2' });
    expect(onSelectMatch.mock.calls[0][1]).toMatchObject({ isOwner: true });
  });

  test('cierra al tocar el botón de cerrar', () => {
    const onClose = jest.fn();
    render(<VenueMatchesSheet venue={venue} currentUserId="me" onClose={onClose} onSelectMatch={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalled();
  });
});
