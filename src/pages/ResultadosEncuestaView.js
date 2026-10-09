import logger from '../utils/logger';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabase';
import { db } from '../api/supabaseWrapper';
import { useAuth } from '../components/AuthProvider';
import LoadingSpinner from '../components/LoadingSpinner';
import PageLoadingState from '../components/PageLoadingState';
import ProfileCard from '../components/ProfileCard';
import StoryLikeCarousel from '../components/StoryLikeCarousel';
import AwardScene from '../components/awards/AwardScene';
import Logo from '../Logo.png';
import { APP_PAGE_TITLE_BASE_CLASS } from '../components/PageTitle';
import { ensureAwards } from '../services/awardsService';
import { ensureSurveyWindowOpen } from '../services/surveyCompletionService';
import { listMatchNoShowSummary } from '../services/db/penalties';
import { subscribeToMatchUpdates } from '../services/realtimeService';
import { getProfile as getLiveProfile } from '../services/db/profiles';
import { fetchPublicProfiles } from '../services/db/publicProfiles';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import { debugNotificationEvent } from '../utils/notificationRouter';
import {
  SURVEY_CHALLENGE_DISABLED_MESSAGE,
  isChallengeLikeTeamMatchRow,
} from '../utils/surveyChallengePolicy';
import {
  AWARDS_STATUS_ERROR,
  hasAnyAwardData,
  isAwardsNotEligibleStatus,
  isAwardsReadyStatus,
  normalizeAwardsStatus,
} from '../utils/awardsReadiness';
import { SURVEY_MIN_VOTERS_FOR_AWARDS } from '../config/surveyConfig';
import { useSmartBackNavigation } from '../hooks/useSmartBackNavigation';
import { useNativeFeatures } from '../hooks/useNativeFeatures';
import { useShareTeamsCard } from '../hooks/useShareTeamsCard';
import {
  buildMatchSummaryShareCardData,
  getWinnerDisplayLabel,
  normalizeResultStatus,
  normalizeWinnerTeam,
} from '../utils/matchSummaryShare';
import { clampPlayerRating } from '../utils/playerRating';
import ShareableMatchSummaryCard from '../components/share/ShareableMatchSummaryCard';
import { buildHomonymHints } from '../utils/surveyRosterIdentity';
import { buildCeremonyEntries, hasSeenCeremony, markCeremonySeen } from '../utils/awardsCeremony';
import { PARTIDO_SELECT } from '../services/db/matchAccessCode';

const ensurePlayersList = (players) => {
  if (players && players.length > 0) return players;
  return [];
};

const DEFAULT_NO_SHOW_PENALTY_DELTA = 0.5;
// Each award plays its sequence in ~2 s and rests briefly before the next one.
const AWARD_SLIDE_MS = 3200;

const isClosedSurveyStatus = (value) => {
  const token = String(value || '').trim().toLowerCase();
  return token === 'closed' || token === 'cerrada';
};

const normalizeAbsenceIdentityToken = (value) => {
  if (value === undefined || value === null) return null;
  const token = String(value).trim();
  return token ? token.toLowerCase() : null;
};

const resolveAbsencePlayerRating = (player, fallback = 5.0) => {
  const parsed = Number.parseFloat(player?.ranking ?? player?.calificacion ?? fallback);
  return clampPlayerRating(Number.isFinite(parsed) ? parsed : fallback, { fallback });
};

export const deriveAbsenceResultsFromSummary = ({
  rosterPlayers = [],
  noShowSummary = [],
} = {}) => {
  const roster = Array.isArray(rosterPlayers) ? rosterPlayers : [];
  const summary = Array.isArray(noShowSummary) ? noShowSummary : [];
  if (roster.length === 0 || summary.length === 0) return [];

  const rosterByKey = new Map();
  roster.forEach((player) => {
    const playerId = Number(player?.id);
    if (Number.isFinite(playerId) && !rosterByKey.has(`player:${playerId}`)) {
      rosterByKey.set(`player:${playerId}`, player);
    }

    [
      player?.usuario_id,
      player?.user_id,
      player?.uuid,
      player?.auth_id,
    ]
      .map((value) => normalizeAbsenceIdentityToken(value))
      .filter(Boolean)
      .forEach((token) => {
        const key = `user:${token}`;
        if (!rosterByKey.has(key)) {
          rosterByKey.set(key, player);
        }
      });
  });

  return summary.map((entry) => {
    const playerId = Number(entry?.playerId);
    const userIdToken = normalizeAbsenceIdentityToken(entry?.userId);
    const rosterPlayer = (
      (Number.isFinite(playerId) ? rosterByKey.get(`player:${playerId}`) : null)
      || (userIdToken ? rosterByKey.get(`user:${userIdToken}`) : null)
      || null
    );

    if (!rosterPlayer) return null;

    const currentRating = resolveAbsencePlayerRating(rosterPlayer);
    const rawPenaltyAmount = Number(entry?.penaltyAmount);
    const penaltyDelta = Number.isFinite(rawPenaltyAmount)
      ? Math.abs(rawPenaltyAmount)
      : (entry?.penaltyApplied ? DEFAULT_NO_SHOW_PENALTY_DELTA : 0);

    // Preferred source: the persisted transition reconstructed by
    // listMatchNoShowSummary from usuarios.ranking + rating_adjustments
    // (base 5.0 penalized by 0.5 shows 5.0 → 4.5). The roster-based guess
    // (current + delta) only remains as fallback for legacy payloads, where
    // a stale roster snapshot could otherwise invent a "before" rating.
    const persistedPre = Number(entry?.prePenaltyRanking);
    const persistedPost = Number(entry?.postPenaltyRanking);
    const hasPersistedTransition = Boolean(entry?.penaltyApplied)
      && Number.isFinite(persistedPre)
      && Number.isFinite(persistedPost);

    const fromRating = clampPlayerRating(hasPersistedTransition
      ? persistedPre
      : (entry?.penaltyApplied ? currentRating + penaltyDelta : currentRating));
    const toRating = clampPlayerRating(hasPersistedTransition ? persistedPost : currentRating);

    return {
      ...rosterPlayer,
      confirmedAbsent: true,
      confirmationCount: Math.max(0, Number(entry?.confirmationCount) || 0),
      penaltyApplied: Boolean(entry?.penaltyApplied),
      absencePenalty: Boolean(entry?.penaltyApplied),
      recoveryApplied: Boolean(entry?.recoveryApplied),
      penaltyAmount: penaltyDelta > 0 ? -penaltyDelta : 0,
      ausenciasCount: Math.max(0, Number(rosterPlayer?.partidos_abandonados ?? rosterPlayer?.pa ?? 0)),
      prePenaltyRanking: Number(fromRating.toFixed(1)),
      penaltyRanking: Number(toRating.toFixed(1)),
    };
  }).filter(Boolean);
};

/**
 * Single source of truth for the penalty slide's "before → after" rating.
 *
 * The on-screen player may be a roster clone that does NOT carry
 * prePenaltyRanking/penaltyRanking — those fields live on the absences entry
 * passed to the slide. Reading the transition from
 * the wrong object made the pill show "5.0 → 5.0" while the bottom label said
 * an impossible above-cap transition. Both now derive from here: penalty
 * fields first (absences entry, then live player), falling back to the live
 * current rating and always respecting the 5.0 ceiling.
 */
export const resolvePenaltyRatingTransition = ({
  penaltyPlayer = null,
  livePlayer = null,
  fallbackRating = 5.0,
} = {}) => {
  const pickFinite = (...values) => {
    for (const value of values) {
      if (value === undefined || value === null || value === '') continue;
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };

  const current = pickFinite(
    penaltyPlayer?.penaltyRanking,
    livePlayer?.penaltyRanking,
    livePlayer?.ranking,
    livePlayer?.calificacion,
    penaltyPlayer?.ranking,
    penaltyPlayer?.calificacion,
  ) ?? fallbackRating;

  const from = clampPlayerRating(
    pickFinite(penaltyPlayer?.prePenaltyRanking, livePlayer?.prePenaltyRanking) ?? current,
  );
  const to = clampPlayerRating(
    pickFinite(penaltyPlayer?.penaltyRanking, livePlayer?.penaltyRanking) ?? from,
  );

  return {
    from,
    to,
    delta: Number(Math.max(0, from - to).toFixed(1)),
  };
};

export const deriveAwardsUiState = ({
  results = null,
  partido = null,
  awardsSkippedByEnsure = false,
  surveyProgress = null,
} = {}) => {
  const toSafeCount = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.trunc(parsed));
  };

  const rawAwardsStatus = results?.awards_status ?? partido?.awards_status ?? null;
  let awardsStatus = awardsSkippedByEnsure
    ? 'not_eligible'
    : (normalizeAwardsStatus(rawAwardsStatus) || 'pending');

  const surveyStatusToken = String(
    surveyProgress?.surveyStatus
      || partido?.survey_status
      || '',
  ).trim().toLowerCase();
  const isSurveyClosed = isClosedSurveyStatus(surveyStatusToken);
  const expectedVoters = toSafeCount(
    surveyProgress?.expectedVoters ?? partido?.survey_expected_voters,
  );
  const submissionsCount = toSafeCount(surveyProgress?.submissionsCount);
  const minimumVotersForAwards = Math.max(1, Math.trunc(Number(SURVEY_MIN_VOTERS_FOR_AWARDS) || 1));
  const hasAwardsPayload = hasAnyAwardData(results) || hasAnyAwardData(partido);
  const isClearlyNotEligibleByVotes = isSurveyClosed && (
    (expectedVoters !== null && expectedVoters < minimumVotersForAwards)
    || (submissionsCount !== null && submissionsCount < minimumVotersForAwards)
  );

  if (awardsStatus === 'pending' && isClearlyNotEligibleByVotes && !hasAwardsPayload) {
    awardsStatus = 'not_eligible';
  }

  if (
    awardsStatus !== 'not_eligible'
    && (
      isAwardsReadyStatus(results)
      || isAwardsReadyStatus(partido)
      || (((results?.results_ready === true) || (partido?.results_ready === true)) && hasAwardsPayload)
    )
  ) {
    awardsStatus = 'ready';
  }
  const hasInsufficientVotesForAwards = awardsStatus === 'not_eligible';
  const awardsReady = awardsStatus === 'ready';
  const hasAwardsError = awardsStatus === AWARDS_STATUS_ERROR;
  return {
    awardsStatus,
    awardsReady,
    hasInsufficientVotesForAwards,
    hasAwardsError,
    shouldShowPendingResultsCard: false,
  };
};

export const deriveCanonicalResultsRow = ({
  results = null,
  surveyProgress = null,
  partido = null,
} = {}) => {
  if (!results || results?.results_ready !== true) return null;

  const surveyClosed = surveyProgress?.hasSurveyStatus
    ? isClosedSurveyStatus(surveyProgress?.surveyStatus)
    : (
      isClosedSurveyStatus(partido?.survey_status)
      || results?.results_ready === true
    );

  return surveyClosed ? results : null;
};

export const deriveCanShowResults = ({
  results = null,
  renderableSlidesCount = 0,
} = {}) => {
  const count = Number(renderableSlidesCount);
  return Boolean(results) && Number.isFinite(count) && count > 0;
};

export const shouldShowAwardsRetryAction = ({
  results = null,
  awardsStatus = null,
  isSurveyClosed = false,
} = {}) => {
  const normalizedAwardsStatus = normalizeAwardsStatus(awardsStatus) || 'pending';
  return Boolean(results)
    && Boolean(isSurveyClosed)
    && normalizedAwardsStatus === 'pending';
};

export const shouldShowSecondaryResultsSections = ({
  awardsStatus = null,
  hasSecondaryResults = false,
} = {}) => (
  Boolean(hasSecondaryResults) || normalizeAwardsStatus(awardsStatus) !== 'not_eligible'
);

export const deriveAwardsPresentationState = ({
  isSurveyClosed = false,
  awardsStatus = null,
  hasRenderableAwardsStory = false,
} = {}) => {
  const normalizedAwardsStatus = normalizeAwardsStatus(awardsStatus) || 'pending';
  const isAwardsError = normalizedAwardsStatus === AWARDS_STATUS_ERROR;
  const shouldShowAwardsUnavailableState = Boolean(
    isSurveyClosed
    && (
      isAwardsError
      || (normalizedAwardsStatus === 'ready' && !hasRenderableAwardsStory)
    )
  );

  const awardsStatusLabel = normalizedAwardsStatus === 'ready'
    ? (shouldShowAwardsUnavailableState ? 'No disponible' : 'Listos para ver')
    : normalizedAwardsStatus === 'not_eligible'
      ? 'No elegible para premios'
      : isAwardsError
        ? 'No disponible'
      : 'En progreso';

  return {
    awardsStatusLabel,
    shouldShowAwardsUnavailableState,
    unavailableTitle: isAwardsError
      ? 'No se pudo calcular la premiación final de este partido.'
      : 'La premiación final no está disponible para este partido.',
    unavailableDescription: isAwardsError
      ? 'Los resultados quedaron cerrados, pero la premiación no pudo resolverse correctamente.'
      : 'Los resultados se muestran sin una historia de premiación.',
    shouldShowPendingResultsCard: false,
  };
};

export const deriveShouldBlockStaticResultsForAwards = ({
  forceAwardsMode = false,
  showingBadgeAnimations = false,
  forcedAwardsFallback = null,
} = {}) => Boolean(
  forceAwardsMode
  && !showingBadgeAnimations
  && !forcedAwardsFallback
);

export const buildForcedAwardsFallback = ({
  row = null,
  reason = '',
} = {}) => {
  const normalizedAwardsStatus = normalizeAwardsStatus(row?.awards_status) || 'pending';
  const normalizedReason = String(reason || '').trim();

  if (normalizedAwardsStatus === 'not_eligible') {
    return {
      title: 'Premiación no disponible',
      message: 'No hubo suficientes votos o no corresponde mostrar una premiación final para este partido.',
      reason: normalizedReason || 'not_eligible',
    };
  }

  if (normalizedAwardsStatus === AWARDS_STATUS_ERROR) {
    return {
      title: 'Premiación no disponible',
      message: 'Los resultados cerraron, pero no pudimos resolver la premiación final de este partido.',
      reason: normalizedReason || 'awards_error',
    };
  }

  if (!row || row?.results_ready !== true) {
    return {
      title: 'Premiación no disponible',
      message: 'La premiación final todavía no está disponible para este partido.',
      reason: normalizedReason || 'results_not_ready',
    };
  }

  return {
    title: 'Premiación no disponible',
    message: 'La premiación final no tiene contenido disponible para mostrar.',
    reason: normalizedReason || 'no_renderable_awards_slides',
  };
};

// --- Final "RESUMEN" slide, aligned with the shareable plaque -----------------
// Same adaptive language as ShareableMatchSummaryCard: 1 award = hero block,
// 2 = stacked rows, 3 = hero + pair, 4 = 2x2 grid. Pure render, no hooks.

const summaryAccent = (color, alpha) => {
  const token = String(color || '').replace('#', '');
  if (token.length !== 6) return `rgba(139,92,255,${alpha})`;
  const r = parseInt(token.slice(0, 2), 16);
  const g = parseInt(token.slice(2, 4), 16);
  const b = parseInt(token.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const SummaryAvatarDisc = ({ award, sizeClass, textClass }) => (
  <div
    className={`relative ${sizeClass} rounded-full overflow-hidden flex items-center justify-center shrink-0`}
    style={{
      border: `2px solid ${summaryAccent(award.color, 0.7)}`,
      background: 'linear-gradient(160deg, rgba(139,92,255,0.35), rgba(20,16,41,0.9))',
      boxShadow: `0 0 16px ${summaryAccent(award.color, 0.3)}`,
    }}
  >
    {award.avatarUrl ? (
      <img src={award.avatarUrl} alt="" draggable={false} className="w-full h-full object-cover" />
    ) : (
      <span className={`font-bebas-real text-white ${textClass}`}>{award.initial || '?'}</span>
    )}
  </div>
);

const SummaryAwardPanel = ({ award, layout, index }) => {
  const panelStyle = {
    border: `1.5px solid ${summaryAccent(award.color, 0.4)}`,
    background: `radial-gradient(240px 120px at 50% -20%, ${summaryAccent(award.color, 0.14)}, transparent 70%), linear-gradient(168deg, rgba(40,31,84,0.66), rgba(16,12,33,0.9))`,
    animation: `slideInUp 650ms ease-out ${index * 90}ms both`,
  };

  if (layout === 'hero') {
    return (
      <div className="flex flex-col items-center text-center gap-2 rounded-2xl px-5 py-5" style={panelStyle}>
        <div className="relative">
          <SummaryAvatarDisc award={award} sizeClass="w-20 h-20" textClass="text-[34px]" />
          <img
            src={award.icon}
            alt=""
            width={36}
            height={36}
            draggable={false}
            className="absolute -right-2.5 -bottom-1"
            style={{ filter: `drop-shadow(0 0 10px ${award.color})` }}
          />
        </div>
        <div className="font-bebas-real text-[17px] tracking-[0.14em] leading-none mt-1" style={{ color: award.color }}>
          {award.awardName}
        </div>
        <div className="text-[20px] text-white font-bold leading-tight truncate max-w-full">
          {award.playerName}
        </div>
      </div>
    );
  }

  if (layout === 'row') {
    return (
      <div className="flex items-center gap-3.5 rounded-2xl px-4 py-3.5" style={panelStyle}>
        <SummaryAvatarDisc award={award} sizeClass="w-14 h-14" textClass="text-[24px]" />
        <div className="min-w-0 flex-1 text-left">
          <div className="font-bebas-real text-[14px] tracking-[0.12em] leading-none" style={{ color: award.color }}>
            {award.awardName}
          </div>
          <div className="text-[17px] text-white font-bold leading-tight truncate mt-1">
            {award.playerName}
          </div>
        </div>
        <img
          src={award.icon}
          alt=""
          width={34}
          height={34}
          draggable={false}
          className="shrink-0"
          style={{ filter: `drop-shadow(0 0 10px ${award.color})` }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center text-center gap-1.5 rounded-2xl px-3 py-3.5 min-w-0" style={panelStyle}>
      <div className="relative">
        <SummaryAvatarDisc award={award} sizeClass="w-12 h-12" textClass="text-[20px]" />
        <img
          src={award.icon}
          alt=""
          width={24}
          height={24}
          draggable={false}
          className="absolute -right-1.5 -bottom-0.5"
          style={{ filter: `drop-shadow(0 0 8px ${award.color})` }}
        />
      </div>
      <div className="font-bebas-real text-[12.5px] tracking-[0.1em] leading-none mt-0.5" style={{ color: award.color }}>
        {award.awardName}
      </div>
      <div className="text-[14.5px] text-white font-bold leading-tight truncate w-full">
        {award.playerName}
      </div>
    </div>
  );
};

const SummaryAwardsMosaic = ({ awards }) => {
  const blocks = (awards || []).slice(0, 4);
  if (blocks.length === 0) return null;

  if (blocks.length === 1) {
    return <SummaryAwardPanel award={blocks[0]} layout="hero" index={0} />;
  }

  if (blocks.length === 2) {
    return (
      <div className="flex flex-col gap-3">
        {blocks.map((award, index) => (
          <SummaryAwardPanel key={award.awardName} award={award} layout="row" index={index} />
        ))}
      </div>
    );
  }

  if (blocks.length === 3) {
    return (
      <div className="flex flex-col gap-3">
        <SummaryAwardPanel award={blocks[0]} layout="hero" index={0} />
        <div className="grid grid-cols-2 gap-3">
          <SummaryAwardPanel award={blocks[1]} layout="tile" index={1} />
          <SummaryAwardPanel award={blocks[2]} layout="tile" index={2} />
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {blocks.map((award, index) => (
        <SummaryAwardPanel key={award.awardName} award={award} layout="tile" index={index} />
      ))}
    </div>
  );
};


// fecha is a date-only column and hora a wall-clock time: parsing fecha alone as a Date reads
// it as UTC midnight and shows the previous day in Argentina.
const formatMatchWallClock = (fecha, hora) => {
  const day = String(fecha || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const time = String(hora || '').trim().replace('.', ':').match(/^(\d{1,2}):(\d{2})/);
  const date = new Date(`${day}T${time ? `${time[1].padStart(2, '0')}:${time[2]}` : '00:00'}:00`);
  return date.toLocaleString('es-ES', time ? { dateStyle: 'full', timeStyle: 'short' } : { dateStyle: 'full' });
};

const ResultadosEncuestaView = () => {
  const { partidoId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const goBackSmart = useSmartBackNavigation({
    fallback: '/',
  });
  const { isNative } = useNativeFeatures();
  const {
    isSharing: isSharingSummary,
    shareTeamsCard: shareSummaryCard,
    cardData: summaryShareCardData,
    cardRef: summaryShareCardRef,
  } = useShareTeamsCard({ isNative });
  const searchParams = new URLSearchParams(location.search);
  const showAwardsParam = searchParams.get('showAwards');
  const forceAwardsParam = searchParams.get('forceAwards');
  const forceAwardsMode =
    Boolean(location?.state?.forceAwards) ||
    forceAwardsParam === 'true' ||
    showAwardsParam === '1';
  const getResultsPageDebugPayload = useCallback((extra = {}) => ({
    source: 'resultados_encuesta_view',
    partido_id: partidoId || null,
    match_id: partidoId || null,
    force_awards_mode: forceAwardsMode,
    showAwards: showAwardsParam || null,
    forceAwards: forceAwardsParam || null,
    current_route: `${location.pathname}${location.search}${location.hash || ''}`,
    location_state: location?.state || null,
    ...extra,
  }), [forceAwardsMode, forceAwardsParam, location.hash, location.pathname, location.search, location?.state, partidoId, showAwardsParam]);

  const [loading, setLoading] = useState(true);
  const [partido, setPartido] = useState(null);
  const [results, setResults] = useState(null);
  const [surveyUnavailableMessage, setSurveyUnavailableMessage] = useState('');
  const [jugadores, setJugadores] = useState([]);
  const [surveyProgress, setSurveyProgress] = useState({
    surveyStatus: 'open',
    hasSurveyStatus: false,
    expectedVoters: 0,
    submissionsCount: 0,
    remainingVotes: 0,
    deadlineAt: null,
  });
  const [showingBadgeAnimations, setShowingBadgeAnimations] = useState(false);
  const [autoOpeningAwards, setAutoOpeningAwards] = useState(false);
  const [forcedAwardsFallback, setForcedAwardsFallback] = useState(null);
  const [awardsSkippedByEnsure, setAwardsSkippedByEnsure] = useState(false);
  const [_badgeAnimations, setBadgeAnimations] = useState([]);
  const [_currentAnimationIndex, _setCurrentAnimationIndex] = useState(0);
  const [_animationComplete, _setAnimationComplete] = useState(false);
  const [absences, setAbsences] = useState([]);
  const [carouselSlides, setCarouselSlides] = useState([]);
  // Backend-confirmed awards (player_awards) of this match's winners and their public
  // profiles, so the ceremony shows real counters only.
  const [awardFacts, setAwardFacts] = useState({ rows: [], profiles: {} });
  const penaltyListRef = useRef([]);
  const forceStoryOpenedRef = useRef(null);
  const autoAwardsOpenedRef = useRef(null);
  const autoOpenGuardRef = useRef(null);
  const pendingRetryAttemptedRef = useRef(new Set());
  const resultsGateRedirectRef = useRef(null);
  const {
    awardsStatus,
    awardsReady,
  } = deriveAwardsUiState({
    results,
    partido,
    awardsSkippedByEnsure,
    surveyProgress,
  });

  const clearAutoOpenGuard = () => {
    if (autoOpenGuardRef.current) {
      clearTimeout(autoOpenGuardRef.current);
      autoOpenGuardRef.current = null;
    }
  };

  // ✅ Helpers
  const toRating = (p, fallback = 5.0) => {
    const n = parseFloat(p?.ranking ?? p?.calificacion ?? fallback);
    return Number.isFinite(n) ? n : fallback;
  };

  const clamp1 = (v) => clampPlayerRating(v);
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

  const pickDefined = (...values) => values.find((value) => value !== undefined && value !== null);
  const pickText = (...values) => values.find((value) => typeof value === 'string' && value.trim().length > 0);
  const pickPresent = (...values) => values.find((value) => (
    value !== undefined
    && value !== null
    && !(typeof value === 'string' && value.trim().length === 0)
  ));
  const pickFiniteNumber = (...values) => {
    for (const value of values) {
      if (value === undefined || value === null || value === '') continue;
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  const IDENTITY_KEYS_BY_PRIORITY = ['usuario_id', 'user_id', 'uuid', 'auth_id', 'player_id', 'id'];
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const normalizeIdentityToken = (value) => {
    if (value === undefined || value === null) return null;
    const token = String(value).trim();
    if (!token) return null;
    return token.toLowerCase();
  };
  const getIdentityTokens = (valueOrEntity) => {
    if (valueOrEntity === undefined || valueOrEntity === null) return [];
    if (typeof valueOrEntity !== 'object') {
      const token = normalizeIdentityToken(valueOrEntity);
      return token ? [token] : [];
    }
    const tokens = IDENTITY_KEYS_BY_PRIORITY
      .map((key) => normalizeIdentityToken(valueOrEntity?.[key]))
      .filter(Boolean);
    return Array.from(new Set(tokens));
  };
  const getPrimaryIdentity = (entity) => getIdentityTokens(entity)[0] || null;
  // A winner is stored by an ID (account or roster uuid); its name comes from the roster,
  // with the hint that tells homonyms apart.
  const highlightNameFor = (winnerId) => {
    if (!winnerId) return null;
    const roster = Array.isArray(jugadores) ? jugadores : [];
    const winner = roster.find((player) => getIdentityTokens(player).includes(normalizeIdentityToken(winnerId)));
    if (!winner?.nombre) return null;
    return [winner.nombre, buildHomonymHints(roster).get(winner.uuid)].filter(Boolean).join(' · ');
  };
  const sharesIdentity = (entityA, entityBOrValue) => {
    const left = new Set(getIdentityTokens(entityA));
    const right = getIdentityTokens(entityBOrValue);
    return right.some((token) => left.has(token));
  };
  const collectProfileIdsForLookup = (players = []) => {
    const ids = [];
    (Array.isArray(players) ? players : []).forEach((player) => {
      const candidateValues = IDENTITY_KEYS_BY_PRIORITY.map((key) => player?.[key]);
      candidateValues.forEach((value) => {
        const token = String(value || '').trim();
        if (token && UUID_REGEX.test(token)) ids.push(token);
      });
    });
    return Array.from(new Set(ids));
  };
  const normalizeCountryCode = (value) => {
    const token = String(value || '').trim().toUpperCase();
    if (!token) return null;
    if (token.length === 2) return token;
    const from3 = {
      ARG: 'AR',
      BRA: 'BR',
      URY: 'UY',
      CHL: 'CL',
      COL: 'CO',
      PER: 'PE',
    };
    if (from3[token]) return from3[token];
    const fromName = {
      ARGENTINA: 'AR',
      BRASIL: 'BR',
      BRAZIL: 'BR',
      URUGUAY: 'UY',
      CHILE: 'CL',
      COLOMBIA: 'CO',
      PERU: 'PE',
      PERÚ: 'PE',
    };
    return fromName[token] || null;
  };

  const mergeRosterPlayerWithUser = (player, userRow, profileRow, liveProfileRow = null) => {
    if (!player) return normalizeBadges(player);
    if (!liveProfileRow && !userRow && !profileRow) return normalizeBadges(player);

    const canonicalProfile = liveProfileRow || userRow || profileRow || {};

    const liveUserId = pickText(canonicalProfile?.id, userRow?.id, profileRow?.id);
    const liveName = pickText(canonicalProfile?.nombre, userRow?.nombre, profileRow?.nombre);
    const liveAvatarUrl = pickText(
      canonicalProfile?.avatar_url,
      canonicalProfile?.foto_url,
      userRow?.avatar_url,
      profileRow?.avatar_url,
      userRow?.foto_url,
      profileRow?.foto_url,
    );
    const livePos = pickText(
      canonicalProfile?.posicion,
      canonicalProfile?.posicion_favorita,
      canonicalProfile?.rol_favorito,
      userRow?.posicion,
      userRow?.posicion_favorita,
      userRow?.rol_favorito,
      profileRow?.posicion,
      profileRow?.posicion_favorita,
      profileRow?.rol_favorito,
    );
    const liveRol = pickText(
      canonicalProfile?.rol_favorito,
      canonicalProfile?.posicion_favorita,
      canonicalProfile?.posicion,
      userRow?.rol_favorito,
      userRow?.posicion_favorita,
      userRow?.posicion,
      profileRow?.rol_favorito,
      profileRow?.posicion_favorita,
      profileRow?.posicion,
    );
    const livePj = pickFiniteNumber(
      canonicalProfile?.partidos_jugados,
      canonicalProfile?.pj,
      canonicalProfile?.played_matches,
      userRow?.partidos_jugados,
      userRow?.pj,
      profileRow?.partidos_jugados,
      profileRow?.pj,
    );
    const livePa = pickFiniteNumber(
      canonicalProfile?.partidos_abandonados,
      canonicalProfile?.pa,
      userRow?.partidos_abandonados,
      userRow?.pa,
      profileRow?.partidos_abandonados,
      profileRow?.pa,
    );
    const liveRanking = pickPresent(
      canonicalProfile?.ranking,
      canonicalProfile?.calificacion,
      canonicalProfile?.rating,
      userRow?.ranking,
      userRow?.calificacion,
      profileRow?.ranking,
      profileRow?.calificacion,
      player?.ranking,
      player?.calificacion,
    );
    const liveCountry = normalizeCountryCode(
      pickText(
        canonicalProfile?.pais_codigo,
        canonicalProfile?.nacionalidad,
        canonicalProfile?.country_code,
        canonicalProfile?.pais,
        userRow?.pais_codigo,
        userRow?.nacionalidad,
        profileRow?.pais_codigo,
        profileRow?.nacionalidad,
      ),
    ) || 'AR';
    const liveFoot = pickText(
      canonicalProfile?.pierna_habil,
      canonicalProfile?.pierna_hábil,
      canonicalProfile?.foot,
      userRow?.pierna_habil,
      profileRow?.pierna_habil,
    ) || null;
    const liveLevel = pickPresent(
      canonicalProfile?.nivel,
      canonicalProfile?.nivel_autopercibido,
      canonicalProfile?.self_perceived_level,
      userRow?.nivel,
      userRow?.nivel_autopercibido,
      profileRow?.nivel,
      profileRow?.nivel_autopercibido,
    );
    const liveAcceptsInvites = pickDefined(
      canonicalProfile?.acepta_invitaciones,
      userRow?.acepta_invitaciones,
      profileRow?.acepta_invitaciones,
    );
    const liveMvp = pickDefined(
      canonicalProfile?.mvp_badges,
      canonicalProfile?.mvps,
      userRow?.mvp_badges,
      userRow?.mvps,
      profileRow?.mvp_badges,
      profileRow?.mvps,
      0,
    );
    const liveGk = pickDefined(
      canonicalProfile?.gk_badges,
      canonicalProfile?.guantes_dorados,
      userRow?.gk_badges,
      userRow?.guantes_dorados,
      profileRow?.gk_badges,
      profileRow?.guantes_dorados,
      0,
    );
    const liveRed = pickDefined(
      canonicalProfile?.red_badges,
      canonicalProfile?.tarjetas_rojas,
      userRow?.red_badges,
      userRow?.tarjetas_rojas,
      profileRow?.red_badges,
      profileRow?.tarjetas_rojas,
      0,
    );

    return normalizeBadges({
      ...player,
      usuario_id: pickText(liveUserId, player?.usuario_id, player?.user_id, player?.auth_id) || null,
      user_id: pickText(player?.user_id, liveUserId, player?.usuario_id, player?.auth_id) || null,
      auth_id: pickText(player?.auth_id, liveUserId, player?.usuario_id, player?.user_id) || null,
      uuid: pickText(player?.uuid, player?.usuario_id, player?.user_id, liveUserId) || null,
      nombre: liveName || 'Jugador',
      avatar_url: liveAvatarUrl || null,
      foto_url: liveAvatarUrl || null,
      posicion: pickText(
        livePos,
        liveRol,
      ) || null,
      rol_favorito: pickText(
        liveRol,
        livePos,
      ) || null,
      partidos_jugados: livePj ?? 0,
      partidos_abandonados: livePa ?? 0,
      ranking: clampPlayerRating(liveRanking ?? 5.0),
      pais_codigo: liveCountry,
      pierna_habil: liveFoot,
      nivel: liveLevel ?? null,
      acepta_invitaciones: pickDefined(liveAcceptsInvites, player?.acepta_invitaciones),
      mvp_badges: pickDefined(player?.mvp_badges, player?.mvps, liveMvp, 0),
      gk_badges: pickDefined(player?.gk_badges, player?.guantes_dorados, liveGk, 0),
      red_badges: pickDefined(player?.red_badges, player?.tarjetas_rojas, liveRed, 0),
      mvps: pickDefined(player?.mvps, player?.mvp_badges, liveMvp, 0),
      guantes_dorados: pickDefined(player?.guantes_dorados, player?.gk_badges, liveGk, 0),
      tarjetas_rojas: pickDefined(player?.tarjetas_rojas, player?.red_badges, liveRed, 0),
    });
  };

  const enrichRosterWithUserProfiles = useCallback(async (players = []) => {
    const roster = (Array.isArray(players) ? players : []).map(normalizeBadges);
    if (roster.length === 0) return [];

    const profileIds = collectProfileIdsForLookup(roster);
    if (profileIds.length === 0) return roster;

    try {
      // Public profiles only (private columns are not readable by other accounts).
      let safeUsers = [];
      try {
        safeUsers = await fetchPublicProfiles(profileIds);
      } catch (_usersError) {
        safeUsers = [];
      }

      let profilesData = [];
      try {
        // Public columns only (profiles.telefono is private data), and only the ones Core
        // Production's profiles has (no posicion/ciudad there).
        const { data: profilesRows } = await supabase
          .from('profiles')
          .select('id, nombre, avatar_url')
          .in('id', profileIds);
        profilesData = Array.isArray(profilesRows) ? profilesRows : [];
      } catch (_profilesFallbackErr) {
        profilesData = [];
      }

      const liveProfileIds = Array.from(new Set(
        (safeUsers || [])
          .map((row) => String(row?.id || '').trim())
          .filter(Boolean),
      ));
      const liveProfilesResolved = await Promise.all(liveProfileIds.map(async (profileId) => {
        try {
          const liveProfile = await getLiveProfile(profileId);
          return liveProfile ? [String(profileId), liveProfile] : null;
        } catch (_liveProfileErr) {
          return null;
        }
      }));
      const liveProfilesById = new Map(liveProfilesResolved.filter(Boolean));

      if (
        safeUsers.length === 0
        && profilesData.length === 0
        && liveProfilesById.size === 0
      ) {
        return roster;
      }

      const usersById = new Map((safeUsers || []).map((row) => [String(row?.id), row]));
      const profilesById = new Map((profilesData || []).map((row) => [String(row?.id), row]));
      return roster.map((player) => {
        const playerIds = collectProfileIdsForLookup([player]);
        const userRow = playerIds.map((id) => usersById.get(id)).find(Boolean) || null;
        const profileRow = playerIds.map((id) => profilesById.get(id)).find(Boolean) || null;
        const liveProfileRow = playerIds.map((id) => liveProfilesById.get(id)).find(Boolean) || null;
        return mergeRosterPlayerWithUser(player, userRow, profileRow, liveProfileRow);
      });
    } catch (_enrichError) {
      return roster;
    }
  }, []);

  const computeSurveyProgress = useCallback(async ({ matchIdNum, partidoRow, rosterRows = [] }) => {
    try {
      const canonicalProgress = await ensureSurveyWindowOpen(matchIdNum, {
        persistLifecycle: false,
      });
      const surveyStatusToken = String(canonicalProgress?.surveyStatus || '').trim().toLowerCase();
      const hasSurveyStatus = surveyStatusToken === 'open' || surveyStatusToken === 'closed';

      return {
        surveyStatus: hasSurveyStatus ? surveyStatusToken : 'open',
        hasSurveyStatus,
        expectedVoters: Math.max(0, Number(canonicalProgress?.expectedVoters) || 0),
        submissionsCount: Math.max(0, Number(canonicalProgress?.submittedVoters) || 0),
        remainingVotes: Math.max(0, Number(canonicalProgress?.remainingVotes) || 0),
        deadlineAt: canonicalProgress?.closesAt || null,
      };
    } catch (_canonicalProgressError) {
      // Fallback to local derivation only if the canonical helper is unavailable.
    }

    let roster = Array.isArray(rosterRows) ? rosterRows : [];
    if (roster.length === 0) {
      const { data: rosterData, error: rosterError } = await supabase
        .from('jugadores')
        .select('id, usuario_id')
        .eq('partido_id', matchIdNum);
      if (!rosterError) {
        roster = rosterData || [];
      }
    }

    const eligibleByPlayerId = new Map();
    const eligibleUserIds = new Set();
    (roster || []).forEach((row) => {
      const playerId = Number(row?.id);
      const userId = row?.usuario_id || null;
      if (!Number.isFinite(playerId) || !userId) return;
      eligibleByPlayerId.set(playerId, String(userId));
      eligibleUserIds.add(String(userId));
    });

    const expectedFromPartido = Number(partidoRow?.survey_expected_voters);
    const expectedVoters = Number.isFinite(expectedFromPartido) && expectedFromPartido >= 0
      ? Math.max(expectedFromPartido, eligibleUserIds.size)
      : eligibleUserIds.size;

    let submissionsCount = 0;
    try {
      const { data: surveysRows, error: surveysErr } = await supabase
        .from('post_match_surveys')
        .select('votante_id')
        .eq('partido_id', matchIdNum);
      if (!surveysErr) {
        const submittedUsers = new Set();
        (surveysRows || []).forEach((row) => {
          const voterId = Number(row?.votante_id);
          if (!Number.isFinite(voterId)) return;
          const userId = eligibleByPlayerId.get(voterId);
          if (!userId) return;
          submittedUsers.add(String(userId));
        });
        submissionsCount = submittedUsers.size;
      }
    } catch (_progressErr) {
      submissionsCount = 0;
    }

    const surveyStatusToken = String(partidoRow?.survey_status || '').trim().toLowerCase();
    const hasSurveyStatus = surveyStatusToken === 'open' || surveyStatusToken === 'closed';
    const surveyStatus = hasSurveyStatus
      ? surveyStatusToken
      : 'open';

    return {
      surveyStatus,
      hasSurveyStatus,
      expectedVoters,
      submissionsCount,
      remainingVotes: Math.max(expectedVoters - submissionsCount, 0),
      deadlineAt: partidoRow?.survey_closes_at || null,
    };
  }, []);

  const computeCanonicalAbsences = useCallback(async ({ matchIdNum, rosterPlayers = [] }) => {
    const id = Number(matchIdNum);
    if (!Number.isFinite(id) || id <= 0) return [];

    try {
      const { data, error } = await listMatchNoShowSummary(id);
      if (error) throw error;
      return deriveAbsenceResultsFromSummary({
        rosterPlayers,
        noShowSummary: data || [],
      });
    } catch (error) {
      logger.warn('[RESULTADOS] canonical no-show summary unavailable', error);
      return [];
    }
  }, []);

  // The awards of the match, straight from the results row: one entry per award with its
  // winner from the roster. [] when there is nothing to present.
  const collectAwardSlides = (currentResults = results, currentPlayers = jugadores) => {
    if (!currentResults) return [];

    const roster = ensurePlayersList(currentPlayers);
    const findP = (id) => (id ? roster.find((j) => sharesIdentity(j, id)) || null : null);
    const awardsObj = currentResults?.awards || {};
    const slides = [];
    const pushAward = (type, player, votes) => {
      if (player) slides.push({ key: type, type, player, votes: Number(votes) || 0 });
    };

    pushAward(
      'mvp',
      findP(currentResults?.mvp ?? awardsObj?.mvp?.player_id ?? null),
      currentResults.mvp_votes || awardsObj?.mvp?.votes,
    );
    pushAward(
      'best_gk',
      findP(currentResults?.golden_glove ?? awardsObj?.best_gk?.player_id ?? null),
      currentResults.golden_glove_votes || awardsObj?.best_gk?.votes,
    );
    const dirtyId = currentResults.dirty_player
      || (Array.isArray(currentResults.red_cards) ? currentResults.red_cards[0] : null)
      || awardsObj?.red_card?.player_id;
    pushAward(
      'red_card',
      findP(dirtyId),
      currentResults.dirty_player_fouls || currentResults.red_card_votes || awardsObj?.red_card?.votes,
    );

    const penalized = absences.find((entry) => entry?.penaltyApplied);
    if (penalized) {
      const { from, to } = resolvePenaltyRatingTransition({ penaltyPlayer: penalized });
      slides.push({
        key: 'penalty',
        type: 'penalty',
        player: penalized,
        votes: 0,
        penalty: { from: fmt1(from), to: fmt1(to) },
      });
    }

    return slides;
  };

  // Each award slide renders from the latest confirmed data (counters arrive after the
  // slides are built), so the scene reads it through a ref.
  const awardSceneDataRef = useRef({});
  awardSceneDataRef.current = { awardFacts, userId: user?.id || null, jugadores };
  const renderAwardScene = (award) => {
    const { awardFacts: facts, userId, jugadores: roster } = awardSceneDataRef.current;
    const [entry] = buildCeremonyEntries({
      slides: [award],
      matchId: partidoId,
      currentUserId: userId,
      awardRows: facts?.rows || [],
      profilesById: facts?.profiles || {},
      hints: buildHomonymHints(ensurePlayersList(roster)),
    });
    return entry ? <AwardScene entry={entry} /> : null;
  };

  const prepareCarouselSlides = (currentResults = results, currentPlayers = jugadores) => {
    if (!currentResults) return [];
    const awardSlides = collectAwardSlides(currentResults, currentPlayers);
    if (awardSlides.length === 0) return [];

    const roster = ensurePlayersList(currentPlayers);
    const matchInfo = partido || { nombre: `Partido ${partidoId}`, fecha: new Date().toISOString(), awards_status: 'pending' };

    const findP = (id) => {
      if (!id) return null;
      return roster.find((j) => sharesIdentity(j, id));
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
              {matchInfo.nombre || matchInfo.titulo || `Partido ${partidoId}`}
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

    // One slide per award: presentation, winner card, trophy reveal and impact on the card.
    awardSlides.forEach((award) => {
      slides.push({
        key: award.key,
        duration: AWARD_SLIDE_MS,
        content: () => renderAwardScene(award),
      });
    });

    const dirtyId = currentResults.dirty_player
      || (Array.isArray(currentResults.red_cards) ? currentResults.red_cards[0] : null)
      || dirtyWinnerIdFromAwards;
    const penalized = (() => {
      const first = absences.find((a) => a.penaltyApplied);
      return first ? { player: first, playerId: getPrimaryIdentity(first) } : null;
    })();

    // RESUMEN FINAL: Última slide siempre
    const summaryBlockFor = (player, awardName, icon, color) => ({
      awardName,
      playerName: player?.nombre || 'Jugador',
      icon,
      color,
      avatarUrl: player?.avatar_url || player?.foto_url || null,
      initial: (String(player?.nombre || '').trim().charAt(0) || '?').toUpperCase(),
    });

    const summaryAwards = [];

    const mvpPlayer = mvpWinnerId ? findP(mvpWinnerId) : null;
    if (mvpPlayer) {
      summaryAwards.push(summaryBlockFor(mvpPlayer, 'MVP', '/mvp_award.webp', '#FFD700'));
    }

    const glovePlayer = gloveWinnerId ? findP(gloveWinnerId) : null;
    if (glovePlayer) {
      summaryAwards.push(summaryBlockFor(glovePlayer, 'MEJOR ARQUERO', '/goalkeeper_award.webp', '#22d3ee'));
    }

    const dirtyPlayer = dirtyId ? findP(dirtyId) : null;
    if (dirtyPlayer) {
      summaryAwards.push(summaryBlockFor(dirtyPlayer, 'MÁS SUCIO', '/redcard_award.webp', '#f87171'));
    }

    if (penalized?.player) {
      summaryAwards.push(summaryBlockFor(penalized.player, 'PENALIZACIÓN', '/penalizacion.webp', '#FDBA74'));
    }

    if (summaryAwards.length === 0) {
      return [];
    }

    // Real recorded result only (never invented): compact chip under the title.
    const summaryResultStatus = normalizeResultStatus(currentResults?.result_status);
    const summaryWinnerTeam = normalizeWinnerTeam(currentResults?.winner_team);
    const summaryResultLabel = summaryResultStatus === 'finished' && summaryWinnerTeam
      ? getWinnerDisplayLabel(matchInfo, summaryWinnerTeam, roster)
      : (summaryResultStatus === 'draw' ? 'EMPATE' : null);
    const summaryMatchName = String(matchInfo?.nombre || matchInfo?.titulo || '').trim();

    slides.push({
      key: 'summary',
      duration: 9000,
      content: (
        <div
          className="relative w-full h-full flex flex-col items-center px-6 md:px-10"
          style={{
            background: 'linear-gradient(135deg,#070B18 0%,#0F1419 50%,#070B18 100%)',
            // Same chrome rule as the award slides: the title always clears the
            // progress bars / close button instead of centering underneath them.
            paddingTop: 'max(52px, calc(env(safe-area-inset-top) + 30px))',
            // Bottom room for the "Compartir resumen" CTA + home indicator.
            paddingBottom: 'max(92px, calc(env(safe-area-inset-bottom) + 84px))',
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

          <div className="relative z-10 w-full flex-1 min-h-0 flex flex-col items-center">
            <div className="text-center mb-4 shrink-0">
              <div className="font-bebas-real text-[52px] md:text-[72px] leading-[0.9] text-white" style={{ animation: 'eaTitleIn 760ms cubic-bezier(.2,.9,.2,1) both', textShadow: '0 0 22px rgba(14,169,198,0.5)' }}>
                RESUMEN
              </div>
              <div className="text-white/70 tracking-[0.35em] text-xs md:text-sm mt-2" style={{ animation: 'eaSubIn 680ms ease-out both' }}>
                DEL PARTIDO
              </div>
              {summaryMatchName ? (
                <div className="text-[#cfc4ff] text-[15px] md:text-base font-oswald font-bold mt-2 truncate max-w-[78vw] mx-auto" style={{ animation: 'eaSubIn 680ms ease-out 120ms both' }}>
                  {summaryMatchName}
                </div>
              ) : null}
              {summaryResultLabel ? (
                <div
                  className="inline-flex items-center px-4 py-1.5 mt-2.5 rounded-full font-bebas-real text-[16px] tracking-[0.08em]"
                  style={{
                    color: '#f5c451',
                    border: '1px solid rgba(245,196,81,0.45)',
                    background: 'rgba(245,196,81,0.1)',
                    textShadow: '0 0 14px rgba(245,196,81,0.4)',
                    animation: 'eaSubIn 680ms ease-out 180ms both',
                  }}
                >
                  {summaryResultLabel}
                </div>
              ) : null}
            </div>

            {/* Placa-style mosaic (mirrors the shareable piece): hero for one
                award, stacked rows for two, hero + pair for three, 2x2 grid
                for four. Compact enough to fit under the pinned title on
                short phones (the title must never get pushed into the bars). */}
            <div className="w-full max-w-[680px] flex-1 min-h-0 flex flex-col justify-center">
              <SummaryAwardsMosaic awards={summaryAwards} />
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

  const canonicalResults = deriveCanonicalResultsRow({
    results,
    surveyProgress,
    partido,
  });
  const renderableResultsSlidesCount = canonicalResults
    ? prepareCarouselSlides(canonicalResults, jugadores).length
    : 0;
  const hasRenderableResultsContent = deriveCanShowResults({
    results: canonicalResults,
    renderableSlidesCount: renderableResultsSlidesCount,
  });
  const canShowResults = hasRenderableResultsContent || (forceAwardsMode && Boolean(canonicalResults));
  const shouldBlockStaticResultsForAwards = deriveShouldBlockStaticResultsForAwards({
    forceAwardsMode,
    showingBadgeAnimations,
    forcedAwardsFallback,
  });

  useEffect(() => {
    let alive = true;

    const fetchResultsData = async () => {
      debugNotificationEvent('RESULTS_PAGE_LOAD_START', getResultsPageDebugPayload({
        stage: 'effect_start',
        has_user: Boolean(user),
        loading,
      }));
      if (!partidoId) {
        debugNotificationEvent('RESULTS_PAGE_LOAD_ERROR', getResultsPageDebugPayload({
          stage: 'missing_partido_id',
          reason: 'missing_partido_id',
        }));
        if (alive) {
          setPartido(null);
          setResults(null);
          setSurveyUnavailableMessage('');
          setJugadores([]);
          setAbsences([]);
          setLoading(false);
        }
        return;
      }

      if (!user) {
        debugNotificationEvent('RESULTS_PAGE_LOAD_ERROR', getResultsPageDebugPayload({
          stage: 'missing_user',
          reason: 'missing_user',
        }));
        if (alive) {
          setPartido(null);
          setResults(null);
          setJugadores([]);
          setAbsences([]);
          setLoading(false);
        }
        return;
      }

      try {
        if (alive) {
          setLoading(true);
          setAwardsSkippedByEnsure(false);
          setForcedAwardsFallback(null);
          setPartido(null);
          setResults(null);
          setJugadores([]);
          setAbsences([]);
          setSurveyProgress({
            surveyStatus: 'open',
            hasSurveyStatus: false,
            expectedVoters: 0,
            submissionsCount: 0,
            remainingVotes: 0,
            deadlineAt: null,
          });
        }

        const matchIdNum = Number(partidoId);

        let partidoData;
        try {
          partidoData = await db.fetchOne('partidos', { id: matchIdNum });
        } catch (error) {
          debugNotificationEvent('RESULTS_PAGE_LOAD_ERROR', getResultsPageDebugPayload({
            stage: 'partido_fetch_exception',
            reason: 'partido_fetch_exception',
            match_id_numeric: matchIdNum,
            error: error?.message || String(error || ''),
          }));
          if (alive) {
            notifyBlockingError('Partido no encontrado');
            navigate('/');
          }
          return;
        }

        if (!partidoData) {
          debugNotificationEvent('RESULTS_PAGE_LOAD_ERROR', getResultsPageDebugPayload({
            stage: 'partido_not_found',
            reason: 'partido_not_found',
            match_id_numeric: matchIdNum,
          }));
          if (alive) {
            notifyBlockingError('Partido no encontrado');
            setLoading(false);
          }
          return;
        }

        if (!alive) return;
        setPartido(partidoData);

        let teamMatchRow = null;
        try {
          const { data } = await supabase
            .from('team_matches')
            .select('id, origin_type, challenge_id')
            .eq('partido_id', matchIdNum)
            .maybeSingle();
          teamMatchRow = data || null;
        } catch (_teamMatchError) {
          teamMatchRow = null;
        }

        if (isChallengeLikeTeamMatchRow(teamMatchRow)) {
          debugNotificationEvent('RESULTS_PAGE_LOAD_ERROR', getResultsPageDebugPayload({
            stage: 'challenge_survey_disabled',
            reason: 'surveys_disabled_for_challenges',
            match_id_numeric: matchIdNum,
            team_match_id: teamMatchRow?.id || null,
          }));
          if (alive) {
            setSurveyUnavailableMessage(SURVEY_CHALLENGE_DISABLED_MESSAGE);
            setResults(null);
            setJugadores([]);
            setAbsences([]);
          }
          return;
        }

        // Fetch players explicitly
        const { data: playersData } = await supabase
          .from('jugadores')
          .select('*')
          .eq('partido_id', matchIdNum);
        debugNotificationEvent('RESULTS_PAGE_LOAD_START', getResultsPageDebugPayload({
          stage: 'players_loaded',
          match_id_numeric: matchIdNum,
          players_count: Array.isArray(playersData) ? playersData.length : null,
        }));

        if (!alive) return;

        const rosterPlayers = await enrichRosterWithUserProfiles(playersData || []);
        if (!alive) return;

        if (rosterPlayers.length > 0) {
          setJugadores(rosterPlayers);
          // Patch partidoData to include players for compatibility with existing code if needed
          partidoData.jugadores = rosterPlayers;
        }

        const canonicalAbsences = await computeCanonicalAbsences({
          matchIdNum,
          rosterPlayers,
        });
        if (alive) {
          setAbsences(canonicalAbsences);
        }

        const progress = await computeSurveyProgress({
          matchIdNum,
          partidoRow: partidoData,
          rosterRows: rosterPlayers,
        });
        if (alive) {
          setSurveyProgress(progress);
        }

        const { data: resultsData, error: resultsError } = await supabase
          .from('survey_results')
          .select('*')
          .eq('partido_id', matchIdNum)
          .single();

        if (resultsError && resultsError.code !== 'PGRST116') {
          debugNotificationEvent('RESULTS_PAGE_LOAD_ERROR', getResultsPageDebugPayload({
            stage: 'survey_results_error',
            reason: 'survey_results_error',
            match_id_numeric: matchIdNum,
            error: resultsError?.message || String(resultsError || ''),
            code: resultsError?.code || null,
          }));
          throw resultsError;
        }
        debugNotificationEvent('RESULTS_PAGE_LOAD_START', getResultsPageDebugPayload({
          stage: 'survey_results_loaded',
          match_id_numeric: matchIdNum,
          has_results_row: Boolean(resultsData),
          results_error_code: resultsError?.code || null,
          results_ready: resultsData?.results_ready ?? null,
          awards_status: resultsData?.awards_status || null,
          has_awards_payload: hasAnyAwardData(resultsData),
        }));

        if (!alive) return;

        const nextCanonicalResults = deriveCanonicalResultsRow({
          results: resultsData,
          surveyProgress: progress,
          partido: partidoData,
        });
        if (nextCanonicalResults) {
          setResults(nextCanonicalResults);
          if (!progress?.hasSurveyStatus) {
            setSurveyProgress((prev) => ({
              ...prev,
              surveyStatus: 'closed',
              remainingVotes: 0,
            }));
          }
        } else {
          setResults(null);
        }
        debugNotificationEvent('RESULTS_PAGE_LOAD_SUCCESS', getResultsPageDebugPayload({
          stage: 'canonical_results_resolved',
          match_id_numeric: matchIdNum,
          has_partido: Boolean(partidoData),
          has_results_row: Boolean(resultsData),
          has_canonical_results: Boolean(nextCanonicalResults),
          players_count: rosterPlayers.length,
          absences_count: canonicalAbsences.length,
          survey_status: progress?.surveyStatus || null,
          survey_has_status: Boolean(progress?.hasSurveyStatus),
          expected_voters: progress?.expectedVoters ?? null,
          submissions_count: progress?.submissionsCount ?? null,
          results_ready: nextCanonicalResults?.results_ready ?? null,
          awards_status: nextCanonicalResults?.awards_status || null,
          has_awards_payload: hasAnyAwardData(nextCanonicalResults),
        }));

        const animations = [];
        const addedPlayers = new Set();
        const finalResults = nextCanonicalResults;

        if (finalResults) {
          if (finalResults.mvp) {
            const mvpVal = finalResults.mvp;
            const player = partidoData.jugadores.find((j) => sharesIdentity(j, mvpVal));
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
            const player = partidoData.jugadores.find((j) => sharesIdentity(j, goldenGloveVal));
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
        if (alive) {
          debugNotificationEvent('RESULTS_PAGE_LOAD_ERROR', getResultsPageDebugPayload({
            stage: 'fetch_results_data_catch',
            reason: 'fetch_results_data_catch',
            error: error?.message || String(error || ''),
          }));
          logger.error('Error fetching results data:', error);
          notifyBlockingError('Error al cargar los resultados');
        }
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    };

    fetchResultsData();
    return () => {
      alive = false;
    };
  }, [partidoId, user, navigate, location.search, computeCanonicalAbsences, computeSurveyProgress, getResultsPageDebugPayload]);

  // Realtime updates
  useEffect(() => {
    if (!partidoId) return;
    const unsubscribe = subscribeToMatchUpdates(partidoId, (event) => {
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

    if (surveyUnavailableMessage) {
      clearAutoOpenGuard();
      setAutoOpeningAwards(false);
      setForcedAwardsFallback(null);
      return;
    }

    if (!shouldForce) {
      forceStoryOpenedRef.current = null;
      clearAutoOpenGuard();
      setAutoOpeningAwards(false);
      setForcedAwardsFallback(null);
      return;
    }

    if (loading || showingBadgeAnimations) return;
    if (forceStoryOpenedRef.current === forceKey) return;
    forceStoryOpenedRef.current = forceKey;

    let cancelled = false;
    const runForceAwards = async () => {
      debugNotificationEvent('RESULTS_PAGE_LOAD_START', getResultsPageDebugPayload({
        stage: 'force_awards_start',
        has_results: Boolean(results),
        players_count: Array.isArray(jugadores) ? jugadores.length : null,
        awards_status: results?.awards_status || null,
        results_ready: results?.results_ready ?? null,
        has_awards_payload: hasAnyAwardData(results),
      }));
      clearAutoOpenGuard();
      setForcedAwardsFallback(null);
      setAutoOpeningAwards(true);
      let openedStory = false;
      autoOpenGuardRef.current = setTimeout(() => {
        if (!cancelled) {
          const roster = ensurePlayersList(jugadores);
          const row = results;
          const maybeSlides = row && isAwardsReadyStatus(row) ? prepareCarouselSlides(row, roster) : [];
          if (maybeSlides.length > 0) {
            debugNotificationEvent('RESULTS_PAGE_LOAD_SUCCESS', getResultsPageDebugPayload({
              stage: 'force_awards_guard_open_slides',
              slides_count: maybeSlides.length,
              slide_keys: maybeSlides.map((slide) => slide?.key).filter(Boolean),
              players_count: roster.length,
              awards_status: row?.awards_status || null,
              has_awards_payload: hasAnyAwardData(row),
            }));
            setCarouselSlides(maybeSlides);
            setShowingBadgeAnimations(true);
            openedStory = true;
          }
          if (maybeSlides.length === 0) {
            debugNotificationEvent('RESULTS_PAGE_LOAD_ERROR', getResultsPageDebugPayload({
              stage: 'force_awards_guard_no_slides',
              reason: 'no_renderable_awards_slides',
              players_count: roster.length,
              awards_status: row?.awards_status || null,
              results_ready: row?.results_ready ?? null,
              has_awards_payload: hasAnyAwardData(row),
            }));
            setForcedAwardsFallback(buildForcedAwardsFallback({
              row,
              reason: 'force_awards_guard_no_slides',
            }));
          }
          setAutoOpeningAwards(false);
        }
      }, 3200);
      try {
        let row = results;
        const rowHasReadyAwards = (candidate) => (
          isAwardsReadyStatus(candidate)
          || (candidate?.results_ready === true && hasAnyAwardData(candidate))
        );
        const rowIsNotEligible = (candidate) => isAwardsNotEligibleStatus(candidate);

        // If results are missing or awards are still pending, ask backend once.
        if (!row || (!rowHasReadyAwards(row) && !rowIsNotEligible(row))) {
          if (!cancelled) {
            setAwardsSkippedByEnsure(false);
          }
          const res = await ensureAwards(partidoId);
          const nextCanonicalResults = deriveCanonicalResultsRow({
            results: res?.row || null,
            surveyProgress,
            partido,
          });
          if (!cancelled) {
            row = nextCanonicalResults;
            setResults(nextCanonicalResults);
          }
          if (!cancelled) {
            setAwardsSkippedByEnsure(Boolean(res?.awardsSkipped));
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
            roster = await enrichRosterWithUserProfiles(playersData);
            if (!cancelled) {
              setJugadores(roster);
            }
          }
        }

        const slides = row && rowHasReadyAwards(row) ? prepareCarouselSlides(row, roster) : [];
        if (slides.length === 0) {
          debugNotificationEvent('RESULTS_PAGE_LOAD_ERROR', getResultsPageDebugPayload({
            stage: 'force_awards_no_slides',
            reason: 'no_renderable_awards_slides',
            players_count: roster.length,
            awards_status: row?.awards_status || null,
            results_ready: row?.results_ready ?? null,
            has_awards_payload: hasAnyAwardData(row),
            mvp: row?.mvp || row?.awards?.mvp?.player_id || null,
            golden_glove: row?.golden_glove || row?.awards?.best_gk?.player_id || null,
            dirty_player: row?.dirty_player || row?.awards?.red_card?.player_id || null,
          }));
          setForcedAwardsFallback(buildForcedAwardsFallback({
            row,
            reason: 'force_awards_no_slides',
          }));
          return;
        }

        debugNotificationEvent('RESULTS_PAGE_LOAD_SUCCESS', getResultsPageDebugPayload({
          stage: 'force_awards_open_slides',
          slides_count: slides.length,
          slide_keys: slides.map((slide) => slide?.key).filter(Boolean),
          players_count: roster.length,
          awards_status: row?.awards_status || null,
          results_ready: row?.results_ready ?? null,
          has_awards_payload: hasAnyAwardData(row),
        }));
        setCarouselSlides(slides);
        setShowingBadgeAnimations(true);
        openedStory = true;
      } catch (e) {
        debugNotificationEvent('RESULTS_PAGE_LOAD_ERROR', getResultsPageDebugPayload({
          stage: 'force_awards_catch',
          reason: 'force_awards_catch',
          error: e?.message || String(e || ''),
        }));
        logger.error('[RESULTADOS] ensureAwards failed', e);
        if (cancelled) return;
        setForcedAwardsFallback(buildForcedAwardsFallback({
          row: results,
          reason: 'force_awards_catch',
        }));
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
  }, [forceAwardsMode, partidoId, location.key, location.search, loading, jugadores, results, showingBadgeAnimations, getResultsPageDebugPayload, surveyUnavailableMessage]);

  useEffect(() => {
    return () => {
      clearAutoOpenGuard();
    };
  }, []);

  useEffect(() => {
    const matchKey = String(partidoId || '').trim();
    if (!matchKey) return;
    if (surveyUnavailableMessage) return;
    if (!results?.results_ready) return;
    const awardsStatusToken = normalizeAwardsStatus(results?.awards_status);
    if (awardsStatusToken !== 'pending') return;
    if (pendingRetryAttemptedRef.current.has(matchKey)) return;
    pendingRetryAttemptedRef.current.add(matchKey);

    let cancelled = false;
    const runPendingRetry = async () => {
      try {
        const res = await ensureAwards(partidoId);
        if (cancelled) return;
        if (res?.ok) {
          const nextCanonicalResults = deriveCanonicalResultsRow({
            results: res?.row || null,
            surveyProgress,
            partido,
          });
          setResults(nextCanonicalResults);
        }
      } catch (retryErr) {
        logger.error('[RESULTADOS] pending awards ensureAwards failed', retryErr);
      }
    };

    runPendingRetry();
    return () => {
      cancelled = true;
    };
  }, [partido, partidoId, results?.awards_status, results?.results_ready, surveyProgress, surveyUnavailableMessage]);

  // If we entered in forced story mode and initially showed "awards-pending",
  // upgrade to real award slides as soon as results/roster become available.
  useEffect(() => {
    if (!forceAwardsMode) return;
    if (!showingBadgeAnimations) return;
    if (!Array.isArray(carouselSlides) || carouselSlides.length === 0) return;
    if (carouselSlides[0]?.key !== 'awards-pending') return;
    if (!results || !isAwardsReadyStatus(results)) return;

    const roster = ensurePlayersList(jugadores);
    if (!roster.length) return;

    const slides = prepareCarouselSlides(results, roster);
    if (!slides.length) return;

    setCarouselSlides(slides);
  }, [forceAwardsMode, showingBadgeAnimations, carouselSlides, results, jugadores]);

  useEffect(() => {
    penaltyListRef.current = absences.filter((jugador) => jugador?.penaltyApplied);
  }, [absences]);

  useEffect(() => {
    if (!partidoId || !awardsReady) return undefined;
    let cancelled = false;
    const loadAwardFacts = async () => {
      try {
        const { data: matchAwards, error: matchAwardsError } = await supabase
          .from('player_awards')
          .select('jugador_id, award_type, partido_id, created_at')
          .eq('partido_id', Number(partidoId));
        if (matchAwardsError) throw matchAwardsError;
        const winnerIds = Array.from(new Set((matchAwards || []).map((row) => row?.jugador_id).filter(Boolean)));
        if (winnerIds.length === 0) {
          if (!cancelled) setAwardFacts({ rows: [], profiles: {} });
          return;
        }
        // The winners' whole award history tells whether this match is their latest.
        const [{ data: history, error: historyError }, profiles] = await Promise.all([
          supabase
            .from('player_awards')
            .select('jugador_id, award_type, partido_id, created_at')
            .in('jugador_id', winnerIds),
          fetchPublicProfiles(winnerIds),
        ]);
        if (historyError) throw historyError;
        if (cancelled) return;
        setAwardFacts({
          rows: Array.isArray(history) ? history : matchAwards,
          profiles: Object.fromEntries((profiles || []).map((row) => [String(row.id).toLowerCase(), row])),
        });
      } catch (factsError) {
        // Without confirmed data the ceremony still runs, without counters.
        logger.warn('[RESULTADOS] confirmed awards unavailable', factsError);
        if (!cancelled) setAwardFacts({ rows: [], profiles: {} });
      }
    };
    loadAwardFacts();
    return () => {
      cancelled = true;
    };
  }, [partidoId, awardsReady, results?.updated_at]);

  useEffect(() => {
    if (forceAwardsMode) return;
    if (!canonicalResults || !awardsReady) return;
    if (showingBadgeAnimations || autoOpeningAwards) return;

    // Opens by itself once per account and match; afterwards "Ver premiación" replays it.
    if (hasSeenCeremony(user?.id, partidoId)) return;
    const autoOpenKey = `${partidoId}:${location.key || location.search || 'results'}:${canonicalResults?.updated_at || canonicalResults?.created_at || 'ready'}`;
    if (autoAwardsOpenedRef.current === autoOpenKey) return;

    const slides = prepareCarouselSlides(canonicalResults, jugadores);
    if (!slides || slides.length === 0) return;

    autoAwardsOpenedRef.current = autoOpenKey;
    setCarouselSlides(slides);
    setShowingBadgeAnimations(true);
  }, [
    awardsReady,
    autoOpeningAwards,
    canonicalResults,
    forceAwardsMode,
    jugadores,
    location.key,
    location.search,
    partidoId,
    showingBadgeAnimations,
    user?.id,
  ]);

  // Once shown (by itself, from a notification or replayed), it does not open by itself again.
  useEffect(() => {
    if (showingBadgeAnimations) markCeremonySeen(user?.id, partidoId);
  }, [showingBadgeAnimations, user?.id, partidoId]);

  useEffect(() => {
    if (loading || autoOpeningAwards || showingBadgeAnimations || !partido) return;
    if (canShowResults) {
      debugNotificationEvent('RESULTS_PAGE_LOAD_SUCCESS', getResultsPageDebugPayload({
        stage: 'gate_can_show_results',
        can_show_results: canShowResults,
        has_renderable_results_content: hasRenderableResultsContent,
        force_awards_mode: forceAwardsMode,
        has_canonical_results: Boolean(canonicalResults),
        renderable_slides_count: renderableResultsSlidesCount,
        awards_status: canonicalResults?.awards_status || null,
        results_ready: canonicalResults?.results_ready ?? null,
        has_awards_payload: hasAnyAwardData(canonicalResults),
      }));
      resultsGateRedirectRef.current = null;
      return;
    }

    const redirectKey = `${partidoId}:${location.key || location.search || 'results'}`;
    if (resultsGateRedirectRef.current === redirectKey) return;
    resultsGateRedirectRef.current = redirectKey;

    debugNotificationEvent('RESULTS_PAGE_LOAD_ERROR', getResultsPageDebugPayload({
      stage: 'gate_redirect',
      reason: 'can_show_results_false',
      can_show_results: canShowResults,
      has_renderable_results_content: hasRenderableResultsContent,
      force_awards_mode: forceAwardsMode,
      has_canonical_results: Boolean(canonicalResults),
      renderable_slides_count: renderableResultsSlidesCount,
      awards_status: canonicalResults?.awards_status || null,
      results_ready: canonicalResults?.results_ready ?? null,
      has_awards_payload: hasAnyAwardData(canonicalResults),
    }));
    goBackSmart({
      preferHistoryBack: true,
      replaceBackTo: true,
      replaceFallback: true,
    });
  }, [
    autoOpeningAwards,
    canShowResults,
    hasRenderableResultsContent,
    canonicalResults,
    forceAwardsMode,
    goBackSmart,
    loading,
    location.key,
    location.search,
    partido,
    partidoId,
    renderableResultsSlidesCount,
    getResultsPageDebugPayload,
    showingBadgeAnimations,
  ]);



  const handleRetry = async () => {
    setLoading(true);
    try {
      const matchIdNum = Number(partidoId);
      const [{ data: partidoData, error: partidoErr }, { data: playersData, error: playersErr }, { data: resultsData, error: resultsError }] = await Promise.all([
        supabase.from('partidos').select(PARTIDO_SELECT).eq('id', matchIdNum).maybeSingle(),
        supabase.from('jugadores').select('*').eq('partido_id', matchIdNum),
        supabase.from('survey_results').select('*').eq('partido_id', matchIdNum).maybeSingle(),
      ]);

      if (partidoErr) throw partidoErr;
      if (playersErr) throw playersErr;
      if (resultsError && resultsError.code !== 'PGRST116') throw resultsError;

      try {
        const { data: teamMatchRow } = await supabase
          .from('team_matches')
          .select('id, origin_type, challenge_id')
          .eq('partido_id', matchIdNum)
          .maybeSingle();
        if (isChallengeLikeTeamMatchRow(teamMatchRow)) {
          setPartido(partidoData || { id: matchIdNum });
          setSurveyUnavailableMessage(SURVEY_CHALLENGE_DISABLED_MESSAGE);
          setResults(null);
          setJugadores([]);
          setAbsences([]);
          return;
        }
      } catch (_teamMatchError) {
        // Non-blocking for legacy environments without team_matches.
      }

      const rosterPlayers = await enrichRosterWithUserProfiles(playersData || []);

      if (partidoData) setPartido(partidoData);
      if (rosterPlayers.length > 0) setJugadores(rosterPlayers);
      setAbsences(await computeCanonicalAbsences({
        matchIdNum,
        rosterPlayers,
      }));

      const progress = await computeSurveyProgress({
        matchIdNum,
        partidoRow: partidoData || partido,
        rosterRows: rosterPlayers,
      });
      setSurveyProgress(progress);

      const nextCanonicalResults = deriveCanonicalResultsRow({
        results: resultsData,
        surveyProgress: progress,
        partido: partidoData || partido,
      });
      if (nextCanonicalResults) {
        setResults(nextCanonicalResults);
        if (!progress?.hasSurveyStatus) {
          setSurveyProgress((prev) => ({ ...prev, surveyStatus: 'closed', remainingVotes: 0 }));
        }
      } else {
        setResults(null);
      }

      // Re-prepare animations
      const animations = [];
      const addedPlayers = new Set();
      const roster = rosterPlayers.length > 0 ? rosterPlayers : (partido?.jugadores || []);

      // Similar logic as useEffect... (abridged for brevity, assuming state updates work)
      // Note: In a full refactor, this logic should be extracted to a helper function.

      // MVP
      if (nextCanonicalResults?.mvp) {
        const mvpVal = nextCanonicalResults.mvp;
        const player = roster.find((j) => sharesIdentity(j, mvpVal));
        if (player && !addedPlayers.has(player.uuid + '_mvp')) {
          animations.push({
            playerName: player.nombre,
            playerAvatar: player.avatar_url || player.foto_url,
            badgeType: 'mvp',
            badgeText: 'MVP',
            badgeIcon: '🏆',
            votes: nextCanonicalResults.mvp_votes || 1,
          });
          addedPlayers.add(player.uuid + '_mvp');
        }
      }

      // Glove
      if (nextCanonicalResults?.golden_glove) {
        const goldenGloveVal = nextCanonicalResults.golden_glove;
        const player = roster.find((j) => sharesIdentity(j, goldenGloveVal));
        if (player && !addedPlayers.has(player.uuid + '_golden_glove')) {
          animations.push({
            playerName: player.nombre,
            playerAvatar: player.avatar_url || player.foto_url,
            badgeType: 'golden_glove',
            badgeText: 'MEJOR ARQUERO',
            badgeIcon: '🥇',
            votes: nextCanonicalResults.golden_glove_votes || 1,
          });
          addedPlayers.add(player.uuid + '_golden_glove');
        }
      }

      setBadgeAnimations(animations);
    } catch (error) {
      logger.error('Error fetching results data:', error);
      notifyBlockingError('Error al cargar los resultados');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    goBackSmart();
  };

  // Closing (or "Ver resultados") stays on this page. A notification link opened it with
  // showAwards/forceAwards: those are dropped so it does not open again on its own.
  const closeCeremony = () => {
    setShowingBadgeAnimations(false);
    if (!forceAwardsMode) return;
    const params = new URLSearchParams(location.search);
    params.delete('showAwards');
    params.delete('forceAwards');
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ''}${location.hash || ''}`, { replace: true, state: null });
  };

  const replayCeremony = () => {
    const slides = prepareCarouselSlides(canonicalResults, jugadores);
    if (slides.length === 0) return;
    setCarouselSlides(slides);
    setShowingBadgeAnimations(true);
  };

  // "Compartir resumen": the render condition and the share handler use the
  // exact same payload (same helper, same inputs). If the button is visible,
  // the share works; if the summary can't be generated, the button never
  // renders — there is no "not available" dead end anymore.
  const shareableSummaryData = buildMatchSummaryShareCardData({
    partido,
    results: canonicalResults,
    jugadores,
    penalized: absences,
  });
  const canShareSummary = shareableSummaryData.isShareable;

  const handleShareSummary = async () => {
    if (isSharingSummary || !canShareSummary) return;

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    await shareSummaryCard(shareableSummaryData, {
      fileName: `resumen-arma2-${stamp}.png`,
      title: 'Resumen del partido',
      text: 'Resumen del partido con Arma2 ⚽️',
    });
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] w-screen flex items-center justify-center" style={{ background: 'var(--app-bg-gradient)' }}>
        <PageLoadingState
          title="CARGANDO RESULTADOS"
          description="Calculando estadísticas y premios del partido."
          className="px-4"
        />
      </div>
    );
  }

  if (!partido) {
    return (
      <div className="min-h-[100dvh] w-screen flex items-start justify-center" style={{ background: 'var(--app-bg-gradient)' }}>
        <div className="text-white text-center mt-20 text-xl">Partido no encontrado</div>
      </div>
    );
  }

  if (surveyUnavailableMessage) {
    return (
      <div className="min-h-[100dvh] w-screen p-0 flex flex-col" style={{ background: 'var(--app-bg-gradient)' }}>
        <div className="w-[90vw] max-w-[720px] mt-[70px] mx-auto py-8 px-5 bg-[linear-gradient(165deg,rgba(48,38,98,0.55),rgba(18,14,38,0.96))] border border-[rgba(148,134,255,0.16)] shadow-elev-2 backdrop-blur-md rounded-[20px] md:w-full md:mt-12 md:shadow-none md:rounded-none relative mb-20 text-center">
          <h1 className={`${APP_PAGE_TITLE_BASE_CLASS} mb-5`}>
            Resultados no disponibles
          </h1>
          <p className="text-gray-300 text-lg mb-8">
            {surveyUnavailableMessage}
          </p>
          <button
            onClick={handleBack}
            className="min-h-[52px] px-6 rounded-2xl text-[18px] font-bebas font-semibold tracking-[0.04em] uppercase text-white bg-white/[0.07] border border-[rgba(148,134,255,0.3)] hover:bg-white/[0.12] transition-all shadow-elev-1"
          >
            Volver
          </button>
        </div>
      </div>
    );
  }

  const hasPrimaryAwardHighlights = Boolean(
    canonicalResults?.mvp
    || canonicalResults?.golden_glove
    || canonicalResults?.dirty_player
    || (Array.isArray(canonicalResults?.red_cards) && canonicalResults.red_cards.length > 0),
  );
  const showSecondaryResultsSections = absences.length > 0;

  // Awards story: the award scenes show the results row, player_awards and the winners'
  // public profiles; nothing is written, so replays never add to a counter.
  if (showingBadgeAnimations && carouselSlides.length > 0) {
    return (
      <>
        <StoryLikeCarousel
          slides={carouselSlides}
          paused={isSharingSummary}
          holdLastSlide
          endFooter={(
            <div className="w-full max-w-[360px] flex flex-col gap-2.5">
              {canShareSummary ? (
                <button
                  type="button"
                  onClick={handleShareSummary}
                  disabled={isSharingSummary}
                  aria-busy={isSharingSummary}
                  className="min-h-[52px] w-full px-6 rounded-full text-[17px] font-bebas font-semibold tracking-[0.06em] uppercase whitespace-nowrap text-white bg-cta-gradient border border-white/25 shadow-cta hover:brightness-105 active:scale-[0.985] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSharingSummary ? 'Generando…' : 'Compartir resumen'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={closeCeremony}
                className="min-h-[52px] w-full px-6 rounded-full text-[17px] font-bebas font-semibold tracking-[0.06em] uppercase whitespace-nowrap text-white bg-white/[0.07] border border-[rgba(148,134,255,0.3)] hover:bg-white/[0.12] active:scale-[0.985] transition-all"
              >
                Ver resultados
              </button>
            </div>
          )}
          onClose={closeCeremony}
        />

        {/* Off-screen render used only while capturing the shareable summary */}
        {summaryShareCardData ? (
          <div
            aria-hidden="true"
            style={{
              position: 'fixed',
              left: '-99999px',
              top: 0,
              pointerEvents: 'none',
              zIndex: -1,
            }}
          >
            <ShareableMatchSummaryCard ref={summaryShareCardRef} data={summaryShareCardData} />
          </div>
        ) : null}
      </>
    );
  }

  // In force awards mode, never show the static results page before story is ready.
  if (forceAwardsMode && autoOpeningAwards && !showingBadgeAnimations) {
    return (
      <div className="min-h-[100dvh] w-screen flex items-center justify-center" style={{ background: 'var(--app-bg-gradient)' }}>
        <LoadingSpinner size="large" fullScreen />
      </div>
    );
  }

  if (forceAwardsMode && forcedAwardsFallback && !showingBadgeAnimations) {
    return (
      <div className="min-h-[100dvh] w-screen p-0 flex flex-col" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}>
        <div className="w-[90vw] max-w-[720px] mt-[70px] mx-auto py-8 px-5 bg-card dark:bg-[#1a1a1a] shadow-fifa-card rounded-[20px] md:w-full md:mt-12 md:shadow-none md:rounded-none relative mb-20 text-center">
          <h1 className={`${APP_PAGE_TITLE_BASE_CLASS} mb-5`}>
            {forcedAwardsFallback.title}
          </h1>
          <p className="text-gray-300 text-lg mb-8">
            {forcedAwardsFallback.message}
          </p>
          <button
            onClick={handleBack}
            className="min-h-[52px] px-6 rounded-xl text-[18px] font-bebas tracking-[0.04em] uppercase text-white bg-white/15 border border-white/25 hover:bg-white/25 transition-all shadow-lg"
          >
            Volver
          </button>
        </div>
      </div>
    );
  }

  if (shouldBlockStaticResultsForAwards) {
    return (
      <div className="min-h-[100dvh] w-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}>
        <LoadingSpinner size="large" fullScreen />
      </div>
    );
  }

  if (!canShowResults) {
    return null;
  }

  return (
    <div className="min-h-[100dvh] w-screen p-0 flex flex-col" style={{ background: 'var(--app-bg-gradient)' }}>
      {/* Main Card Container */}
      <div className="w-[90vw] max-w-[1100px] mt-[70px] mx-auto py-6 px-4 pb-11 bg-[linear-gradient(165deg,rgba(48,38,98,0.55),rgba(18,14,38,0.96))] border border-[rgba(148,134,255,0.16)] shadow-elev-2 backdrop-blur-md rounded-[20px] min-h-[82vh] md:w-full md:mt-12 md:shadow-none md:rounded-none relative mb-20">

        <div className="text-center mb-8">
          <span className="section-eyebrow">Post partido</span>
          <h1 className={APP_PAGE_TITLE_BASE_CLASS}>Resultados de la encuesta</h1>
        </div>

        {/* Partido Info */}
        <div className="surface-hero p-5 mb-6 text-center">
          <h2 className="text-xl md:text-2xl text-[#cfc4ff] mb-2 tracking-[0.01em] font-oswald font-bold">
            {partido.nombre || partido.titulo || `Partido ${partidoId}`}
          </h2>
          <p className="text-white/60 text-base mb-1 font-sans">
            {formatMatchWallClock(partido.fecha, partido.hora)}
          </p>
        </div>

        {/* Results Summary */}
        {canonicalResults && awardsReady && hasPrimaryAwardHighlights && (
          <div className="surface-card rounded-card p-5 mb-8">
            <h3 className="section-title text-xl mb-4 border-b border-white/10 pb-3">Destacados</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {canonicalResults.mvp && (
                <div className="flex items-center gap-3 bg-[rgba(12,10,29,0.6)] border border-[rgba(148,134,255,0.14)] p-3 rounded-xl">
                  <span className="text-2xl">🏆</span>
                  <div className="flex flex-col">
                    <span className="font-oswald text-lg text-gray-400 tracking-[0.01em] font-semibold">Mvp</span>
                    <span className="text-lg text-white  text-shadow-sm">{canonicalResults.mvp_nombre || highlightNameFor(canonicalResults.mvp) || '—'}</span>
                  </div>
                </div>
              )}
              {canonicalResults.golden_glove && (
                <div className="flex items-center gap-3 bg-[rgba(12,10,29,0.6)] border border-[rgba(148,134,255,0.14)] p-3 rounded-xl">
                  <span className="text-2xl">🥇</span>
                  <div className="flex flex-col">
                    <span className="font-oswald text-lg text-gray-400 tracking-[0.01em] font-semibold">Mejor arquero</span>
                    <span className="text-lg text-white  text-shadow-sm">{canonicalResults.golden_glove_nombre || highlightNameFor(canonicalResults.golden_glove) || '—'}</span>
                  </div>
                </div>
              )}
              {(canonicalResults.dirty_player || (Array.isArray(canonicalResults.red_cards) && canonicalResults.red_cards.length > 0)) && (
                <div className="flex items-center gap-3 bg-[rgba(12,10,29,0.6)] border border-[rgba(148,134,255,0.14)] p-3 rounded-xl">
                  <span className="text-2xl">🟥</span>
                  <div className="flex flex-col">
                    <span className="font-bebas-real text-lg text-gray-400 uppercase tracking-wider">MÁS SUCIO</span>
                    <span className="text-lg text-white  text-shadow-sm">{canonicalResults.dirty_player_nombre || '—'}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-10">
          {canShareSummary && (
            <button
              onClick={handleShareSummary}
              disabled={isSharingSummary}
              className="min-h-[52px] px-6 rounded-2xl text-[18px] font-bebas font-semibold tracking-[0.04em] uppercase text-white bg-cta-gradient border border-white/20 shadow-cta hover:brightness-105 active:scale-[0.985] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSharingSummary ? 'Generando…' : 'Compartir resumen'}
            </button>
          )}
          {awardsReady && renderableResultsSlidesCount > 0 && (
            <button
              type="button"
              onClick={replayCeremony}
              className="min-h-[52px] px-6 rounded-2xl text-[18px] font-bebas font-semibold tracking-[0.04em] uppercase text-white bg-white/[0.07] border border-[rgba(148,134,255,0.3)] hover:bg-white/[0.12] active:scale-[0.985] transition-all shadow-elev-1"
            >
              Ver premiación
            </button>
          )}
          <button
            onClick={handleBack}
            className="min-h-[52px] px-6 rounded-2xl text-[18px] font-bebas font-semibold tracking-[0.04em] uppercase text-white bg-white/[0.07] border border-[rgba(148,134,255,0.3)] hover:bg-white/[0.12] transition-all shadow-elev-1"
          >
            Volver
          </button>
        </div>

        {/* Absences Section */}
        {showSecondaryResultsSections && absences.length > 0 && (
          <div className="mt-8 border-t border-white/10 pt-8">
            <h3 className="text-2xl text-white mb-2 pl-2 border-l-4 border-red-500">Información de Ausencias</h3>
            <p className="text-sm text-white/60 mb-5">
              Información secundaria del partido. No corresponde a premiación.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {absences.map((jugador) => (
                <div key={jugador.uuid} className="bg-[rgba(12,10,29,0.6)] border border-[rgba(148,134,255,0.14)] rounded-xl p-3 flex flex-col items-center">
                  <div className="transform scale-90 mb-[-10px]">
                    <ProfileCard
                      profile={jugador}
                      isVisible={true}
                      showSideAwards={false}
                    />
                  </div>
                  <div className="mt-2 text-center text-xs text-gray-400 w-full bg-black/40 py-2 rounded">
                    <p>Confirmaciones: <span className="text-white font-bold">{jugador.confirmationCount}</span></p>
                    <p>Ausencias sancionadas: <span className="text-white font-bold">{jugador.ausenciasCount}</span></p>
                    {jugador.penaltyApplied && <span className="text-red-400 block font-bold mt-1">PENALIZADO</span>}
                    {!jugador.penaltyApplied && jugador.confirmedAbsent && (
                      <span className="text-orange-300 block font-bold mt-1">AUSENCIA CONFIRMADA</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Off-screen render used only while capturing the shareable summary */}
      {summaryShareCardData ? (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: '-99999px',
            top: 0,
            pointerEvents: 'none',
            zIndex: -1,
          }}
        >
          <ShareableMatchSummaryCard ref={summaryShareCardRef} data={summaryShareCardData} />
        </div>
      ) : null}
    </div>
  );
};

export default ResultadosEncuestaView;
