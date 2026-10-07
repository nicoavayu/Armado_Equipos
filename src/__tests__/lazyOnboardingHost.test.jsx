import React from 'react';
import { act, render, screen } from '@testing-library/react';

import { OnboardingContext } from '../features/onboarding/OnboardingContext';
import LazyOnboardingHost from '../features/onboarding/LazyOnboardingHost';

const mockHostRender = jest.fn();
jest.mock('../features/onboarding/OnboardingHost', () => ({
  __esModule: true,
  default: () => {
    mockHostRender();
    return <div data-testid="onboarding-host" />;
  },
}));

const renderWith = (value) => render(
  <OnboardingContext.Provider value={value}>
    <LazyOnboardingHost />
  </OnboardingContext.Provider>,
);

test('nothing is loaded or mounted while no onboarding surface is needed', () => {
  renderWith({ activeFlow: null, profileTourOpen: false });
  expect(screen.queryByTestId('onboarding-host')).not.toBeInTheDocument();
  expect(mockHostRender).not.toHaveBeenCalled();
});

test('the real host mounts when a flow starts and stays mounted for its exit animation', async () => {
  const { rerender } = renderWith({ activeFlow: { screen: 'intro' }, profileTourOpen: false });
  expect(await screen.findByTestId('onboarding-host')).toBeInTheDocument();

  await act(async () => {
    rerender(
      <OnboardingContext.Provider value={{ activeFlow: null, profileTourOpen: false }}>
        <LazyOnboardingHost />
      </OnboardingContext.Provider>,
    );
  });
  expect(screen.getByTestId('onboarding-host')).toBeInTheDocument();
});

test('the profile tour also mounts the host', async () => {
  renderWith({ activeFlow: null, profileTourOpen: true });
  expect(await screen.findByTestId('onboarding-host')).toBeInTheDocument();
});
