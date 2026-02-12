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
  return src;
};

const ANIM = { SMOOTH: 600, INIT: 1500, OX: 70, OY: 60 };

// Photo mask positioning constants (adjust for perfect alignment)
const HOLE_SIZE = 176; // px - diameter of circular mask (increased ~10%)
const HOLE_TOP = 80; // px - distance from card top

const ProfileCardComponent = ({
  profile,
  isVisible = true,
  enableTilt = true,
  ratingOverride = null,
  disableInternalMotion = false,
  performanceMode = false,
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
          -webkit-text-size-adjust: 100%;
          text-size-adjust: 100%;
        }
        .profile-card-main { 
          background: transparent;
        }
        .photo-glow-outer { 
          /* No glow on photo circle - glow is behind entire card */
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
        .rating-star--perf{
          color:#FFD700;
          font-size: 20px;
          line-height: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          filter: none;
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
        .rating-value--perf{
          font-family: 'Bebas Neue', 'Arial Black', sans-serif;
          color:#00C8FF;
          font-weight: 900;
          font-size: 64px;
          line-height: 1;
          letter-spacing: 0.02em;
          filter: none;
        }
          .pc-badge-count.pc-pop {
            animation: pcBadgePop 520ms cubic-bezier(.2,.85,.2,1);
          }
          @keyframes pcBadgePop {
            0% { transform: scale(1); filter: drop-shadow(0 0 0 rgba(255,255,255,0)); }
            40% { transform: scale(1.35); filter: drop-shadow(0 0 8px rgba(255,255,255,0.6)); }
            100% { transform: scale(1); filter: drop-shadow(0 0 0 rgba(255,255,255,0)); }
          }

          @media (max-width: 390px) {
            .profile-card-wrapper {
              overflow-x: clip !important;
            }
            .profile-card-wrapper .pc-card-shell {
              width: min(340px, calc(100vw - 2.75rem)) !important;
            }
            .profile-card-wrapper .pc-awards-wrap {
              padding-left: 1.25rem;
              padding-right: 1.25rem;
              padding-bottom: 2.65rem;
            }
            .profile-card-wrapper .pc-awards-row {
              gap: 1.1rem;
              margin-bottom: 0.4rem;
            }
            .profile-card-wrapper .pc-awards-item {
              gap: 0.5rem;
              min-width: 0;
            }
            .profile-card-wrapper .pc-awards-divider {
              height: 0.8rem;
            }
            .profile-card-wrapper .pc-awards-count {
              font-size: 1.18rem;
              line-height: 1;
            }
            .profile-card-wrapper .pc-awards-icon--mvp,
            .profile-card-wrapper .pc-awards-icon--glove {
              width: 22px !important;
              height: 22px !important;
            }
            .profile-card-wrapper .pc-awards-icon--red {
              width: 15px !important;
              height: 21px !important;
            }
            .profile-card-wrapper .pc-right-stats {
              right: 40px;
              top: -16px;
              transform: scale(0.96);
              transform-origin: top right;
            }
          }

          @media (max-width: 360px) {
            .profile-card-wrapper .pc-awards-row {
              gap: 0.95rem;
            }
            .profile-card-wrapper .pc-awards-wrap {
              padding-bottom: 2.45rem;
            }
            .profile-card-wrapper .pc-awards-count {
              font-size: 1.05rem;
            }
            .profile-card-wrapper .pc-right-stats {
              right: 34px;
              top: -14px;
              transform: scale(0.9);
              transform-origin: top right;
            }
          }
      `}</style>

      <div ref={wrapRef} className="w-full flex justify-center overflow-visible perspective-[1000px] touch-none group profile-card-wrapper">
        <div className="relative inline-block overflow-visible px-0">
          {/* Glow layer behind the card - disabled during scroll for performance */}
          {!performanceMode && (
            <div
              className="absolute pointer-events-none"
              style={{
                top: '-40px',
                left: '-40px',
                right: '-40px',
                bottom: '-40px',
                background: 'radial-gradient(ellipse at center, rgba(0, 180, 255, 0.5) 0%, rgba(0, 160, 255, 0.3) 30%, transparent 65%)',
                filter: 'blur(35px)',
                zIndex: 0,
              }}
            />
          )}

          {/* Card container */}
          <div className="relative pc-card-shell" style={{ width: 'min(340px, calc(100vw - 6rem))', zIndex: 1 }}>
            <section
              ref={cardRef}
              className={`profile-card-main mx-auto w-full aspect-[0.72] md:aspect-[0.7] rounded-[var(--card-radius)] overflow-hidden flex flex-col relative origin-center ${!disableInternalMotion ? 'transition-transform duration-700 ease-out' : ''}`}
              style={{
                willChange: 'transform',
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                transformStyle: 'preserve-3d'
              }}
            >
              {/* Layer 0: Player Photo Background (centered hole) */}
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

              {/* Inner Content - Flex Col for vertical zones */}
              <div className="h-full w-full flex flex-col pt-5 pb-4 relative z-20">

                {/* --- 1. TOP ZONE: Header --- */}
                <div className="relative w-full px-6 mb-2">
                  {/* Name (Centered) */}
                  <div className="flex justify-center items-center h-12">
                    <h3 className="font-bebas-real font-black text-[2.6rem] leading-none text-white tracking-[0.05em] uppercase m-0 truncate max-w-[80%]" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(63, 169, 255, 0.3)' }}>
                      {vm.name.slice(0, 12)}
                    </h3>
                  </div>
                </div>

                {/* --- 2. MIDDLE ZONE: Content Area --- */}
                <div className="flex-1 flex flex-col items-center relative w-full pt-4">
                  {/* Photo Placeholder (Layer 0 occupies this space) */}
                  <div className="w-[176px] h-[176px] mb-2" />

                  {/* Layout Wrapper */}
                  <div className="relative w-full px-6 flex flex-col items-center">

                    {/* RIGHT SIDE STATS (Vertical Stack in Smaller Glass Container - Raised) */}
                    <div className="absolute right-[40px] -top-[20px] flex flex-col items-center p-1.5 rounded-lg bg-white/5 border border-white/10 backdrop-blur-md pc-right-stats">
                      {/* PJ Stack */}
                      <div className="flex flex-col items-center scale-90">
                        <span className="text-[#00C8FF]/80 text-[10px] font-black uppercase tracking-[0.2em] mb-0.5">PJ</span>
                        <span className="text-white font-black text-xl leading-none" style={{ textShadow: '0 0 10px rgba(0, 200, 255, 0.6)' }}>{vm.pj}</span>
                      </div>

                      {/* Inner Horizontal Divider */}
                      <div className="w-6 h-[1px] bg-white/10 my-1.5" />

                      {/* PA Stack */}
                      <div className="flex flex-col items-center scale-90">
                        <span className="text-[#00C8FF]/80 text-[10px] font-black uppercase tracking-[0.2em] mb-0.5">PA</span>
                        <span className="text-white font-black text-xl leading-none" style={{ textShadow: '0 0 10px rgba(0, 200, 255, 0.6)' }}>{vm.pa}</span>
                      </div>
                    </div>

                    {/* CENTER COLUMN: Badges Row + Rating (Tilted 2px lower) */}
                    <div className="flex flex-col items-center -mt-[8px]">
                      {/* Unified Badges Row (Horizontal + Divider - No Shadows) */}
                      <div className="flex items-center justify-center gap-3 mb-1.5">
                        {/* Flag Badge (No shadow, white border) */}
                        <div className={`${performanceMode ? 'badge-glass--perf' : 'badge-glass'} rounded-md w-9 h-6 flex items-center justify-center overflow-hidden shrink-0`}>
                          <img src={`https://flagcdn.com/w40/${vm.cc}.png`} alt={vm.abbr} className="w-full h-auto object-cover" />
                        </div>

                        {/* Divider Line */}
                        <div className="w-[1px] h-3 bg-white/20" />

                        {/* Position Badge (No shadow, translucent border color) */}
                        <div
                          className="rounded-md w-9 h-6 flex items-center justify-center shrink-0 border-[1.5px] bg-white/5"
                          style={{
                            borderColor: vm.posColor,
                          }}
                        >
                          <span
                            className="font-bebas text-[11px] tracking-wider font-black leading-none"
                            style={{
                              color: vm.posColor,
                              textShadow: `0 0 4px ${vm.posColor}AA`,
                            }}
                          >
                            {vm.pos}
                          </span>
                        </div>
                      </div>

                      {/* Rating Block - PERFECT CENTERED NUMBER with close star accessory (+12px Lower, Larger) */}
                      <div className="flex items-center justify-center w-full max-w-[150px] h-14 mt-3">
                        <div className="relative inline-flex items-center">
                          {/* Star as independent accessory (approx 10px from number) */}
                          <div className="absolute right-full mr-2.5 flex items-center">
                            <div className="rating-star-badge" style={{ width: '22px', height: '22px' }}>
                              <span className={`${performanceMode ? 'rating-star--perf' : 'rating-star'} text-[14px]`}>★</span>
                            </div>
                          </div>
                          <span className={`${performanceMode ? 'rating-value--perf' : 'rating-value'} leading-none`} style={{ fontSize: '76px', color: '#FFD700' }}>
                            {ratingOverride !== null ? ratingOverride.toFixed(1) : vm.rating}
                          </span>
                        </div>
                      </div>
                    </div>

                  </div>
                </div>

                <div className="flex flex-col items-center w-full px-8 pb-8 mt-auto pc-awards-wrap">
                  {/* Footer Divider Removed as requested */}

                  {/* Prizes Row (Divided into 3 sections, container removed) */}
                  <div className="flex items-center justify-center gap-6 mb-2 pc-awards-row">
                    {/* MVP Prize */}
                    <div className="flex items-center gap-2 min-w-[44px] pc-awards-item">
                      <img src="/mvp.png" alt="MVP" width={22} height={22} className="shrink-0 pc-awards-icon--mvp" draggable={false} />
                      <span ref={mvpRef} className="text-white text-sm font-black pc-badge-count pc-awards-count leading-none">{vm.mvp}</span>
                    </div>

                    {/* Divider */}
                    <div className="w-[1px] h-4 bg-white/10 pc-awards-divider" />

                    {/* Glove Prize */}
                    <div className="flex items-center gap-2 min-w-[44px] pc-awards-item">
                      <img src="/glove.png" alt="Glove" width={22} height={22} className="shrink-0 pc-awards-icon--glove" draggable={false} />
                      <span ref={gkRef} className="text-white text-sm font-black pc-badge-count pc-awards-count leading-none">{vm.gk}</span>
                    </div>

                    {/* Divider */}
                    <div className="w-[1px] h-4 bg-white/10 pc-awards-divider" />

                    {/* Red Card Prize (Last) */}
                    <div className="flex items-center gap-2 min-w-[38px] pc-awards-item">
                      <img src="/red_card.png" alt="Card" width={16} height={22} className="shrink-0 pc-awards-icon--red" draggable={false} />
                      <span ref={redRef} className="text-white text-sm font-black pc-badge-count pc-awards-count leading-none">{vm.red}</span>
                    </div>
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
export default ProfileCard;
