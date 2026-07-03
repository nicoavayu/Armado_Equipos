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

describe('QuickAccessRail — every card is actionable (orbital ring, one node per item)', () => {
  test('no card renders as an inert <div>: each is a link or a button', () => {
    const { container } = renderRail();
    const cards = container.querySelectorAll('.qa-card');
    // The orbital ring loops via geometry, so there is exactly one DOM node per
    // real item — no clones.
    expect(cards.length).toBe(4);
    cards.forEach((card) => {
      expect(['A', 'BUTTON']).toContain(card.tagName);
    });
  });

  test('each real card carries its own navigation target / handler', () => {
    const { container } = renderRail();
    const hrefs = Array.from(container.querySelectorAll('a.qa-card')).map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toEqual(expect.arrayContaining(['/nuevo-partido', '/frecuentes', '/stats']));
    // Exactly one node per route — no cloned duplicates.
    expect(hrefs.filter((h) => h === '/stats')).toHaveLength(1);
    // The onClick (no-route) card renders as a button.
    const misPartidos = Array.from(container.querySelectorAll('button.qa-card')).find((b) =>
      b.textContent.includes('Mis partidos'),
    );
    expect(misPartidos).toBeTruthy();
  });

  test('no card is hidden from the a11y tree, and exactly one is aria-current', () => {
    const { container } = renderRail();
    // No clones → nothing is aria-hidden.
    expect(container.querySelectorAll('.qa-card[aria-hidden="true"]').length).toBe(0);
    const cards = Array.from(container.querySelectorAll('.qa-card'));
    expect(cards.length).toBe(4);
    const current = cards.filter((c) => c.getAttribute('aria-current') === 'true');
    expect(current.length).toBe(1);
    // The first item is active at rest.
    expect(current[0].textContent).toContain('Partido nuevo');
  });

  test('the 3D stage lets hits pass through to the side cards', () => {
    // The side cards sit at negative translateZ — behind the (transparent) stage
    // plane — so in a real browser the stage swallowed their taps and only the
    // front card was clickable. The stage must keep pointer-events: none (each
    // card re-enables its own pointer-events imperatively).
    const { container } = renderRail();
    const css = Array.from(container.querySelectorAll('style'))
      .map((s) => s.textContent)
      .join('\n');
    expect(css).toMatch(/\.qa-stage\s*\{[^}]*pointer-events:\s*none/);
  });

  test('dots mirror the real items with accessible labels', () => {
    const { container } = renderRail();
    const dots = Array.from(container.querySelectorAll('button[aria-label^="Ir a "]'));
    expect(dots.map((d) => d.getAttribute('aria-label'))).toEqual([
      'Ir a Partido nuevo',
      'Ir a Mis partidos',
      'Ir a Frecuentes',
      'Ir a Estadísticas',
    ]);
  });
});

describe('QuickAccessRail — tap navigates, drag does not', () => {
  test('tapping a side card (Estadísticas) navigates to its destination', () => {
    const { container, getByTestId } = renderRail();
    const stats = Array.from(container.querySelectorAll('a.qa-card')).find(
      (a) => a.getAttribute('href') === '/stats',
    );
    expect(stats).toBeTruthy();
    fireEvent.click(stats);
    expect(getByTestId('location').textContent).toBe('/stats');
  });

  test('tapping a routed card navigates', () => {
    const { container, getByTestId } = renderRail();
    const freq = Array.from(container.querySelectorAll('a.qa-card')).find(
      (a) => a.getAttribute('href') === '/frecuentes',
    );
    fireEvent.click(freq);
    expect(getByTestId('location').textContent).toBe('/frecuentes');
  });

  test('tapping an onClick (no-route) card fires its handler', () => {
    const { container } = renderRail();
    const misPartidos = Array.from(container.querySelectorAll('button.qa-card')).find((b) =>
      b.textContent.includes('Mis partidos'),
    );
    fireEvent.click(misPartidos);
    expect(onClickMisPartidos).toHaveBeenCalledTimes(1);
  });

  test('a horizontal drag suppresses the click so it does NOT navigate', () => {
    const { container, zone, getByTestId } = renderRail();
    const link = Array.from(container.querySelectorAll('a.qa-card')).find(
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
    const link = Array.from(container.querySelectorAll('a.qa-card')).find(
      (a) => a.getAttribute('href') === '/frecuentes',
    );
    firePointerEvent(zone, 'pointerdown', { clientX: 200, clientY: 40, timeStamp: 0 });
    firePointerEvent(zone, 'pointermove', { clientX: 202, clientY: 40, timeStamp: 30 });
    firePointerEvent(zone, 'pointerup', { clientX: 202, clientY: 40, timeStamp: 60 });
    fireEvent.click(link);
    expect(getByTestId('location').textContent).toBe('/frecuentes');
  });

  test('a small finger wobble (under the cancel threshold) still taps a side card', () => {
    // On a real device, tapping a small rotated side-card sliver almost always
    // carries a few px of horizontal jitter. That must NOT be swallowed as a drag
    // (which previously captured the pointer and killed the side card's tap), so a
    // sub-CLICK_CANCEL_PX wobble must still navigate to the tapped card.
    const { container, zone, getByTestId } = renderRail();
    const stats = Array.from(container.querySelectorAll('a.qa-card')).find(
      (a) => a.getAttribute('href') === '/stats',
    );
    firePointerEvent(zone, 'pointerdown', { clientX: 200, clientY: 40, timeStamp: 0 });
    firePointerEvent(zone, 'pointermove', { clientX: 209, clientY: 41, timeStamp: 24 });
    firePointerEvent(zone, 'pointerup', { clientX: 209, clientY: 41, timeStamp: 48 });
    fireEvent.click(stats);
    expect(getByTestId('location').textContent).toBe('/stats');
  });
});
