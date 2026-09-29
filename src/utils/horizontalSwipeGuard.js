// Global mobile guard: prevent accidental horizontal drag/side-scroll of the
// page, while letting real horizontal scrollers (tab bars, chip rails, wide
// tables) scroll by touch.
//
// The guard used to require every scroller to opt in with
// data-allow-horizontal-scroll="true". Almost none did, so tab bars with
// overflow-x: auto scrolled with a mouse/trackpad but were dead to a swipe:
// labels past the viewport were unreachable on phones. Now an element that can
// actually scroll sideways (overflow-x auto/scroll AND content wider than its
// box) lets the gesture through by itself; the attribute still forces it.

const ALLOW_SELECTOR = '[data-allow-horizontal-scroll="true"]';
const EDGE_PX = 24;
const SCROLLABLE_OVERFLOW = new Set(['auto', 'scroll']);

function canScrollHorizontally(element, win) {
  if (element.scrollWidth <= element.clientWidth + 1) return false;
  const { overflowX } = win.getComputedStyle(element);
  return SCROLLABLE_OVERFLOW.has(overflowX);
}

// Whether a horizontal gesture that starts on `target` belongs to a scroller
// (explicit opt-in or a horizontally scrollable ancestor) instead of the page.
export function isInsideHorizontalScroller(target, win = window) {
  if (!target || typeof target.closest !== 'function') return false;
  if (target.closest(ALLOW_SELECTOR)) return true;

  const doc = target.ownerDocument;
  for (let element = target; element && element !== doc.body && element !== doc.documentElement;
    element = element.parentElement) {
    if (canScrollHorizontally(element, win)) return true;
  }
  return false;
}

export function installHorizontalSwipeGuard(win = window) {
  const doc = win.document;
  let startX = 0;
  let startY = 0;
  let ignoreGesture = false;
  let gestureInScroller = null;

  const onTouchStart = (event) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    ignoreGesture = touch.clientX <= EDGE_PX || touch.clientX >= (win.innerWidth - EDGE_PX);
    // Resolved lazily, once per gesture, only when it turns horizontal.
    gestureInScroller = null;
  };

  const onTouchMove = (event) => {
    if (event.touches.length !== 1 || ignoreGesture) return;

    const touch = event.touches[0];
    const deltaX = Math.abs(touch.clientX - startX);
    const deltaY = Math.abs(touch.clientY - startY);

    // If gesture is mainly horizontal, block it unless a scroller owns it.
    if (deltaX > deltaY + 4) {
      if (gestureInScroller === null) {
        gestureInScroller = event.target instanceof win.Element
          && isInsideHorizontalScroller(event.target, win);
      }
      if (!gestureInScroller) event.preventDefault();
    }
  };

  doc.addEventListener('touchstart', onTouchStart, { passive: true });
  doc.addEventListener('touchmove', onTouchMove, { passive: false });

  return () => {
    doc.removeEventListener('touchstart', onTouchStart);
    doc.removeEventListener('touchmove', onTouchMove);
  };
}
