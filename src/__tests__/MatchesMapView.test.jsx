import { render, screen } from '@testing-library/react';

// MapLibre is WebGL-based and cannot run in jsdom, so stub it. The "load"
// handler (which registers sources/layers) is never fired here; we only assert
// the React-rendered chrome (filters) around the canvas.
jest.mock('maplibre-gl', () => {
  // Use a constructor that writes onto `this` so `new maplibregl.Map(...)`
  // yields an instance with the methods (a jest.fn returning an object is not
  // reliably used as the constructed value under `new`).
  function Map() {
    this.on = jest.fn();
    this.once = jest.fn();
    this.addControl = jest.fn();
    this.addSource = jest.fn();
    this.addLayer = jest.fn();
    this.getSource = jest.fn();
    this.isStyleLoaded = jest.fn(() => false);
    this.getCanvas = jest.fn(() => ({ style: {} }));
    this.resize = jest.fn();
    this.remove = jest.fn();
    this.easeTo = jest.fn();
    this.fitBounds = jest.fn();
  }
  function AttributionControl() {}
  function NavigationControl() {}
  function LngLatBounds() {
    this.extend = jest.fn();
  }
  const api = { Map, AttributionControl, NavigationControl, LngLatBounds };
  return { __esModule: true, default: api, ...api };
});

// CSS import is a side-effect only.
jest.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}), { virtual: true });

// eslint-disable-next-line import/first
import MatchesMapView from '../components/jugar/MatchesMapView';

const matches = [
  {
    id: 'm1',
    fecha: '2026-07-01',
    hora: '20:00',
    modalidad: 'F5',
    sede: 'La Terraza Fútbol',
    sede_place_id: 'place-1',
    sede_latitud: -34.6037,
    sede_longitud: -58.3816,
    cupo_jugadores: 10,
    jugadores_count: 6,
    falta_jugadores: 4,
  },
];

describe('MatchesMapView — Phase A filters', () => {
  test('no muestra el chip "Falta arquero" (Phase A)', () => {
    render(<MatchesMapView matches={matches} userLocation={null} currentUserId="me" />);
    // The honest "Hoy" filter is present...
    expect(screen.getByRole('button', { name: /Hoy/i })).toBeInTheDocument();
    // ...but no goalkeeper filter/chip is surfaced until a real backend field exists.
    expect(screen.queryByText(/Falta arquero/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pronto/i)).not.toBeInTheDocument();
  });
});
