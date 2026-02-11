import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabase';
import { db } from '../api/supabaseWrapper';
import { toast } from 'react-toastify';
import { useAuth } from '../components/AuthProvider';
import LoadingSpinner from '../components/LoadingSpinner';
import ProfileCard from '../components/ProfileCard';
import StoryLikeCarousel from '../components/StoryLikeCarousel';
import { ensureAwards } from '../services/awardsService';
import { subscribeToMatchUpdates } from '../services/realtimeService';
import Logo from '../Logo.png';

const ensurePlayersList = (players) => {
  if (players && players.length > 0) return players;
  return [];
};

// Context to broadcast live previewPlayers without recreating slides
const PreviewPlayersContext = createContext([]);

const ResultadosEncuestaView = () => {
  const { partidoId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const fallbackMatchName =
    location?.state?.matchName ||
    location?.state?.partidoNombre ||
    location?.state?.partido_nombre ||
    'Partido';
  const searchParams = new URLSearchParams(location.search);
  const forceAwardsMode =
    Boolean(location?.state?.forceAwards) ||
    Boolean(location?.state?.fromNotification) ||
    searchParams.get('forceAwards') === 'true' ||
    searchParams.get('showAwards') === '1';

  const [loading, setLoading] = useState(true);
  const [partido, setPartido] = useState(null);
  const [results, setResults] = useState(null);
  const [jugadores, setJugadores] = useState([]);
  const [showingBadgeAnimations, setShowingBadgeAnimations] = useState(false);
  const [autoOpeningAwards, setAutoOpeningAwards] = useState(false);
  const [_badgeAnimations, setBadgeAnimations] = useState([]);
  const [_currentAnimationIndex, _setCurrentAnimationIndex] = useState(0);
  const [_animationComplete, _setAnimationComplete] = useState(false);
  const [absences, setAbsences] = useState([]);
  const [carouselSlides, setCarouselSlides] = useState([]);
  const [previewPlayers, setPreviewPlayers] = useState([]);
  const [slideStages, setSlideStages] = useState({}); // 0 award only, 1 card visible, 2 token fly/apply, 3 done
  const penaltyListRef = useRef([]);
  const badgesApplied = useRef(new Set());
  const liveApplied = useRef(new Set());
  const badgeTimers = useRef([]);
  const forceStoryOpenedRef = useRef(null);
  const autoOpenGuardRef = useRef(null);

  const setStage = (key, stage) => {
    setSlideStages((prev) => ({ ...prev, [key]: stage }));
  };

  const clearTimers = () => {
    badgeTimers.current.forEach((t) => clearTimeout(t));
    badgeTimers.current = [];
  };

  const clearAutoOpenGuard = () => {
    if (autoOpenGuardRef.current) {
      clearTimeout(autoOpenGuardRef.current);
      autoOpenGuardRef.current = null;
    }
  };

  const _applyAward = (slideType) => {
    if (badgesApplied.current.has(slideType)) return;
    badgesApplied.current.add(slideType);

    if (slideType === 'mvp' && results?.mvp) {
      setPreviewPlayers((prev) => prev.map((p) =>
        (p.uuid === results.mvp || p.usuario_id === results.mvp)
          ? { ...p, mvp_badges: (p.mvp_badges || 0) + 1 }
          : p,
      ));
    } else if (slideType === 'glove' && results?.golden_glove) {
      setPreviewPlayers((prev) => prev.map((p) =>
        (p.uuid === results.golden_glove || p.usuario_id === results.golden_glove)
          ? { ...p, gk_badges: (p.gk_badges || 0) + 1 }
          : p,
      ));
    } else if (slideType === 'dirty' && results?.dirty_player) {
      setPreviewPlayers((prev) => prev.map((p) =>
        (p.uuid === results.dirty_player || p.usuario_id === results.dirty_player)
          ? { ...p, red_badges: (p.red_badges || 0) + 1 }
          : p,
      ));
    } else if (slideType === 'penalty' && penaltyListRef.current.length > 0) {
      const ids = new Set(penaltyListRef.current.map((p) => p.playerId));
      setPreviewPlayers((prev) => prev.map((p) => {
        if (!ids.has(p.uuid) && !ids.has(p.usuario_id) && !ids.has(String(p.id))) return p;
        const current = parseFloat(p.ranking || p.calificacion || 5.0) || 0;
        const next = Math.max(0, current - 0.5);
        return { ...p, ranking: next.toFixed(1) };
      }));
    }
  };

  const startSlideSequence = (slideType) => {
    // Solo para slides con premio/penalización
    if (!['mvp', 'glove', 'dirty', 'penalty'].includes(slideType)) return;

    // Evitar reiniciar si ya está en progreso
    if (slideStages[slideType] > 0) return;

    clearTimers();
    setStage(slideType, 0);

    const t1 = setTimeout(() => setStage(slideType, 1), 900); // Card aparece
    const t2 = setTimeout(() => {
      setStage(slideType, 2); // Token en vuelo
    }, 1700);

    badgeTimers.current.push(t1, t2);
  };

  const handleCarouselIndexChange = (index, slideKey) => {
    const key = slideKey || carouselSlides?.[index]?.key || `slide-${index}`;
    startSlideSequence(key);
  };

  useEffect(() => () => clearTimers(), []);

  // ✅ Helpers
  const toRating = (p, fallback = 5.0) => {
    const n = parseFloat(p?.ranking ?? p?.calificacion ?? fallback);
    return Number.isFinite(n) ? n : fallback;
  };

  const clamp1 = (v) => Math.max(0, Math.min(10, v)); // si tu rating es 0..10
  const fmt1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '0.0');

  const normalizeBadges = (p) => {
    if (!p) return p;
    return {
      ...p,
      mvp_badges: p.mvp_badges ?? p.mvps ?? 0,
      mvps: p.mvps ?? p.mvp_badges ?? 0,
      gk_badges: p.gk_badges ?? p.guantes_dorados ?? 0,
      guantes_dorados: p.guantes_dorados ?? p.gk_badges ?? 0,
      red_badges: p.red_badges ?? p.tarjetas_rojas ?? 0,
      tarjetas_rojas: p.tarjetas_rojas ?? p.red_badges ?? 0,
    };
  };

  const applyLiveAward = (type, playerId) => {
    const key = `${type}-${playerId}`;
    if (liveApplied.current.has(key) || badgesApplied.current.has(key)) {
      return;
    }
    liveApplied.current.add(key);
    badgesApplied.current.add(key);
    console.log(`🎬 applyLiveAward called: type=${type}, playerId=${playerId}`);
    setPreviewPlayers((prev) => {
      const updated = prev.map((p) => {
        const pid = p.uuid || p.usuario_id || p.id;
        if (String(pid) !== String(playerId)) return p;

        if (type === 'mvp') {
          const current = p.mvp_badges ?? p.mvps ?? 0;
          const newVal = current + 1;
          console.log(`✅ MVP Updated: ${current} → ${newVal}`);
          return normalizeBadges({ ...p, mvp_badges: newVal, mvps: newVal });
        }
        if (type === 'glove') {
          const current = p.gk_badges ?? p.guantes_dorados ?? 0;
          const newVal = current + 1;
          console.log(`✅ GK Updated: ${current} → ${newVal}`);
          return normalizeBadges({ ...p, gk_badges: newVal, guantes_dorados: newVal });
        }
        if (type === 'dirty') {
          const current = p.red_badges ?? p.tarjetas_rojas ?? 0;
          const newVal = current + 1;
          console.log(`✅ RED Updated: ${current} → ${newVal}`);
          return normalizeBadges({ ...p, red_badges: newVal, tarjetas_rojas: newVal });
        }
        if (type === 'penalty') {
          const base = toRating(p, 5.0);
          const next = clamp1(base - 0.5);
          console.log(`✅ PENALTY Updated: ${base} → ${next}`);
          return normalizeBadges({ ...p, ranking: fmt1(next) });
        }
        return normalizeBadges(p);
      });
      console.log('📊 previewPlayers after update:', updated);
      return updated.map(normalizeBadges);
    });
  };

  // ✅ Componente "EA Sports" para cada premio
  const AwardStory = ({
    kind, // 'mvp' | 'glove' | 'dirty' | 'penalty'
    title,
    subtitle,
    icon,
    accent,
    border,
    player,
    playerId,
    bottomLabel,
    onApply,
  }) => {
    const previewPlayers = useContext(PreviewPlayersContext);
    const [stage, setStage] = React.useState(0); // 0: título, 1: card, 2: token aparece, 3: token vuela, 4: premio aplicado
    const appliedRef = React.useRef(false);
    const [showFlash, setShowFlash] = React.useState(false);
    const flashPlayedRef = React.useRef(false);
    const flashTimerRef = React.useRef(null);

    // Resolve live player from previewPlayers to reflect real-time award impacts
    const resolvedPlayer = React.useMemo(() => {
      const pid = playerId || player?.uuid || player?.usuario_id || player?.id;
      if (!pid) return normalizeBadges(player);
      const pidStr = String(pid);
      const found = previewPlayers.find((j) =>
        String(j.uuid) === pidStr || String(j.usuario_id) === pidStr || String(j.id) === pidStr,
      );
      const result = normalizeBadges(found || player);
      console.log(`🔍 resolvedPlayer updated: mvp=${result.mvp_badges}, gk=${result.gk_badges}, red=${result.red_badges}`);
      return result;
    }, [previewPlayers, player, playerId]);

    // Penalty rating animation states
    const [penaltyFrom, setPenaltyFrom] = React.useState(null);
    const [penaltyTo, setPenaltyTo] = React.useState(null);
    const [penaltyNow, setPenaltyNow] = React.useState(null);

    React.useEffect(() => {
      // Reset stage solo cuando cambia la slide (tipo o identidad), no por cambios de conteo
      setStage(0);
      appliedRef.current = false;
      setShowFlash(false);
      flashPlayedRef.current = false;
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
        flashTimerRef.current = null;
      }

      // Precompute animation values per slide
      const base = toRating(resolvedPlayer, 5.0);

      if (kind === 'penalty') {
        const next = clamp1(base - 0.5);
        setPenaltyFrom(base);
        setPenaltyTo(next);
        setPenaltyNow(base);
      } else {
        // For MVP, GLOVE, DIRTY: no rating change, only award count change
        setPenaltyFrom(null);
        setPenaltyTo(null);
        setPenaltyNow(null);
      }

      // Stage 0 → 1: Título visible, card aparece (suspenso)
      const t0 = setTimeout(() => setStage(1), 600);

      // Stage 1 → 2: Card visible, token aparece ARRIBA
      const t1 = setTimeout(() => setStage(2), 1200);

      // Stage 2 → 3: Token empieza a volar hacia la card
      const t2 = setTimeout(() => setStage(3), 1700);

      // Stage 3 → 4: Token termina el vuelo, APLICAR PREMIO
      const t3 = setTimeout(() => {
        setStage(4);
        if (!appliedRef.current) {
          appliedRef.current = true;
          onApply?.();
        }
      }, 2600); // 1700 + ~900ms de animación del vuelo

      return () => {
        clearTimeout(t0);
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }, [kind, playerId, player?.uuid, player?.usuario_id, player?.id, onApply]);

    // Programar flash justo al final del vuelo (antes de aplicar el premio)
    React.useEffect(() => {
      if (stage !== 3) return;
      if (flashPlayedRef.current) return; // asegurar una sola vez
      // El vuelo dura ~1300ms; disparamos el flash apenas llega (ligeramente antes)
      flashTimerRef.current = setTimeout(() => {
        flashPlayedRef.current = true;
        setShowFlash(true);
      }, 780);
      return () => {
        if (flashTimerRef.current) {
          clearTimeout(flashTimerRef.current);
          flashTimerRef.current = null;
        }
      };
    }, [stage]);

    // Animate penalty rating change on stage 4
    React.useEffect(() => {
      if (kind !== 'penalty') return;
      if (stage !== 4) return;
      if (penaltyFrom == null || penaltyTo == null) return;

      let raf = null;
      const duration = 600;
      const start = performance.now();
      const tick = (ts) => {
        const t = Math.min(1, (ts - start) / duration);
        const val = penaltyFrom + (penaltyTo - penaltyFrom) * t;
        setPenaltyNow(val);
        if (t < 1) {
          raf = requestAnimationFrame(tick);
        }
      };
      raf = requestAnimationFrame(tick);
      return () => {
        if (raf) cancelAnimationFrame(raf);
      };
    }, [stage, kind, penaltyFrom, penaltyTo]);

    return (
      <div
        className="relative w-full h-full flex flex-col items-center justify-start py-10 md:py-14 gap-8"
        style={{
          background:
            kind === 'mvp'
              ? 'linear-gradient(135deg,#070B18 0%,#1B1030 35%,#070B18 100%)'
              : kind === 'glove'
                ? 'linear-gradient(135deg,#061019 0%,#062F3A 40%,#061019 100%)'
                : kind === 'dirty'
                  ? 'linear-gradient(135deg,#12060B 0%,#3A0A18 42%,#12060B 100%)'
                  : 'linear-gradient(135deg,#0B0F16 0%,#1B2432 45%,#0B0F16 100%)',
        }}
      >
        {/* glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(650px 260px at 50% 18%, ${accent} 0%, rgba(0,0,0,0) 70%)`,
            opacity: 0.35,
            filter: 'blur(14px)',
          }}
        />

        {/* Acto 1: award */}
        <div className="relative z-10 text-center" style={{ paddingTop: 10 }}>
          {subtitle && (
            <div className="text-white/70 tracking-[0.35em] text-xs md:text-sm mb-2" style={{ animation: 'eaSubIn 740ms ease-out 120ms both' }}>
              {subtitle}
            </div>
          )}

          <div
            className="font-bebas-real text-[56px] md:text-[78px] leading-[0.9]"
            style={{
              color: border,
              textShadow: `0 0 22px ${accent}`,
              animation: stage === 0 ? 'eaTitleIn 760ms cubic-bezier(.2,.9,.2,1) 80ms both' : 'none',
            }}
          >
            {title}
          </div>
        </div>

        {/* Acto 2: card */}
        <div className="relative z-10 w-full h-full flex items-center justify-center">
          {stage >= 1 && resolvedPlayer && (
            <div
              style={{
                animation: stage === 1 ? 'eaCardIn 520ms ease-out both' : 'none',
              }}
            >
              <ProfileCard
                profile={resolvedPlayer}
                isVisible={true}
                ratingOverride={kind === 'penalty' ? penaltyNow : null}
              />
            </div>
          )}

          {/* Token (Acto 3) - Aparece ARRIBA en stage 2, vuela en stage 3 */}
          {stage >= 2 && stage < 4 && (
            <div
              className="absolute pointer-events-none z-50"
              style={{
                right: stage >= 3 ? '50%' : '10%',
                top: stage >= 3 ? '42%' : '2%',
                transform: stage >= 3 ? 'translate(50%, -50%)' : 'none',
                opacity: stage >= 3 ? 0.3 : 1,
                transition: stage >= 3 ? 'right 900ms cubic-bezier(.25,.8,.25,1), top 900ms cubic-bezier(.25,.8,.25,1), opacity 900ms ease-out' : 'none',
                animation: stage === 2 ? 'eaTokenAppear 360ms cubic-bezier(.2,.85,.2,1) both' : 'none',
                zIndex: 60,
              }}
            >
              <div
                className="px-4 py-2 rounded-full"
                style={{
                  background: 'rgba(0,0,0,0.55)',
                  border: '1px solid rgba(255,255,255,0.16)',
                  boxShadow: '0 16px 55px rgba(0,0,0,0.6)',
                  backdropFilter: 'blur(10px)',
                }}
              >
                <div className="flex items-center gap-2">
                  {typeof icon === 'string' && icon.startsWith('/') ? (
                    <img src={icon} alt="award" width={32} height={32} draggable={false} style={{ filter: `drop-shadow(0 0 18px ${accent})` }} />
                  ) : (
                    <span className="text-2xl" style={{ filter: `drop-shadow(0 0 18px ${accent})` }}>
                      {icon}
                    </span>
                  )}
                  <span className="text-white font-bold">
                    {kind === 'penalty' ? '-0.5' : '+1'}
                  </span>
                </div>
              </div>
            </div>
          )}
          {showFlash && (
            <div className="absolute inset-0 pointer-events-none z-[60] flex items-center justify-center">
              <div
                style={{
                  width: 220,
                  height: 220,
                  borderRadius: '50%',
                  background: 'radial-gradient(closest-side, rgba(255,255,255,0.85), rgba(255,255,255,0.35) 40%, rgba(255,255,255,0) 70%)',
                  boxShadow: `0 0 60px ${accent}`,
                  animation: 'eaMergeFlash 540ms ease-out forwards',
                  filter: `drop-shadow(0 0 22px ${accent})`,
                }}
                onAnimationEnd={() => setShowFlash(false)}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        {bottomLabel && stage >= 1 && (
          <div className="relative z-10 pb-4 md:pb-6">
            <div
              className="px-5 py-2 rounded-full text-white/85 text-sm md:text-base"
              style={{
                background: 'rgba(0,0,0,0.45)',
                border: '1px solid rgba(255,255,255,0.14)',
                backdropFilter: 'blur(10px)',
                opacity: 1,
                transform: 'translateY(0)',
                animation: 'eaFooterIn 520ms ease-out both',
              }}
            >
              {kind === 'penalty' && penaltyNow != null && penaltyTo != null ? (
                <span>
                  Rating: {fmt1(penaltyFrom ?? penaltyNow)} → {fmt1(penaltyNow)}
                </span>
              ) : (
                bottomLabel
              )}
            </div>
          </div>
        )}

        <style>{`
          @keyframes eaAwardIn {
            0% { opacity:0; transform: translateY(-24px) scale(0.92); }
            60% { opacity:1; transform: translateY(0px) scale(1.04); }
            100% { opacity:1; transform: translateY(0px) scale(1); }
          }
          @keyframes eaTitleIn {
            0% { opacity:0; transform: translateY(18px) scale(0.98); letter-spacing: .2em; }
            100% { opacity:1; transform: translateY(0px) scale(1); letter-spacing: .02em; }
          }
          @keyframes eaSubIn {
            0% { opacity:0; transform: translateY(10px); }
            100% { opacity:1; transform: translateY(0); }
          }
          @keyframes eaCardIn {
            0% { opacity:0; transform: translateY(48px) scale(0.96); }
            60% { opacity:1; transform: translateY(6px) scale(1.02); }
            100% { opacity:1; transform: translateY(0) scale(1); }
          }
          @keyframes eaFooterIn {
            0% { opacity:0; transform: translateY(12px); }
            100% { opacity:1; transform: translateY(0); }
          }
          @keyframes eaTokenAppear {
            0% { opacity:0; transform: scale(0.5) translateY(-10px); }
            60% { opacity:1; transform: scale(1.08) translateY(0); }
            100% { opacity:1; transform: scale(1) translateY(0); }
          }
          @keyframes eaPulse {
            0% { transform: scale(0.6); opacity: 0.0; }
            40% { transform: scale(1.0); opacity: 0.9; }
            100% { transform: scale(2.2); opacity: 0; }
          }
          @keyframes eaMergeFlash {
            0% { transform: scale(0.8); opacity: 0; }
            30% { transform: scale(1.15); opacity: 1; }
            100% { transform: scale(1.6); opacity: 0; }
          }
        `}</style>
      </div>
    );
  };

  const prepareCarouselSlides = (currentResults = results, currentPlayers = jugadores) => {
    if (!currentResults) return [];

    const roster = ensurePlayersList(currentPlayers);
    const matchInfo = partido || { nombre: fallbackMatchName, fecha: new Date().toISOString(), awards_status: 'ready' };

    const findP = (id) => {
      if (!id) return null;
      return roster.find((j) =>
        j.uuid === id ||
        j.usuario_id === id ||
        String(j.id) === String(id) ||
        (j.uuid && id && String(j.uuid).toLowerCase() === String(id).toLowerCase()),
      );
    };

    const slides = [];
    const awardsObj = currentResults?.awards || {};
    const mvpWinnerId = currentResults?.mvp ?? awardsObj?.mvp?.player_id ?? null;
    const gloveWinnerId = currentResults?.golden_glove ?? awardsObj?.best_gk?.player_id ?? null;
    const dirtyWinnerIdFromAwards = awardsObj?.red_card?.player_id ?? null;

    // INTRO: Primera slide siempre
    slides.push({
      key: 'intro',
      duration: 1800,
      content: (
        <div
          className="relative w-full h-full flex flex-col items-center justify-center text-center py-10 md:py-14"
          style={{
            background: 'linear-gradient(135deg,#070B18 0%,#120B2A 45%,#070B18 100%)',
            borderRadius: 28,
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: '0 30px 120px rgba(0,0,0,0.55)',
          }}
        >
          {/* glow */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'radial-gradient(650px 260px at 50% 40%, rgba(14,169,198,0.4) 0%, rgba(0,0,0,0) 70%)',
              opacity: 0.35,
              filter: 'blur(14px)',
              borderRadius: 28,
            }}
          />

          <div className="relative z-10 flex flex-col items-center justify-center flex-1">
            <div className="font-bebas-real text-[56px] md:text-[78px] leading-[0.9] text-white" style={{ animation: 'eaTitleIn 760ms cubic-bezier(.2,.9,.2,1) both', textShadow: '0 0 22px rgba(14,169,198,0.5)' }}>
              PREMIACIÓN
            </div>
            <div className="text-white/70 tracking-[0.35em] text-xs md:text-sm mt-2 mb-6" style={{ animation: 'eaSubIn 740ms ease-out 120ms both' }}>
              DEL PARTIDO
            </div>
            <div className="text-[#0EA9C6] text-lg md:text-xl font-bold" style={{ textShadow: '0 0 18px rgba(14,169,198,0.55)' }}>
              {matchInfo.nombre || matchInfo.titulo || fallbackMatchName}
            </div>
          </div>

          {/* Logo app al pie */}
          <div className="absolute bottom-4 md:bottom-6 left-1/2 transform -translate-x-1/2 z-10" style={{ opacity: 0.55 }}>
            <img src={Logo} alt="Logo" style={{ width: 72, height: 'auto', filter: 'drop-shadow(0 0 6px rgba(0,0,0,0.4))' }} />
          </div>

          <style>{`
            @keyframes eaTitleIn {
              0% { opacity:0; transform: translateY(18px) scale(0.98); letter-spacing: .22em; }
              100% { opacity:1; transform: translateY(0px) scale(1); letter-spacing: .04em; }
            }
            @keyframes eaSubIn {
              0% { opacity:0; transform: translateY(10px); }
              100% { opacity:1; transform: translateY(0); }
            }
          `}</style>
        </div>
      ),
    });

    // MVP
    if (mvpWinnerId) {
      const p = findP(mvpWinnerId);
      if (p) {
        const pid = p.uuid || p.usuario_id || p.id;
        slides.push({
          key: 'mvp',
          duration: 4500,
          content: (
            <AwardStory
              kind="mvp"
              icon="/mvp.png"
              title="MVP"
              subtitle={null}
              accent="rgba(255,215,0,0.65)"
              border="#FFD700"
              player={p}
              playerId={pid}
              bottomLabel={`${currentResults.mvp_votes || awardsObj?.mvp?.votes || 0} VOTOS`}
              onApply={() => applyLiveAward('mvp', pid)}
            />
          ),
        });
      }
    }

    // Guante
    if (gloveWinnerId) {
      const p = findP(gloveWinnerId);
      if (p) {
        const pid = p.uuid || p.usuario_id || p.id;
        slides.push({
          key: 'glove',
          duration: 4500,
          content: (
            <AwardStory
              kind="glove"
              icon="/glove.png"
              title="MEJOR ARQUERO"
              subtitle={null}
              accent="rgba(34,211,238,0.55)"
              border="#22d3ee"
              player={p}
              playerId={pid}
              bottomLabel={`${currentResults.golden_glove_votes || awardsObj?.best_gk?.votes || 0} VOTOS`}
              onApply={() => applyLiveAward('glove', pid)}
            />
          ),
        });
      }
    }

    // Tarjeta roja / Más sucio
    const dirtyId = currentResults.dirty_player
      || (Array.isArray(currentResults.red_cards) ? currentResults.red_cards[0] : null)
      || dirtyWinnerIdFromAwards;
    if (dirtyId) {
      const p = findP(dirtyId);
      if (p) {
        const pid = p.uuid || p.usuario_id || p.id;
        slides.push({
          key: 'dirty',
          duration: 4500,
          content: (
            <AwardStory
              kind="dirty"
              icon="/red_card.png"
              title="MÁS SUCIO"
              subtitle={null}
              accent="rgba(248,113,113,0.55)"
              border="#f87171"
              player={p}
              playerId={pid}
              bottomLabel={`${currentResults.dirty_player_fouls || currentResults.red_card_votes || awardsObj?.red_card?.votes || 0} VOTOS`}
              onApply={() => applyLiveAward('dirty', pid)}
            />
          ),
        });
      }
    }

    // PENALIZACIÓN
    const penalized = (() => {
      const punished = absences.filter((a) => a.absencePenalty || a.ineligible);
      if (punished?.length) {
        const first = punished[0];
        const pid = first.uuid || first.usuario_id || first.id;
        return { player: first, playerId: pid };
      }
      return null;
    })();

    if (penalized?.player) {
      const base = toRating(penalized.player, 5.0);
      const next = clamp1(base - 0.5);
      slides.push({
        key: 'penalty',
        duration: 4500,
        content: (
          <AwardStory
            kind="penalty"
            icon="/penalizacion.png"
            title="PENALIZACIÓN"
            subtitle={null}
            accent="rgba(251,146,60,0.55)"
            border="#FDBA74"
            player={penalized.player}
            playerId={penalized.playerId}
            bottomLabel={`Penalización -0.5 • Rating: ${fmt1(base)} → ${fmt1(next)}`}
            onApply={() => applyLiveAward('penalty', penalized.playerId)}
          />
        ),
      });
    }

    // RESUMEN FINAL: Última slide siempre
    const summaryAwards = [];

    const mvpPlayer = mvpWinnerId ? findP(mvpWinnerId) : null;
    if (mvpPlayer) {
      summaryAwards.push({
        awardName: 'MVP',
        playerName: mvpPlayer.nombre,
        icon: '/mvp.png',
        color: '#FFD700',
      });
    }

    const glovePlayer = gloveWinnerId ? findP(gloveWinnerId) : null;
    if (glovePlayer) {
      summaryAwards.push({
        awardName: 'MEJOR ARQUERO',
        playerName: glovePlayer.nombre,
        icon: '/glove.png',
        color: '#22d3ee',
      });
    }

    const dirtyPlayer = dirtyId ? findP(dirtyId) : null;
    if (dirtyPlayer) {
      summaryAwards.push({
        awardName: 'MÁS SUCIO',
        playerName: dirtyPlayer.nombre,
        icon: '/red_card.png',
        color: '#f87171',
      });
    }

    if (penalized?.player) {
      summaryAwards.push({
        awardName: 'PENALIZACIÓN',
        playerName: penalized.player.nombre,
        icon: '/penalizacion.png',
        color: '#FDBA74',
      });
    }

    if (summaryAwards.length === 0) {
      return [];
    }

    slides.push({
      key: 'summary',
      duration: 5000,
      content: (
        <div
          className="relative w-full h-full flex flex-col items-center justify-center px-6 md:px-10 py-10 md:py-14"
          style={{
            background: 'linear-gradient(135deg,#070B18 0%,#0F1419 50%,#070B18 100%)',
          }}
        >
          {/* glow */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'radial-gradient(650px 260px at 50% 20%, rgba(14,169,198,0.3) 0%, rgba(0,0,0,0) 70%)',
              opacity: 0.35,
              filter: 'blur(14px)',
              borderRadius: 28,
            }}
          />

          <div className="relative z-10 w-full flex flex-col items-center">
            <div className="text-center mb-8">
              <div className="font-bebas-real text-[52px] md:text-[72px] leading-[0.9] text-white" style={{ animation: 'eaTitleIn 760ms cubic-bezier(.2,.9,.2,1) both', textShadow: '0 0 22px rgba(14,169,198,0.5)' }}>
                RESUMEN
              </div>
              <div className="text-white/70 tracking-[0.35em] text-xs md:text-sm mt-2" style={{ animation: 'eaSubIn 680ms ease-out both' }}>
                DEL PARTIDO
              </div>
            </div>

            <div className="w-full max-w-[680px] grid grid-cols-1 md:grid-cols-2 gap-4">
              {summaryAwards.map((award, idx) => (
                <div
                  key={idx}
                  className="flex flex-col items-center justify-center px-5 py-6 rounded-xl"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    animation: `slideInUp 650ms ease-out ${idx * 80}ms both`,
                  }}
                >
                  {typeof award.icon === 'string' && award.icon.startsWith('/') ? (
                    <img
                      src={award.icon}
                      alt={award.awardName}
                      width={38}
                      height={38}
                      draggable={false}
                      style={{ filter: `drop-shadow(0 0 12px ${award.color})` }}
                      className="mb-3"
                    />
                  ) : (
                    <span className="text-4xl mb-3" style={{ filter: `drop-shadow(0 0 12px ${award.color})` }}>
                      {award.icon}
                    </span>
                  )}
                  <div className="text-center">
                    <div className="font-bebas-real text-lg text-white/60 uppercase tracking-wider mb-1">
                      {award.awardName}
                    </div>
                    <div className="text-base md:text-lg text-white font-bold">
                      {award.playerName}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <style>{`
            @keyframes eaTitleIn {
              0% { opacity:0; transform: translateY(18px) scale(0.98); letter-spacing: .22em; }
              100% { opacity:1; transform: translateY(0px) scale(1); letter-spacing: .04em; }
            }
            @keyframes eaSubIn {
              0% { opacity:0; transform: translateY(10px); }
              100% { opacity:1; transform: translateY(0); }
            }
            @keyframes slideInUp {
              0% { opacity:0; transform: translateY(30px) scale(0.95); }
              100% { opacity:1; transform: translateY(0) scale(1); }
            }
          `}</style>
        </div>
      ),
    });

    return slides;
  };

  const prepareForceFallbackSlides = () => {
    const matchInfo = partido || { nombre: fallbackMatchName };
    return [{
      key: 'awards-pending',
      duration: 3200,
      content: (
        <div
          className="relative w-full h-full flex flex-col items-center justify-center text-center py-10 md:py-14"
          style={{
            background: 'linear-gradient(135deg,#070B18 0%,#120B2A 45%,#070B18 100%)',
            borderRadius: 28,
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: '0 30px 120px rgba(0,0,0,0.55)',
          }}
        >
          <div className="font-bebas-real text-[48px] md:text-[68px] leading-[0.9] text-white" style={{ textShadow: '0 0 22px rgba(14,169,198,0.5)' }}>
            PREMIACIÓN
          </div>
          <div className="text-white/70 tracking-[0.35em] text-xs md:text-sm mt-2 mb-6">
            DEL PARTIDO
          </div>
          <div className="text-[#0EA9C6] text-lg md:text-xl font-bold mb-2">
            {matchInfo.nombre || matchInfo.titulo || fallbackMatchName}
          </div>
          <div className="text-white/80 text-base md:text-lg">
            Todavía no hay premios listos para mostrar.
          </div>
          <div className="text-white/60 text-sm mt-2">
            Volvé en un momento.
          </div>
        </div>
      ),
    }];
  };

  // Animation Styles encapsulated here to avoid external CSS

  // NO regenerar slides durante reproducción - content functions ya leen slideStages/previewPlayers en vivo
  // useEffect(() => {
  //   if (!results || !showingBadgeAnimations || previewPlayers.length === 0) return;
  //   const slides = prepareCarouselSlides(results, jugadores);
  //   setCarouselSlides(slides);
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [slideStages, previewPlayers]);

  useEffect(() => {
    const fetchResultsData = async () => {
      if (!partidoId) {
        setLoading(false);
        return;
      }

      if (!user) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);

        let partidoData;
        try {
          partidoData = await db.fetchOne('partidos', { id: Number(partidoId) });
        } catch (error) {
          toast.error('Partido no encontrado');
          navigate('/');
          return;
        }

        if (!partidoData) {
          toast.error('Partido no encontrado');
          setLoading(false);
          return;
        }

        setPartido(partidoData);

        // Fetch players explicitly
        const { data: playersData } = await supabase
          .from('jugadores')
          .select('*')
          .eq('partido_id', Number(partidoId));

        if (playersData) {
          setJugadores(playersData);
          // Patch partidoData to include players for compatibility with existing code if needed
          partidoData.jugadores = playersData;
        }

        const { data: resultsData, error: resultsError } = await supabase
          .from('survey_results')
          .select('*')
          .eq('partido_id', Number(partidoId))
          .single();

        if (resultsError && resultsError.code !== 'PGRST116') {
          throw resultsError;
        }

        // Logic fix: rely on resultsData existence and results_ready flag, ignoring missing awards_status column
        if (resultsData && resultsData.results_ready) {
          setResults(resultsData);
        } else {
          setResults(null);
        }

        const animations = [];
        const addedPlayers = new Set();
        const finalResults = resultsData || null;

        if (finalResults) {
          if (finalResults.mvp) {
            const mvpVal = finalResults.mvp;
            const player = partidoData.jugadores.find((j) => j.uuid === mvpVal || j.usuario_id === mvpVal || String(j.uuid) === String(mvpVal));
            if (player && !addedPlayers.has(player.uuid + '_mvp')) {
              animations.push({
                playerName: player.nombre,
                playerAvatar: player.avatar_url || player.foto_url,
                badgeType: 'mvp',
                badgeText: 'MVP',
                badgeIcon: '🏆',
                votes: Number(finalResults.mvp_votes || 1),
              });
              addedPlayers.add(player.uuid + '_mvp');
            }
          }

          if (finalResults.golden_glove) {
            const goldenGloveVal = finalResults.golden_glove;
            const player = partidoData.jugadores.find((j) => j.uuid === goldenGloveVal || j.usuario_id === goldenGloveVal || String(j.uuid) === String(goldenGloveVal));
            if (player && !addedPlayers.has(player.uuid + '_golden_glove')) {
              animations.push({
                playerName: player.nombre,
                playerAvatar: player.avatar_url || player.foto_url,
                badgeType: 'golden_glove',
                badgeText: 'MEJOR ARQUERO',
                badgeIcon: '🥇',
                votes: Number(finalResults.golden_glove_votes || 1),
              });
              addedPlayers.add(player.uuid + '_golden_glove');
            }
          }
        }

        setBadgeAnimations(animations);
      } catch (error) {
        console.error('Error fetching results data:', error);
        toast.error('Error al cargar los resultados');
      } finally {
        setLoading(false);
      }
    };

    fetchResultsData();
  }, [partidoId, user, navigate, location.search]);

  // Realtime updates
  useEffect(() => {
    if (!partidoId) return;
    const unsubscribe = subscribeToMatchUpdates(partidoId, (event) => {
      console.debug('[RT] Resultados update:', event.type);
      // Refetch on any significant change
      if (event.type === 'results_update' || event.type === 'votes_update' || event.type === 'match_update') {
        // Debounce could be added here if high volume, but for now direct refetch
        // We reuse handleRetry but maybe without setting loading=true to avoid flicker?
        // For now, handleRetry does set loading. Let's try to call it.
        handleRetry();
      }
    });
    return () => unsubscribe();
  }, [partidoId]);

  // Force story-like awards entry from notification/ring/showAwards links.
  useEffect(() => {
    const shouldForce = forceAwardsMode && partidoId;
    const forceKey = `${partidoId}:${location.key || location.search}`;

    if (!shouldForce) {
      forceStoryOpenedRef.current = null;
      clearAutoOpenGuard();
      setAutoOpeningAwards(false);
      return;
    }

    if (loading || showingBadgeAnimations) return;
    if (forceStoryOpenedRef.current === forceKey) return;
    forceStoryOpenedRef.current = forceKey;

    let cancelled = false;
    const runForceAwards = async () => {
      console.log('[RESULTADOS] forcing awards ensure (one-shot)', { partidoId });
      clearAutoOpenGuard();
      setAutoOpeningAwards(true);
      let openedStory = false;
      autoOpenGuardRef.current = setTimeout(() => {
        if (!cancelled) {
          console.warn('[RESULTADOS] auto-open guard timeout, waiting for real slides (no fallback flash)');
          // Last check before giving up loading. In forced mode, always open a story fallback.
          const roster = ensurePlayersList(jugadores);
          const row = results;
          const maybeSlides = row ? prepareCarouselSlides(row, roster) : [];
          if (maybeSlides.length > 0) {
            setPreviewPlayers(JSON.parse(JSON.stringify(roster)));
            badgesApplied.current.clear();
            liveApplied.current.clear();
            setSlideStages({});
            setCarouselSlides(maybeSlides);
            setShowingBadgeAnimations(true);
            openedStory = true;
          } else {
            setPreviewPlayers([]);
            badgesApplied.current.clear();
            liveApplied.current.clear();
            setSlideStages({});
            setCarouselSlides(prepareForceFallbackSlides());
            setShowingBadgeAnimations(true);
            openedStory = true;
          }
          setAutoOpeningAwards(false);
        }
      }, 3200);
      try {
        let row = results;

        // If results are missing/not ready, ask backend once.
        if (!row || !row.results_ready) {
          const res = await ensureAwards(partidoId);
          if (!cancelled && res?.ok && res.row) {
            row = res.row;
            setResults(res.row);
          }
        }

        if (cancelled) return;

        let roster = ensurePlayersList(jugadores);
        if (!roster.length) {
          const { data: playersData, error: playersError } = await supabase
            .from('jugadores')
            .select('*')
            .eq('partido_id', Number(partidoId));
          if (!playersError && Array.isArray(playersData)) {
            roster = playersData;
            if (!cancelled) {
              setJugadores(playersData);
            }
          }
        }

        const slides = row ? prepareCarouselSlides(row, roster) : [];
        if (slides.length === 0) {
          // Forced mode: always open story, even if awards are not ready yet.
          setPreviewPlayers([]);
          badgesApplied.current.clear();
          liveApplied.current.clear();
          setSlideStages({});
          setCarouselSlides(prepareForceFallbackSlides());
          setShowingBadgeAnimations(true);
          openedStory = true;
          return;
        }

        setPreviewPlayers(JSON.parse(JSON.stringify(roster)));
        badgesApplied.current.clear();
        liveApplied.current.clear();
        setSlideStages({});
        setCarouselSlides(slides);
        setShowingBadgeAnimations(true);
        openedStory = true;
      } catch (e) {
        console.error('[RESULTADOS] ensureAwards failed', e);
        if (cancelled) return;
        // Forced mode: keep UX in story flow even on transient errors.
        setPreviewPlayers([]);
        badgesApplied.current.clear();
        liveApplied.current.clear();
        setSlideStages({});
        setCarouselSlides(prepareForceFallbackSlides());
        setShowingBadgeAnimations(true);
        openedStory = true;
      } finally {
        clearAutoOpenGuard();
        // Always release spinner lock when attempt finishes.
        if (!cancelled) setAutoOpeningAwards(false);
      }
    };

    runForceAwards();

    return () => {
      cancelled = true;
      clearAutoOpenGuard();
      // Effect re-runs can cancel an in-flight attempt; never leave the spinner locked.
      setAutoOpeningAwards(false);
    };
  }, [forceAwardsMode, partidoId, location.key, location.search, loading, jugadores, results, showingBadgeAnimations]);

  useEffect(() => {
    return () => {
      clearAutoOpenGuard();
    };
  }, []);

  // If we entered in forced story mode and initially showed "awards-pending",
  // upgrade to real award slides as soon as results/roster become available.
  useEffect(() => {
    if (!forceAwardsMode) return;
    if (!showingBadgeAnimations) return;
    if (!Array.isArray(carouselSlides) || carouselSlides.length === 0) return;
    if (carouselSlides[0]?.key !== 'awards-pending') return;
    if (!results || !results.results_ready) return;

    const roster = ensurePlayersList(jugadores);
    if (!roster.length) return;

    const slides = prepareCarouselSlides(results, roster);
    if (!slides.length) return;

    setPreviewPlayers(JSON.parse(JSON.stringify(roster)));
    badgesApplied.current.clear();
    liveApplied.current.clear();
    setSlideStages({});
    setCarouselSlides(slides);
  }, [forceAwardsMode, showingBadgeAnimations, carouselSlides, results, jugadores]);

  useEffect(() => {
    const computeAbsences = () => {
      if (!jugadores || !Array.isArray(jugadores) || jugadores.length === 0) {
        setAbsences([]);
        return;
      }

      const now = new Date();
      const updatedAbsences = jugadores.map((jugador) => {
        const ausenciasCount = (jugador.ausencias && Array.isArray(jugador.ausencias)) ? jugador.ausencias.length : 0;
        const ineligible = (jugador.estado === 'ineligible');
        const lastAbsenceDate = (jugador.ausencias && jugador.ausencias.length > 0) ? new Date(jugador.ausencias[jugador.ausencias.length - 1].fecha) : null;
        const absencePenalty = (ausenciasCount > 0 && lastAbsenceDate && (now.getTime() - lastAbsenceDate.getTime()) < 7 * 24 * 60 * 60 * 1000);

        return {
          ...jugador,
          ausenciasCount,
          ineligible,
          absencePenalty,
        };
      });

      setAbsences(updatedAbsences);
    };

    computeAbsences();
  }, [jugadores]);



  const handleRetry = async () => {
    setLoading(true);
    try {
      const { data: resultsData, error: resultsError } = await supabase
        .from('survey_results')
        .select('*')
        .eq('partido_id', partidoId)
        .single();

      if (resultsError) throw resultsError;

      if (resultsData) setResults(resultsData);

      // Re-prepare animations
      const animations = [];
      const addedPlayers = new Set();

      // Similar logic as useEffect... (abridged for brevity, assuming state updates work)
      // Note: In a full refactor, this logic should be extracted to a helper function.

      // MVP
      if (resultsData?.mvp) {
        const mvpVal = resultsData.mvp;
        const player = partido.jugadores.find((j) => j.uuid === mvpVal || j.usuario_id === mvpVal);
        if (player && !addedPlayers.has(player.uuid + '_mvp')) {
          animations.push({
            playerName: player.nombre,
            playerAvatar: player.avatar_url || player.foto_url,
            badgeType: 'mvp',
            badgeText: 'MVP',
            badgeIcon: '🏆',
            votes: resultsData.mvp_votes || 1,
          });
          addedPlayers.add(player.uuid + '_mvp');
        }
      }

      // Glove
      if (resultsData?.golden_glove) {
        const goldenGloveVal = resultsData.golden_glove;
        const player = partido.jugadores.find((j) => j.uuid === goldenGloveVal || j.usuario_id === goldenGloveVal);
        if (player && !addedPlayers.has(player.uuid + '_golden_glove')) {
          animations.push({
            playerName: player.nombre,
            playerAvatar: player.avatar_url || player.foto_url,
            badgeType: 'golden_glove',
            badgeText: 'MEJOR ARQUERO',
            badgeIcon: '🥇',
            votes: resultsData.golden_glove_votes || 1,
          });
          addedPlayers.add(player.uuid + '_golden_glove');
        }
      }

      setBadgeAnimations(animations);
    } catch (error) {
      console.error('Error fetching results data:', error);
      toast.error('Error al cargar los resultados');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    navigate(-1);
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] w-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}>
        <LoadingSpinner size="large" />
      </div>
    );
  }

  if (!partido) {
    return <div className="text-white text-center mt-20 text-xl">Partido no encontrado</div>;
  }

  const awardsStatus = partido.awards_status;

  // OVERLAY ANIMATION RENDER
  // Carousel state


  const handleAnimateBadges = () => {
    // Initialize previewPlayers with current jugadores state
    setPreviewPlayers(JSON.parse(JSON.stringify(jugadores)));
    badgesApplied.current.clear();
    liveApplied.current.clear();
    setSlideStages({});

    const slides = prepareCarouselSlides();
    if (!slides || slides.length === 0) {
      return;
    }
    setCarouselSlides(slides);
    setShowingBadgeAnimations(true);
  };

  if (showingBadgeAnimations && carouselSlides.length > 0) {
    return (
      <>
        <PreviewPlayersContext.Provider value={previewPlayers}>
          <StoryLikeCarousel
            slides={carouselSlides}
            onClose={() => {
              clearTimers();
              setShowingBadgeAnimations(false);
              badgesApplied.current.clear();
              liveApplied.current.clear();
              setSlideStages({});
              navigate('/');
            }}
            onIndexChange={handleCarouselIndexChange}
          />
        </PreviewPlayersContext.Provider>

        <style>{`
          @keyframes awardDropIn {
            0% { transform: translateY(-30px) scale(0.6); opacity: 0; }
            60% { transform: translateY(8px) scale(1.08); }
            100% { transform: translateY(0) scale(1); opacity: 1; }
          }
          @keyframes cardReveal {
            0% { transform: translateY(20px) scale(0.96); opacity: 0; }
            100% { transform: translateY(0) scale(1); opacity: 1; }
          }
          @keyframes tokenFlyToCard {
            0% { transform: translate(-50%, 0) scale(1); opacity: 1; }
            70% { transform: translate(-50%, 200px) scale(0.9); opacity: 1; }
            100% { transform: translate(-50%, 230px) scale(0.75); opacity: 0; }
          }
          @keyframes badgePopPulse {
            0% { transform: scale(0.8); opacity: 0.4; box-shadow: 0 0 0 0 rgba(255,255,255,0.15); }
            60% { transform: scale(1.15); opacity: 1; box-shadow: 0 0 0 10px rgba(255,255,255,0); }
            100% { transform: scale(1); opacity: 0.8; box-shadow: 0 0 0 0 rgba(255,255,255,0); }
          }
          @keyframes dropIn {
            0% { transform: translateY(-100px) scale(0); opacity: 0; }
            60% { transform: translateY(10px) scale(1.05); }
            100% { transform: translateY(0) scale(1); opacity: 1; }
          }
          @keyframes slideInUp {
            0% { transform: translateY(50px); opacity: 0; }
            100% { transform: translateY(0); opacity: 1; }
          }
          @keyframes scaleIn {
            0% { transform: scale(0.92); opacity: 0; }
            100% { transform: scale(1); opacity: 1; }
          }
          @keyframes fadeIn {
            0% { opacity: 0; }
            100% { opacity: 1; }
          }
          @keyframes pulse {
            0%, 100% { opacity: 0.3; }
            50% { opacity: 0.6; }
          }
          .animate-cardReveal { animation: cardReveal 0.6s ease-out both; }
          .animate-badgePopPulse { animation: badgePopPulse 0.8s ease-out both; }
          .token-flight { pointer-events: none; }
        `}</style>
      </>
    );
  }

  // In force awards mode, never show the static results page before story is ready.
  if (forceAwardsMode && !showingBadgeAnimations) {
    return (
      <div className="min-h-[100dvh] w-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}>
        <LoadingSpinner size="large" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] w-screen p-0 flex flex-col" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}>
      {/* Main Card Container */}
      <div className="w-[90vw] max-w-[1100px] mt-[70px] mx-auto py-6 px-4 pb-11 bg-card dark:bg-[#1a1a1a] shadow-fifa-card rounded-[20px] min-h-[82vh] md:w-full md:mt-12 md:shadow-none md:rounded-none relative mb-20">

        <h1 className="text-3xl md:text-4xl text-white  text-center mb-8 uppercase tracking-wider">Resultados de la Encuesta</h1>

        {/* Partido Info */}
        <div className="bg-white/5 rounded-xl p-5 mb-6 border border-white/10 text-center">
          <h2 className="text-xl md:text-2xl text-[#0EA9C6]  mb-3 uppercase tracking-wide">
            {partido.nombre || partido.titulo || fallbackMatchName}
          </h2>
          <p className="text-gray-300  text-lg mb-1">
            {new Date(partido.fecha).toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' })}
          </p>
          <p className="text-sm  uppercase tracking-wider mt-3">
            <span className="text-gray-400">Estado de los Premios: </span>
            <span className={`${awardsStatus === 'ready' ? 'text-green-400' : 'text-yellow-400'} font-bold`}>
              {awardsStatus === 'ready' ? 'Listos para ver' : awardsStatus === 'insufficient' ? 'No suficientes votos' : 'En progreso'}
            </span>
          </p>
        </div>

        {/* Results Summary */}
        {results && (
          <div className="bg-gradient-to-br from-white/10 to-white/5 rounded-xl p-5 mb-8 border border-white/10">
            <h3 className="text-xl text-white  mb-4 border-b border-white/10 pb-2">Destacados</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {results.mvp && (
                <div className="flex items-center gap-3 bg-black/20 p-3 rounded-lg">
                  <span className="text-2xl">🏆</span>
                  <div className="flex flex-col">
                    <span className="font-bebas-real text-lg text-gray-400 uppercase tracking-wider">MVP</span>
                    <span className="text-lg text-white  text-shadow-sm">{results.mvp_nombre || '—'}</span>
                  </div>
                </div>
              )}
              {results.golden_glove && (
                <div className="flex items-center gap-3 bg-black/20 p-3 rounded-lg">
                  <span className="text-2xl">🥇</span>
                  <div className="flex flex-col">
                    <span className="font-bebas-real text-lg text-gray-400 uppercase tracking-wider">MEJOR ARQUERO</span>
                    <span className="text-lg text-white  text-shadow-sm">{results.golden_glove_nombre || '—'}</span>
                  </div>
                </div>
              )}
              {(results.dirty_player || (Array.isArray(results.red_cards) && results.red_cards.length > 0)) && (
                <div className="flex items-center gap-3 bg-black/20 p-3 rounded-lg">
                  <span className="text-2xl">🟥</span>
                  <div className="flex flex-col">
                    <span className="font-bebas-real text-lg text-gray-400 uppercase tracking-wider">MÁS SUCIO</span>
                    <span className="text-lg text-white  text-shadow-sm">{results.dirty_player_nombre || '—'}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* No Results Message */}
        {(!results || (results && results.estado !== 'finalizado')) && (
          <div className="text-center py-10 px-5 bg-white/5 rounded-xl mb-6">
            {results ? (
              <p className="text-gray-300 text-lg">Los resultados aún no están disponibles. Volvé a intentarlo más tarde.</p>
            ) : (
              <p className="text-gray-300 text-lg">No se encontraron resultados para este partido.</p>
            )}
            {awardsStatus === 'insufficient' && (
              <p className="text-orange-400 mt-2 font-bold">No hay suficientes votos para determinar los resultados.</p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-10">
          <button
            onClick={handleBack}
            className="px-6 py-3 rounded-lg  text-xl uppercase tracking-wide text-white bg-gray-600 hover:bg-gray-500 transition-colors shadow-lg"
          >
            Volver
          </button>

          {results && results.estado !== 'finalizado' && (
            <button
              onClick={handleRetry}
              className="px-6 py-3 rounded-lg  text-xl uppercase tracking-wide text-white bg-[#0EA9C6] hover:bg-[#0c90a8] transition-colors shadow-lg"
            >
              Reintentar
            </button>
          )}

          {results && (
            <button
              onClick={handleAnimateBadges}
              className="px-6 py-3 rounded-lg  text-xl uppercase tracking-wide text-black bg-[#FFD700] hover:bg-[#ffc800] transition-transform hover:scale-105 shadow-[0_0_15px_rgba(255,215,0,0.4)] flex items-center justify-center gap-2"
            >
              <span>✨</span> Ver Premiación
            </button>
          )}

          {!results && awardsStatus === 'ready' && (
            <button
              onClick={async () => {
                try {
                  setLoading(true);
                  const res = await ensureAwards(partidoId);
                if (res?.ok && res.row && (res.row.mvp || res.row.golden_glove || res.row.dirty_player || (Array.isArray(res.row.red_cards) && res.row.red_cards.length > 0))) {
                  setResults(res.row);
                  setPreviewPlayers(JSON.parse(JSON.stringify(jugadores)));
                  badgesApplied.current.clear();
                  const slides = prepareCarouselSlides(res.row, jugadores);
                  if (slides.length > 0) {
                    setCarouselSlides(slides);
                    setShowingBadgeAnimations(true);
                  }
                }
              } catch (e) {
                console.error('[RESULTADOS] ensureAwards from CTA failed', e);
              } finally {
                setLoading(false);
              }
              }}
              className="px-6 py-3 rounded-lg text-xl uppercase tracking-wide text-black bg-[#FFD700] hover:bg-[#ffc800] transition-transform hover:scale-105 shadow-[0_0_15px_rgba(255,215,0,0.4)] flex items-center justify-center gap-2"
            >
              <span>✨</span> Ver Premiación
            </button>
          )}
        </div>

        {/* Absences Section */}
        {absences.length > 0 && (
          <div className="mt-8 border-t border-white/10 pt-8">
            <h3 className="text-2xl text-white  mb-6 pl-2 border-l-4 border-red-500">Información de Ausencias</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {absences.map((jugador) => (
                <div key={jugador.uuid} className="bg-black/20 rounded-lg p-3 flex flex-col items-center">
                  <div className="transform scale-90 mb-[-10px]">
                    <ProfileCard
                      profile={jugador}
                      isVisible={true}
                    />
                  </div>
                  <div className="mt-2 text-center text-xs text-gray-400 w-full bg-black/40 py-2 rounded">
                    <p>Ausencias: <span className="text-white font-bold">{jugador.ausenciasCount}</span></p>
                    {jugador.absencePenalty && <span className="text-red-400 block font-bold mt-1">PENALIZADO</span>}
                    {jugador.ineligible && <span className="text-red-600 font-extrabold block mt-1">INELIGIBLE</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ResultadosEncuestaView;
