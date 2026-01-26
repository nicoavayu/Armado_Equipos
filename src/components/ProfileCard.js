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
  const map = { 'ARQ': '#FDB022', 'DEF': '#335CFF', 'MED': '#06C270', 'DEL': '#FF3B3B' };
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

const ProfileCardComponent = ({
  profile,
  isVisible = true,
  enableTilt = true,
}) => {
  const wrapRef = useRef(null);
  const cardRef = useRef(null);

  // 1. Single View Model for all data
  const vm = useMemo(() => {
    if (!profile) return null;
    return {
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
          background: 
            repeating-linear-gradient(
              45deg,
              transparent,
              transparent 35px,
              rgba(0, 200, 255, 0.03) 35px,
              rgba(0, 200, 255, 0.03) 70px
            ),
            linear-gradient(180deg, #0a1628 0%, #050d1a 100%); 
          border: 3px solid var(--rating-border); 
          box-shadow: 
            0 20px 60px rgba(0, 0, 0, 0.8), 
            0 0 30px var(--rating-glow1),
            0 0 50px var(--rating-glow2),
            inset 0 0 40px rgba(0, 200, 255, 0.1); 
        }
        .photo-glow-outer { 
          box-shadow: 
            0 0 20px rgba(63, 169, 255, 0.6), 
            0 0 40px rgba(63, 169, 255, 0.3);
          border: 3px solid rgba(63, 169, 255, 0.7); 
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
      `}</style>

      <div ref={wrapRef} className="w-full flex justify-center overflow-visible perspective-[1000px] touch-none group profile-card-wrapper">
        <div className="relative overflow-visible px-4" style={{ width: 'min(340px, 92vw)' }}>
          <section
            ref={cardRef}
            className="profile-card-main mx-auto w-full aspect-[0.72] md:aspect-[0.7] rounded-[var(--card-radius)] overflow-hidden flex flex-col transition-transform duration-700 ease-out relative origin-center"
          >
            {/* Inner Recess */}
            <div className="h-full w-full flex flex-col pt-4 pb-0 relative">

              {/* Header - Nombre */}
              <div className="flex justify-center items-center mb-3 px-6">
                <h3 className="font-bebas font-black text-[2.8rem] leading-none text-white tracking-[0.05em] uppercase m-0 truncate max-w-full" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(63, 169, 255, 0.3)' }}>
                  {vm.name.slice(0, 12)}
                </h3>
              </div>

              {/* 3-Column Body Composition */}
              <div className="flex-1 grid grid-cols-[60px_1fr_60px] items-center gap-3 md:gap-4 px-3 md:px-4 min-h-0 overflow-visible">

                {/* Column 1: Left Badges */}
                <div className="flex flex-col gap-2.5 z-20 items-center shrink-0">
                  <div className="flex flex-col gap-1 items-center">
                    <div className="badge-glass rounded-lg w-11 h-7 md:w-12 md:h-8 flex items-center justify-center overflow-hidden shrink-0 shadow-lg">
                      <img src={`https://flagcdn.com/w40/${vm.cc}.png`} alt={vm.abbr} className="w-full h-auto object-cover" />
                    </div>
                    <span className="text-white font-bebas text-xs md:text-sm tracking-wider font-bold">{vm.abbr}</span>
                  </div>
                  <div
                    className="badge-glass rounded-xl w-12 h-12 md:w-[52px] md:h-[52px] flex items-center justify-center shrink-0 shadow-xl"
                    style={{ 
                      background: `${vm.posColor}40`, 
                      borderColor: `${vm.posColor}`,
                      borderWidth: '2px',
                      boxShadow: `0 0 20px ${vm.posColor}40`
                    }}
                  >
                    <span
                      className="font-bebas text-xl md:text-2xl tracking-wider font-black leading-none"
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

                {/* Column 2: Center Photo */}
                <div className="relative z-10 justify-self-center min-w-0">
                  <div className="photo-glow-outer w-[160px] h-[160px] sm:w-[170px] sm:h-[170px] md:w-[180px] md:h-[180px] rounded-full p-1.5 flex items-center justify-center shrink-0">
                    <div className="w-full h-full rounded-full overflow-hidden bg-[#05060f] border-2 border-black/40">
                      {vm.avatarUrl ? (
                        <img className="w-full h-full object-cover" src={vm.avatarUrl} alt={vm.name} loading="eager" crossOrigin="anonymous" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-5xl">👤</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Column 3: Right Prizes */}
                <div className="flex flex-col gap-2.5 z-20 items-center shrink-0">
                  <div className="flex flex-col items-center gap-1">
                    <div className="text-[#ffd700] drop-shadow-[0_0_8px_rgba(255,215,0,0.8)]">
                      <svg viewBox="0 0 24 24" fill="currentColor" width={24} height={24} className="md:w-[26px] md:h-[26px]"><path d="M5.166 2.621v.858c-1.035.148-2.059.33-3.071.543a.75.75 0 0 0-.584.859 6.753 6.753 0 0 0 6.138 5.6 6.73 6.73 0 0 0 2.743 1.346A6.707 6.707 0 0 1 9.279 15H8.54c-1.036 0-1.875.84-1.875 1.875V19.5h-.75a2.25 2.25 0 0 0-2.25 2.25c0 .414.336.75.75.75h15a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-2.25-2.25H16.5v-2.625c0-1.036-.84-1.875-1.875-1.875h-.739a6.706 6.706 0 0 1-1.112-3.173 6.73 6.73 0 0 0 2.743-1.347 6.753 6.753 0 0 0 6.139-5.6.75.75 0 0 0-.585-.858 47.077 47.077 0 0 0-3.07-.543V2.62a.75.75 0 0 0-.658-.744 49.22 49.22 0 0 0-6.093-.377c-2.063 0-4.096.128-6.093.377a.75.75 0 0 0-.657.744Z" /></svg>
                    </div>
                    <span className="text-white text-sm md:text-[15px] font-black">{vm.mvp}</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-4 h-6 md:w-[18px] md:h-7 rounded-[2px] bg-[#f44336] shadow-[0_0_15px_rgba(244,67,54,0.7)]" />
                    <span className="text-white text-sm md:text-[15px] font-black">{vm.red}</span>
                  </div>
                  {(vm.pos === 'ARQ' || vm.gk > 0) && (
                    <div className="flex flex-col items-center gap-1">
                      <div className="text-[#8178e5] drop-shadow-[0_0_8px_rgba(129,120,229,0.8)]">
                        <svg viewBox="0 0 640 640" width={24} height={24} className="md:w-[26px] md:h-[26px]" fill="currentColor"><path d="M448 448L160 448L101.4 242.9C97.8 230.4 96 217.4 96 204.3C96 126.8 158.8 64 236.3 64L239.7 64C305.7 64 363.2 108.9 379.2 172.9L410.6 298.7L428.2 278.6C440.8 264.2 458.9 256 478 256L480.8 256C515.7 256 544.1 284.3 544.1 319.3C544.1 335.2 538.1 350.5 527.3 362.2L448 448zM128 528C128 510.3 142.3 496 160 496L448 496C465.7 496 480 510.3 480 528L480 544C480 561.7 465.7 576 448 576L160 576C142.3 576 128 561.7 128 544L128 528z" /></svg>
                      </div>
                      <span className="text-white text-sm md:text-[15px] font-black">{vm.gk}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer Area: Stats + Rating */}
              <div className="mt-32 flex flex-col px-5 pb-4 flex-1">

                {/* Stats Row (PJ, PA) */}
                <div className="flex items-center justify-center gap-8 mb-2">
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
                <div className="flex items-center justify-center relative">
                  <div className="rating-star-badge absolute left-16 -translate-y-2">
                    <span className="rating-star text-[10px]">★</span>
                  </div>
                  <span className="rating-value" style={{color: '#FFD700', filter: 'drop-shadow(0 0 10px rgba(255, 215, 0, 0.8))'}}>{vm.rating}</span>
                </div>
              </div>

              {/* Status Bar - Full Width */}
              {vm.injured ? (
                <div 
                  className="w-full h-8 flex items-center justify-center rounded-b-[var(--card-radius)]"
                  style={{ 
                    background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0.6) 100%)',
                    backdropFilter: 'blur(10px)',
                    boxShadow: 'inset 0 2px 8px rgba(255, 255, 255, 0.6), inset 0 -1px 3px rgba(0, 0, 0, 0.2), 0 8px 16px rgba(0, 0, 0, 0.4)'
                  }}
                  title="Lesionado"
                >
                  <span className="text-[#FF4444] font-black text-lg uppercase tracking-wider">Lesionado</span>
                </div>
              ) : (
                <div 
                  className="w-full h-8 rounded-b-[var(--card-radius)]"
                  style={{ 
                    background: vm.available 
                      ? 'linear-gradient(180deg, rgba(34, 197, 94, 0.9) 0%, rgba(34, 197, 94, 0.6) 100%)' 
                      : 'linear-gradient(180deg, rgba(239, 68, 68, 0.9) 0%, rgba(239, 68, 68, 0.6) 100%)',
                    backdropFilter: 'blur(10px)',
                    boxShadow: vm.available
                      ? 'inset 0 2px 8px rgba(255, 255, 255, 0.6), inset 0 -1px 3px rgba(0, 0, 0, 0.2), 0 8px 16px rgba(0, 0, 0, 0.4)'
                      : 'inset 0 2px 8px rgba(255, 255, 255, 0.5), inset 0 -1px 3px rgba(0, 0, 0, 0.2), 0 8px 16px rgba(0, 0, 0, 0.4)'
                  }}
                  title={vm.available ? 'Disponible' : 'No disponible'}
                />
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
};

const ProfileCard = React.memo(ProfileCardComponent);
ProfileCard.displayName = 'ProfileCard';

export default ProfileCard;
