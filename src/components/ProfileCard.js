import React, { useEffect, useRef, useCallback, useMemo } from 'react';

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

const getAvatar = (p) => {
  const src = p?.avatar_url || p?.foto_url || p?.user?.user_metadata?.avatar_url || p?.user?.user_metadata?.picture || p?.user_metadata?.avatar_url || p?.user_metadata?.picture;
  if (!src) return null;
  if (src.startsWith('blob:')) return src;
  return src.includes('?') ? src : `${src}?t=${Date.now()}`;
};

const ANIM = { SMOOTH: 600, INIT: 1500, OX: 70, OY: 60 };

// Photo mask positioning constants (adjust for perfect alignment)
const HOLE_SIZE = 176; // px - diameter of circular mask (increased ~10%)
const HOLE_TOP = 95; // px - distance from card top

const ProfileCardComponent = ({
  profile,
  isVisible = true,
  enableTilt = true,
  ratingOverride = null,
}) => {
  const wrapRef = useRef(null);
  const cardRef = useRef(null);
  const mvpRef = useRef(null);
  const gkRef = useRef(null);
  const redRef = useRef(null);
  const prevCountsRef = useRef({ mvp: null, gk: null, red: null });

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

  if (!isVisible || !vm) return null;

  return (
    <>
      <style>{`
        .profile-card-wrapper { 
          --card-radius: 1.5rem; 
          --glow-blue: rgba(0, 200, 255, 1); 
          --rating-border: rgba(0, 200, 255, 1);
          --rating-glow1: rgba(0, 200, 255, 0.8);
          --rating-glow2: rgba(0, 200, 255, 0.4);
        }
        .profile-card-main { 
          background: transparent;
        }
        .photo-glow-outer { 
          /* No glow on photo circle - glow is behind entire card */
        }
        .badge-glass { 
          background: rgba(0, 0, 0, 0.7); 
          backdrop-filter: blur(10px); 
          border: 2px solid rgba(255, 215, 0, 0.6);
          box-shadow: 0 0 15px rgba(255, 215, 0, 0.4);
        }
        .rating-star-badge{
          width: 32px;
          height: 32px;
          border-radius: 999px;
          display:flex;
          align-items:center;
          justify-content:center;
          background: rgba(255, 215, 0, 0.15);
          border: 2px solid rgba(255, 215, 0, 0.4);
          box-shadow: 0 0 20px rgba(255, 215, 0, 0.5);
        }
        .rating-star{
          color:#FFD700;
          font-size: 20px;
          line-height: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          filter: drop-shadow(0 0 4px rgba(255, 215, 0, 0.8));
        }
        .rating-value{
          font-family: 'Bebas Neue', 'Arial Black', sans-serif;
          color:#00C8FF;
          font-weight: 900;
          font-size: 64px;
          line-height: 1;
          letter-spacing: 0.02em;
          filter: drop-shadow(0 0 12px rgba(0, 200, 255, 0.8));
        }
          .pc-badge-count.pc-pop {
            animation: pcBadgePop 520ms cubic-bezier(.2,.85,.2,1);
          }
          @keyframes pcBadgePop {
            0% { transform: scale(1); filter: drop-shadow(0 0 0 rgba(255,255,255,0)); }
            40% { transform: scale(1.35); filter: drop-shadow(0 0 8px rgba(255,255,255,0.6)); }
            100% { transform: scale(1); filter: drop-shadow(0 0 0 rgba(255,255,255,0)); }
          }
      `}</style>

      <div ref={wrapRef} className="w-full flex justify-center overflow-visible perspective-[1000px] touch-none group profile-card-wrapper">
        <div className="relative inline-block overflow-visible px-4">
          {/* Glow layer behind the card */}
          <div 
            className="absolute pointer-events-none"
            style={{ 
              top: '-40px',
              left: '-40px',
              right: '-40px',
              bottom: '-40px',
              background: 'radial-gradient(ellipse at center, rgba(0, 180, 255, 0.5) 0%, rgba(0, 160, 255, 0.3) 30%, transparent 65%)',
              filter: 'blur(35px)',
              zIndex: 0
            }}
          />
          
          {/* Card container */}
          <div className="relative" style={{ width: 'min(340px, 92vw)', zIndex: 1 }}>
            <section
              ref={cardRef}
              className="profile-card-main mx-auto w-full aspect-[0.72] md:aspect-[0.7] rounded-[var(--card-radius)] overflow-hidden flex flex-col transition-transform duration-700 ease-out relative origin-center"
            >
            {/* Layer 0: Player Photo Background (behind card, only visible through hole) */}
            <div 
              className="absolute rounded-full overflow-hidden z-0 photo-glow-outer"
              style={{
                width: `${HOLE_SIZE}px`,
                height: `${HOLE_SIZE}px`,
                top: `${HOLE_TOP}px`,
                left: '50%',
                transform: 'translateX(-50%)',
              }}
            >
              <div className="w-full h-full rounded-full overflow-hidden">
                {vm.avatarUrl ? (
                  <img 
                    className="w-full h-full object-cover" 
                    style={{ objectPosition: 'center' }}
                    src={vm.avatarUrl} 
                    alt={vm.name} 
                    loading="eager" 
                    crossOrigin="anonymous" 
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-5xl bg-[#05060f]">👤</div>
                )}
              </div>
            </div>

            {/* Layer 1: Card Mockup Overlay */}
            <img 
              src="/card_mockup.png" 
              alt="" 
              className="absolute inset-0 w-full h-full object-contain pointer-events-none z-10"
            />

            {/* Inner Recess */}
            <div className="h-full w-full flex flex-col pt-4 pb-0 relative z-20">

              {/* Header - Nombre */}
              <div className="flex justify-center items-center mb-8 px-6 pt-3">
                <h3 className="font-bebas font-black text-[2.6rem] md:text-[2.8rem] leading-none text-white tracking-[0.05em] uppercase m-0 truncate max-w-full" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(63, 169, 255, 0.3)' }}>
                  {vm.name.slice(0, 12)}
                </h3>
              </div>

              {/* 3-Column Body Composition - Wider columns and more spacing to push elements away from center */}
              <div className="grid grid-cols-[88px_1fr_88px] items-start gap-6 md:gap-7 px-6 md:px-7 min-h-0 overflow-visible pt-2">

                {/* Column 1: Left Badges - With right padding buffer to prevent circle overlap */}
                <div className="flex flex-col gap-2.5 items-center shrink-0 pr-3 md:pr-4 h-full">
                  <div className="flex flex-col gap-0.5 items-center -mt-3">
                    <div className="badge-glass rounded w-11 h-6 md:w-12 md:h-7 flex items-center justify-center overflow-hidden shrink-0 shadow-lg">
                      <img src={`https://flagcdn.com/w40/${vm.cc}.png`} alt={vm.abbr} className="w-full h-auto object-cover" />
                    </div>
                    <span className="text-white font-bebas text-xs md:text-sm tracking-wider font-bold">{vm.abbr}</span>
                  </div>
                  <div
                    className="badge-glass rounded w-12 h-7 md:w-12 md:h-8 flex items-center justify-center shrink-0 shadow-xl mt-auto"
                    style={{ 
                      background: `${vm.posColor}40`, 
                      borderColor: `${vm.posColor}`,
                      borderWidth: '2px',
                      boxShadow: `0 0 20px ${vm.posColor}40`,
                      marginLeft: '3px'
                    }}
                  >
                    <span
                      className="font-bebas text-lg md:text-xl tracking-wider font-black leading-none"
                      style={{ 
                        color: vm.posColor, 
                        textShadow: `0 0 15px ${vm.posColor}88`,
                        filter: `drop-shadow(0 0 10px ${vm.posColor})`
                      }}
                    >
                      {vm.pos}
                    </span>
                  </div>
                </div>

                {/* Column 2: Center Photo - Now Empty (photo rendered in background layer) */}
                <div className="relative justify-self-center min-w-0">
                  {/* Spacer to maintain layout */}
                  <div className="w-[176px] h-[176px]" />
                </div>

                {/* Column 3: Right Prizes - Positioned in right gutter between circle and edge */}
                <div className="flex flex-col gap-2.5 items-center shrink-0 pl-6 md:pl-7 pr-0">
                  <div className="flex flex-col items-center gap-1">
                    <img 
                      src="/mvp.png" 
                      alt="MVP Award" 
                      width={24}
                      height={24}
                      className="md:w-[26px] md:h-[26px]"
                      draggable={false}
                    />
                    <span ref={mvpRef} className="text-white text-sm md:text-[15px] font-black pc-badge-count">{vm.mvp}</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <img 
                      src="/red_card.png" 
                      alt="Red Card" 
                      width={16}
                      height={24}
                      className="md:w-[18px] md:h-7"
                      draggable={false}
                    />
                    <span ref={redRef} className="text-white text-sm md:text-[15px] font-black pc-badge-count">{vm.red}</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <img 
                      src="/glove.png" 
                      alt="Guante" 
                      width={24}
                      height={24}
                      className="md:w-[26px] md:h-[26px]"
                      draggable={false}
                    />
                    <span ref={gkRef} className="text-white text-sm md:text-[15px] font-black pc-badge-count">{vm.gk}</span>
                  </div>
                </div>
              </div>

              {/* Footer Area: Stats + Rating - Adjusted spacing */}
              <div className="flex flex-col px-8 pb-8">

                {/* Stats Row (PJ, PA) - Slightly more space from photo */}
                <div className="flex items-center justify-center gap-5 mb-0" style={{ marginTop: '-8px' }}>
                  <div className="flex flex-col items-center">
                    <span className="text-[#00C8FF] text-sm md:text-[15px] font-black uppercase tracking-[0.2em] mb-1">PJ</span>
                    <span className="text-white font-black text-[32px] md:text-[36px] leading-none" style={{textShadow: '0 0 20px rgba(0, 200, 255, 0.8)'}}>{vm.pj}</span>
                  </div>
                  <div className="w-[2px] h-12 bg-gradient-to-b from-transparent via-[#00C8FF]/30 to-transparent" />
                  <div className="flex flex-col items-center">
                    <span className="text-[#00C8FF] text-sm md:text-[15px] font-black uppercase tracking-[0.2em] mb-1">PA</span>
                    <span className="text-white font-black text-[32px] md:text-[36px] leading-none" style={{textShadow: '0 0 20px rgba(0, 200, 255, 0.8)'}}>{vm.pa}</span>
                  </div>
                </div>

                {/* Rating */}
                <div className="flex items-center justify-center relative mt-3">
                  <div className="rating-star-badge absolute left-14 -translate-y-1" style={{ width: '26px', height: '26px' }}>
                    <span className="rating-star text-[16px]">★</span>
                  </div>
                  <span className="rating-value" style={{color: '#FFD700', filter: 'drop-shadow(0 0 10px rgba(255, 215, 0, 0.8))'}}>{ratingOverride !== null ? ratingOverride.toFixed(1) : vm.rating}</span>
                </div>
              </div>


            </div>
          </section>
          </div>
        </div>
      </div>
    </>
  );
};

const ProfileCard = ProfileCardComponent;
ProfileCard.displayName = 'ProfileCard';

export default ProfileCard;
