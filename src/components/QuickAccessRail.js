import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { prefetchRoute } from '../utils/routePrefetch';

// 3D orbital ("coverflow") selector for the Home "Accesos rápidos".
//
// The cards sit on a circular ring in depth: the active card is centred, large,
// front-facing, bright and glowing, while the siblings rotate backward into the
// scene — angled in perspective, smaller, dimmer and more edge-on the farther
// they are. The whole thing reads as cards orbiting around the viewer, not a flat
// strip sliding left/right.
//
// Why a custom gesture (not native scroll / scroll-snap):
//  - The visual is genuine 3D (rotateY / translateZ), so there is no real scroll
//    position to ride — the geometry is derived purely from each card's offset to
//    the active index. We own the gesture so a drag can start ANYWHERE in the
//    section (a card, its icon/text, the gaps, the dots) and the cards follow the
//    finger around the ring; native horizontal scroll fought the finger because
//    the cards are real links/buttons that swallow the touch.
//
// How it works:
//  - `getCarousel3DStyle(index, pos, total)` is a pure function of a card's real
//    index, the (possibly fractional) ring position `pos`, and the card count. It
//    returns the 3D transform, opacity, z-index, pointer-events and a continuous
//    activation `a` (0→1) used to light up the active card's face. The offset is
//    normalised to the SHORTEST path around the ring, so the carousel loops
//    seamlessly with a single DOM node per card (no clones needed — the card that
//    is "behind you" is simply the same node placed at the back of the ring).
//  - During a drag we drive `pos` 1:1 with the finger and write each card's
//    transform imperatively every frame (pure maths, no layout reads → no jank).
//  - On release / dot tap we settle `pos` to the nearest integer with a JS rAF
//    eased timeline (same cubic-bezier the rest of the app uses). Driving the
//    settle in JS — rather than a CSS transition on `transform` — guarantees the
//    cards travel along the ring's ARC (CSS would linearly interpolate the matrix
//    and cut across the chord, reading as a flat slide). `prefers-reduced-motion`
//    skips the animation and snaps straight to the resting layout.
//
// Card faces (icon, title, subtitle, hero gradient, glow, badge) are unchanged
// from the previous rail and are driven by a single CSS custom property `--qa-a`
// the ring sets per card, so a React re-render (badge update, dot preview) never
// clobbers an in-flight animation.

const CARD_W = 170; // px, dominant active card width (within the 170–185 brief)
const CARD_H = 204; // px, fixed card height
// The stage hugs the card (small symmetric slack) so the rail sits closer to its
// section title and leaves more room for the next-action card below it.
const VIEWPORT_H = 224; // px, fixed stage height
const DRAG_THRESHOLD = 5; // px of horizontal travel before the ring starts following the finger
// Past this much travel the gesture is unambiguously a drag: we capture the pointer
// and suppress the click. BELOW it a tiny wobble while tapping a small side-card
// sliver still fires the tap (so the visible neighbours stay actionable on touch).
const CLICK_CANCEL_PX = 12;
const DRAG_PER_CARD = 120; // px of finger travel that equals one card step
const EASE = 'cubic-bezier(0.22,1,0.36,1)';

// Extra paint room above/below the clipped 3D stage so the active card's violet
// glow tapers off naturally instead of being sliced into a hard line at the clip
// edge. Matching negative margins cancel it in layout, so the carousel's vertical
// footprint (and the gap down to "Actividad reciente") is unchanged.
const GLOW_PAD_TOP = 20; // px
const GLOW_PAD_BOTTOM = 48; // px

// --- ring geometry (tuned for ~phone widths; safe to tweak on real devices) ---
const ANGLE_STEP = 36; // deg between adjacent cards around the ring
const RADIUS_X = 200; // px horizontal spread of the ring
const RADIUS_Z = 240; // px depth radius (how far back siblings recede)
const MIN_SCALE = 0.62; // farthest cards never shrink below this
const SCALE_FALLOFF = 0.14; // scale lost per card of distance

// Settle timing scales with travel so a single-card snap stays quick while a
// multi-card glide takes a little longer without ever feeling sluggish.
const SETTLE_MIN = 240; // ms
const SETTLE_MAX = 460; // ms
const SETTLE_PER_CARD = 120; // ms added per card of travel

// Release flick: velocity only adds a small, capped nudge so a quick flick can
// carry at most ~one extra card and never flies away.
const VELOCITY_CLAMP = 2.2; // px/ms — hard cap on a violent flick
const MOMENTUM_PROJECT_MS = 90; // ms of motion projected from the release velocity

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

// Geometry of one card on the ring. `pos` is the (possibly fractional) ring
// position — `index === pos` means that card is dead-centre. The offset is fully
// normalised to the shortest signed distance around the ring so any `pos` (even
// the unbounded values produced mid-drag) maps to a stable position and the loop
// is seamless.
function getCarousel3DStyle(index, pos, total) {
  let offset = index - pos;
  if (total > 1) {
    offset = ((offset % total) + total) % total; // [0, total)
    if (offset > total / 2) offset -= total; // (-total/2, total/2]
  }
  const abs = Math.abs(offset);
  const angle = offset * ANGLE_STEP;
  const rad = (angle * Math.PI) / 180;
  const x = Math.sin(rad) * RADIUS_X;
  const z = Math.cos(rad) * RADIUS_Z - RADIUS_Z; // 0 at centre, negative behind
  const rotateY = -angle;
  const scale = Math.max(MIN_SCALE, 1 - abs * SCALE_FALLOFF);

  // Opacity is derived from a continuous "distance to the back" (0 at the front,
  // 1 directly behind, normalised by the ring's half so it works for any count).
  // The shortest-path normalisation above makes a card's X teleport from one side
  // to the other exactly at the back (offset = ±total/2); fading it to ~0 right
  // there means that swap is never visible. Instead each card smoothly fades and
  // recedes into the back and fades back in from the other side — an orbit, not a
  // pop. Near cards stay bright (a neighbour on a 4-card ring sits at ~0.75).
  const half = total > 1 ? total / 2 : 1;
  const tBack = clamp(abs / half, 0, 1);
  const opacity = clamp(1 - tBack * tBack, 0, 1);

  // Face activation (violet hero / glow / icon presence) — only the card near the
  // centre lights up; smoothstepped so neighbours stay ~0 until they approach.
  let a = clamp(1 - abs, 0, 1);
  a = a * a * (3 - 2 * a);

  return {
    transform: `translate(-50%, -50%) translateX(${x.toFixed(2)}px) translateZ(${z.toFixed(2)}px) rotateY(${rotateY.toFixed(2)}deg) scale(${scale.toFixed(3)})`,
    opacity: opacity.toFixed(3),
    zIndex: String(Math.round(100 - abs * 10)),
    // Centre + immediate neighbours stay tappable; the far/back card is inert so a
    // tap can never trigger a hidden card's route by accident.
    pointerEvents: abs < 1.5 ? 'auto' : 'none',
    activation: a,
  };
}

// Subtle, decorative pitch markings layered behind each card — one motif per card
// so the rail doesn't look like the same patch of grass four times. Kept very
// low-opacity (lower still when inactive) so it never competes with icon/text.
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

const QuickAccessCard = React.forwardRef(({ item, isActive, variant }, ref) => {
  const { to, onClick, prefetch, icon, title, subtitle, badge, showPlus } = item;

  const handlePrefetch = useCallback(() => {
    if (prefetch) prefetchRoute(prefetch);
  }, [prefetch]);

  // The card's ring placement (transform / opacity / z-index / pointer-events) is
  // written imperatively by the rail every frame and therefore intentionally
  // absent from the style prop below — so a React re-render never resets an
  // in-flight animation. The face appearance is driven by one CSS custom property
  // the rail also sets, `--qa-a` (0→1 activation): as a card nears the centre its
  // violet hero fades in, the glow/ring rise, and the icon/title/subtitle gain
  // presence. Using calc(var()) (not class toggles) lets the activation sit at any
  // fractional value mid-drag.
  const cardClass = [
    'qa-card group absolute left-1/2 top-1/2 flex flex-col items-center justify-center text-center',
    'overflow-hidden rounded-card no-underline text-white outline-none cursor-pointer border',
    'focus-visible:ring-2 focus-visible:ring-[rgba(190,170,255,0.7)] focus-visible:ring-offset-0',
  ].join(' ');

  const cardStyle = {
    width: `${CARD_W}px`,
    height: `${CARD_H}px`,
    borderColor: 'rgba(196,178,255, calc(0.16 + 0.44 * var(--qa-a, 0)))',
    boxShadow: [
      '0 4px 14px rgba(5,3,16, calc(0.4 - 0.12 * var(--qa-a, 0)))',
      // Softer, contained violet glow so it tapers gracefully within the clipped
      // stage rather than ending abruptly.
      '0 14px 38px rgba(84,48,224, calc(0.42 * var(--qa-a, 0)))',
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
    // ring placement (transform/opacity/z-index/pointer-events) is set imperatively
    // by the rail; only the var-driven appearance + size live here so a re-render
    // can't reset it.
    style: cardStyle,
    onMouseEnter: handlePrefetch,
    onTouchStart: handlePrefetch,
    onFocus: handlePrefetch,
    'aria-current': isActive ? 'true' : undefined,
    // dragging is handled entirely by the parent gesture zone; the card itself must
    // never start a native drag/selection that would fight the thumb.
    draggable: false,
    onDragStart: (e) => e.preventDefault(),
  };

  if (to) {
    return (
      <Link to={to} {...sharedProps}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} {...sharedProps}>
      {inner}
    </button>
  );
});

QuickAccessCard.displayName = 'QuickAccessCard';

const QuickAccessRail = ({ items = [] }) => {
  const gestureRef = useRef(null); // the whole section: where pointers are caught
  const cardRefs = useRef([]);

  const posRef = useRef(0); // current (possibly fractional) ring position
  const previewRef = useRef(0); // real index currently nearest the centre
  const settleRaf = useRef(0);

  // --- custom pointer-drag state ---
  const pointerActiveRef = useRef(false); // a pointer is down and being tracked
  const draggingRef = useRef(false); // travel crossed the horizontal threshold
  const draggedRef = useRef(false); // a drag happened → suppress the next click
  const pointerIdRef = useRef(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startPosRef = useRef(0);
  const lastXRef = useRef(0);
  const lastTRef = useRef(0);
  const velocityRef = useRef(0); // px/ms of pointer X, smoothed (for the flick)

  const count = items.length;
  const [activeIndex, setActiveIndex] = useState(0); // real index (drives appearance + dots)

  const wrap = useCallback((i) => ((i % count) + count) % count, [count]);

  // Write every card's ring geometry imperatively (pure maths, no layout reads).
  // Runs every drag/settle frame plus on mount — cheap enough for any frame.
  const applyTransforms = useCallback(
    (pos) => {
      const nodes = cardRefs.current;
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        if (node) {
          const s = getCarousel3DStyle(i, pos, count);
          node.style.transform = s.transform;
          node.style.opacity = s.opacity;
          node.style.zIndex = s.zIndex;
          node.style.pointerEvents = s.pointerEvents;
          node.style.setProperty('--qa-a', s.activation.toFixed(3));
        }
      }
    },
    [count],
  );

  const cancelSettle = useCallback(() => {
    if (settleRaf.current) {
      cancelAnimationFrame(settleRaf.current);
      settleRaf.current = 0;
    }
  }, []);

  // Settle `pos` to `targetRaw` (any real value; we re-base to the wrapped real on
  // arrival) along the ring's arc with an eased JS timeline. updateVisuals-style
  // per-frame writes keep the activation coherent right through the glide.
  const settleTo = useCallback(
    (targetRaw) => {
      if (count === 0) return;
      cancelSettle();
      const finalReal = wrap(Math.round(targetRaw));
      previewRef.current = finalReal;
      setActiveIndex(finalReal); // consolidates dots + a11y

      if (prefersReducedMotion()) {
        posRef.current = finalReal;
        applyTransforms(finalReal);
        return;
      }

      const startPos = posRef.current;
      const endPos = targetRaw;
      const dist = Math.abs(endPos - startPos);
      const dur = clamp(SETTLE_MIN + dist * SETTLE_PER_CARD, SETTLE_MIN, SETTLE_MAX);
      const begin = performance.now();

      const step = (now) => {
        const raw = clamp((now - begin) / dur, 0, 1);
        const t = ease(raw);
        const p = startPos + (endPos - startPos) * t;
        posRef.current = p;
        applyTransforms(p);
        if (raw < 1) {
          settleRaf.current = requestAnimationFrame(step);
          return;
        }
        settleRaf.current = 0;
        // Re-base to the wrapped real so `pos` stays bounded across interactions.
        posRef.current = finalReal;
        applyTransforms(finalReal);
      };
      settleRaf.current = requestAnimationFrame(step);
    },
    [applyTransforms, cancelSettle, count, wrap],
  );

  // Settle to a specific real index taking the shortest path around the ring.
  const settleToIndex = useCallback(
    (index) => {
      let raw = index;
      const cur = posRef.current;
      while (raw - cur > count / 2) raw -= count;
      while (raw - cur < -count / 2) raw += count;
      settleTo(raw);
    },
    [count, settleTo],
  );

  // --- pointer gesture: works anywhere in the zone, over any child ---

  const handlePointerDown = useCallback(
    (e) => {
      if (e.button != null && e.button > 0) return; // ignore right/middle click
      if (count <= 1) return;
      pointerActiveRef.current = true;
      draggingRef.current = false;
      draggedRef.current = false;
      pointerIdRef.current = e.pointerId;
      startXRef.current = e.clientX;
      startYRef.current = e.clientY;
      startPosRef.current = posRef.current;
      lastXRef.current = e.clientX;
      lastTRef.current = performance.now();
      velocityRef.current = 0;
      cancelSettle(); // hand control to the finger immediately (cancels any glide)
    },
    [cancelSettle, count],
  );

  const handlePointerMove = useCallback(
    (e) => {
      if (!pointerActiveRef.current) return;
      const dx = e.clientX - startXRef.current;
      const dy = e.clientY - startYRef.current;

      // Direction lock on the first meaningful movement: horizontal → we own it;
      // vertical → release it back to the browser so the page can scroll.
      if (!draggingRef.current) {
        if (Math.abs(dx) > DRAG_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
          draggingRef.current = true; // start following the finger (no capture yet)
        } else if (Math.abs(dy) > DRAG_THRESHOLD && Math.abs(dy) >= Math.abs(dx)) {
          pointerActiveRef.current = false; // vertical: let the page scroll
          return;
        } else {
          return; // not enough travel to decide yet
        }
      }

      // Promote to a committed drag only once the travel is unambiguous: capture
      // the pointer (so a long drag keeps tracking even off the rail) and arm the
      // click-suppression. Below CLICK_CANCEL_PX we deliberately do NEITHER — a
      // tiny wobble while tapping a small side card must not steal its tap (capture
      // would redirect the synthesised click to the gesture zone, killing the
      // card's navigation), so the visible neighbours stay tappable on touch.
      if (!draggedRef.current && Math.abs(dx) > CLICK_CANCEL_PX) {
        draggedRef.current = true;
        const zone = gestureRef.current;
        if (zone && pointerIdRef.current != null) {
          try {
            zone.setPointerCapture(pointerIdRef.current);
          } catch (_) {
            /* capture can fail if the pointer already ended; harmless */
          }
        }
      }

      // Follow the finger 1:1 around the ring (drag left → advance to the next card).
      const pos = startPosRef.current - dx / DRAG_PER_CARD;
      posRef.current = pos;
      applyTransforms(pos);

      // Smoothed pointer velocity for the release flick.
      const now = performance.now();
      const dt = now - lastTRef.current;
      if (dt > 0) {
        const inst = (e.clientX - lastXRef.current) / dt;
        velocityRef.current = velocityRef.current * 0.7 + inst * 0.3;
        lastXRef.current = e.clientX;
        lastTRef.current = now;
      }

      // Live "which card am I on" → drive the dots + a11y without waiting for
      // release (kept cheap: only re-render when the nearest real card flips).
      const nr = wrap(Math.round(pos));
      if (nr !== previewRef.current) {
        previewRef.current = nr;
        setActiveIndex(nr);
      }
    },
    [applyTransforms, wrap],
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

    // The distance dragged already moved `pos` (so a long drag lands several cards
    // away); velocity only adds a small, capped nudge so a flick carries ≤ one
    // extra card and never flies off.
    const velocity = clamp(velocityRef.current, -VELOCITY_CLAMP, VELOCITY_CLAMP);
    const momentum = clamp((-velocity * MOMENTUM_PROJECT_MS) / DRAG_PER_CARD, -1, 1);
    settleTo(Math.round(posRef.current + momentum));
  }, [settleTo]);

  // Capture-phase: if the finger dragged, swallow the click before it reaches the
  // card's Link/button so a scroll never navigates by accident.
  const handleClickCapture = useCallback((e) => {
    if (draggedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      draggedRef.current = false;
    }
  }, []);

  // Initial / count-change layout (before paint, so there's no flash of stacked
  // cards or equal-weight faces).
  useLayoutEffect(() => {
    posRef.current = 0;
    previewRef.current = 0;
    setActiveIndex(0);
    applyTransforms(0);
  }, [count, applyTransforms]);

  useEffect(
    () => () => {
      if (settleRaf.current) cancelAnimationFrame(settleRaf.current);
    },
    [],
  );

  return (
    <div className="-mx-4 mb-3">
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
        .qa-viewport {
          perspective: 1100px;
          perspective-origin: 50% 50%;
        }
        .qa-stage {
          transform-style: preserve-3d;
          /* The stage plane sits at z=0 while the side cards recede to negative
             translateZ — i.e. BEHIND the (transparent) stage — so the stage
             itself would swallow their taps and only the front card stayed
             clickable. Let hits pass through; each card re-enables its own
             pointer-events imperatively in applyTransforms. */
          pointer-events: none;
        }
        .qa-card {
          transform-origin: center center;
          -webkit-backface-visibility: hidden;
          backface-visibility: hidden;
          will-change: transform, opacity;
          -webkit-user-drag: none;
          -webkit-user-select: none;
          user-select: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .qa-card { transition: none; }
        }
      `}</style>

      {/* One continuous touch surface: cards, gaps and dots all drag the ring. */}
      <div
        ref={gestureRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClickCapture={handleClickCapture}
        className="qa-gesture-zone relative"
      >
        {/* The clip lives on this OUTER wrapper, not on the perspective stage.
            Horizontally it clips the side cards as they rotate to the back;
            vertically it is padded so the active card's downward glow fades out
            *inside* the clip instead of being sliced into a hard line. Matching
            negative margins cancel the padding in layout, so the carousel's
            footprint — and the gap down to "Actividad reciente" — is unchanged. */}
        <div
          className="qa-clip relative overflow-hidden"
          style={{
            paddingTop: `${GLOW_PAD_TOP}px`,
            paddingBottom: `${GLOW_PAD_BOTTOM}px`,
            marginTop: `-${GLOW_PAD_TOP}px`,
            marginBottom: `-${GLOW_PAD_BOTTOM}px`,
          }}
        >
          {/* Fixed-height 3D stage. The perspective lives here (not on the clip)
              so the vanishing point stays centred on the cards regardless of the
              clip padding; the height keeps the Home vertical spacing stable. */}
          <div className="qa-viewport relative" style={{ height: `${VIEWPORT_H}px` }}>
            <div className="qa-stage absolute inset-0">
              {items.map((item, index) => (
                <QuickAccessCard
                  key={item.key}
                  ref={(node) => {
                    cardRefs.current[index] = node;
                  }}
                  item={item}
                  variant={index}
                  isActive={index === activeIndex}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Dots represent the real items. Kept small/dim/glow-free so they read as
            a position hint, not a CTA. */}
        {count > 1 && (
          <div className="mt-1 flex items-center justify-center gap-1.5 px-4 pb-1.5">
            {items.map((item, index) => {
              const isActive = index === activeIndex;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-label={`Ir a ${item.title}`}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => settleToIndex(index)}
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
