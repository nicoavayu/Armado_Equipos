import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import NeighborhoodAutocomplete, {
  resolveSelectionLabel,
  normalizePredictions,
} from '../features/equipos/components/NeighborhoodAutocomplete';

// The hook is mocked so suggestions come exclusively from the manual Places probe
// (window.google AutocompleteService), which is how the component behaves in app.
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
  return { __esModule: true, default: useMockPlaces };
});

jest.mock('../utils/notifyBlockingError', () => ({
  notifyBlockingError: jest.fn(),
}));

const cuscoPred = {
  place_id: 'p-cusco',
  description: 'Cusco, Mendoza, Argentina',
  structured_formatting: { main_text: 'Cusco', secondary_text: 'Mendoza, Argentina' },
};
const amancayPred = {
  place_id: 'p-amancay',
  description: 'Amancay, Mendoza, Argentina',
  structured_formatting: { main_text: 'Amancay', secondary_text: 'Mendoza, Argentina' },
};

function Harness({ onChangeSpy }) {
  const [val, setVal] = React.useState('');
  return (
    <NeighborhoodAutocomplete
      value={val}
      onChange={(next) => { onChangeSpy(next); setVal(next); }}
      inputClassName="np-input"
    />
  );
}

let predictionCalls;

beforeEach(() => {
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

const typeQuery = (input, text) => {
  act(() => { fireEvent.change(input, { target: { value: text } }); });
  act(() => { jest.advanceTimersByTime(300); }); // fire the 260ms probe debounce
};

const resolveCall = (call, predictions) => {
  act(() => { call.cb(predictions, 'OK'); });
};

describe('resolveSelectionLabel (pure)', () => {
  test('keeps the tapped label exactly — "Cusco" must stay "Cusco"', () => {
    expect(resolveSelectionLabel({ label: 'Cusco' })).toBe('Cusco');
  });

  test('falls back to the suggestion main text when no label is set', () => {
    expect(resolveSelectionLabel({
      structured_formatting: { main_text: 'Cusco' },
      description: 'Cusco, Mendoza, Argentina',
    })).toBe('Cusco');
  });
});

describe('normalizePredictions (pure)', () => {
  test('drops non-Argentina results and de-duplicates by label', () => {
    const out = normalizePredictions(
      [
        cuscoPred,
        { ...cuscoPred, place_id: 'dup' },
        { place_id: 'pe', description: 'Cusco, Peru', structured_formatting: { main_text: 'Cusco' } },
      ],
      8,
      'Cusco',
      'ar',
    );
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('Cusco');
  });
});

describe('NeighborhoodAutocomplete selection', () => {
  test('tapping "Cusco" stores "Cusco" and closes the dropdown for good', () => {
    const onChangeSpy = jest.fn();
    render(<Harness onChangeSpy={onChangeSpy} />);
    const input = screen.getByRole('textbox');

    typeQuery(input, 'Cusco');
    expect(predictionCalls.length).toBeGreaterThan(0);
    resolveCall(predictionCalls[predictionCalls.length - 1], [cuscoPred, amancayPred]);

    const cuscoBtn = screen.getByRole('button', { name: 'Cusco' });
    expect(cuscoBtn).toBeInTheDocument();
    // The query "Cusco" must not surface an unrelated neighbourhood.
    expect(screen.queryByRole('button', { name: 'Amancay' })).not.toBeInTheDocument();

    act(() => { fireEvent.click(cuscoBtn); });

    expect(onChangeSpy).toHaveBeenLastCalledWith('Cusco');
    expect(input).toHaveValue('Cusco');
    // Dropdown closes immediately on selection...
    expect(screen.queryByRole('button', { name: 'Cusco' })).not.toBeInTheDocument();
    // ...and does not pop back open from a trailing debounce.
    act(() => { jest.advanceTimersByTime(1500); });
    expect(screen.queryByRole('button', { name: 'Cusco' })).not.toBeInTheDocument();
  });

  test('ignores stale prediction responses from earlier keystrokes', () => {
    const onChangeSpy = jest.fn();
    render(<Harness onChangeSpy={onChangeSpy} />);
    const input = screen.getByRole('textbox');

    typeQuery(input, 'Cus');
    const staleCall = predictionCalls[predictionCalls.length - 1];

    typeQuery(input, 'Cusco');
    const freshCall = predictionCalls[predictionCalls.length - 1];

    // A late response for the earlier query arrives AFTER the newer one was issued.
    const stalePred = {
      place_id: 'p-stale',
      description: 'Cusco Viejo, Salta, Argentina',
      structured_formatting: { main_text: 'Cusco Viejo' },
    };
    resolveCall(staleCall, [stalePred]);
    expect(screen.queryByRole('button', { name: 'Cusco Viejo' })).not.toBeInTheDocument();

    // The current query's response is honoured.
    resolveCall(freshCall, [cuscoPred]);
    expect(screen.getByRole('button', { name: 'Cusco' })).toBeInTheDocument();
  });
});
