import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { prefetchRoute } from '../utils/routePrefetch';

// Horizontal "gamer menu" selector for the Home "Accesos rápidos".
//
// Why this is a custom interaction and not plain CSS scroll-snap / native scroll:
// the brief is a dominant active card with genuinely *narrower* siblings (real
// width, not just transform: scale) AND buttery free-drag scrolling that you can
// start ANYWHERE in the section — on a card, its icon, its text, the gaps, or the
// dots. Native horizontal scroll fought the finger because the cards are real
// links/buttons that swallow the touch, so the scroll only engaged on certain
// pixels. So the gesture is fully owned by us via Pointer Events.
//
// Looping / continuity (no empty gaps at the extremes):
//  - We render the 4 *real* items plus 2 visual clones on each side:
//      [c(n-2) c(n-1)  r0 r1 r2 r3  c0 c1]
//    so the first real card always has a (cloned) "previous" peeking on its left
//    and the last real card a (cloned) "next" peeking on its right. The lead/tail
//    spacers shrink to a single gap, so the extremes are never blank.
//  - Clones are inert: plain <div>s, aria-hidden, no Link/onClick/prefetch, so
//    they never duplicate navigation or analytics. The dots also map to the 4
//    real items only.
//  - When a settle lands on a clone slot we instantly reposition scrollLeft to
//    the equivalent *real* slot (±one full set) in the same synchronous frame.
//    Because only the active card is wide and the on-screen window (centre card +
//    the two peeks) is content-identical at the wrap point, the swap is pixel-for
//    -pixel invisible — a seamless infinite carousel.
//
// Sensitivity (no "card flies off" on a quick flick):
//  - During the drag we drive el.scrollLeft 1:1 with the finger (slow drag stays
//    proportional). On release we do NOT project momentum into a far-away card.
//    Instead we look at dragDistance (how far the finger travelled) and velocity
//    (how fast it left) *separately* and advance AT MOST one card:
//      • travelled past DISTANCE_THRESHOLD → move one card in that direction;
//      • short but fast (a flick) → still only one card;
//      • tiny move / tap → stay put (a clean tap still activates the card).
//    The settle then glides to that single neighbour with a controlled ease.
//
// Card *widths are real* (active ~182px, inactive ~108px) but only change on
// settle (finger up), never mid-drag, so dragging never reflows. Mid-drag we only
// give layout-free feedback (transform/opacity, coverflow-style).

const ACTIVE_W = 182; // px, dominant active card width (within the 170–185 brief)
const INACTIVE_W = 108; // px, collapsed sibling width (within the 96–118 brief)
const CARD_H = 190; // px, fixed height (taller than before, better use of space)
const GAP = 10; // px, matches the flex gap below
const SETTLE_MS = 320; // settle duration (260–340 brief) — controlled, not snappy
const IDLE_MS = 110; // "scrolling has stopped" debounce (wheel/trackpad path)
const DRAG_THRESHOLD = 5; // px of horizontal travel before a touch becomes a drag
const CLONES = 2; // visual clones rendered on each side for the loop illusion
const EASE = 'cubic-bezier(0.22,1,0.36,1)';

// Release tuning — distance and velocity are judged independently so a fast flick
// never overshoots and a tiny drag never changes card.
const DISTANCE_THRESHOLD = 46; // px the finger must travel to commit a card change
const VELOCITY_THRESHOLD = 0.5; // px/ms release speed that counts as a flick
const FLICK_MIN_DISTANCE = 10; // px — a flick still needs *some* travel (not a tap)
const VELOCITY_CLAMP = 2.0; // px/ms — hard cap so a violent flick can't run away

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Standard cubic-bezier(0.22,1,0.36,1) evaluator (Newton-Raphson on x), so the
// JS settle uses the exact same easing the CSS transitions do.
const cubicBezier = (p1x, p1y, p2x, p2y) => {
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 5; i += 1) {
      const dx = sampleX(t) - x;
      const d = slopeX(t);
      if (Math.abs(dx) < 1e-4) break;
      if (Math.abs(d) < 1e-6) break;
      t -= dx / d;
    }
    return sampleY(clamp(t, 0, 1));
  };
};
const ease = cubicBezier(0.22, 1, 0.36, 1);

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Subtle, decorative pitch markings layered behind each card — one motif per real
// item so the rail doesn't look like the same patch of grass four times. Kept very
// low-opacity (lower still when inactive) so it never competes with icon/text. To
// remove entirely, just stop rendering <PitchLines/> in the card body.
const PITCH_VARIANTS = [
  // 0 · Partido nuevo — kickoff: centre circle + halfway line
  (
    <>
      <circle cx="80" cy="120" r="30" />
      <path d="M80 90v30" />
      <path d="M0 120h160" />
      <circle cx="80" cy="120" r="2.4" fill="currentColor" stroke="none" />
    </>
  ),
  // 1 · Mis partidos — penalty box + arc (the "área")
  (
    <>
      <path d="M0 120h160" />
      <path d="M44 120v-30h72v30" />
      <path d="M68 120v-12h24v12" />
      <path d="M62 90a20 20 0 0 0 36 0" />
    </>
  ),
  // 2 · Frecuentes — tactical route / diagonal play
  (
    <>
      <path d="M0 120h160" />
      <path d="M12 116 56 80 104 102 150 58" />
      <path d="M150 58l-12 1m12-1l-1 12" />
      <circle cx="12" cy="116" r="2.4" fill="currentColor" stroke="none" />
    </>
  ),
  // 3 · Estadísticas — baseline + rising stat/heatmap bars
  (
    <>
      <path d="M0 120h160" />
      <path d="M34 120v-22" />
      <path d="M66 120v-38" />
      <path d="M98 120v-28" />
      <path d="M130 120v-50" />
    </>
  ),
];

const PitchLines = ({ variant = 0, isActive }) => (
  <svg
    className="pointer-events-none absolute inset-x-0 bottom-0 h-[72%] w-full mix-blend-screen transition-opacity duration-300"
    style={{ opacity: isActive ? 0.18 : 0.07 }}
    viewBox="0 0 160 120"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {PITCH_VARIANTS[variant % PITCH_VARIANTS.length]}
  </svg>
);

const QuickAccessCard = React.forwardRef(({ item, isActive, isClone, variant }, ref) => {
  const { to, onClick, prefetch, icon, title, subtitle, badge, showPlus } = item;

  const handlePrefetch = useCallback(() => {
    if (prefetch) prefetchRoute(prefetch);
  }, [prefetch]);

  // Layout width + transform/opacity are driven imperatively by the rail, never
  // by class names here, so re-renders (e.g. a badge update) never clobber an
  // in-flight animation. Class names only carry the *appearance* (which itself
  // cross-fades via the gradient overlay + transitions below).
  const cardClass = [
    'qa-card group relative flex-none flex flex-col items-center justify-center text-center',
    'origin-center overflow-hidden rounded-card no-underline text-white outline-none cursor-pointer',
    'border transition-[border-color,box-shadow,color] duration-300',
    'focus-visible:ring-2 focus-visible:ring-[rgba(190,170,255,0.7)] focus-visible:ring-offset-0',
    isActive
      ? 'z-[3] border-[rgba(196,178,255,0.6)] shadow-[0_16px_38px_rgba(84,48,224,0.5),0_0_0_1px_rgba(196,178,255,0.22),inset_0_1px_0_rgba(255,255,255,0.24)]'
      : 'z-[1] border-[rgba(148,134,255,0.16)] shadow-elev-1',
  ].join(' ');

  // Glass base sits underneath; the violet hero gradient is a separate overlay
  // whose opacity transitions (CSS can't tween between two gradients directly).
  const baseBg =
    'absolute inset-0 rounded-card bg-[linear-gradient(165deg,rgba(48,38,98,0.72),rgba(20,16,41,0.94))]';
  const heroBg =
    'absolute inset-0 rounded-card transition-opacity duration-300 bg-[linear-gradient(135deg,#8b5cff_0%,#6a43ff_56%,#5430e0_100%)]';

  const iconBadgeClass = [
    'relative inline-flex items-center justify-center rounded-full',
    'transition-[width,height,background-color,border-color] duration-300',
    isActive
      ? 'h-[54px] w-[54px] bg-white/[0.16] border border-white/30 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_6px_16px_rgba(20,8,60,0.35)]'
      : 'h-11 w-11 bg-[rgba(139,92,255,0.14)] border border-[rgba(148,134,255,0.28)] text-[#cfc4ff]',
  ].join(' ');

  const titleClass = [
    'font-oswald font-bold leading-tight tracking-[0.01em] text-white transition-[font-size] duration-300 line-clamp-2 px-1',
    isActive ? 'text-[15px]' : 'text-[12.5px]',
  ].join(' ');

  // Badge mirrors the card's active state: on the wide active card it sits full
  // size with a soft glow; when the card collapses it scales down and dims so it
  // stays visually anchored to the shrinking container instead of floating.
  const badgeClass = [
    'absolute top-2.5 right-2.5 z-[4] inline-flex min-w-[20px] h-5 items-center justify-center',
    'rounded-full bg-[#ec007d] px-1.5 text-[10px] font-bold text-white origin-top-right',
    'transition-[transform,opacity,box-shadow] duration-300',
    isActive
      ? 'scale-100 opacity-100 shadow-[0_0_10px_rgba(236,0,125,0.5)]'
      : 'scale-[0.78] opacity-90 shadow-[0_0_4px_rgba(236,0,125,0.3)]',
  ].join(' ');

  const inner = (
    <>
      <span aria-hidden className={baseBg} />
      <span aria-hidden className={heroBg} style={{ opacity: isActive ? 1 : 0 }} />
      <span aria-hidden className="absolute inset-0 text-white">
        <PitchLines variant={variant} isActive={isActive} />
      </span>

      {badge > 0 && <span className={badgeClass}>{badge}</span>}

      <span className="relative z-[2] flex flex-col items-center gap-3 px-2">
        <span className={iconBadgeClass}>
          <span className="inline-flex items-center justify-center [&>svg]:h-[26px] [&>svg]:w-[26px]">
            {icon}
          </span>
          {showPlus && (
            <span className="absolute -top-1 -right-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-[#6a43ff] shadow-[0_3px_8px_rgba(20,8,60,0.4)]">
              <Plus size={13} strokeWidth={3} />
            </span>
          )}
        </span>

        <span className="flex flex-col items-center gap-0.5">
          <span className={titleClass}>{title}</span>
          {/* Subtitle is revealed only on the wide active card; the card clips
              overflow so it never breaks the narrow sibling layout. */}
          <span
            className="font-sans font-medium leading-tight text-[11px] text-white/80 whitespace-nowrap transition-opacity duration-300"
            style={{ opacity: isActive ? 1 : 0 }}
          >
            {subtitle}
          </span>
        </span>
      </span>
    </>
  );

  const sharedProps = {
    ref,
    className: cardClass,
    // width is driven imperatively (and animated on settle); only height is
    // React-controlled so a re-render (e.g. badge update) can't reset the width.
    style: { height: `${CARD_H}px` },
    // dragging is handled entirely by the parent gesture zone; the card itself
    // must never start a native drag/selection that would fight the thumb.
    draggable: false,
    onDragStart: (e) => e.preventDefault(),
  };

  // Clones are purely decorative: inert <div>s with no link/handler/prefetch and
  // hidden from a11y, so they never double up navigation or analytics.
  if (isClone) {
    return (
      <div {...sharedProps} aria-hidden="true" tabIndex={-1}>
        {inner}
      </div>
    );
  }

  const interactiveProps = {
    ...sharedProps,
    onMouseEnter: handlePrefetch,
    onTouchStart: handlePrefetch,
    onFocus: handlePrefetch,
    'aria-current': isActive ? 'true' : undefined,
  };

  if (to) {
    return (
      <Link to={to} {...interactiveProps}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} {...interactiveProps}>
      {inner}
    </button>
  );
});

QuickAccessCard.displayName = 'QuickAccessCard';

const QuickAccessRail = ({ items = [] }) => {
  const gestureRef = useRef(null); // the whole section: where pointers are caught
  const scrollRef = useRef(null); // the overflow container we drive via scrollLeft
  const leadRef = useRef(null);
  const tailRef = useRef(null);
  const cardRefs = useRef([]);

  const railWidthRef = useRef(0);
  const widthsRef = useRef([]); // current (possibly mid-animation) px widths
  const settleRaf = useRef(0);
  const scrollRaf = useRef(0);
  const idleTimer = useRef(0);
  const settlingRef = useRef(false);
  const activeSlotRef = useRef(0); // currently focused *slot* (may be a clone)

  // --- custom pointer-drag state ---
  const pointerActiveRef = useRef(false); // a pointer is down and being tracked
  const draggingRef = useRef(false); // travel crossed the horizontal threshold
  const draggedRef = useRef(false); // a drag happened → suppress the next click
  const pointerIdRef = useRef(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startScrollRef = useRef(0);
  const startSlotRef = useRef(0); // active slot when the gesture began
  const lastXRef = useRef(0);
  const lastTRef = useRef(0);
  const velocityRef = useRef(0); // px/ms of pointer X, smoothed (for the flick)

  const count = items.length;
  // Loop only makes sense with enough distinct cards; below that we fall back to
  // a plain centred rail (no clones).
  const loop = count >= 3;
  const lead = loop ? CLONES : 0;
  const slotCount = count + lead * 2;

  // Build the rendered slot list: leading clones, the real items, trailing clones.
  const slots = useMemo(() => {
    if (!loop) {
      return items.map((item, realIndex) => ({ item, realIndex, isClone: false, key: item.key }));
    }
    const out = [];
    for (let i = 0; i < lead; i += 1) {
      const realIndex = (count - lead + i + count) % count;
      out.push({ item: items[realIndex], realIndex, isClone: true, key: `clone-pre-${i}` });
    }
    items.forEach((item, realIndex) => {
      out.push({ item, realIndex, isClone: false, key: item.key });
    });
    for (let i = 0; i < lead; i += 1) {
      const realIndex = i % count;
      out.push({ item: items[realIndex], realIndex, isClone: true, key: `clone-post-${i}` });
    }
    return out;
  }, [items, count, lead, loop]);

  const realIndexOfSlot = useCallback(
    (slot) => (loop ? ((slot - lead) % count + count) % count : slot),
    [loop, lead, count],
  );
  const slotForReal = useCallback((real) => real + lead, [lead]);

  const [activeIndex, setActiveIndex] = useState(0); // real index (drives appearance + dots)

  const targetWidths = useCallback(
    (slot) => Array.from({ length: slotCount }, (_, i) => (i === slot ? ACTIVE_W : INACTIVE_W)),
    [slotCount],
  );

  const setWidths = useCallback((arr) => {
    widthsRef.current = arr;
    cardRefs.current.forEach((node, i) => {
      if (node) node.style.width = `${arr[i]}px`;
    });
  }, []);

  // Layout-free live feedback: cards near the centre are full size/opacity,
  // cards toward the edges shrink/dim. Pure transform+opacity, so it can run
  // every drag frame without ever reflowing.
  const updateVisuals = useCallback((scrollLeft) => {
    const railW = railWidthRef.current || 1;
    const viewCenter = scrollLeft + railW / 2;
    cardRefs.current.forEach((node) => {
      if (!node) return;
      const center = node.offsetLeft + node.offsetWidth / 2;
      const norm = clamp(Math.abs(center - viewCenter) / (railW * 0.55), 0, 1);
      const scale = 1 - 0.1 * norm; // 1.0 → 0.90
      const opacity = 1 - 0.45 * norm; // 1.0 → 0.55
      node.style.transform = `scale(${scale.toFixed(3)})`;
      node.style.opacity = opacity.toFixed(3);
    });
  }, []);

  const centerScrollFor = useCallback((slot) => {
    const el = scrollRef.current;
    const node = cardRefs.current[slot];
    if (!el || !node) return 0;
    const center = node.offsetLeft + node.offsetWidth / 2;
    return clamp(center - railWidthRef.current / 2, 0, el.scrollWidth - el.clientWidth);
  }, []);

  // Nearest slot to a given scroll position (used both for the drag-release
  // settle and for the wheel/trackpad idle settle).
  const nearestSlotForScroll = useCallback((scrollLeft) => {
    const viewCenter = scrollLeft + railWidthRef.current / 2;
    let best = 0;
    let bestDist = Infinity;
    cardRefs.current.forEach((node, i) => {
      if (!node) return;
      const center = node.offsetLeft + node.offsetWidth / 2;
      const dist = Math.abs(center - viewCenter);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best;
  }, []);

  const nearestSlot = useCallback(() => {
    const el = scrollRef.current;
    return el ? nearestSlotForScroll(el.scrollLeft) : activeSlotRef.current;
  }, [nearestSlotForScroll]);

  // Snap the layout into its resting state instantly (mount / resize / reduced
  // motion / loop reposition): correct widths, focused slot centred, visuals
  // applied. No animation. Done synchronously in one frame so a reposition after
  // a settle is pixel-identical and therefore invisible.
  const applyResting = useCallback(
    (slot) => {
      const el = scrollRef.current;
      if (!el) return;
      setWidths(targetWidths(slot));
      el.scrollLeft = centerScrollFor(slot);
      updateVisuals(el.scrollLeft);
    },
    [centerScrollFor, setWidths, targetWidths, updateVisuals],
  );

  // If a settle ended on a clone slot, hop to the equivalent real slot (±one full
  // set) so the next gesture starts from a real card and the loop stays endless.
  // The on-screen window is content-identical at this point, so it's seamless.
  const wrapSlot = useCallback(
    (slot) => {
      if (!loop) return slot;
      if (slot < lead) return slot + count;
      if (slot >= lead + count) return slot - count;
      return slot;
    },
    [loop, lead, count],
  );

  // Settle to `slot`: lerp widths active↔inactive while pinning the chosen card's
  // centre to the viewport centre each frame, so it stays still while its siblings
  // collapse/expand around it. Finger is up, so we own scrollLeft.
  const settleTo = useCallback(
    (slot) => {
      const el = scrollRef.current;
      if (!el || count === 0) return;
      // Never settle onto the outermost clones (they have no outer neighbour to
      // peek), so the post-settle wrap target always has matching neighbours.
      const lo = loop ? 1 : 0;
      const hi = loop ? slotCount - 2 : slotCount - 1;
      const target = clamp(slot, lo, hi);

      if (settleRaf.current) cancelAnimationFrame(settleRaf.current);
      settlingRef.current = true;
      activeSlotRef.current = target;
      setActiveIndex(realIndexOfSlot(target)); // cross-fades the hero gradient/glow

      if (prefersReducedMotion()) {
        const final = wrapSlot(target);
        activeSlotRef.current = final;
        applyResting(final);
        settlingRef.current = false;
        return;
      }

      const startW = [...widthsRef.current];
      const endW = targetWidths(target);
      const begin = performance.now();

      const step = (now) => {
        const raw = clamp((now - begin) / SETTLE_MS, 0, 1);
        const t = ease(raw);
        setWidths(startW.map((s, i) => s + (endW[i] - s) * t));

        const node = cardRefs.current[target];
        if (node) {
          const center = node.offsetLeft + node.offsetWidth / 2;
          el.scrollLeft = clamp(center - railWidthRef.current / 2, 0, el.scrollWidth - el.clientWidth);
          updateVisuals(el.scrollLeft);
        }

        if (raw < 1) {
          settleRaf.current = requestAnimationFrame(step);
          return;
        }
        settleRaf.current = 0;
        const final = wrapSlot(target);
        if (final !== target) {
          // Seamless loop hop: same synchronous frame, identical visible pixels.
          activeSlotRef.current = final;
          applyResting(final);
          // Keep the scroll handler muted until the reposition's scroll event has
          // been swallowed, then release control.
          requestAnimationFrame(() => {
            settlingRef.current = false;
          });
        } else {
          settlingRef.current = false;
        }
      };
      settleRaf.current = requestAnimationFrame(step);
    },
    [applyResting, count, loop, realIndexOfSlot, slotCount, setWidths, targetWidths, updateVisuals, wrapSlot],
  );

  // Stop any in-flight settle / idle timer so the finger gets control instantly.
  const cancelSettle = useCallback(() => {
    if (settleRaf.current) {
      cancelAnimationFrame(settleRaf.current);
      settleRaf.current = 0;
    }
    settlingRef.current = false;
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = 0;
    }
  }, []);

  // Wheel / trackpad horizontal scroll (desktop): keep visuals live and settle
  // once it stops. The touch path never relies on this — it's guarded out while
  // a pointer drag or settle owns the scroll position.
  const handleScroll = useCallback(() => {
    if (pointerActiveRef.current || settlingRef.current) return;
    if (!scrollRaf.current) {
      scrollRaf.current = requestAnimationFrame(() => {
        scrollRaf.current = 0;
        const el = scrollRef.current;
        if (el) updateVisuals(el.scrollLeft);
      });
    }
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      if (!pointerActiveRef.current && !settlingRef.current) settleTo(nearestSlot());
    }, IDLE_MS);
  }, [nearestSlot, settleTo, updateVisuals]);

  // --- pointer gesture: works anywhere in the zone, over any child ---

  const handlePointerDown = useCallback(
    (e) => {
      if (e.button != null && e.button > 0) return; // ignore right/middle click
      const el = scrollRef.current;
      if (!el) return;
      pointerActiveRef.current = true;
      draggingRef.current = false;
      draggedRef.current = false;
      pointerIdRef.current = e.pointerId;
      startXRef.current = e.clientX;
      startYRef.current = e.clientY;
      startScrollRef.current = el.scrollLeft;
      startSlotRef.current = activeSlotRef.current;
      lastXRef.current = e.clientX;
      lastTRef.current = performance.now();
      velocityRef.current = 0;
      cancelSettle(); // hand control to the finger immediately
    },
    [cancelSettle],
  );

  const handlePointerMove = useCallback(
    (e) => {
      if (!pointerActiveRef.current) return;
      const el = scrollRef.current;
      if (!el) return;
      const dx = e.clientX - startXRef.current;
      const dy = e.clientY - startYRef.current;

      // Direction lock on the first meaningful movement: horizontal → we own it;
      // vertical → release it back to the browser so the page can scroll.
      if (!draggingRef.current) {
        if (Math.abs(dx) > DRAG_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
          draggingRef.current = true;
          draggedRef.current = true;
          const zone = gestureRef.current;
          if (zone && pointerIdRef.current != null) {
            try {
              zone.setPointerCapture(pointerIdRef.current);
            } catch (_) {
              /* capture can fail if the pointer already ended; harmless */
            }
          }
        } else if (Math.abs(dy) > DRAG_THRESHOLD && Math.abs(dy) >= Math.abs(dx)) {
          pointerActiveRef.current = false; // vertical: let the page scroll
          return;
        } else {
          return; // not enough travel to decide yet
        }
      }

      // 1:1 with the finger — slow drags stay perfectly proportional.
      const max = el.scrollWidth - el.clientWidth;
      el.scrollLeft = clamp(startScrollRef.current - dx, 0, max);

      // Smoothed pointer velocity for the release flick.
      const now = performance.now();
      const dt = now - lastTRef.current;
      if (dt > 0) {
        const inst = (e.clientX - lastXRef.current) / dt;
        velocityRef.current = velocityRef.current * 0.7 + inst * 0.3;
        lastXRef.current = e.clientX;
        lastTRef.current = now;
      }

      updateVisuals(el.scrollLeft);
    },
    [updateVisuals],
  );

  const handlePointerUp = useCallback(() => {
    const wasDragging = draggingRef.current;
    const zone = gestureRef.current;
    if (zone && pointerIdRef.current != null) {
      try {
        zone.releasePointerCapture(pointerIdRef.current);
      } catch (_) {
        /* already released */
      }
    }
    pointerIdRef.current = null;
    pointerActiveRef.current = false;
    draggingRef.current = false;

    if (!wasDragging) return; // a clean tap → let the click activate the card

    const el = scrollRef.current;
    if (!el) return;

    // Judge distance and velocity *independently* and advance at most one card:
    //  - travelled past the distance threshold → commit one card;
    //  - short but fast (a real flick) → still just one card;
    //  - otherwise → snap back to where we started.
    const dragDistance = el.scrollLeft - startScrollRef.current; // +: moved toward next
    const velocity = clamp(velocityRef.current, -VELOCITY_CLAMP, VELOCITY_CLAMP);
    const absDist = Math.abs(dragDistance);
    const movedEnough = absDist > DISTANCE_THRESHOLD;
    const flicked = Math.abs(velocity) > VELOCITY_THRESHOLD && absDist > FLICK_MIN_DISTANCE;

    const startSlot = startSlotRef.current;
    let target = startSlot;
    if (movedEnough || flicked) {
      // direction primarily from travel; fall back to flick direction
      const dir = dragDistance !== 0 ? Math.sign(dragDistance) : -Math.sign(velocity);
      target = startSlot + dir;
    }
    target = clamp(target, startSlot - 1, startSlot + 1);
    settleTo(target);
  }, [settleTo]);

  // Capture-phase: if the finger dragged, swallow the click before it reaches
  // the card's Link/button so a scroll never navigates by accident.
  const handleClickCapture = useCallback((e) => {
    if (draggedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      draggedRef.current = false;
    }
  }, []);

  // Measure rail + spacers. With loop clones filling the extremes the spacer is a
  // single gap; without clones it keeps the legacy half-width pad so the first/last
  // real card can still reach the centre.
  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    railWidthRef.current = el.clientWidth;
    const spacer = loop ? GAP : Math.max(GAP, (el.clientWidth - ACTIVE_W) / 2);
    if (leadRef.current) leadRef.current.style.width = `${spacer}px`;
    if (tailRef.current) tailRef.current.style.width = `${spacer}px`;
  }, [loop]);

  // Initial layout (before paint, so there's no flash of equal-width cards).
  useLayoutEffect(() => {
    activeSlotRef.current = slotForReal(0);
    measure();
    applyResting(activeSlotRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotCount]);

  useEffect(() => {
    const onResize = () => {
      measure();
      applyResting(activeSlotRef.current);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (settleRaf.current) cancelAnimationFrame(settleRaf.current);
      if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [applyResting, measure]);

  return (
    <div className="-mx-4 mb-4">
      <style>{`
        .qa-gesture-zone {
          /* keep vertical page scroll, but the horizontal axis is ours */
          touch-action: pan-y;
          -webkit-user-select: none;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
          cursor: grab;
        }
        .qa-gesture-zone:active { cursor: grabbing; }
        .qa-rail {
          -ms-overflow-style: none;
          scrollbar-width: none;
          touch-action: pan-y;
          overscroll-behavior-x: contain;
        }
        .qa-rail::-webkit-scrollbar { display: none; }
        .qa-card {
          will-change: width, transform;
          touch-action: pan-y;
          -webkit-user-drag: none;
          -webkit-user-select: none;
          user-select: none;
        }
      `}</style>

      {/* One continuous touch surface: cards, gaps and dots all drag the rail. */}
      <div
        ref={gestureRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClickCapture={handleClickCapture}
        className="qa-gesture-zone relative"
      >
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="qa-rail relative flex items-center gap-2.5 overflow-x-auto py-4"
        >
          <div ref={leadRef} aria-hidden className="flex-none" />
          {slots.map((slot, index) => (
            <QuickAccessCard
              key={slot.key}
              ref={(node) => {
                cardRefs.current[index] = node;
              }}
              item={slot.item}
              variant={slot.realIndex}
              isClone={slot.isClone}
              isActive={slot.realIndex === activeIndex}
            />
          ))}
          <div ref={tailRef} aria-hidden className="flex-none" />
        </div>

        {/* Dots represent the 4 real items only — clones are never counted. Kept
            small/dim/glow-free so they read as a position hint, not a CTA. */}
        {count > 1 && (
          <div className="mt-0.5 flex items-center justify-center gap-1.5 px-4 pb-1.5">
            {items.map((item, index) => {
              const isActive = index === activeIndex;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-label={`Ir a ${item.title}`}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => settleTo(slotForReal(index))}
                  className="group/dot inline-flex h-3 items-center justify-center"
                >
                  <span
                    className={[
                      'block rounded-full transition-all duration-300',
                      isActive
                        ? 'w-2 h-[3px] bg-[#8b5cff]/55'
                        : 'w-[3px] h-[3px] bg-white/12 group-hover/dot:bg-white/25',
                    ].join(' ')}
                    style={{ transitionTimingFunction: EASE }}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default QuickAccessRail;
