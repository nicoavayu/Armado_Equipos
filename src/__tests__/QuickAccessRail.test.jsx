import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

jest.mock('../utils/routePrefetch', () => ({
  prefetchRoute: jest.fn(),
}));

const QuickAccessRail = require('../components/QuickAccessRail').default;

// jsdom can't deliver real PointerEvents; mirror the helper used by the swipe
// tests so we drive the rail's pointer gesture handlers directly.
const firePointerEvent = (target, type, { pointerId = 1, clientX, clientY, timeStamp = 0 }) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  fireEvent(target, event);
};

const onClickMisPartidos = jest.fn();

const buildItems = () => [
  { key: 'nuevo-partido', to: '/nuevo-partido', prefetch: '/nuevo-partido', title: 'Partido nuevo', subtitle: 'Armá y compartí' },
  { key: 'mis-partidos', onClick: onClickMisPartidos, title: 'Mis partidos', subtitle: 'Agenda y estado' },
  { key: 'frecuentes', to: '/frecuentes', prefetch: '/frecuentes', title: 'Frecuentes', subtitle: 'Tus plantillas' },
  { key: 'estadisticas', to: '/stats', prefetch: '/stats', title: 'Estadísticas', subtitle: 'Tu rendimiento' },
];

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

const renderRail = () => {
  const utils = render(
    <MemoryRouter initialEntries={['/']}>
      <QuickAccessRail items={buildItems()} />
      <LocationProbe />
    </MemoryRouter>,
  );
  const zone = utils.container.querySelector('.qa-gesture-zone');
  return { ...utils, zone };
};

beforeEach(() => {
  onClickMisPartidos.mockClear();
});

describe('QuickAccessRail — every visible card is actionable', () => {
  test('no card renders as an inert <div>: each is a link or a button', () => {
    const { container } = renderRail();
    const cards = container.querySelectorAll('.qa-card');
    // 4 real items + 3 clones per side = 10 rendered cards.
    expect(cards.length).toBeGreaterThan(4);
    cards.forEach((card) => {
      expect(['A', 'BUTTON']).toContain(card.tagName);
    });
  });

  test('cloned cards carry the same navigation target as the real item they mirror', () => {
    const { container } = renderRail();
    // "Estadísticas" is the card that peeks to the LEFT of the active "Partido
    // nuevo" — in loop mode that slot is a clone. The clone must still point to /stats.
    const statsLinks = Array.from(container.querySelectorAll('a')).filter(
      (a) => a.getAttribute('href') === '/stats',
    );
    expect(statsLinks.length).toBeGreaterThan(1); // the real card + at least one clone
    const cloneLinks = statsLinks.filter((a) => a.getAttribute('aria-hidden') === 'true');
    expect(cloneLinks.length).toBeGreaterThan(0);
  });

  test('clones stay out of the a11y tree and tab order', () => {
    const { container } = renderRail();
    container.querySelectorAll('.qa-card[aria-hidden="true"]').forEach((clone) => {
      expect(clone.getAttribute('tabindex')).toBe('-1');
    });
    // Real cards are never aria-hidden.
    const realCards = Array.from(container.querySelectorAll('.qa-card')).filter(
      (c) => c.getAttribute('aria-hidden') !== 'true',
    );
    expect(realCards.length).toBe(4);
  });
});

describe('QuickAccessRail — tap navigates, drag does not', () => {
  test('tapping a clone card navigates to its real destination', () => {
    const { container, getByTestId } = renderRail();
    const cloneStats = Array.from(container.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/stats' && a.getAttribute('aria-hidden') === 'true',
    );
    expect(cloneStats).toBeTruthy();
    fireEvent.click(cloneStats);
    expect(getByTestId('location').textContent).toBe('/stats');
  });

  test('tapping a real (right-side) card navigates', () => {
    const { container, getByTestId } = renderRail();
    const freq = Array.from(container.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/frecuentes' && a.getAttribute('aria-hidden') !== 'true',
    );
    fireEvent.click(freq);
    expect(getByTestId('location').textContent).toBe('/frecuentes');
  });

  test('tapping an onClick (no-route) card fires its handler', () => {
    const { container } = renderRail();
    const misPartidos = Array.from(container.querySelectorAll('button.qa-card')).find(
      (b) => b.getAttribute('aria-hidden') !== 'true' && b.textContent.includes('Mis partidos'),
    );
    fireEvent.click(misPartidos);
    expect(onClickMisPartidos).toHaveBeenCalledTimes(1);
  });

  test('a horizontal drag suppresses the click so it does NOT navigate', () => {
    const { container, zone, getByTestId } = renderRail();
    const link = Array.from(container.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/frecuentes',
    );
    // Drag clearly past the threshold (50px horizontal).
    firePointerEvent(zone, 'pointerdown', { clientX: 200, clientY: 40, timeStamp: 0 });
    firePointerEvent(zone, 'pointermove', { clientX: 150, clientY: 42, timeStamp: 30 });
    firePointerEvent(zone, 'pointerup', { clientX: 150, clientY: 42, timeStamp: 60 });
    // The click that the browser would synthesise after the drag must be swallowed.
    fireEvent.click(link);
    expect(getByTestId('location').textContent).toBe('/');
  });

  test('a tiny movement below the drag threshold still counts as a tap', () => {
    const { container, zone, getByTestId } = renderRail();
    const link = Array.from(container.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/frecuentes' && a.getAttribute('aria-hidden') !== 'true',
    );
    firePointerEvent(zone, 'pointerdown', { clientX: 200, clientY: 40, timeStamp: 0 });
    firePointerEvent(zone, 'pointermove', { clientX: 202, clientY: 40, timeStamp: 30 });
    firePointerEvent(zone, 'pointerup', { clientX: 202, clientY: 40, timeStamp: 60 });
    fireEvent.click(link);
    expect(getByTestId('location').textContent).toBe('/frecuentes');
  });
});
