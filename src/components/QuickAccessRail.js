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
//  - We render the real items plus CLONES visual clones on each side:
//      [..clones..  r0 r1 r2 r3  ..clones..]
//    so the first real card always has a (cloned) "previous" peeking on its left
//    and the last real card a (cloned) "next" peeking on its right, and a single
//    gesture can travel several cards before reaching a wall. The lead/tail
//    spacers shrink to a single gap, so the extremes are never blank.
//  - Clones are inert: plain <div>s, aria-hidden, no Link/onClick/prefetch, so
//    they never duplicate navigation or analytics. The dots also map to the real
//    items only.
//  - When a settle lands on a clone slot we instantly reposition scrollLeft to
//    the equivalent *real* slot (±one full set) in the same synchronous frame.
//    The on-screen window is content-identical at the wrap point, so the swap is
//    pixel-for-pixel invisible — a seamless infinite carousel.
//
// Feel (premium carousel, two-state model):
//  - REAL state  (`activeSlotRef` / consolidated `activeIndex`): the card that is
//    settled and wide. Drives the dots and a11y.
//  - VISUAL state (`--qa-p` / `--qa-a` CSS vars, set every drag/settle frame):
//    a continuous activation per card derived from its distance to the viewport
//    centre. As a card nears the centre it *progressively* grows, brightens, its
//    violet hero fades in, the glow/ring rise, the icon and title gain presence;
//    cards drifting away compress and dim. This happens while the finger is down,
//    not only on release, so you always see "which card you're on".
//  - Mid-drag we never change a card's real width (no reflow → no jank). Only the
//    layout-free vars move. The width morph happens on settle.
//
// Release / sensitivity:
//  - During the drag we drive el.scrollLeft 1:1 with the finger. On release the
//    destination is simply the card *nearest the viewport centre* — so a long
//    drag genuinely travels several cards (no "max one card" clamp), a short drag
//    lands on the neighbour, and a tap stays put. Velocity adds only a small,
//    hard-capped momentum nudge (≤ ~one card) so a quick flick can carry one more
//    card but never flies away. The settle then glides scroll + widths together
//    with a controlled ease whose duration scales gently with the travel.

const ACTIVE_W = 182; // px, dominant active card width (within the 170–185 brief)
const INACTIVE_W = 108; // px, collapsed sibling width (within the 96–118 brief)
const CARD_H = 204; // px, fixed height (+14 vs before — a touch taller, fills the lower space)
const GAP = 10; // px, matches the flex gap below
const IDLE_MS = 110; // "scrolling has stopped" debounce (wheel/trackpad path)
const DRAG_THRESHOLD = 5; // px of horizontal travel before a touch becomes a drag
const CLONES = 3; // visual clones per side — enough headroom to drag several cards in one go
const EASE = 'cubic-bezier(0.22,1,0.36,1)';

// Settle timing scales with how far we travel, so a single-card snap stays quick
// while a multi-card glide takes a little longer without ever feeling sluggish.
const SETTLE_MIN = 240; // ms (single card / pure width morph)
const SETTLE_MAX = 440; // ms (several cards)
const SETTLE_PER_PX = 0.42; // ms added per px of scroll travel

// Release tuning — distance dragged decides the destination; velocity only adds a
// small, capped momentum nudge so a flick can carry at most ~one extra card.
const VELOCITY_CLAMP = 2.2; // px/ms — hard cap so a violent flick can't run away
const MOMENTUM_FACTOR = 78; // px of glide projected per px/ms of release speed
const MAX_FLICK_PX = 150; // px — hard cap on the flick nudge (~one card)

// Activation falloff: how close to the viewport centre a card must be (in px)
// before its violet hero / glow / icon start lighting up. Tight (≈ one collapsed
// slot) so neighbours stay subdued at rest and only light as they approach centre.
const ACT_RANGE = INACTIVE_W + GAP; // 118px

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

// Opacity rides the per-card --qa-a activation var so the markings strengthen
// progressively as the card nears the centre (no discrete on/off pop).
const PitchLines = ({ variant = 0 }) => (
  <svg
    className="pointer-events-none absolute inset-x-0 bottom-0 h-[72%] w-full mix-blend-screen"
    style={{ opacity: 'calc(0.07 + 0.12 * var(--qa-a, 0))' }}
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

  // Appearance is driven *continuously* by two CSS custom properties the rail sets
  // imperatively each frame:
  //   --qa-p  broad proximity (0→1) → gentle scale + opacity for every card
  //   --qa-a  tight activation (0→1) → violet hero, glow, ring, icon/title presence
  // Using calc(var()) here (not class toggles) means a React re-render — e.g. a
  // badge update or the dots' preview index flipping — never clobbers an in-flight
  // animation, and the activation can sit at any fractional value mid-drag.
  const cardClass = [
    'qa-card group relative flex-none flex flex-col items-center justify-center text-center',
    'origin-center overflow-hidden rounded-card no-underline text-white outline-none cursor-pointer border',
    'focus-visible:ring-2 focus-visible:ring-[rgba(190,170,255,0.7)] focus-visible:ring-offset-0',
    isActive ? 'z-[3]' : 'z-[1]',
  ].join(' ');

  // Layout-free, var-driven styling. width is set separately/imperatively by the
  // rail (and animated on settle), so it is intentionally absent here.
  const cardStyle = {
    height: `${CARD_H}px`,
    transform: 'scale(calc(0.9 + 0.1 * var(--qa-p, 0)))',
    opacity: 'calc(0.55 + 0.45 * var(--qa-p, 0))',
    borderColor: 'rgba(196,178,255, calc(0.16 + 0.44 * var(--qa-a, 0)))',
    boxShadow: [
      '0 4px 14px rgba(5,3,16, calc(0.4 - 0.12 * var(--qa-a, 0)))',
      // Softer, longer-reaching violet glow so it tapers out gracefully in the
      // extra bottom room rather than ending abruptly.
      '0 18px 46px rgba(84,48,224, calc(0.42 * var(--qa-a, 0)))',
      '0 0 0 1px rgba(196,178,255, calc(0.22 * var(--qa-a, 0)))',
      'inset 0 1px 0 rgba(255,255,255, calc(0.24 * var(--qa-a, 0)))',
    ].join(', '),
  };

  // Glass base sits underneath; the violet hero gradient is a separate overlay
  // whose opacity rides --qa-a (CSS can't tween between two gradients directly).
  const baseBg =
    'absolute inset-0 rounded-card bg-[linear-gradient(165deg,rgba(48,38,98,0.72),rgba(20,16,41,0.94))]';
  const heroBg =
    'absolute inset-0 rounded-card bg-[linear-gradient(135deg,#8b5cff_0%,#6a43ff_56%,#5430e0_100%)]';

  // Badge mirrors the card's activation: it scales up + brightens as the card
  // centres, and stays compressed/dimmed while collapsed — all continuous so it
  // never pops between states on settle.
  const badgeClass =
    'absolute top-2.5 right-2.5 z-[4] inline-flex min-w-[20px] h-5 items-center justify-center rounded-full bg-[#ec007d] px-1.5 text-[10px] font-bold text-white origin-top-right';
  const badgeStyle = {
    transform: 'scale(calc(0.78 + 0.22 * var(--qa-a, 0)))',
    opacity: 'calc(0.9 + 0.1 * var(--qa-a, 0))',
    boxShadow: '0 0 calc(4px + 6px * var(--qa-a, 0)) rgba(236,0,125, calc(0.3 + 0.2 * var(--qa-a, 0)))',
  };

  const inner = (
    <>
      <span aria-hidden className={baseBg} />
      <span aria-hidden className={heroBg} style={{ opacity: 'var(--qa-a, 0)' }} />
      <span aria-hidden className="absolute inset-0 text-white">
        <PitchLines variant={variant} />
      </span>

      {badge > 0 && (
        <span className={badgeClass} style={badgeStyle}>
          {badge}
        </span>
      )}

      <span className="relative z-[2] flex flex-col items-center gap-3 px-2">
        {/* Icon badge: the active ring/bg cross-fades in over the inactive one and
            the whole badge scales up as the card centres → "el icono gana presencia". */}
        <span
          className="relative inline-flex h-11 w-11 items-center justify-center rounded-full"
          style={{ transform: 'scale(calc(1 + 0.22 * var(--qa-a, 0)))' }}
        >
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-[rgba(139,92,255,0.14)] border border-[rgba(148,134,255,0.28)]"
            style={{ opacity: 'calc(1 - var(--qa-a, 0))' }}
          />
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-white/[0.16] border border-white/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_6px_16px_rgba(20,8,60,0.35)]"
            style={{ opacity: 'var(--qa-a, 0)' }}
          />
          <span className="relative z-[1] inline-flex items-center justify-center text-white [&>svg]:h-[26px] [&>svg]:w-[26px]">
            {icon}
          </span>
          {showPlus && (
            <span className="absolute -top-1 -right-1 z-[2] inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-[#6a43ff] shadow-[0_3px_8px_rgba(20,8,60,0.4)]">
              <Plus size={13} strokeWidth={3} />
            </span>
          )}
        </span>

        <span className="flex flex-col items-center gap-0.5">
          {/* Title scales (not font-size) so it never reflows / rewraps mid-drag:
              ~12.6px collapsed → 15px at full activation. */}
          <span
            className="font-oswald font-bold leading-tight tracking-[0.01em] text-white line-clamp-2 px-1 text-[15px]"
            style={{ transform: 'scale(calc(0.84 + 0.16 * var(--qa-a, 0)))' }}
          >
            {title}
          </span>
          {/* Subtitle is revealed only as the card activates; the card clips
              overflow so it never breaks the narrow sibling layout. */}
          <span
            className="font-sans font-medium leading-tight text-[11px] text-white/80 whitespace-nowrap"
            style={{ opacity: 'var(--qa-a, 0)' }}
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
    // width is driven imperatively (and animated on settle); only the var-driven
    // appearance + height live here so a re-render can't reset the width.
    style: cardStyle,
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
  const activeSlotRef = useRef(0); // consolidated (settled) *slot* (may be a clone)
  const previewRealRef = useRef(0); // real index currently nearest the centre (drag preview)

  // --- custom pointer-drag state ---
  const pointerActiveRef = useRef(false); // a pointer is down and being tracked
  const draggingRef = useRef(false); // travel crossed the horizontal threshold
  const draggedRef = useRef(false); // a drag happened → suppress the next click
  const pointerIdRef = useRef(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startScrollRef = useRef(0);
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

  // Continuous, layout-free activation. For every card we measure its centre's
  // distance to the viewport centre and publish two vars the card's CSS consumes:
  //   --qa-p broad proximity (gentle scale/opacity coverflow falloff)
  //   --qa-a tight activation (violet hero / glow / icon — smoothstepped so
  //          neighbours stay ~0 until they actually approach the centre)
  // Pure custom-property writes, so it can run every drag frame without reflow.
  const updateVisuals = useCallback((scrollLeft) => {
    const railW = railWidthRef.current || 1;
    const viewCenter = scrollLeft + railW / 2;
    const nodes = cardRefs.current;
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!node) continue; // eslint-disable-line no-continue
      const center = node.offsetLeft + node.offsetWidth / 2;
      const d = Math.abs(center - viewCenter);
      const prox = clamp(1 - d / (railW * 0.55), 0, 1);
      let a = clamp(1 - d / ACT_RANGE, 0, 1);
      a = a * a * (3 - 2 * a); // smoothstep
      node.style.setProperty('--qa-p', prox.toFixed(3));
      node.style.setProperty('--qa-a', a.toFixed(3));
    }
  }, []);

  const centerScrollFor = useCallback((slot) => {
    const el = scrollRef.current;
    const node = cardRefs.current[slot];
    if (!el || !node) return 0;
    const center = node.offsetLeft + node.offsetWidth / 2;
    return clamp(center - railWidthRef.current / 2, 0, el.scrollWidth - el.clientWidth);
  }, []);

  // Nearest slot to a given scroll position (used for the drag-release settle, the
  // live drag preview, and the wheel/trackpad idle settle).
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
  // motion / loop reposition): correct widths, focused slot centred, vars applied.
  // No animation. Done synchronously in one frame so a reposition after a settle is
  // pixel-identical and therefore invisible.
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

  // Settle to `slot`: glide BOTH scrollLeft and the card widths to their resting
  // values with one eased timeline. We measure the destination scroll at the final
  // widths up front, so even a several-card settle glides straight there with no
  // first-frame jump. updateVisuals runs each frame, so the activation the user saw
  // mid-drag stays coherent right through the settle.
  const settleTo = useCallback(
    (slot, opts) => {
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
      const targetReal = realIndexOfSlot(target);
      previewRealRef.current = targetReal;
      setActiveIndex(targetReal); // consolidates dots + a11y

      if (prefersReducedMotion()) {
        const final = wrapSlot(target);
        activeSlotRef.current = final;
        applyResting(final);
        settlingRef.current = false;
        return;
      }

      const startW = [...widthsRef.current];
      const endW = targetWidths(target);
      const railW = railWidthRef.current;
      const startScroll = el.scrollLeft;

      // Measure the resting scroll for `target` at its FINAL widths so we can glide
      // straight there (no jump when travelling several cards). Mutating + restoring
      // widths is synchronous within this frame, so nothing paints in between.
      setWidths(endW);
      const endNode = cardRefs.current[target];
      const endCenter = endNode ? endNode.offsetLeft + endNode.offsetWidth / 2 : startScroll + railW / 2;
      const endMax = el.scrollWidth - el.clientWidth;
      const endScroll = clamp(endCenter - railW / 2, 0, endMax);
      setWidths(startW);

      const travel = Math.abs(endScroll - startScroll);
      const dur =
        (opts && opts.duration) || clamp(SETTLE_MIN + travel * SETTLE_PER_PX, SETTLE_MIN, SETTLE_MAX);
      const begin = performance.now();

      const step = (now) => {
        const raw = clamp((now - begin) / dur, 0, 1);
        const t = ease(raw);
        setWidths(startW.map((s, i) => s + (endW[i] - s) * t));
        el.scrollLeft = startScroll + (endScroll - startScroll) * t;
        updateVisuals(el.scrollLeft);

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
      previewRealRef.current = realIndexOfSlot(activeSlotRef.current);
      lastXRef.current = e.clientX;
      lastTRef.current = performance.now();
      velocityRef.current = 0;
      cancelSettle(); // hand control to the finger immediately (cancels any glide)
    },
    [cancelSettle, realIndexOfSlot],
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

      // 1:1 with the finger — slow drags stay perfectly proportional, and a long
      // drag genuinely moves the viewport centre across several cards.
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

      // Live "which card am I on" → drive the dots + a11y preview without waiting
      // for release (kept cheap: only re-render when the nearest real card flips).
      const nr = realIndexOfSlot(nearestSlotForScroll(el.scrollLeft));
      if (nr !== previewRealRef.current) {
        previewRealRef.current = nr;
        setActiveIndex(nr);
      }
    },
    [nearestSlotForScroll, realIndexOfSlot, updateVisuals],
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

    // Destination = the card nearest the viewport centre AFTER a small, capped
    // momentum nudge. The distance the finger travelled already moved scrollLeft
    // (so a long drag lands several cards away — no "max one card" clamp), while
    // velocity only adds a limited glide so a quick flick carries at most ~one
    // extra card and never flies off.
    const velocity = clamp(velocityRef.current, -VELOCITY_CLAMP, VELOCITY_CLAMP);
    const momentum = clamp(-velocity * MOMENTUM_FACTOR, -MAX_FLICK_PX, MAX_FLICK_PX);
    const max = el.scrollWidth - el.clientWidth;
    const projected = clamp(el.scrollLeft + momentum, 0, max);
    settleTo(nearestSlotForScroll(projected));
  }, [nearestSlotForScroll, settleTo]);

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
    previewRealRef.current = 0;
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
          will-change: width, transform, opacity;
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
          // overflow-x:auto forces overflow-y to clip too, which used to cut the
          // active card's downward glow into a hard horizontal line ~16px below the
          // card. We give the shadow generous room to fade out inside the (clipped)
          // padding box and pull the following content back up with a matching
          // negative margin, so the glow falls naturally without growing the layout.
          className="qa-rail relative flex items-center gap-2.5 overflow-x-auto pt-4 pb-14 -mb-10"
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

        {/* Dots represent the real items only — clones are never counted. Kept
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
