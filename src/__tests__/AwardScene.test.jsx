import React from 'react';
import { act, render, screen } from '@testing-library/react';
import AwardScene from '../components/awards/AwardScene';

const cardProfiles = [];
jest.mock('../components/ProfileCard', () => (props) => {
  cardProfiles.push(props.profile);
  return <div data-testid="profile-card">{props.profile?.nombre} · mvps {props.profile?.mvps}</div>;
});

const baseEntry = {
  key: 'mvp',
  type: 'mvp',
  name: 'Ana',
  hint: null,
  isMine: true,
  chip: 'Ganaste',
  votesLabel: '3 votos',
  counter: { total: 2, before: 1, isLatest: true, label: 'MVP' },
  collectionNote: 'Sumado a tu colección',
  penalty: null,
  cardProfile: { nombre: 'Ana', mvps: 2, mvp_badges: 2 },
};

describe('AwardScene', () => {
  beforeEach(() => {
    cardProfiles.length = 0;
    jest.useFakeTimers();
  });
  afterEach(() => {
    act(() => { jest.runOnlyPendingTimers(); });
    jest.useRealTimers();
  });

  test('shows the winner\'s ProfileCard with the counter before the award, then the real total after the impact', () => {
    render(<AwardScene entry={baseEntry} />);
    expect(screen.getByText('Ganaste')).toBeInTheDocument();
    expect(screen.getByTestId('profile-card')).toHaveTextContent('Ana · mvps 1');
    expect(screen.queryByText('+1')).not.toBeInTheDocument();

    act(() => { jest.advanceTimersByTime(2200); });
    expect(screen.getByTestId('profile-card')).toHaveTextContent('Ana · mvps 2');
    expect(screen.getByText(/Sumado a tu colección/)).toBeInTheDocument();
  });

  test('a guest award shows no total and no "Ganaste"', () => {
    render(<AwardScene entry={{
      ...baseEntry,
      isMine: false,
      chip: 'Premio',
      counter: null,
      collectionNote: 'Jugó como invitado: el premio queda en este partido',
      cardProfile: { nombre: 'Juan', mvps: 0 },
    }}
    />);
    act(() => { jest.advanceTimersByTime(2200); });
    expect(screen.queryByText('Ganaste')).not.toBeInTheDocument();
    expect(screen.getByText('Jugó como invitado: el premio queda en este partido')).toBeInTheDocument();
    expect(screen.getByTestId('profile-card')).toHaveTextContent('mvps 0');
  });

  test('unmounting mid-sequence leaves no timers', () => {
    const { unmount } = render(<AwardScene entry={baseEntry} />);
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
