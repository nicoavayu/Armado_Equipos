import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getGeocode, getLatLng } from 'use-places-autocomplete';
import AutocompleteSede from '../components/AutocompleteSede';

// The places hook is mocked so suggestions come exclusively from the manual
// Places probe (window.google AutocompleteService) — the same path the wizard
// venue picker uses in the app. getGeocode/getLatLng resolve a fixed location so
// selection carries coordinates.
jest.mock('use-places-autocomplete', () => {
  const ReactLib = require('react');
  const EMPTY_SUGGESTIONS = { status: '', data: [] };
  const useMockPlaces = ({ defaultValue }) => {
    const [value, setVal] = ReactLib.useState(defaultValue || '');
    const setValue = ReactLib.useCallback((next) => setVal(next), []);
    const clearSuggestions = ReactLib.useCallback(() => {}, []);
    return {
      ready: true,
      value,
      setValue,
      suggestions: EMPTY_SUGGESTIONS,
      clearSuggestions,
    };
  };
  return {
    __esModule: true,
    default: useMockPlaces,
    getGeocode: jest.fn(() => Promise.resolve([{ geometry: {} }])),
    getLatLng: jest.fn(() => Promise.resolve({ lat: -34.6037, lng: -58.3816 })),
  };
});

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => ({ user: null, profile: null }),
}));

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../services/locationService', () => ({
  distanceInMeters: jest.fn(() => 1234),
}));

const canchaUno = {
  place_id: 'p1',
  description: 'Cancha Uno, Av. Siempreviva 123, CABA, Argentina',
  structured_formatting: {
    main_text: 'Cancha Uno',
    secondary_text: 'Av. Siempreviva 123, CABA, Argentina',
  },
};
const canchaDos = {
  place_id: 'p2',
  description: 'Cancha Dos, Calle Falsa 456, CABA, Argentina',
  structured_formatting: {
    main_text: 'Cancha Dos',
    secondary_text: 'Calle Falsa 456, CABA, Argentina',
  },
};

let predictionCalls;

beforeEach(() => {
  // CRA's jest config sets resetMocks:true, which clears the factory-defined
  // implementations before each test — re-establish them here.
  getGeocode.mockImplementation(() => Promise.resolve([{ geometry: {} }]));
  getLatLng.mockImplementation(() => Promise.resolve({ lat: -34.6037, lng: -58.3816 }));
  predictionCalls = [];
  window.google = {
    maps: {
      places: {
        AutocompleteService: class {
          getPlacePredictions(options, cb) {
            predictionCalls.push({ input: options.input, cb });
          }
        },
      },
    },
  };
  jest.useFakeTimers();
});

afterEach(() => {
  act(() => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
  delete window.google;
});

// AutocompleteSede mirrors its `value` prop back into the input, so the field
// must be driven by a controlled parent or it would reset to empty on every
// keystroke (exactly how the wizard uses it via `value={sede}`).
const renderWizardField = () => {
  const onSelect = jest.fn();
  const onChange = jest.fn();
  function Harness() {
    const [val, setVal] = React.useState('');
    return (
      <AutocompleteSede
        wizard
        dense
        value={val}
        onSelect={onSelect}
        onChange={(next) => { onChange(next); setVal(next); }}
      />
    );
  }
  render(<Harness />);
  return { onSelect, onChange };
};

const typeQuery = (input, text) => {
  act(() => { fireEvent.change(input, { target: { value: text } }); });
  act(() => { jest.advanceTimersByTime(300); });
};

const resolveLatestProbe = (predictions) => {
  const call = predictionCalls[predictionCalls.length - 1];
  act(() => { call.cb(predictions, 'OK'); });
};

describe('AutocompleteSede — wizard venue picker', () => {
  test('uses the clean "Buscar cancha o lugar" placeholder', () => {
    renderWizardField();
    expect(screen.getByPlaceholderText('Buscar cancha o lugar')).toBeInTheDocument();
    expect(screen.getByLabelText('Buscar cancha o lugar')).toBeInTheDocument();
  });

  test('shows no suggestions while the input is empty', () => {
    renderWizardField();
    expect(screen.queryByTestId('wizard-venue-suggestions')).not.toBeInTheDocument();
  });

  test('shows venue name + address suggestions only after the user types', () => {
    renderWizardField();
    expect(screen.queryByTestId('wizard-venue-suggestions')).not.toBeInTheDocument();

    typeQuery(screen.getByLabelText('Buscar cancha o lugar'), 'Cancha');
    resolveLatestProbe([canchaUno, canchaDos]);

    expect(screen.getByTestId('wizard-venue-suggestions')).toBeInTheDocument();
    expect(screen.getByText('Cancha Uno')).toBeInTheDocument();
    expect(screen.getByText('Av. Siempreviva 123, CABA')).toBeInTheDocument();
  });

  test('does not show any distance label in the suggestions', () => {
    renderWizardField();
    typeQuery(screen.getByLabelText('Buscar cancha o lugar'), 'Cancha');
    resolveLatestProbe([canchaUno, canchaDos]);

    const panel = screen.getByTestId('wizard-venue-suggestions');
    expect(panel.textContent).not.toMatch(/km/i);
    expect(panel.textContent).not.toMatch(/cerca/i);
  });

  test('passes name and address to onSelect when a suggestion is chosen', async () => {
    const { onSelect } = renderWizardField();
    typeQuery(screen.getByLabelText('Buscar cancha o lugar'), 'Cancha');
    resolveLatestProbe([canchaUno]);

    fireEvent.click(screen.getByText('Cancha Uno'));
    await waitFor(() => expect(onSelect).toHaveBeenCalled());

    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({
      description: 'Cancha Uno, Av. Siempreviva 123, CABA, Argentina',
      place_id: 'p1',
      mainText: 'Cancha Uno',
      secondaryText: 'Av. Siempreviva 123, CABA',
      lat: -34.6037,
      lng: -58.3816,
    }));
  });
});
