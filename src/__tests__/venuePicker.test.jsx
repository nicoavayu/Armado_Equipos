import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

// MapLibre is WebGL-based and cannot run in jsdom, so stub it. MapPinPreview is
// lazy-loaded by VenuePicker, so the real module only loads once a venue with
// coordinates is selected.
jest.mock('maplibre-gl', () => {
  function Map() {
    this.on = jest.fn();
    this.addControl = jest.fn();
    this.remove = jest.fn();
    this.resize = jest.fn();
    this.jumpTo = jest.fn();
  }
  function Marker() {
    this.setLngLat = jest.fn(() => this);
    this.addTo = jest.fn(() => this);
  }
  function AttributionControl() {}
  const api = { Map, Marker, AttributionControl };
  return { __esModule: true, default: api, ...api };
});
jest.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}), { virtual: true });

// The autocomplete is mocked to a tiny harness: an input plus two "pick" buttons
// that drive onSelect with/without coordinates.
jest.mock('../components/AutocompleteSede', () => ({
  __esModule: true,
  default: ({ value, onChange, onSelect }) => (
    <div>
      <input
        aria-label="Buscar cancha o lugar"
        placeholder="Buscar cancha o lugar"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        onClick={() => onSelect({
          description: 'Cancha Uno, Av. Siempreviva 123, CABA',
          place_id: 'p1',
          lat: -34.6037,
          lng: -58.3816,
          mainText: 'Cancha Uno',
          secondaryText: 'Av. Siempreviva 123, CABA',
        })}
      >
        pick-with-coords
      </button>
      <button
        type="button"
        onClick={() => onSelect({
          description: 'Cancha Sin Mapa',
          place_id: 'p2',
          lat: null,
          lng: null,
          mainText: 'Cancha Sin Mapa',
          secondaryText: 'Barrio Centro',
        })}
      >
        pick-no-coords
      </button>
    </div>
  ),
}));

// eslint-disable-next-line import/first
import VenuePicker from '../components/VenuePicker';

function Harness() {
  const [value, setValue] = React.useState('');
  const [info, setInfo] = React.useState(null);
  return (
    <VenuePicker
      value={value}
      info={info}
      onChange={(next) => { setValue(next); if (!next.trim()) setInfo(null); }}
      onSelect={(selected) => { setValue(selected.description); setInfo(selected); }}
      onClear={() => { setValue(''); setInfo(null); }}
    />
  );
}

describe('VenuePicker', () => {
  test('shows the autocomplete input and no selected card by default', () => {
    render(<Harness />);
    expect(screen.getByPlaceholderText('Buscar cancha o lugar')).toBeInTheDocument();
    expect(screen.queryByTestId('selected-venue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('map-pin-preview')).not.toBeInTheDocument();
  });

  test('shows venue name, address and map preview when a place with coordinates is chosen', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('pick-with-coords'));

    expect(screen.getByTestId('selected-venue')).toBeInTheDocument();
    expect(screen.getByTestId('selected-venue-name')).toHaveTextContent('Cancha Uno');
    expect(screen.getByTestId('selected-venue-address')).toHaveTextContent('Av. Siempreviva 123, CABA');
    expect(screen.getByRole('button', { name: /Cambiar/i })).toBeInTheDocument();
    // The map preview is lazy-loaded, so wait for it to appear.
    expect(await screen.findByTestId('map-pin-preview')).toBeInTheDocument();
    // The autocomplete input is hidden while a venue is selected.
    expect(screen.queryByPlaceholderText('Buscar cancha o lugar')).not.toBeInTheDocument();
  });

  test('omits the map preview when the selected place has no coordinates', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('pick-no-coords'));

    expect(screen.getByTestId('selected-venue-name')).toHaveTextContent('Cancha Sin Mapa');
    expect(screen.queryByTestId('map-pin-preview')).not.toBeInTheDocument();
  });

  test('Cambiar clears the selection and returns to the autocomplete input', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('pick-with-coords'));
    expect(await screen.findByTestId('map-pin-preview')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Cambiar/i }));

    expect(screen.queryByTestId('selected-venue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('map-pin-preview')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Buscar cancha o lugar')).toBeInTheDocument();
  });
});
