import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockUseKeyboard = jest.fn();

jest.mock('../hooks/useKeyboard', () => ({
  useKeyboard: () => mockUseKeyboard(),
}));

jest.mock('../context/NotificationContext', () => ({
  useNotifications: () => ({
    unreadCount: { friends: 0, teamInvites: 0, matches: 0, total: 0 },
  }),
}));

jest.mock('../utils/routePrefetch', () => ({
  prefetchRoute: jest.fn(),
}));

const TabBar = require('../components/TabBar').default;

const renderTabBar = () => render(
  <MemoryRouter>
    <TabBar activeTab="home" onTabChange={jest.fn()} />
  </MemoryRouter>,
);

describe('TabBar keyboard behavior', () => {
  test('visible and interactive while the keyboard is closed', () => {
    mockUseKeyboard.mockReturnValue({ isKeyboardOpen: false, keyboardHeight: 0 });
    const { container } = renderTabBar();
    const bar = container.querySelector('.app-tabbar');

    expect(bar.className).not.toContain('translate-y-[130%]');
    expect(bar.className).not.toContain('pointer-events-none');
    expect(bar).not.toHaveAttribute('aria-hidden');
  });

  test('slides out (never floats above the keyboard) while the keyboard is open', () => {
    mockUseKeyboard.mockReturnValue({ isKeyboardOpen: true, keyboardHeight: 280 });
    const { container } = renderTabBar();
    const bar = container.querySelector('.app-tabbar');

    expect(bar.className).toContain('translate-y-[130%]');
    expect(bar.className).toContain('opacity-0');
    expect(bar.className).toContain('pointer-events-none');
    expect(bar).toHaveAttribute('aria-hidden', 'true');
  });
});
