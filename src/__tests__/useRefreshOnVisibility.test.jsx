import React from 'react';
import { render } from '@testing-library/react';
import { useRefreshOnVisibility } from '../hooks/useRefreshOnVisibility';

describe('useRefreshOnVisibility', () => {
  const originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');

  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  afterEach(() => {
    if (originalVisibilityState) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityState);
    }
    jest.restoreAllMocks();
  });

  function Harness({ onRefresh, minIntervalMs }) {
    useRefreshOnVisibility(onRefresh, { minIntervalMs });
    return null;
  }

  it('deduplicates focus and visibility refreshes fired back to back', () => {
    const onRefresh = jest.fn();
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    render(<Harness onRefresh={onRefresh} />);

    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(onRefresh).toHaveBeenCalledTimes(1);

    now += 2_000;
    document.dispatchEvent(new Event('visibilitychange'));

    expect(onRefresh).toHaveBeenCalledTimes(2);
  });
});
