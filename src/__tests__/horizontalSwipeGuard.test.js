import { installHorizontalSwipeGuard, isInsideHorizontalScroller } from '../utils/horizontalSwipeGuard';

// jsdom has no layout: give an element the box sizes a real scroller would have.
const setBox = (element, { scrollWidth, clientWidth }) => {
  Object.defineProperty(element, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: clientWidth });
};

const touchEvent = (type, target, x, y) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: [{ clientX: x, clientY: y }] });
  target.dispatchEvent(event);
  return event;
};

// A swipe from the middle of a 390px viewport, 60px to the left.
const swipeLeft = (target) => {
  touchEvent('touchstart', target, 220, 400);
  return touchEvent('touchmove', target, 160, 402);
};

const buildTabBar = ({ overflowX = 'auto', scrollWidth = 720, clientWidth = 366 } = {}) => {
  const bar = document.createElement('nav');
  bar.style.overflowX = overflowX;
  setBox(bar, { scrollWidth, clientWidth });
  const tab = document.createElement('button');
  tab.textContent = 'Goleadores';
  bar.appendChild(tab);
  document.body.appendChild(bar);
  return { bar, tab };
};

describe('horizontal swipe guard', () => {
  let uninstall;

  beforeEach(() => {
    document.body.innerHTML = '';
    window.innerWidth = 390;
    uninstall = installHorizontalSwipeGuard(window);
  });

  afterEach(() => uninstall());

  test('a tab bar wider than its box scrolls by touch without any opt-in attribute', () => {
    const { tab } = buildTabBar();

    expect(isInsideHorizontalScroller(tab)).toBe(true);
    expect(swipeLeft(tab).defaultPrevented).toBe(false);
  });

  test('a horizontal drag on plain page content is still blocked', () => {
    const paragraph = document.createElement('p');
    document.body.appendChild(paragraph);

    expect(swipeLeft(paragraph).defaultPrevented).toBe(true);
  });

  test('a bar whose tabs all fit does not own the gesture', () => {
    const { tab } = buildTabBar({ scrollWidth: 366, clientWidth: 366 });

    expect(swipeLeft(tab).defaultPrevented).toBe(true);
  });

  test('clipped overflow (hidden/clip) is not a scroller', () => {
    const { tab } = buildTabBar({ overflowX: 'hidden' });

    expect(swipeLeft(tab).defaultPrevented).toBe(true);
  });

  test('the explicit data-allow-horizontal-scroll opt-in keeps working', () => {
    const slider = document.createElement('div');
    slider.setAttribute('data-allow-horizontal-scroll', 'true');
    const thumb = document.createElement('span');
    slider.appendChild(thumb);
    document.body.appendChild(slider);

    expect(swipeLeft(thumb).defaultPrevented).toBe(false);
  });

  test('vertical scrolling is never touched', () => {
    const paragraph = document.createElement('p');
    document.body.appendChild(paragraph);
    touchEvent('touchstart', paragraph, 200, 500);

    expect(touchEvent('touchmove', paragraph, 204, 380).defaultPrevented).toBe(false);
  });

  test('edge gestures (system back) are left alone', () => {
    const paragraph = document.createElement('p');
    document.body.appendChild(paragraph);
    touchEvent('touchstart', paragraph, 10, 400);

    expect(touchEvent('touchmove', paragraph, 90, 400).defaultPrevented).toBe(false);
  });
});
