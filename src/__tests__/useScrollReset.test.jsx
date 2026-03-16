import React, { act, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import {
  useRouteScrollReset,
  useScrollResetContainer,
  useScrollResetOnChange,
} from '../hooks/useScrollReset';

const flushScheduledReset = () => {
  act(() => {
    jest.runAllTimers();
  });
};

function RouteResetHarness() {
  useRouteScrollReset();

  return (
    <Routes>
      <Route path="/one" element={<FirstScreen />} />
      <Route path="/two" element={<div>Screen Two</div>} />
    </Routes>
  );
}

function FirstScreen() {
  const navigate = useNavigate();

  return (
    <button type="button" onClick={() => navigate('/two')}>
      Go to two
    </button>
  );
}

function InternalFlowHarness() {
  const [screenKey, setScreenKey] = useState('step-1');
  const scrollContainerRef = useScrollResetContainer();

  useScrollResetOnChange(screenKey);

  return (
    <>
      <button type="button" onClick={() => setScreenKey('step-2')}>
        Next step
      </button>
      <div ref={scrollContainerRef} data-testid="scroll-container">
        {screenKey}
      </div>
    </>
  );
}

describe('useScrollReset', () => {
  let consoleErrorSpy;
  let originalConsoleError;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(window, 'scrollTo').mockImplementation(() => {});
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => (
      window.setTimeout(() => callback(Date.now()), 0)
    ));
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((timerId) => {
      window.clearTimeout(timerId);
    });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    originalConsoleError = console.error;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      const [firstArg] = args;
      if (typeof firstArg === 'string' && firstArg.includes('ReactDOMTestUtils.act')) {
        return;
      }
      originalConsoleError(...args);
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    consoleErrorSpy?.mockRestore();
    jest.restoreAllMocks();
  });

  test('resets document scroll on route navigation', () => {
    render(
      <MemoryRouter
        initialEntries={['/one']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <RouteResetHarness />
      </MemoryRouter>,
    );

    flushScheduledReset();
    window.scrollTo.mockClear();

    document.documentElement.scrollTop = 180;
    document.body.scrollTop = 90;

    fireEvent.click(screen.getByRole('button', { name: /go to two/i }));
    flushScheduledReset();

    expect(window.scrollTo).toHaveBeenCalled();
    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.body.scrollTop).toBe(0);
    expect(screen.getByText(/screen two/i)).toBeInTheDocument();
  });

  test('resets registered scroll containers on internal screen changes', () => {
    render(<InternalFlowHarness />);

    const container = screen.getByTestId('scroll-container');
    container.scrollTop = 240;

    fireEvent.click(screen.getByRole('button', { name: /next step/i }));
    flushScheduledReset();

    expect(screen.getByText(/step-2/i)).toBeInTheDocument();
    expect(container.scrollTop).toBe(0);
  });
});
