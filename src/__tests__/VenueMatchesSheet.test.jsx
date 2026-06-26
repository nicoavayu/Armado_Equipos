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
      // Boolean open-call flag — the count must come from cupo/roster, NOT this.
      falta_jugadores: true,
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
      falta_jugadores: false,
      creado_por: 'me',
    },
  ],
};

const renderVenue = (overrides) => render(
  <VenueMatchesSheet
    venue={overrides || venue}
    currentUserId="me"
    onClose={() => {}}
    onSelectMatch={() => {}}
  />,
);

const singleMatchVenue = (match) => ({
  key: 'place:solo',
  label: 'Cancha Única',
  sede: 'Cancha Única',
  activeMatchCount: 1,
  matches: [{ id: 'solo', fecha: '2026-07-01', modalidad: 'F5', creado_por: 'x', ...match }],
});

describe('VenueMatchesSheet', () => {
  test('no renderiza nada sin venue', () => {
    const { container } = render(<VenueMatchesSheet venue={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('lista los partidos abiertos de la sede seleccionada', () => {
    renderVenue();

    expect(screen.getByText('La Terraza Fútbol')).toBeInTheDocument();
    expect(screen.getByText('2 partidos abiertos')).toBeInTheDocument();
    // Two match rows → two "Ver partido" CTAs.
    expect(screen.getAllByRole('button', { name: 'Ver partido' })).toHaveLength(2);
    // Formats from both matches are shown.
    expect(screen.getByText('F5')).toBeInTheDocument();
    expect(screen.getByText('F7')).toBeInTheDocument();
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

  describe('conteo de jugadores faltantes', () => {
    test('muestra "Faltan 9 jugadores" con 1/10 (no deriva del booleano falta_jugadores)', () => {
      renderVenue(singleMatchVenue({ cupo_jugadores: 10, jugadores_count: 1, falta_jugadores: true }));

      expect(screen.getByText('Faltan 9 jugadores')).toBeInTheDocument();
      // The boolean true (Number(true) === 1) must NOT leak through as the count.
      expect(screen.queryByText('Faltan 1 jugador')).not.toBeInTheDocument();
      expect(screen.queryByText('Falta 1 jugador')).not.toBeInTheDocument();
    });

    test('muestra "Falta 1 jugador" (singular) con 9/10', () => {
      renderVenue(singleMatchVenue({ cupo_jugadores: 10, jugadores_count: 9, falta_jugadores: true }));

      expect(screen.getByText('Falta 1 jugador')).toBeInTheDocument();
      expect(screen.queryByText(/Faltan/)).not.toBeInTheDocument();
    });

    test('no muestra advertencia cuando el partido está completo', () => {
      renderVenue(singleMatchVenue({ cupo_jugadores: 10, jugadores_count: 10, falta_jugadores: true }));

      expect(screen.queryByText(/Falta/)).not.toBeInTheDocument();
    });

    test('no muestra advertencia cuando no hay cupo conocido', () => {
      renderVenue(singleMatchVenue({ cupo_jugadores: 0, jugadores_count: 0, falta_jugadores: true }));

      expect(screen.queryByText(/Falta/)).not.toBeInTheDocument();
    });

    test('deriva el conteo del cupo/roster aunque falta_jugadores sea booleano', () => {
      // cupo 10 - roster 6 = 4 faltan; el booleano true daría "Faltan 1" si se usara mal.
      renderVenue();

      expect(screen.getByText('Faltan 4 jugadores')).toBeInTheDocument();
      expect(screen.queryByText('Faltan 1 jugador')).not.toBeInTheDocument();
    });
  });
});
