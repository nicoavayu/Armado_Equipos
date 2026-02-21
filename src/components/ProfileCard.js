import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';

// --- Pure Helper Functions (Outside Component) ---
const clamp = (v, min = 0, max = 100) => Math.min(Math.max(v, min), max);
const round = (v, prec = 3) => parseFloat(v.toFixed(prec));
const adjust = (v, fmin, fmax, tmin, tmax) => round(tmin + ((tmax - tmin) * (v - fmin)) / (fmax - fmin));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

const getPos = (p) => {
  const map = { 'ARQ': 'ARQ', 'DEF': 'DEF', 'MED': 'MED', 'DEL': 'DEL', 'arquero': 'ARQ', 'defensor': 'DEF', 'mediocampista': 'MED', 'delantero': 'DEL' };
  return map[p] || 'DEF';
};

const getPosColor = (p) => {
  const map = { 'ARQ': '#FDB022', 'DEF': '#FF6B9D', 'MED': '#06C270', 'DEL': '#FF3B3B' };
  return map[p] || '#8178e5';
};

const getCountry = (c) => {
  const map = { 'AR': 'ARG', 'BR': 'BRA', 'UY': 'URU', 'CL': 'CHI', 'CO': 'COL', 'PE': 'PER' };
  return map[c] || c?.toUpperCase() || 'ARG';
};

const getFootAbbr = (foot) => {
  const map = { right: 'DER', left: 'IZQ', both: 'AMB' };
  if (!foot) return null;
  return map[String(foot).toLowerCase()] || null;
};

const getFootBadgeStyle = (foot) => {
  const value = String(foot || '').toLowerCase();
  if (value === 'right') {
    return {
      borderColor: '#22D3EE',
      color: '#67E8F9',
      background: 'rgba(34, 211, 238, 0.14)',
      textShadow: '0 0 4px rgba(34, 211, 238, 0.55)',
    };
  }
  if (value === 'left') {
    return {
      borderColor: '#A78BFA',
      color: '#C4B5FD',
      background: 'rgba(167, 139, 250, 0.14)',
      textShadow: '0 0 4px rgba(167, 139, 250, 0.55)',
    };
  }
  if (value === 'both') {
    return {
      borderColor: '#94A3B8',
      color: '#E2E8F0',
      background: 'rgba(148, 163, 184, 0.14)',
      textShadow: '0 0 4px rgba(148, 163, 184, 0.55)',
    };
  }
  return {
    borderColor: 'rgba(255,255,255,0.3)',
    color: 'rgba(255,255,255,0.85)',
    background: 'rgba(255,255,255,0.08)',
    textShadow: 'none',
  };
};

const getLevelValue = (nivel) => {
  if (nivel === null || nivel === undefined || nivel === '') return null;
  const parsed = Number.parseInt(nivel, 10);
  if (Number.isNaN(parsed)) return null;
  return Math.min(5, Math.max(1, parsed));
};

const getLevelDotColor = (level) => {
  const map = {
    1: '#EF4444', // Recreativo
    2: '#F97316', // Amateur
    3: '#FACC15', // Intermedio
    4: '#84CC16', // Competitivo
    5: '#22C55E', // Avanzado
  };
  return map[level] || '#FFFFFF';
};

const getAvatar = (p) => {
  const src = p?.avatar_url || p?.foto_url || p?.user?.user_metadata?.avatar_url || p?.user?.user_metadata?.picture || p?.user_metadata?.avatar_url || p?.user_metadata?.picture;
  if (!src) return null;
  if (src.startsWith('blob:')) return src;
  return src;
};

const ANIM = { SMOOTH: 600, INIT: 1500, OX: 70, OY: 60 };
const CARD_FRAME_WIDTH = 758;
const CARD_FRAME_HEIGHT = 1246;
const CARD_FRAME_RATIO = CARD_FRAME_WIDTH / CARD_FRAME_HEIGHT;

const ProfileCardComponent = ({
  profile,
  isVisible = true,
  enableTilt = true,
  ratingOverride = null,
  disableInternalMotion = false,
  performanceMode = false,
  cardRatio = CARD_FRAME_RATIO,
  cardMaxWidth = 430,
  screenMode = false,
  awardsLayout = 'adaptive',
}) => {
  const wrapRef = useRef(null);
  const cardRef = useRef(null);
  const mvpRef = useRef(null);
  const gkRef = useRef(null);
  const redRef = useRef(null);
  const prevCountsRef = useRef({ mvp: null, gk: null, red: null });
  const [frameRatio, setFrameRatio] = useState(() => (Number(cardRatio) > 0 ? Number(cardRatio) : CARD_FRAME_RATIO));

  // 1. Single View Model for all data
  const vm = useMemo(() => {
    if (!profile) return null;
    const result = {
      name: profile.nombre || 'JUGADOR',
      handle: profile.social?.replace('@', '') || 'jugador',
      avatarUrl: getAvatar(profile),
      rating: parseFloat(profile.ranking || profile.calificacion || 5.0).toFixed(1),
      pj: profile.partidos_jugados || 0,
      pa: profile.partidos_abandonados || 0,
      pos: getPos(profile.posicion || profile.rol_favorito),
      cc: (profile.pais_codigo || 'AR').toLowerCase(),
      abbr: getCountry(profile.pais_codigo),
      posColor: getPosColor(getPos(profile.posicion || profile.rol_favorito)),
      foot: getFootAbbr(profile.pierna_habil),
      footStyle: getFootBadgeStyle(profile.pierna_habil),
      level: getLevelValue(profile.nivel),
      mvp: profile.mvp_badges ?? profile.mvps ?? 0,
      gk: profile.gk_badges ?? profile.guantes_dorados ?? 0,
      red: profile.red_badges ?? profile.tarjetas_rojas ?? 0,
      injured: !!profile.lesion_activa,
      available: profile.acepta_invitaciones !== false,
    };
    // console.log(`🎨 ProfileCard vm recalculated: mvp=${result.mvp}, gk=${result.gk}, red=${result.red}`);
    return result;
  }, [profile]);

  // 2. Consistent Tilt Logic
  const handlers = useMemo(() => {
    if (!enableTilt) return null;
    let raf = null;
    const upd = (ox, oy, card, wrap) => {
      const w = card.clientWidth, h = card.clientHeight;
      const px = clamp((100 / w) * ox), py = clamp((100 / h) * oy);
      const props = {
        '--pointer-x': `${px}%`, '--pointer-y': `${py}%`,
        '--background-x': `${adjust(px, 0, 100, 35, 65)}%`, '--background-y': `${adjust(py, 0, 100, 35, 65)}%`,
        '--rotate-x': `${round(-((px - 50) / 5))}deg`, '--rotate-y': `${round((py - 50) / 4)}deg`,
      };
      Object.entries(props).forEach(([k, v]) => wrap.style.setProperty(k, v));
    };
    const smooth = (dur, sx, sy, card, wrap) => {
      const start = performance.now(), tx = wrap.clientWidth / 2, ty = wrap.clientHeight / 2;
      const loop = (t) => {
        const p = clamp((t - start) / dur), e = ease(p);
        upd(adjust(e, 0, 1, sx, tx), adjust(e, 0, 1, sy, ty), card, wrap);
        if (p < 1) raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    };
    return { upd, smooth, cancel: () => raf && cancelAnimationFrame(raf) };
  }, [enableTilt]);

  const onEnter = useCallback(() => { handlers?.cancel(); wrapRef.current?.classList.add('active'); }, [handlers]);
  const onMove = useCallback((e) => {
    if (!handlers || !cardRef.current || !wrapRef.current) return;
    const r = cardRef.current.getBoundingClientRect();
    handlers.upd(e.clientX - r.left, e.clientY - r.top, cardRef.current, wrapRef.current);
  }, [handlers]);
  const onLeave = useCallback((e) => {
    if (!handlers || !cardRef.current || !wrapRef.current) return;
    handlers.smooth(ANIM.SMOOTH, e.offsetX, e.offsetY, cardRef.current, wrapRef.current);
    wrapRef.current.classList.remove('active');
  }, [handlers]);

  useEffect(() => {
    if (!enableTilt || !handlers || !cardRef.current || !wrapRef.current) return;
    const c = cardRef.current;
    c.addEventListener('pointerenter', onEnter);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerleave', onLeave);
    handlers.upd(wrapRef.current.clientWidth - ANIM.OX, ANIM.OY, c, wrapRef.current);
    handlers.smooth(ANIM.INIT, wrapRef.current.clientWidth - ANIM.OX, ANIM.OY, c, wrapRef.current);
    return () => {
      c.removeEventListener('pointerenter', onEnter);
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerleave', onLeave);
      handlers.cancel();
    };
  }, [enableTilt, handlers, onEnter, onMove, onLeave]);

  useEffect(() => {
    setFrameRatio(Number(cardRatio) > 0 ? Number(cardRatio) : CARD_FRAME_RATIO);
  }, [cardRatio]);

  // Pop animation when badge counts change
  useEffect(() => {
    const prev = prevCountsRef.current;
    const runPop = (el) => {
      if (!el) return;
      el.classList.remove('pc-pop');
      // Force reflow to restart animation
      void el.offsetWidth;
      el.classList.add('pc-pop');
      setTimeout(() => el.classList.remove('pc-pop'), 600);
    };
    if (prev.mvp !== null && vm.mvp !== prev.mvp) runPop(mvpRef.current);
    if (prev.gk !== null && vm.gk !== prev.gk) runPop(gkRef.current);
    if (prev.red !== null && vm.red !== prev.red) runPop(redRef.current);
    prevCountsRef.current = { mvp: vm.mvp, gk: vm.gk, red: vm.red };
  }, [vm?.mvp, vm?.gk, vm?.red]);

  const onFrameLoad = useCallback((event) => {
    const { naturalWidth, naturalHeight } = event.currentTarget || {};
    if (!naturalWidth || !naturalHeight) return;
    const nextRatio = naturalWidth / naturalHeight;
    if (!Number.isFinite(nextRatio) || nextRatio <= 0) return;
    setFrameRatio((prevRatio) => (Math.abs(prevRatio - nextRatio) < 0.0001 ? prevRatio : nextRatio));
  }, []);

  if (!isVisible || !vm) return null;
  const levelDotColor = vm.level !== null ? getLevelDotColor(vm.level) : null;
  const normalizedCardMaxWidth = Number(cardMaxWidth) > 0 ? Number(cardMaxWidth) : 430;
  const forceSideAwards = awardsLayout === 'side';
  const reserveLeftAwardsSpace = awardsLayout === 'space-left';
  const showAwardsRail = awardsLayout !== 'none' && !reserveLeftAwardsSpace;
  const resolvedCardWidth = reserveLeftAwardsSpace
    ? `min(64.8vw, ${Math.round(normalizedCardMaxWidth * 0.9)}px)`
    : `min(92vw, ${normalizedCardMaxWidth}px)`;

  return (
    <>
      <style>{`
        .profile-card-screen {
          min-height: 100%;
          padding-top: max(0px, env(safe-area-inset-top));
          padding-right: max(0px, env(safe-area-inset-right));
          padding-bottom: max(0px, env(safe-area-inset-bottom));
          padding-left: max(0px, env(safe-area-inset-left));
          box-sizing: border-box;
        }
        .profile-card-wrapper {
          --card-radius: 1.5rem;
          --glow-blue: rgba(0, 200, 255, 1);
          --rating-border: rgba(0, 200, 255, 1);
          --rating-glow1: rgba(0, 200, 255, 0.8);
          --rating-glow2: rgba(0, 200, 255, 0.4);
          --pc-card-width: min(92vw, 430px);
          --pc-card-ratio: ${CARD_FRAME_WIDTH} / ${CARD_FRAME_HEIGHT};
          --pc-card-height: calc(var(--pc-card-width) / var(--pc-card-ratio));
          --pc-award-height: clamp(
            calc(var(--pc-card-height) * 0.18),
            calc(var(--pc-card-height) * 0.2),
            calc(var(--pc-card-height) * 0.22)
          );
          --pc-layout-gap: clamp(0.5rem, 2.4vw, 1rem);
          --pc-awards-gap: calc(var(--pc-award-height) * 0.08);
          --pc-photo-size: 57%;
          --pc-photo-top: 14.3%;
          --pc-side-top: 39.5%;
          --pc-center-top: 56.8%;
          width: 100%;
          display: grid;
          justify-items: center;
          overflow: visible;
          perspective: 1000px;
          touch-action: pan-y;
          -webkit-text-size-adjust: 100%;
          text-size-adjust: 100%;
        }
        .profile-card-wrapper.pc-awards-force-side {
          touch-action: auto;
        }
        .profile-card-wrapper.pc-awards-space-left {
          --pc-layout-gap: 0px;
          --pc-card-target-width: 64.8vw;
          --pc-card-width: min(
            var(--pc-card-target-width),
            100%
          );
          --pc-left-awards-gap: clamp(12px, 3.5vw, 16px);
          --pc-left-award-width: clamp(30px, 8.8vw, 38px);
          --pc-left-award-height: clamp(54px, 15.5vw, 68px);
          --pc-left-awards-stack-gap: clamp(8px, 2.2vw, 12px);
        }
        .pc-layout {
          width: min(100%, 62rem);
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: center;
          justify-content: center;
          gap: var(--pc-layout-gap);
        }
        .pc-layout--single {
          grid-template-columns: max-content;
          width: fit-content;
        }
        .pc-layout-scroll {
          width: 100%;
          display: grid;
          justify-items: center;
          overflow: visible;
        }
        .profile-card-wrapper.pc-awards-force-side .pc-layout-scroll {
          overflow-x: visible;
          overflow-y: visible;
        }
        .profile-card-wrapper.pc-awards-space-left .pc-layout {
          grid-template-columns: max-content;
          width: fit-content;
          max-width: 100%;
        }
        .profile-card-wrapper.pc-awards-force-side .pc-layout {
          grid-template-columns: max-content max-content;
          width: fit-content;
          max-width: 100%;
        }
        .pc-awards-side-rail {
          position: absolute;
          top: 50%;
          right: calc(100% + var(--pc-left-awards-gap));
          transform: translateY(-50%);
          display: grid;
          grid-auto-rows: max-content;
          justify-items: center;
          gap: var(--pc-left-awards-stack-gap);
          z-index: 2;
          pointer-events: none;
        }
        .pc-awards-side-item {
          width: var(--pc-left-award-width);
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .pc-awards-side-card {
          width: var(--pc-left-award-width);
          height: var(--pc-left-award-height);
          border-radius: clamp(10px, 2.6vw, 14px);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(180deg, rgba(13, 48, 74, 0.64) 0%, rgba(4, 19, 35, 0.72) 100%);
          border: 1px solid rgba(142, 236, 255, 0.4);
          box-shadow:
            0 0 10px rgba(0, 196, 255, 0.2),
            inset 0 0 10px rgba(97, 218, 255, 0.12);
        }
        .pc-awards-side-image {
          width: 88%;
          height: 88%;
          object-fit: contain;
          display: block;
          pointer-events: none;
          user-select: none;
        }
        .pc-awards-side-count {
          margin-top: clamp(6px, 1.8vw, 10px);
          width: 100%;
          text-align: center;
          font-size: clamp(12px, 3.2vw, 14px);
          line-height: 1;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          color: #EAFBFF;
          text-shadow: 0 0 4px rgba(120, 230, 255, 0.35);
          pointer-events: none;
          user-select: none;
        }
        .pc-awards-rail {
          width: max-content;
          display: grid;
          grid-auto-rows: max-content;
          align-content: center;
          justify-items: center;
          gap: var(--pc-awards-gap);
        }
        .pc-award-tile {
          position: relative;
          width: max-content;
          line-height: 0;
        }
        .pc-award-image {
          height: var(--pc-award-height);
          width: auto;
          display: block;
          object-fit: contain;
          pointer-events: none;
          user-select: none;
        }
        .pc-award-count {
          position: absolute;
          left: 50%;
          bottom: 14%;
          transform: translateX(-50%);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 2ch;
          color: #EAFBFF;
          font-size: clamp(
            calc(var(--pc-award-height) * 0.12),
            calc(var(--pc-award-height) * 0.13),
            calc(var(--pc-award-height) * 0.14)
          );
          line-height: 1;
          font-variant-numeric: tabular-nums;
          text-align: center;
          text-shadow:
            0 0 3px rgba(0, 0, 0, 0.75),
            0 0 8px rgba(120, 230, 255, 0.6);
          pointer-events: none;
          user-select: none;
        }
        .pc-main-column {
          min-width: 0;
          display: grid;
          justify-items: center;
        }
        .pc-stage {
          position: relative;
          width: var(--pc-card-width);
          overflow: visible;
        }
        .pc-glow-layer {
          position: absolute;
          top: -12%;
          left: -12%;
          right: -12%;
          bottom: -12%;
          pointer-events: none;
          background: radial-gradient(ellipse at center, rgba(0, 180, 255, 0.5) 0%, rgba(0, 160, 255, 0.3) 30%, transparent 65%);
          filter: blur(35px);
          z-index: 0;
        }
        .pc-card-shell {
          position: relative;
          width: 100%;
          z-index: 1;
        }
        .profile-card-main,
        .pc-card-main {
          background: transparent;
          position: relative;
          width: 100%;
          aspect-ratio: var(--pc-card-ratio);
          border-radius: var(--card-radius);
          overflow: hidden;
          transform-origin: center;
        }
        .pc-card-main--motion {
          transition: transform 700ms ease-out;
        }
        .pc-photo-hole {
          position: absolute;
          width: var(--pc-photo-size);
          aspect-ratio: 1 / 1;
          border-radius: 50%;
          overflow: hidden;
          top: var(--pc-photo-top);
          left: 50%;
          transform: translateX(-50%);
          z-index: 5;
        }
        .pc-photo-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center 46%;
        }
        .pc-photo-fallback {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: clamp(34px, 10vw, 56px);
          background: #05060f;
        }
        .pc-card-frame {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: contain;
          pointer-events: none;
          z-index: 20;
        }
        .pc-content-layer {
          position: absolute;
          inset: 0;
          z-index: 30;
        }
        .pc-name-wrap {
          position: absolute;
          top: 7.8%;
          left: 50%;
          transform: translateX(-50%);
          width: 82%;
          display: flex;
          justify-content: center;
        }
        .pc-name {
          margin: -15px;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-family: 'Bebas Neue', 'Bebas', 'Oswald', sans-serif;
          font-size: clamp(28px, 9.6vw, 46px);
          line-height: 0.95;
          font-weight: 900;
          letter-spacing: 0.01em;
          color: #fff;
          text-shadow: 0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(63, 169, 255, 0.3);
        }
        .pc-right-stats {
          position: absolute;
          right: 4%;
          top: var(--pc-side-top);
          transform: translateY(74%);
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: clamp(4px, 1.4vw, 8px);
          border-radius: 0.6rem;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(8px);
        }
        .pc-stat-stack {
          display: flex;
          flex-direction: column;
          align-items: center;
          transform: scale(0.92);
        }
        .pc-stat-label {
          color: rgba(0, 200, 255, 0.8);
          font-size: clamp(9px, 2.4vw, 11px);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.2em;
          margin-bottom: 2px;
          line-height: 1;
        }
        .pc-stat-value {
          color: #fff;
          font-size: clamp(18px, 5.8vw, 24px);
          font-weight: 900;
          line-height: 1;
          text-shadow: 0 0 10px rgba(0, 200, 255, 0.6);
        }
        .pc-stats-divider {
          width: clamp(18px, 5.6vw, 24px);
          height: 1px;
          background: rgba(255, 255, 255, 0.1);
          margin: clamp(5px, 1.4vw, 8px) 0;
        }
        .pc-left-meta {
          position: absolute;
          left: 5%;
          top: var(--pc-side-top);
          transform: translateY(88%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: clamp(4px, 1vw, 6px);
          width: 13%;
        }
        .pc-mini-badge {
          width: clamp(30px, 9.2vw, 38px);
          height: clamp(20px, 6.1vw, 26px);
          border-radius: 0.4rem;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          box-sizing: border-box;
        }
        .pc-mini-badge--placeholder {
          opacity: 0;
          pointer-events: none;
        }
        .pc-mini-badge-label {
          font-family: 'Oswald', sans-serif;
          font-size: clamp(10px, 2.8vw, 12px);
          line-height: 1;
          font-weight: 900;
          letter-spacing: 0.04em;
        }
        .pc-level-wrap {
          margin-top: clamp(8px, 2.3vw, 12px);
          display: flex;
          justify-content: center;
        }
        .pc-level-stack {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          gap: clamp(4px, 1.2vw, 6px);
        }
        .pc-level-dot {
          width: clamp(5px, 1.5vw, 7px);
          height: clamp(5px, 1.5vw, 7px);
          border-radius: 50%;
        }
        .pc-level-dot--empty {
          background: rgba(255, 255, 255, 0.25);
        }
        .pc-center-cluster {
          position: absolute;
          left: 50%;
          top: var(--pc-center-top);
          transform: translateX(-50%);
          width: 54%;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .badge-glass {
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(255, 255, 255, 0.4);
        }
        .badge-glass--perf {
          background: rgba(0, 0, 0, 0.65);
          border: 1px solid rgba(255, 255, 255, 0.25);
          backdrop-filter: none;
        }
        .pc-center-badge-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: clamp(9px, 2.8vw, 14px);
        }
        .pc-center-badge {
          overflow: hidden;
        }
        .pc-flag-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .pc-center-divider {
          width: 1px;
          height: clamp(10px, 2.8vw, 14px);
          background: rgba(255, 255, 255, 0.2);
        }
        .pc-position-badge {
          border: 1.5px solid;
          background: rgba(255, 255, 255, 0.05);
        }
        .pc-rating-wrap {
          margin-top: clamp(10px, 3.1vw, 15px);
          display: flex;
          justify-content: center;
          width: 100%;
        }
        .pc-rating-inner {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .pc-rating-star-anchor {
          position: absolute;
          right: 100%;
          margin-right: clamp(8px, 2.2vw, 12px);
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
        }
        .rating-star-badge {
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 215, 0, 0.15);
          border: 2px solid rgba(255, 215, 0, 0.4);
          box-shadow: 0 0 20px rgba(255, 215, 0, 0.5);
        }
        .pc-rating-star-badge {
          width: clamp(20px, 6vw, 26px);
          height: clamp(20px, 6vw, 26px);
        }
        .rating-star {
          color:#FFD700;
          font-size: clamp(12px, 3.8vw, 16px);
          line-height: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          filter: drop-shadow(0 0 4px rgba(255, 215, 0, 0.8));
        }
        .rating-star--perf {
          color:#FFD700;
          font-size: clamp(12px, 3.8vw, 16px);
          line-height: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          filter: none;
        }
        .rating-value {
          font-family: 'Bebas Neue', 'Arial Black', sans-serif;
          color:#00C8FF;
          font-weight: 900;
          font-size: clamp(62px, 18vw, 82px);
          line-height: 0.88;
          letter-spacing: 0.02em;
          filter: drop-shadow(0 0 12px rgba(0, 200, 255, 0.8));
        }
        .rating-value--perf {
          font-family: 'Bebas Neue', 'Arial Black', sans-serif;
          color:#00C8FF;
          font-weight: 900;
          font-size: clamp(62px, 18vw, 82px);
          line-height: 0.88;
          letter-spacing: 0.02em;
          filter: none;
        }
        .pc-badge-count.pc-pop {
          animation: pcBadgePop 520ms cubic-bezier(.2,.85,.2,1);
        }
        @keyframes pcBadgePop {
          0% { transform: translateX(-50%) scale(1); filter: drop-shadow(0 0 0 rgba(255,255,255,0)); }
          40% { transform: translateX(-50%) scale(1.35); filter: drop-shadow(0 0 8px rgba(255,255,255,0.6)); }
          100% { transform: translateX(-50%) scale(1); filter: drop-shadow(0 0 0 rgba(255,255,255,0)); }
        }
        @media (max-width: 42rem) {
          .profile-card-wrapper.pc-awards-force-side .pc-layout {
            grid-template-columns: max-content max-content;
          }
          .profile-card-wrapper.pc-awards-space-left .pc-layout {
            grid-template-columns: max-content;
          }
          .profile-card-wrapper:not(.pc-awards-force-side):not(.pc-awards-space-left) .pc-layout {
            width: 100%;
            grid-template-columns: minmax(0, 1fr);
            justify-items: center;
          }
          .profile-card-wrapper:not(.pc-awards-force-side):not(.pc-awards-space-left) .pc-main-column {
            order: 1;
          }
          .profile-card-wrapper:not(.pc-awards-force-side):not(.pc-awards-space-left) .pc-awards-rail {
            order: 2;
            width: min(100%, var(--pc-card-width));
            grid-auto-flow: column;
            grid-auto-columns: max-content;
            justify-content: flex-start;
            overflow-x: auto;
            padding-bottom: calc(var(--pc-award-height) * 0.02);
            overscroll-behavior-x: contain;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: thin;
          }
          .profile-card-wrapper:not(.pc-awards-force-side):not(.pc-awards-space-left) .pc-award-tile {
            flex: 0 0 auto;
          }
        }
      `}</style>

      <div
        ref={wrapRef}
        className={`profile-card-wrapper${screenMode ? ' profile-card-screen' : ''}${forceSideAwards ? ' pc-awards-force-side' : ''}${reserveLeftAwardsSpace ? ' pc-awards-space-left' : ''}`}
        style={{
          '--pc-card-ratio': String(frameRatio),
          '--pc-card-width': resolvedCardWidth,
        }}
      >
        <div className="pc-layout-scroll">
          <div className={`pc-layout${!showAwardsRail ? ' pc-layout--single' : ''}`}>
            {showAwardsRail ? (
              <aside className="pc-awards-rail" aria-label="Premios del jugador">
                <div className="pc-award-tile">
                  <img className="pc-award-image" src="/mvp_award.png" alt="Premio MVP" loading="lazy" decoding="async" />
                  <span ref={mvpRef} className="pc-badge-count pc-award-count">{vm.mvp}</span>
                </div>
                <div className="pc-award-tile">
                  <img className="pc-award-image" src="/goalkeeper_award.png" alt="Premio arquero" loading="lazy" decoding="async" />
                  <span ref={gkRef} className="pc-badge-count pc-award-count">{vm.gk}</span>
                </div>
                <div className="pc-award-tile">
                  <img className="pc-award-image" src="/redcard_award.png" alt="Premio tarjeta roja" loading="lazy" decoding="async" />
                  <span ref={redRef} className="pc-badge-count pc-award-count">{vm.red}</span>
                </div>
              </aside>
            ) : null}

            <div className="pc-main-column">
              <div className="pc-stage">
                {reserveLeftAwardsSpace && (
                  <aside className="pc-awards-side-rail" aria-hidden="true">
                    <span className="pc-awards-side-item">
                      <span className="pc-awards-side-card">
                        <img className="pc-awards-side-image" src="/mvp_award.png" alt="" loading="lazy" decoding="async" />
                      </span>
                      <span ref={mvpRef} className="pc-awards-side-count">{vm.mvp}</span>
                    </span>
                    <span className="pc-awards-side-item">
                      <span className="pc-awards-side-card">
                        <img className="pc-awards-side-image" src="/goalkeeper_award.png" alt="" loading="lazy" decoding="async" />
                      </span>
                      <span ref={gkRef} className="pc-awards-side-count">{vm.gk}</span>
                    </span>
                    <span className="pc-awards-side-item">
                      <span className="pc-awards-side-card">
                        <img className="pc-awards-side-image" src="/redcard_award.png" alt="" loading="lazy" decoding="async" />
                      </span>
                      <span ref={redRef} className="pc-awards-side-count">{vm.red}</span>
                    </span>
                  </aside>
                )}
                {!performanceMode && (
                  <div className="pc-glow-layer" />
                )}

                <div className="pc-card-shell">
                  <section
                    ref={cardRef}
                    className={`profile-card-main pc-card-main ${!disableInternalMotion ? 'pc-card-main--motion' : ''}`}
                    style={{
                      willChange: 'transform',
                      backfaceVisibility: 'hidden',
                      WebkitBackfaceVisibility: 'hidden',
                      transformStyle: 'preserve-3d',
                    }}
                  >
                    <div className="pc-photo-hole">
                      {vm.avatarUrl ? (
                        <img
                          className="pc-photo-img"
                          src={vm.avatarUrl}
                          alt={vm.name}
                          loading="eager"
                          crossOrigin="anonymous"
                        />
                      ) : (
                        <div className="pc-photo-fallback">👤</div>
                      )}
                    </div>

                    <img
                      src="/card_mockup.png"
                      alt=""
                      className="pc-card-frame"
                      onLoad={onFrameLoad}
                    />

                    <div className="pc-content-layer">
                      <div className="pc-name-wrap">
                        <h3 className="pc-name" title={vm.name}>
                          {vm.name.slice(0, 12)}
                        </h3>
                      </div>

                      <div className="pc-right-stats">
                        <div className="pc-stat-stack">
                          <span className="pc-stat-label">PJ</span>
                          <span className="pc-stat-value">{vm.pj}</span>
                        </div>
                        <div className="pc-stats-divider" />
                        <div className="pc-stat-stack">
                          <span className="pc-stat-label">PA</span>
                          <span className="pc-stat-value">{vm.pa}</span>
                        </div>
                      </div>

                      {(vm.foot || vm.level !== null) && (
                        <div className="pc-left-meta">
                          {vm.foot && (
                            <div
                              className="pc-mini-badge"
                              style={{ border: '1.5px solid', borderColor: vm.footStyle.borderColor, background: vm.footStyle.background }}
                            >
                              <span className="pc-mini-badge-label" style={{ color: vm.footStyle.color, textShadow: vm.footStyle.textShadow }}>
                                {vm.foot}
                              </span>
                            </div>
                          )}
                          {!vm.foot && vm.level !== null && (
                            <div className="pc-mini-badge pc-mini-badge--placeholder" aria-hidden="true" />
                          )}

                          {vm.level !== null && (
                            <div className="pc-level-wrap">
                              <span className="pc-level-stack" aria-label={`Nivel autopercibido ${vm.level} de 5`}>
                                {[5, 4, 3, 2, 1].map((dot) => (
                                  <span
                                    key={dot}
                                    className={`pc-level-dot ${dot <= vm.level ? '' : 'pc-level-dot--empty'}`}
                                    style={dot <= vm.level ? {
                                      backgroundColor: levelDotColor,
                                      boxShadow: `0 0 6px ${levelDotColor}80`,
                                    } : undefined}
                                  />
                                ))}
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="pc-center-cluster">
                        <div className="pc-center-badge-row">
                          <div className={`${performanceMode ? 'badge-glass--perf' : 'badge-glass'} pc-mini-badge pc-center-badge`}>
                            <img src={`https://flagcdn.com/w40/${vm.cc}.png`} alt={vm.abbr} className="pc-flag-img" />
                          </div>

                          <div className="pc-center-divider" />

                          <div
                            className="pc-mini-badge pc-center-badge pc-position-badge"
                            style={{ borderColor: vm.posColor }}
                          >
                            <span
                              className="pc-mini-badge-label"
                              style={{
                                color: vm.posColor,
                                textShadow: `0 0 4px ${vm.posColor}AA`,
                              }}
                            >
                              {vm.pos}
                            </span>
                          </div>
                        </div>

                        <div className="pc-rating-wrap">
                          <div className="pc-rating-inner">
                            <div className="pc-rating-star-anchor">
                              <div className="rating-star-badge pc-rating-star-badge">
                                <span className={performanceMode ? 'rating-star--perf' : 'rating-star'}>★</span>
                              </div>
                            </div>
                            <span className={performanceMode ? 'rating-value--perf' : 'rating-value'} style={{ color: '#FFD700' }}>
                              {ratingOverride !== null ? ratingOverride.toFixed(1) : vm.rating}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

const ProfileCard = ProfileCardComponent;
export default ProfileCard;
