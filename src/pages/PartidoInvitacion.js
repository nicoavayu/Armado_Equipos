import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../components/AuthProvider';
import { isUserMemberOfMatch, clearGuestMembership } from '../utils/membershipCheck';
import { formatLocalDateShort } from '../utils/dateLocal';
import LoadingSpinner from '../components/LoadingSpinner';
import PageTitle from '../components/PageTitle';
import MatchInfoSection from '../components/MatchInfoSection';
import TabBar from '../components/TabBar';
import normalizePartidoForHeader from '../utils/normalizePartidoForHeader';
import { PlayerCardTrigger } from '../components/ProfileComponents';
import ConfirmModal from '../components/ConfirmModal';
import InlineNotice from '../components/ui/InlineNotice';
import { Camera, UserRound, CircleAlert, Zap, LockKeyhole, CheckCircle2, Calendar, Clock, MapPin } from 'lucide-react';
import Logo from '../Logo.png';
import { findUserScheduleConflicts } from '../services/db/matchScheduling';
import { notifyAdminJoinRequest, notifyAdminPlayerJoined } from '../services/matchJoinNotificationService';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import { buildMatchCalendarIcs, shareOrDownloadCalendarIcs } from '../utils/calendarInvite';
import {
  getNotificationTimestampMs,
  hasPendingMatchInviteStatus,
} from '../utils/notificationInviteState';
import {
  buildPlayerRefToKeyMap,
  normalizeIdentityRef,
  resolvePlayerKey,
  toPlayerKeysFromRefs,
} from '../services/surveyTeamsService';

/**
 * Pantalla pública de invitación a un partido
 */

// Helper function to get initials from name
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function getShortVenueName(venue) {
  if (!venue) return '';
  return String(venue).split(/[,(]/)[0].trim();
}

function getGoogleMapsUrl(venue) {
  const venueFull = String(venue || '').trim();
  if (!venueFull) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueFull)}`;
}

const CLOSED_MATCH_STATUSES = new Set(['cancelado', 'deleted', 'finalizado']);
const GUEST_SELF_JOIN_ENABLED = true;
const MAX_SUBSTITUTES = 4;
const INVITE_ACCEPT_BUTTON_VIOLET = '#644dff';
const INVITE_ACCEPT_BUTTON_VIOLET_DARK = '#4e2fd3';
const isMatchClosed = (match) => {
  const estado = String(match?.estado || '').toLowerCase();
  return CLOSED_MATCH_STATUSES.has(estado);
};

const getMatchCapacity = (match) => Number(match?.cupo_jugadores || match?.cupo || 0);
const getMaxRosterSlots = (match) => {
  const baseCapacity = getMatchCapacity(match);
  return baseCapacity > 0 ? baseCapacity + MAX_SUBSTITUTES : 0;
};

const toMatchIdText = (value) => String(value ?? '').trim();
const buildMatchNotificationOrFilter = (matchId) => {
  const matchIdText = toMatchIdText(matchId);
  const matchIdNumber = Number(matchId);
  return [
    Number.isFinite(matchIdNumber) ? `partido_id.eq.${matchIdNumber}` : null,
    `data->>matchId.eq.${matchIdText}`,
    `data->>match_id.eq.${matchIdText}`,
    `data->>partido_id.eq.${matchIdText}`,
    `data->>partidoId.eq.${matchIdText}`,
  ]
    .filter(Boolean)
    .join(',');
};

async function fetchInviteAccessState({ userId, matchId }) {
  if (!userId || !matchId) {
    return { hasActiveInvite: false, blockedByKick: false };
  }

  const matchIdText = toMatchIdText(matchId);
  let rows = [];

  const { data: extRows, error: extError } = await supabase
    .from('notifications_ext')
    .select('id, type, data, read, send_at, created_at, partido_id')
    .eq('user_id', userId)
    .in('type', ['match_invite', 'match_kicked'])
    .eq('match_id_text', matchIdText)
    .order('send_at', { ascending: false });

  if (!extError) {
    rows = extRows || [];
  } else if (extError.code === '42P01') {
    const orFilters = buildMatchNotificationOrFilter(matchId);

    let fallbackQuery = supabase
      .from('notifications')
      .select('id, type, data, read, send_at, created_at, partido_id')
      .eq('user_id', userId)
      .in('type', ['match_invite', 'match_kicked']);

    if (orFilters) {
      fallbackQuery = fallbackQuery.or(orFilters);
    }

    const { data: fallbackRows, error: fallbackError } = await fallbackQuery.order('send_at', { ascending: false });
    if (fallbackError) throw fallbackError;
    rows = fallbackRows || [];
  } else {
    throw extError;
  }

  const latestKick = rows.find((row) => row?.type === 'match_kicked') || null;
  const latestPendingInvite = rows.find(
    (row) => row?.type === 'match_invite' && hasPendingMatchInviteStatus(row),
  ) || null;
  const inviteCode = String(
    latestPendingInvite?.data?.codigo
    ?? latestPendingInvite?.data?.matchCode
    ?? latestPendingInvite?.data?.code
    ?? latestPendingInvite?.data?.match_code
    ?? '',
  ).trim();

  const kickTs = getNotificationTimestampMs(latestKick);
  const inviteTs = getNotificationTimestampMs(latestPendingInvite);
  const hasActiveInvite = Boolean(latestPendingInvite) && (kickTs === 0 || inviteTs > kickTs);
  const blockedByKick = Boolean(latestKick) && !hasActiveInvite;

  return { hasActiveInvite, blockedByKick, inviteCode: inviteCode || null };
}

async function markOwnMatchInviteAs({ userId, matchId, status }) {
  if (!userId || !matchId || !status) return;

  const statusToken = String(status).trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const statusTsKey = statusToken === 'accepted' ? 'accepted_at' : `${statusToken}_at`;
  const matchOrFilter = buildMatchNotificationOrFilter(matchId);

  let selectQuery = supabase
    .from('notifications')
    .select('id, data')
    .eq('user_id', userId)
    .eq('type', 'match_invite');

  if (matchOrFilter) {
    selectQuery = selectQuery.or(matchOrFilter);
  }

  const { data: rows, error: rowsError } = await selectQuery;
  if (rowsError) {
    throw rowsError;
  }

  const targetRows = rows || [];
  if (targetRows.length === 0) return;

  await Promise.all(
    targetRows.map((row) =>
      supabase
        .from('notifications')
        .update({
          read: true,
          data: {
            ...(row?.data || {}),
            status: statusToken,
            [statusTsKey]: nowIso,
          },
        })
        .eq('id', row.id),
    ),
  );
}

const resolveSlotsFromMatchType = (match = {}) => {
  const explicitCapacity = Number(match?.cupo_jugadores || match?.cupo || 0);
  if (Number.isFinite(explicitCapacity) && explicitCapacity > 0) {
    return explicitCapacity;
  }

  const token = String(match?.tipo_partido || match?.modalidad || '').trim().toUpperCase();
  const normalized = token.replace(/\s+/g, '');
  const matchByNumber = normalized.match(/F(\d+)/i);
  if (matchByNumber) {
    const playersPerTeam = Number(matchByNumber[1]);
    if (Number.isFinite(playersPerTeam) && playersPerTeam > 0) {
      return playersPerTeam * 2;
    }
  }

  const fallbackByType = {
    F5: 10,
    F6: 12,
    F7: 14,
    F8: 16,
    F11: 22,
  };

  return fallbackByType[normalized] || 10;
};

const getGuestStorageKey = (matchId, _guestName = '') => `guest_joined_${matchId}`;
const PLACEHOLDER_NUMBER_STYLE = {
  color: 'transparent',
  WebkitTextStroke: '2px rgba(104, 154, 255, 0.5)',
  textShadow: '-0.6px -0.6px 0 rgba(255,255,255,0.11), 0.8px 0.8px 0 rgba(0,0,0,0.34)',
  opacity: 0.56,
  fontFamily: '"Roboto Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  fontWeight: 700,
  letterSpacing: '0.02em',
  lineHeight: 1,
};

const TEAM_REF_CANDIDATE_FIELDS = [
  'ref',
  'persist_ref',
  'player_ref',
  'playerRef',
  'playerKey',
  'key',
  'usuario_id',
  'user_id',
  'uuid',
  'auth_id',
  'player_id',
  'jugador_id',
  'id',
  'value',
];

const TEAM_REF_LABEL_FIELDS = ['nombre', 'name', 'label'];

const getTeamRefCandidates = (ref) => {
  if (ref === null || ref === undefined) return [];
  if (typeof ref === 'string' || typeof ref === 'number' || typeof ref === 'boolean') {
    return [String(ref).trim()].filter(Boolean);
  }
  if (typeof ref !== 'object') return [];

  return TEAM_REF_CANDIDATE_FIELDS
    .map((field) => String(ref?.[field] || '').trim())
    .filter(Boolean);
};

const getTeamRefLabel = (ref) => {
  if (!ref || typeof ref !== 'object') return '';
  return TEAM_REF_LABEL_FIELDS
    .map((field) => String(ref?.[field] || '').trim())
    .find(Boolean) || '';
};

const normalizeTeamRefs = (value) => (
  (Array.isArray(value) ? value : [])
    .map((ref) => getTeamRefCandidates(ref)[0] || '')
    .filter(Boolean)
);

const buildFallbackPlayersFromRefs = ({ rawRefs = [], normalizedRefs = [] }) => {
  const seen = new Set();
  return (Array.isArray(rawRefs) ? rawRefs : [])
    .map((rawRef, index) => {
      const label = getTeamRefLabel(rawRef) || String(normalizedRefs[index] || '').trim();
      if (!label) return null;
      const dedupeKey = normalizeIdentityRef(label);
      if (seen.has(dedupeKey)) return null;
      seen.add(dedupeKey);
      return {
        id: `guest-team-ref-${index}-${dedupeKey || index}`,
        nombre: label,
      };
    })
    .filter(Boolean);
};

const mapTeamRefsToPlayers = ({ refs = [], rawRefs = [], refToKeyMap, keyToPlayerMap }) => {
  const keys = toPlayerKeysFromRefs({ refs, refToKeyMap });
  const resolvedPlayers = keys
    .map((key) => keyToPlayerMap.get(String(key).trim()))
    .filter(Boolean);

  if (resolvedPlayers.length > 0) {
    return resolvedPlayers;
  }

  return buildFallbackPlayersFromRefs({ rawRefs, normalizedRefs: refs });
};

const TEAM_BALANCE_SCALE = [
  { maxDiff: 0, label: 'MATCH PERFECTO', color: '#10B981' },
  { maxDiff: 2, label: 'MUY PAREJO', color: '#10B981' },
  { maxDiff: 5, label: 'PAREJO', color: '#84CC16' },
  { maxDiff: 8, label: 'DESBALANCEADO', color: '#F59E0B' },
  { maxDiff: Number.POSITIVE_INFINITY, label: 'MUY DESBALANCEADO', color: '#EF4444' },
];

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeTeamsPayload = (value) => {
  const raw = typeof value === 'string' ? (() => {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  })() : value;

  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (raw && typeof raw === 'object' && Array.isArray(raw.teams)) return raw.teams.filter(Boolean);
  return [];
};

const normalizeTeamToken = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const pickOrderedTeamsFromPayload = (teamsPayload = []) => {
  const teams = Array.isArray(teamsPayload) ? teamsPayload.filter(Boolean) : [];
  if (teams.length === 0) return [null, null];

  const findByToken = (candidates = []) => teams.find((team) => candidates.includes(normalizeTeamToken(team?.id)));
  const teamA = findByToken(['equipoa', 'teama', 'a']) || teams[0] || null;
  const teamB = findByToken(['equipob', 'teamb', 'b']) || teams.find((team) => team !== teamA) || teams[1] || null;
  return [teamA, teamB];
};

const resolveTeamPlayerRefsFromPayload = (teamPayload) => {
  if (!teamPayload || typeof teamPayload !== 'object') return [];
  const rawRefs = ['players', 'jugadores', 'members']
    .map((field) => (Array.isArray(teamPayload?.[field]) ? teamPayload[field] : []))
    .find((arr) => arr.length > 0) || [];
  return rawRefs;
};

const computeTeamScore = ({ explicitScore, players = [] }) => {
  const fromPayload = toFiniteNumber(explicitScore);
  if (fromPayload !== null) return fromPayload;

  const sum = (Array.isArray(players) ? players : []).reduce((acc, player) => {
    const candidate = toFiniteNumber(player?.score ?? player?.promedio ?? player?.rating);
    return acc + (candidate ?? 0);
  }, 0);
  return Number(sum.toFixed(1));
};

const resolveBalanceMeta = (diffValue) => {
  const diff = Number.isFinite(Number(diffValue)) ? Number(diffValue) : 0;
  return TEAM_BALANCE_SCALE.find((entry) => diff <= entry.maxDiff) || TEAM_BALANCE_SCALE[TEAM_BALANCE_SCALE.length - 1];
};

const pickTeamsFieldsSnapshot = (value) => {
  if (!value || typeof value !== 'object') return null;
  const snapshot = {
    teams_confirmed: value?.teams_confirmed,
    teams_locked: value?.teams_locked,
    equipos_json: value?.equipos_json,
    equipos: value?.equipos,
    survey_team_a: value?.survey_team_a,
    survey_team_b: value?.survey_team_b,
    final_team_a: value?.final_team_a,
    final_team_b: value?.final_team_b,
  };
  const hasAnyField = Object.values(snapshot).some((fieldValue) => fieldValue !== null && fieldValue !== undefined);
  return hasAnyField ? snapshot : null;
};

const fetchGuestMatchSnapshotWithAnon = async ({ matchId, codigo }) => {
  const supabaseUrl = String(process.env.REACT_APP_SUPABASE_URL || '').trim();
  const anonKey = String(process.env.REACT_APP_SUPABASE_ANON_KEY || '').trim();
  const normalizedMatchId = Number(matchId);
  if (!supabaseUrl || !anonKey || !Number.isFinite(normalizedMatchId) || normalizedMatchId <= 0) {
    return null;
  }

  const params = new URLSearchParams();
  params.set('select', 'teams_confirmed,teams_locked,equipos_json,equipos,survey_team_a,survey_team_b,final_team_a,final_team_b');
  params.set('id', `eq.${normalizedMatchId}`);
  if (codigo) {
    params.set('codigo', `eq.${String(codigo).trim()}`);
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/partidos?${params.toString()}`, {
    method: 'GET',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) return null;
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows[0]) return null;
  return pickTeamsFieldsSnapshot(rows[0]);
};

const mergePartidoWithTeamsSnapshot = async ({ partidoBase, matchId, codigo }) => {
  const base = partidoBase && typeof partidoBase === 'object' ? partidoBase : {};
  try {
    const snapshot = await fetchGuestMatchSnapshotWithAnon({
      matchId,
      codigo: codigo || null,
    });
    if (!snapshot) return base;
    return { ...base, ...snapshot };
  } catch (_snapshotError) {
    return base;
  }
};

function PlayersReadOnly({ jugadores, partido, mode }) {
  const requiredSlots = resolveSlotsFromMatchType(partido);
  const displayCount = jugadores?.length ?? 0;
  const confirmedCount = Math.min(displayCount, requiredSlots);
  const progressPct = requiredSlots > 0
    ? Math.max(0, Math.min((confirmedCount / requiredSlots) * 100, 100))
    : 0;
  const slotItems = Array.from({ length: requiredSlots }, (_, idx) => jugadores?.[idx] || null);
  const isSoftVariant = mode === 'invite' || mode === 'public';
  const skewX = 0;
  const slotHeightClass = 'h-12';
  const invitePlayersBlockStyle = {
    background: 'linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.01) 100%)',
    paddingTop: '16px',
    paddingBottom: '24px',
  };
  const softCardWrapperStyle = {
    backgroundColor: '#07163b',
    border: '1px solid rgba(41, 170, 255, 0.9)',
    boxShadow: '0 0 10px rgba(41, 170, 255, 0.24)',
    transform: `skewX(-${skewX}deg)`,
    backfaceVisibility: 'hidden',
  };
  const softPlaceholderWrapperStyle = {
    background: 'rgba(255,255,255,0.015)',
    border: '1px dashed rgba(255,255,255,0.055)',
    boxShadow: 'none',
    transform: `skewX(-${skewX}deg)`,
  };
  const skewCounterStyle = {
    transform: `skewX(${skewX}deg)`,
  };
  let remainingSlotNumber = Math.max(0, requiredSlots - confirmedCount);

  return (
    <div
      className={isSoftVariant ? 'w-full box-border' : 'w-full bg-white/10 border-2 border-white/20 rounded-xl p-3 box-border min-h-[120px]'}
      style={isSoftVariant ? invitePlayersBlockStyle : undefined}
    >
      <div className={`px-1 ${isSoftVariant ? 'mb-6' : 'mb-3 mt-1'}`}>
        <div className="flex items-baseline gap-2">
          <div className="font-oswald text-xl font-semibold text-white tracking-[0.01em]">
            Jugadores
          </div>
          <div className="font-oswald text-[13px] font-medium text-white/75 whitespace-nowrap">
            {confirmedCount}/{requiredSlots}
          </div>
        </div>
        <div className="mt-2 h-[6px] w-full overflow-hidden rounded-[6px] bg-white/[0.08]">
          <div
            className="h-full rounded-[6px] transition-all duration-200"
            style={{ width: `${progressPct}%`, backgroundColor: INVITE_ACCEPT_BUTTON_VIOLET, filter: 'saturate(1.05)' }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 w-full max-w-[720px] mx-auto justify-items-center box-border">
        {slotItems.map((player, idx) => {
          if (!player) {
            const visibleNumber = remainingSlotNumber > 0 ? remainingSlotNumber : Math.max(1, requiredSlots - idx);
            remainingSlotNumber = Math.max(0, remainingSlotNumber - 1);

            if (isSoftVariant) {
              return (
                <div
                  key={`slot-empty-${idx}`}
                  className={`rounded-none ${slotHeightClass} w-full overflow-hidden`}
                  style={softPlaceholderWrapperStyle}
                  aria-hidden="true"
                >
                  <div
                    className="h-full w-full p-2 flex items-center justify-center"
                    style={skewCounterStyle}
                  >
                    <span className="select-none pointer-events-none text-[28px]" style={PLACEHOLDER_NUMBER_STYLE}>
                      {visibleNumber}
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={`slot-empty-${idx}`}
                className="flex items-center justify-center rounded-lg p-2 min-h-[36px] w-full border border-dashed border-white/[0.08] bg-white/[0.03]"
                aria-hidden="true"
              >
                <UserRound size={16} className="text-white/20" />
              </div>
            );
          }

          if (isSoftVariant) {
            return (
              <PlayerCardTrigger key={player.uuid || player.id || `slot-player-${idx}`} profile={player} partidoActual={partido}>
                <div
                  className={`PlayerCard PlayerCard--soft relative rounded-none ${slotHeightClass} w-full overflow-visible transition-all cursor-pointer hover:brightness-105`}
                  style={softCardWrapperStyle}
                >
                  <div
                    className="h-full w-full p-2 flex items-center gap-1.5"
                    style={skewCounterStyle}
                  >
                    {player.foto_url || player.avatar_url ? (
                      <img
                        src={player.foto_url || player.avatar_url}
                        alt={player.nombre}
                        className="w-8 h-8 rounded-full object-cover border border-slate-700 bg-slate-800 shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 border border-slate-700 flex items-center justify-center text-xs font-bold shrink-0 text-white">
                        {getInitials(player.nombre)}
                      </div>
                    )}
                    <span className="flex-1 font-oswald text-sm font-semibold text-white tracking-wide min-w-0 truncate leading-tight">
                      {player.nombre || 'Jugador'}
                    </span>
                    {partido?.creado_por === player.usuario_id && (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="16" height="16" fill="#FFD700" style={{ flexShrink: 0 }}>
                        <path d="M345 151.2C354.2 143.9 360 132.6 360 120C360 97.9 342.1 80 320 80C297.9 80 280 97.9 280 120C280 132.6 285.9 143.9 295 151.2L226.6 258.8C216.6 274.5 195.3 278.4 180.4 267.2L120.9 222.7C125.4 216.3 128 208.4 128 200C128 177.9 110.1 160 88 160C65.9 160 48 177.9 48 200C48 221.8 65.5 239.6 87.2 240L119.8 457.5C124.5 488.8 151.4 512 183.1 512L456.9 512C488.6 512 515.5 488.8 520.2 457.5L552.8 240C574.5 239.6 592 221.8 592 200C592 177.9 574.1 160 552 160C529.9 160 512 177.9 512 200C512 208.4 514.6 216.3 519.1 222.7L459.7 267.3C444.8 278.5 423.5 274.6 413.5 258.9L345 151.2z" />
                      </svg>
                    )}
                  </div>
                </div>
              </PlayerCardTrigger>
            );
          }

          return (
            <PlayerCardTrigger key={player.uuid || player.id || `slot-player-${idx}`} profile={player} partidoActual={partido}>
              <div
                className="PlayerCard flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg p-2 transition-all min-h-[36px] w-full hover:bg-slate-800 cursor-pointer"
              >
                {player.foto_url || player.avatar_url ? (
                  <img
                    src={player.foto_url || player.avatar_url}
                    alt={player.nombre}
                    className="w-8 h-8 rounded-full object-cover border border-slate-700 bg-slate-800 shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 border border-slate-700 flex items-center justify-center text-xs font-bold shrink-0 text-white">
                    {getInitials(player.nombre)}
                  </div>
                )}
                <span className="flex-1 font-oswald text-sm font-semibold text-white tracking-wide min-w-0 break-words leading-tight">
                  {player.nombre || 'Jugador'}
                </span>
                {partido?.creado_por === player.usuario_id && (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="16" height="16" fill="#FFD700" style={{ flexShrink: 0 }}>
                    <path d="M345 151.2C354.2 143.9 360 132.6 360 120C360 97.9 342.1 80 320 80C297.9 80 280 97.9 280 120C280 132.6 285.9 143.9 295 151.2L226.6 258.8C216.6 274.5 195.3 278.4 180.4 267.2L120.9 222.7C125.4 216.3 128 208.4 128 200C128 177.9 110.1 160 88 160C65.9 160 48 177.9 48 200C48 221.8 65.5 239.6 87.2 240L119.8 457.5C124.5 488.8 151.4 512 183.1 512L456.9 512C488.6 512 515.5 488.8 520.2 457.5L552.8 240C574.5 239.6 592 221.8 592 200C592 177.9 574.1 160 552 160C529.9 160 512 177.9 512 200C512 208.4 514.6 216.3 519.1 222.7L459.7 267.3C444.8 278.5 423.5 274.6 413.5 258.9L345 151.2z" />
                  </svg>
                )}
              </div>
            </PlayerCardTrigger>
          );
        })}
      </div>
    </div>
  );
}

function GuestTeamsModal({
  isOpen,
  onClose,
  teamAName = 'Equipo A',
  teamBName = 'Equipo B',
  teamAPlayers = [],
  teamBPlayers = [],
  teamAScore = 0,
  teamBScore = 0,
  balanceDiff = 0,
  balanceLabel = 'MUY PAREJO',
  balanceColor = '#10B981',
}) {
  if (!isOpen) return null;

  const renderTeamPlayerRow = (player, teamToken, index) => {
    const avatarUrl = player?.foto_url || player?.avatar_url || '';
    const key = `${teamToken}-${resolvePlayerKey(player) || player?.usuario_id || player?.id || player?.nombre || index}`;
    return (
      <div
        key={key}
        className="flex items-center gap-2 bg-[#07163b] border border-[rgba(41,170,255,0.86)] rounded-[6px] px-2.5 py-2 min-h-[44px]"
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={player?.nombre || 'Jugador'}
            className="w-7 h-7 rounded-full object-cover border border-slate-700 bg-slate-800 shrink-0"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 border border-slate-700 flex items-center justify-center text-xs font-bold shrink-0 text-white">
            {getInitials(player?.nombre || 'Jugador')}
          </div>
        )}
        <span className="font-oswald text-[22px] leading-none text-white truncate">{player?.nombre || 'Jugador'}</span>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[10050] bg-black/70 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[760px] rounded-[8px] border border-white/20 bg-[#181d48] shadow-[0_20px_60px_rgba(0,0,0,0.55)] p-4 sm:p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bebas text-white text-[28px] leading-none tracking-[0.02em]">Equipos confirmados</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-white/80 hover:text-white text-2xl leading-none px-2 py-1 rounded-full hover:bg-white/10 transition-colors"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[#1b214e] border border-white/10 rounded-[6px] p-3">
            <div className="font-bebas text-[36px] leading-none text-white uppercase tracking-[0.04em] text-center mb-2">{teamAName}</div>
            <div className="flex flex-col gap-1.5">
              {teamAPlayers.length > 0 ? teamAPlayers.map((player, index) => renderTeamPlayerRow(player, 'team-a', index)) : (
                <div className="text-white/55 text-sm font-oswald text-center py-2">Sin jugadores</div>
              )}
            </div>
            <div className="relative text-center w-full box-border mt-2 h-[74px] overflow-hidden rounded-[6px] border border-[#19d7b6cc] bg-[#07163b]">
              <div className="w-full h-full flex flex-col items-center justify-center px-2">
                <div className="text-white/75 text-[11px] font-oswald uppercase tracking-wide mb-0.5">PUNTAJE</div>
                <div className="text-white font-bebas text-[48px] leading-none font-bold">{Number(teamAScore || 0).toFixed(1)}</div>
              </div>
            </div>
          </div>

          <div className="bg-[#1b214e] border border-white/10 rounded-[6px] p-3">
            <div className="font-bebas text-[36px] leading-none text-white uppercase tracking-[0.04em] text-center mb-2">{teamBName}</div>
            <div className="flex flex-col gap-1.5">
              {teamBPlayers.length > 0 ? teamBPlayers.map((player, index) => renderTeamPlayerRow(player, 'team-b', index)) : (
                <div className="text-white/55 text-sm font-oswald text-center py-2">Sin jugadores</div>
              )}
            </div>
            <div className="relative text-center w-full box-border mt-2 h-[74px] overflow-hidden rounded-[6px] border border-[#19d7b6cc] bg-[#07163b]">
              <div className="w-full h-full flex flex-col items-center justify-center px-2">
                <div className="text-white/75 text-[11px] font-oswald uppercase tracking-wide mb-0.5">PUNTAJE</div>
                <div className="text-white font-bebas text-[48px] leading-none font-bold">{Number(teamBScore || 0).toFixed(1)}</div>
              </div>
            </div>
          </div>
        </div>

        <div
          className="w-full border px-4 py-3 mt-3 rounded-[6px]"
          style={{
            borderColor: `${balanceColor}cc`,
            background: 'linear-gradient(180deg, rgba(7,22,59,0.96) 0%, rgba(9,20,58,0.88) 100%)',
            boxShadow: '0 0 10px rgba(41, 170, 255, 0.16)',
          }}
        >
          <div className="text-center">
            <div className="font-bebas text-base text-white/90 tracking-wider mb-0.5">BALANCE DEL PARTIDO</div>
            <div className="font-bebas text-2xl text-white font-bold mb-0.5">DIF: {Number(balanceDiff || 0).toFixed(1)}</div>
            <div className="font-oswald text-xs font-semibold tracking-wide" style={{ color: balanceColor }}>{balanceLabel}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SharedInviteLayout({
  partido,
  jugadores,
  title,
  showChatIcon,
  ctaVariant,
  submitting,
  onSumarse,
  onNavigateHome,
  onNavigateBack,
  codigoValido,
  mode,
  joinStatus,
  isMatchFull,
  inlineNotice,
  onClearInlineNotice,
  onAddToCalendar,
  showViewTeamsButton = false,
  onViewTeams,
  showBottomNav = false,
}) {
  const isSent = joinStatus === 'pending';
  const isApproved = joinStatus === 'approved';
  const isPendingSync = joinStatus === 'approved_pending_sync';
  const isSending = submitting && joinStatus === 'none';
  const matchPrimaryButtonClass = 'w-full font-bebas text-base px-4 py-2.5 border border-[#7d5aff] rounded-[5px] cursor-pointer transition-all text-white min-h-[44px] flex items-center justify-center text-center bg-[#6a43ff] shadow-[0_0_14px_rgba(106,67,255,0.3)] hover:bg-[#7550ff] disabled:opacity-60 disabled:cursor-not-allowed';
  const matchSecondaryButtonClass = 'w-full font-bebas text-base px-4 py-2.5 border border-[rgba(88,107,170,0.46)] rounded-[5px] cursor-pointer transition-all text-[rgba(242,246,255,0.9)] min-h-[44px] flex items-center justify-center text-center bg-[rgba(23,35,74,0.72)] hover:bg-[rgba(31,45,91,0.82)] disabled:opacity-60 disabled:cursor-not-allowed';
  const publicCtaBaseClass = 'w-full font-bebas text-base px-4 py-2.5 border rounded-[5px] transition-all min-h-[44px] flex items-center justify-center text-center disabled:opacity-100';
  const publicCtaStateClass = joinStatus === 'checking'
    ? 'border-[rgba(88,107,170,0.46)] bg-[rgba(23,35,74,0.72)] text-[rgba(242,246,255,0.9)] cursor-wait'
    : isMatchFull
      ? 'border-[rgba(245,158,11,0.62)] bg-[rgba(146,64,14,0.74)] text-[#fff8eb] cursor-not-allowed'
      : isPendingSync
        ? 'border-[rgba(52,211,153,0.66)] bg-[rgba(16,185,129,0.72)] text-white cursor-wait'
        : isSent || isApproved
          ? 'border-[rgba(125,90,255,0.52)] bg-[rgba(100,77,255,0.38)] text-white/85 cursor-not-allowed'
          : 'border-[#7d5aff] bg-[#6a43ff] text-white hover:bg-[#7550ff] shadow-[0_0_14px_rgba(106,67,255,0.3)]';

  const renderJoinedBlock = () => (
    <div className="flex flex-col gap-2 w-full">
      {mode === 'invite' && (
        <div className="w-full rounded-[6px] border-2 border-yellow-300 bg-red-600 px-3 py-2 text-center font-oswald text-sm font-bold text-white tracking-wide">
          TEST VIEW TEAMS · mode={mode} · CTA={String(showViewTeamsButton)}
        </div>
      )}
      {showViewTeamsButton && (
        <button
          onClick={onViewTeams}
          className={matchPrimaryButtonClass}
        >
          Ver equipos
        </button>
      )}
      <button
        onClick={onAddToCalendar}
        className={showViewTeamsButton ? matchSecondaryButtonClass : matchPrimaryButtonClass}
      >
        Agregar al calendario
      </button>
    </div>
  );

  return (
    <div className={`min-h-[100dvh] w-screen max-w-[100vw] overflow-x-hidden bg-fifa-gradient ${showBottomNav ? 'pb-[calc(var(--safe-bottom,0px)+78px)] md:pb-[calc(var(--safe-bottom,0px)+88px)]' : ''}`}>
      <div className="mx-auto w-[90vw] max-w-[650px] pt-5 shadow-none">
        <PageTitle
          title={title}
          onBack={onNavigateBack}
          showChatButton={showChatIcon}
          onChatClick={() => {}}
        />

        <MatchInfoSection
          partido={normalizePartidoForHeader(partido)}
          fecha={partido?.fecha}
          hora={partido?.hora}
          sede={partido?.sede}
          modalidad={partido?.modalidad}
          tipo={partido?.tipo_partido}
          precio={partido?.precio || partido?.valor_cancha || partido?.valor}
        />

        <main className="pt-0">
          <div className="main-content">
            <div className="w-full flex flex-col gap-3 overflow-x-visible pt-3">
              <InlineNotice
                type={inlineNotice?.type}
                message={inlineNotice?.message}
                autoHideMs={4500}
                onClose={onClearInlineNotice}
              />
              <PlayersReadOnly jugadores={jugadores} partido={partido} mode={mode} />
              {isMatchFull && (
                <div className="mt-4 text-center text-rose-300 font-oswald text-sm">
                  El partido ya está completo
                </div>
              )}
              <div className="w-full border-t border-white/12 mt-2" aria-hidden="true" />

              {/* CTA */}
              <div className="w-full max-w-[500px] mx-auto mt-5 px-0 text-center">
                {ctaVariant === 'public' ? (
                  isApproved ? (
                    renderJoinedBlock()
                  ) : (
                    <div className="flex flex-col gap-3 w-full">
                      <button
                        onClick={onSumarse}
                        disabled={submitting || isSent || isPendingSync || joinStatus === 'checking' || isMatchFull}
                        className={`${publicCtaBaseClass} ${publicCtaStateClass}`}
                      >
                        {joinStatus === 'checking' ? (
                          <span className="flex items-center justify-center gap-2">
                            <LoadingSpinner size="small" />
                            Verificando...
                          </span>
                        ) : isPendingSync ? (
                          <span className="flex items-center justify-center gap-2">
                            <LoadingSpinner size="small" />
                            Aprobado - sincronizando...
                          </span>
                        ) : isMatchFull ? 'Partido completo' :
                          isSending ? 'Enviando...' :
                            isSent ? 'Solicitud enviada' :
                              'Solicitar unirme'}
                      </button>

                      {isSent && (
                        <p className="text-white/70 font-oswald text-sm mt-1">
                          Esperando aprobación del admin.
                        </p>
                      )}
                      {isPendingSync && (
                        <p className="text-emerald-300 font-oswald text-sm mt-1">
                          Tu solicitud fue aprobada. Sincronizando acceso...
                        </p>
                      )}
                    </div>
                  )
                ) : (
                  isApproved ? (
                    renderJoinedBlock()
                  ) : (
                    <div className="flex flex-row gap-3 w-full">
                      <button
                        onClick={onNavigateHome}
                        className={matchSecondaryButtonClass}
                      >
                        <span>Rechazar</span>
                      </button>
                      <button
                        onClick={onSumarse}
                        disabled={!codigoValido || submitting || isMatchFull}
                        className={matchPrimaryButtonClass}
                      >
                        <span>{isMatchFull ? 'Partido completo' : (submitting ? 'Sumando...' : 'Aceptar')}</span>
                      </button>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </main >
      </div >
      {showBottomNav && (
        <TabBar
          activeTab="quiero-jugar"
          onTabChange={() => {}}
        />
      )}
    </div >
  );
}

export default function PartidoInvitacion({ mode = 'invite' }) {
  const [jugadores, setJugadores] = useState([]);
  const { partidoId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const [partido, setPartido] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [step, setStep] = useState('invitation'); // 'invitation', 'choose-method', 'guest-form', 'success', 'already-joined'
  const [guestName, setGuestName] = useState('');
  const [guestPhotoDataUrl, setGuestPhotoDataUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [codigoValido, setCodigoValido] = useState(true); // Flag de validación de código
  const [alreadyJoined, setAlreadyJoined] = useState(false);
  const [joinStatus, setJoinStatus] = useState('checking'); // 'checking', 'none', 'pending', 'approved', 'approved_pending_sync'
  const [joinSubmitting, setJoinSubmitting] = useState(false);
  const [inviteValidatedByNotification, setInviteValidatedByNotification] = useState(false);
  const [scheduleWarning, setScheduleWarning] = useState({
    isOpen: false,
    message: '',
  });
  const [joinSuccessModal, setJoinSuccessModal] = useState({
    isOpen: false,
    afterConfirm: null,
  });
  const [inlineNotice, setInlineNotice] = useState(null);
  const [guestTeamsModalOpen, setGuestTeamsModalOpen] = useState(false);
  const [guestConfirmedTeams, setGuestConfirmedTeams] = useState({
    isAvailable: false,
    hasConfirmedFlag: false,
    teamAName: 'Equipo A',
    teamBName: 'Equipo B',
    teamAPlayers: [],
    teamBPlayers: [],
    teamAScore: 0,
    teamBScore: 0,
    balanceDiff: 0,
    balanceLabel: 'MUY PAREJO',
    balanceColor: '#10B981',
  });
  const pendingContinueRef = useRef(null);
  const guestPhotoInputRef = useRef(null);

  const showInlineNotice = (type, message) => {
    setInlineNotice({ type, message, ts: Date.now() });
  };

  const closeScheduleWarning = () => {
    pendingContinueRef.current = null;
    setScheduleWarning({ isOpen: false, message: '' });
  };

  const showScheduleWarning = (message) => {
    setScheduleWarning({
      isOpen: true,
      message,
    });
  };

  const openJoinSuccessModal = (afterConfirm = null) => {
    setJoinSuccessModal({
      isOpen: true,
      afterConfirm,
    });
  };

  const closeJoinSuccessModal = () => {
    const callback = joinSuccessModal.afterConfirm;
    setJoinSuccessModal({
      isOpen: false,
      afterConfirm: null,
    });
    if (typeof callback === 'function') {
      callback();
    }
  };

  const toCompressedDataUrl = async (file) => {
    const readAsDataUrl = () => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const loadImage = (src) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

    const rawDataUrl = await readAsDataUrl();
    const img = await loadImage(rawDataUrl);
    const maxSide = 360;
    const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * ratio));
    const height = Math.max(1, Math.round(img.height * ratio));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.82);
  };

  const handleGuestPhotoChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showInlineNotice('warning', 'Elegí una imagen válida.');
      return;
    }
    try {
      const dataUrl = await toCompressedDataUrl(file);
      setGuestPhotoDataUrl(dataUrl);
    } catch (err) {
      console.error('[INVITE] photo parse error:', err);
      showInlineNotice('warning', 'No se pudo procesar la foto.');
    } finally {
      event.target.value = '';
    }
  };

  const openGuestPhotoPicker = () => {
    guestPhotoInputRef.current?.click();
  };

  // Anti-race condition: track request ID
  const reqIdRef = useRef(0);

  // Query params (soportamos versión corta para links más compactos)
  const codigoParam = searchParams.get('codigo') || searchParams.get('c');
  const inviteTokenParam = searchParams.get('invite') || searchParams.get('i');

  // Clear guest localStorage when authenticated user accesses match
  useEffect(() => {
    if (user && partidoId) {
      clearGuestMembership(partidoId);
    }
  }, [user, partidoId]);

  // Cargar datos del partido según modo
  useEffect(() => {
    async function loadPartido() {
      // 1. HARD RESET: Clear all states at start
      const reqId = ++reqIdRef.current;

      // Reset states based on user auth
      if (user) {
        setJoinStatus('checking');
      } else {
        setJoinStatus('none');
      }
      setInviteValidatedByNotification(false);
      setSubmitting(false);
      setJoinSubmitting(false);

      console.log('[LOAD_PARTIDO] Starting load', { partidoId, mode, user: !!user, reqId });

      if (!partidoId) {
        setError('Partido no encontrado');
        setLoading(false);
        return;
      }

      if (mode === 'public') {
        try {
          const { data, error: fetchError } = await supabase
            .from('partidos_view')
            .select('*')
            .eq('id', partidoId)
            .maybeSingle();

          // Check if this request is stale
          if (reqId !== reqIdRef.current) {
            console.log('[LOAD_PARTIDO] Aborting stale request (after partido fetch)', { reqId, current: reqIdRef.current });
            return;
          }

          if (fetchError || !data) {
            setError('Partido no encontrado');
            setLoading(false);
            return;
          }

          const { data: jugadoresData, count } = await supabase
            .from('jugadores')
            .select('*', { count: 'exact' })
            .eq('partido_id', partidoId);

          // Check if this request is stale
          if (reqId !== reqIdRef.current) {
            console.log('[LOAD_PARTIDO] Aborting stale request (after jugadores fetch)', { reqId, current: reqIdRef.current });
            return;
          }

          setPartido({ ...data, jugadoresCount: count || 0 });
          setJugadores(jugadoresData || []);

          if (isMatchClosed(data)) {
            setError('Este partido fue cancelado o cerrado.');
            setJoinStatus('none');
            setLoading(false);
            return;
          }

          // If no user, set to 'none' and skip membership check
          if (!user) {
            console.log('[LOAD_PARTIDO] No user, setting status: none', { reqId });
            setJoinStatus('none');
            setLoading(false);
            return;
          }

          // User is authenticated - check membership
          console.log('[PUBLIC_MATCH] membership_check_start', {
            partidoId: Number(partidoId),
            currentUserUuid: user.id,
            jugadoresCount: jugadoresData?.length || 0,
            reqId
          });

          // 1. Use centralized membership check (single source of truth)
          const { isMember, jugadorRow } = await isUserMemberOfMatch(user.id, Number(partidoId));

          // Check if this request is stale
          if (reqId !== reqIdRef.current) {
            console.log('[LOAD_PARTIDO] Aborting stale request (after membership check)', { reqId, current: reqIdRef.current });
            return;
          }

          console.log('[PUBLIC_MATCH] membership_result', {
            source: 'centralized_db_check',
            isMember,
            jugadorRow,
            reqId
          });

          if (isMember) {
            console.log('[PUBLIC_MATCH] setJoinStatus: approved', { partidoId, userId: user.id, source: 'db_member', reqId });
            setJoinStatus('approved');
          } else {
            // 2. Verificar si hay solicitud (más reciente)
            const { data: request, error: reqErr } = await supabase
              .from('match_join_requests')
              .select('id, status, created_at')
              .eq('match_id', Number(partidoId))
              .eq('user_id', user.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            // Check if this request is stale
            if (reqId !== reqIdRef.current) {
              console.log('[LOAD_PARTIDO] Aborting stale request (after request check)', { reqId, current: reqIdRef.current });
              return;
            }

            if (reqErr) console.error('[INVITE_PUBLIC] request check error', reqErr);

            if (request?.status === 'pending') {
              console.log('[PUBLIC_MATCH] setJoinStatus: pending', { partidoId, userId: user.id, source: 'request_pending', reqId });
              setJoinStatus('pending');
            } else if (request?.status === 'approved') {
              // If request says approved but user is not in jugadores, treat as stale state.
              // This happens after admin kicks a user and should allow re-request immediately.
              console.warn('[PUBLIC_MATCH] stale approved request without membership, resetting to none', {
                partidoId,
                userId: user.id,
                requestId: request.id,
                reqId
              });
              setJoinStatus('none');
            } else {
              console.log('[PUBLIC_MATCH] setJoinStatus: none', { partidoId, userId: user.id, source: 'no_request', reqId });
              setJoinStatus('none');
            }
          }

          // Only set loading false if this request is still current
          if (reqId === reqIdRef.current) {
            setLoading(false);
          }
        } catch (err) {
          if (reqId === reqIdRef.current) {
            setError('Partido no encontrado');
            setLoading(false);
          }
        }
        return;
      }

      // INVITE MODE (default)
      if (!codigoParam || codigoParam.trim() === '') {
        // Permitir abrir invitaciones sin código cuando el acceso proviene de una notificación pendiente.
        if (!user?.id) {
          setError('Partido no encontrado');
          setLoading(false);
          return;
        }

        try {
          const inviteAccess = await fetchInviteAccessState({
            userId: user.id,
            matchId: partidoId,
          });
          const inviteCodeFromNotification = String(inviteAccess?.inviteCode || '').trim();

          if (reqId !== reqIdRef.current) {
            console.log('[LOAD_PARTIDO] Aborting stale request (invite no-code)', { reqId, current: reqIdRef.current });
            return;
          }

          if (inviteAccess.blockedByKick) {
            showInlineNotice('warning', 'Ya no formás parte de este partido.');
            setError('Ya no tenés acceso a este partido.');
            setLoading(false);
            navigate('/', { replace: true });
            return;
          }

          if (!inviteAccess.hasActiveInvite) {
            setError('Partido no encontrado');
            setLoading(false);
            return;
          }

          const { data: partidoData, error: partidoError } = await supabase
            .from('partidos_view')
            .select('*')
            .eq('id', partidoId)
            .maybeSingle();

          if (reqId !== reqIdRef.current) {
            console.log('[LOAD_PARTIDO] Aborting stale request (invite no-code partido fetch)', { reqId, current: reqIdRef.current });
            return;
          }

          if (partidoError || !partidoData) {
            setError('Partido no encontrado');
            setLoading(false);
            return;
          }

          const { data: jugadoresData, count } = await supabase
            .from('jugadores')
            .select('*', { count: 'exact' })
            .eq('partido_id', partidoId);

          if (reqId !== reqIdRef.current) {
            console.log('[LOAD_PARTIDO] Aborting stale request (invite no-code jugadores fetch)', { reqId, current: reqIdRef.current });
            return;
          }

          const enrichedPartidoData = await mergePartidoWithTeamsSnapshot({
            partidoBase: partidoData,
            matchId: partidoId,
            codigo: partidoData?.codigo || codigoParam || inviteCodeFromNotification || null,
          });

          if (reqId !== reqIdRef.current) {
            console.log('[LOAD_PARTIDO] Aborting stale request (invite no-code enrich fetch)', { reqId, current: reqIdRef.current });
            return;
          }

          setPartido({ ...enrichedPartidoData, jugadoresCount: count || 0 });
          setJugadores(jugadoresData || []);
          setInviteValidatedByNotification(true);

          if (isMatchClosed(partidoData)) {
            setError('Este partido fue cancelado o cerrado.');
            setLoading(false);
            return;
          }

          setLoading(false);
        } catch (err) {
          console.error('[LOAD_PARTIDO] invite no-code fallback failed', err);
          if (reqId === reqIdRef.current) {
            setError('Partido no encontrado');
            setLoading(false);
          }
        }
        return;
      }

      try {
        if (user?.id) {
          const inviteAccess = await fetchInviteAccessState({
            userId: user.id,
            matchId: partidoId,
          });

          if (reqId !== reqIdRef.current) {
            console.log('[LOAD_PARTIDO] Aborting stale request (invite mode access check)', { reqId, current: reqIdRef.current });
            return;
          }

          if (inviteAccess.blockedByKick) {
            showInlineNotice('warning', 'Ya no formás parte de este partido.');
            setError('Ya no tenés acceso a este partido.');
            setLoading(false);
            navigate('/', { replace: true });
            return;
          }

          if (!inviteAccess.hasActiveInvite) {
            showInlineNotice('warning', 'Esta invitación ya no está activa.');
            setError('Ya no tenés acceso a este partido.');
            setLoading(false);
            navigate('/', { replace: true });
            return;
          }
        }

        const { data, error: fetchError } = await supabase.rpc('get_partido_by_invite', {
          p_partido_id: Number(partidoId),
          p_codigo: codigoParam
        });

        if (reqId !== reqIdRef.current) {
          console.log('[LOAD_PARTIDO] Aborting stale request (invite mode)', { reqId, current: reqIdRef.current });
          return;
        }

        if (fetchError) {
          setError('Partido no encontrado.');
          setLoading(false);
          return;
        }
        if (!data || data.length === 0) {
          setCodigoValido(false);
          setError('Partido no encontrado');
          setLoading(false);
          return;
        }
        const partidoData = data[0];
        const { data: jugadoresData, count } = await supabase
          .from('jugadores')
          .select('*', { count: 'exact' })
          .eq('partido_id', partidoId);

        if (reqId === reqIdRef.current) {
          const enrichedPartidoData = await mergePartidoWithTeamsSnapshot({
            partidoBase: partidoData,
            matchId: partidoId,
            codigo: codigoParam || partidoData?.codigo || null,
          });

          if (reqId !== reqIdRef.current) {
            console.log('[LOAD_PARTIDO] Aborting stale request (invite mode enrich fetch)', { reqId, current: reqIdRef.current });
            return;
          }

          setPartido({ ...enrichedPartidoData, jugadoresCount: count || 0 });
          setJugadores(jugadoresData || []);
          // UX: for invite links, unauthenticated users go straight to "Sumarte rápido".
          if (!user && mode === 'invite') {
            setStep('guest-form');
          }
          if (isMatchClosed(partidoData)) {
            setError('Este partido fue cancelado o cerrado.');
            setLoading(false);
            return;
          }
          setLoading(false);
        }
      } catch (err) {
        if (reqId === reqIdRef.current) {
          setError('Partido no encontrado');
          setLoading(false);
        }
      }
    }
    loadPartido();
  }, [partidoId, codigoParam, mode, user, navigate]);

  // Realtime membership guard:
  // If the user is removed from jugadores while viewing the match, return to home immediately.
  useEffect(() => {
    if ((mode !== 'public' && mode !== 'invite') || !user?.id || !partidoId) return undefined;

    const channel = supabase
      .channel(`public-match-membership-${partidoId}-${user.id}`)
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'jugadores',
        filter: `partido_id=eq.${Number(partidoId)}`,
      }, (payload) => {
        const removedUserId = payload?.old?.usuario_id;
        if (String(removedUserId) !== String(user.id)) return;
        showInlineNotice('warning', 'Fuiste removido del partido por el admin.');
        setTimeout(() => navigate('/', { replace: true }), 900);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [mode, user?.id, partidoId, navigate]);

  useEffect(() => {
    let isCancelled = false;

    const clearConfirmedTeams = () => {
      if (isCancelled) return;
      setGuestConfirmedTeams({
        isAvailable: false,
        hasConfirmedFlag: false,
        teamAName: 'Equipo A',
        teamBName: 'Equipo B',
        teamAPlayers: [],
        teamBPlayers: [],
        teamAScore: 0,
        teamBScore: 0,
        balanceDiff: 0,
        balanceLabel: 'MUY PAREJO',
        balanceColor: '#10B981',
      });
      setGuestTeamsModalOpen(false);
    };

    const loadGuestConfirmedTeams = async () => {
      if (mode !== 'invite') {
        clearConfirmedTeams();
        return;
      }

      if (!partidoId || !partido || !Array.isArray(jugadores) || jugadores.length === 0) {
        clearConfirmedTeams();
        return;
      }

      try {
        const matchIdNum = Number(partidoId);
        const matchIdFilter = Number.isFinite(matchIdNum) ? matchIdNum : partidoId;

        let partidoRow = null;
        try {
          const { data: partidoData, error: partidoError } = await supabase
            .from('partidos')
            .select('teams_confirmed, teams_locked, equipos_json, equipos, survey_team_a, survey_team_b, final_team_a, final_team_b')
            .eq('id', matchIdFilter)
            .maybeSingle();
          if (!partidoError) {
            partidoRow = partidoData || null;
          }
        } catch (_partidoFetchError) {
          partidoRow = null;
        }

        const inviteCode = String(codigoParam || partido?.codigo || '').trim();
        if (!partidoRow && inviteCode) {
          try {
            const { data: rpcRows, error: rpcError } = await supabase.rpc('get_partido_by_invite', {
              p_partido_id: Number.isFinite(matchIdNum) ? matchIdNum : Number(matchIdFilter),
              p_codigo: inviteCode,
            });
            if (!rpcError && Array.isArray(rpcRows) && rpcRows[0]) {
              partidoRow = pickTeamsFieldsSnapshot(rpcRows[0]);
            }
          } catch (_rpcFetchError) {
            partidoRow = null;
          }
        }

        if (!partidoRow) {
          try {
            partidoRow = await fetchGuestMatchSnapshotWithAnon({
              matchId: matchIdFilter,
              codigo: inviteCode || null,
            });
          } catch (_anonFetchError) {
            partidoRow = null;
          }
        }

        if (isCancelled) return;

        const sourcePartido = partidoRow || partido || {};
        let teamAName = 'Equipo A';
        let teamBName = 'Equipo B';
        let teamAScoreFromPayload = null;
        let teamBScoreFromPayload = null;
        let teamARawRefs = [];
        let teamBRawRefs = [];
        let teamARefs = [];
        let teamBRefs = [];

        const persistedTeamsPayload = normalizeTeamsPayload(sourcePartido?.equipos_json ?? sourcePartido?.equipos);
        const [teamPayloadA, teamPayloadB] = pickOrderedTeamsFromPayload(persistedTeamsPayload);
        const payloadARefs = resolveTeamPlayerRefsFromPayload(teamPayloadA);
        const payloadBRefs = resolveTeamPlayerRefsFromPayload(teamPayloadB);
        if (payloadARefs.length > 0 && payloadBRefs.length > 0) {
          teamARawRefs = payloadARefs;
          teamBRawRefs = payloadBRefs;
          teamARefs = normalizeTeamRefs(teamARawRefs);
          teamBRefs = normalizeTeamRefs(teamBRawRefs);
          teamAName = String(teamPayloadA?.name || 'Equipo A').trim() || 'Equipo A';
          teamBName = String(teamPayloadB?.name || 'Equipo B').trim() || 'Equipo B';
          teamAScoreFromPayload = toFiniteNumber(teamPayloadA?.score);
          teamBScoreFromPayload = toFiniteNumber(teamPayloadB?.score);
        }

        if (teamARefs.length === 0 || teamBRefs.length === 0) {
          teamARawRefs = Array.isArray(sourcePartido?.survey_team_a) ? sourcePartido.survey_team_a : [];
          teamBRawRefs = Array.isArray(sourcePartido?.survey_team_b) ? sourcePartido.survey_team_b : [];
          teamARefs = normalizeTeamRefs(teamARawRefs);
          teamBRefs = normalizeTeamRefs(teamBRawRefs);
        }

        if (teamARefs.length === 0 || teamBRefs.length === 0) {
          teamARawRefs = Array.isArray(sourcePartido?.final_team_a) ? sourcePartido.final_team_a : [];
          teamBRawRefs = Array.isArray(sourcePartido?.final_team_b) ? sourcePartido.final_team_b : [];
          teamARefs = normalizeTeamRefs(teamARawRefs);
          teamBRefs = normalizeTeamRefs(teamBRawRefs);
        }

        if (teamARefs.length === 0 || teamBRefs.length === 0) {
          try {
            const { data: confirmationRow } = await supabase
              .from('partido_team_confirmations')
              .select('team_a, team_b')
              .eq('partido_id', matchIdFilter)
              .order('confirmed_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (isCancelled) return;

            if (confirmationRow) {
              teamARawRefs = Array.isArray(confirmationRow.team_a) ? confirmationRow.team_a : [];
              teamBRawRefs = Array.isArray(confirmationRow.team_b) ? confirmationRow.team_b : [];
              teamARefs = normalizeTeamRefs(teamARawRefs);
              teamBRefs = normalizeTeamRefs(teamBRawRefs);
            }
          } catch (_confirmationFetchError) {
            // Non-blocking fallback: if this lookup fails, keep current refs.
          }
        }

        const hasPersistedTeams = teamARefs.length > 0 && teamBRefs.length > 0;
        const hasConfirmedFlag = Boolean(
          partidoRow?.teams_confirmed
          ?? partido?.teams_confirmed
          ?? partidoRow?.teams_locked
          ?? partido?.teams_locked,
        );
        const shouldExposeGuestTeams = hasConfirmedFlag || hasPersistedTeams || normalizeTeamsPayload(sourcePartido?.equipos_json ?? sourcePartido?.equipos).length > 0;

        if (!shouldExposeGuestTeams) {
          clearConfirmedTeams();
          return;
        }

        const refToKeyMap = buildPlayerRefToKeyMap(jugadores);
        const keyToPlayerMap = new Map(
          jugadores.map((player) => [String(resolvePlayerKey(player) || '').trim(), player]).filter(([key]) => key),
        );
        const teamAPlayers = mapTeamRefsToPlayers({
          refs: teamARefs,
          rawRefs: teamARawRefs,
          refToKeyMap,
          keyToPlayerMap,
        });
        const teamBPlayers = mapTeamRefsToPlayers({
          refs: teamBRefs,
          rawRefs: teamBRawRefs,
          refToKeyMap,
          keyToPlayerMap,
        });
        const hasDisplayableTeams = teamAPlayers.length > 0 && teamBPlayers.length > 0;

        if (isCancelled) return;
        if (!hasDisplayableTeams) {
          setGuestConfirmedTeams({
            isAvailable: true,
            hasConfirmedFlag: true,
            teamAName,
            teamBName,
            teamAPlayers,
            teamBPlayers,
            teamAScore: 0,
            teamBScore: 0,
            balanceDiff: 0,
            balanceLabel: 'MUY PAREJO',
            balanceColor: '#10B981',
          });
          return;
        }

        const teamAScore = computeTeamScore({ explicitScore: teamAScoreFromPayload, players: teamAPlayers });
        const teamBScore = computeTeamScore({ explicitScore: teamBScoreFromPayload, players: teamBPlayers });
        const balanceDiff = Number(Math.abs(teamAScore - teamBScore).toFixed(1));
        const balanceMeta = resolveBalanceMeta(balanceDiff);

        setGuestConfirmedTeams({
          isAvailable: true,
          hasConfirmedFlag: true,
          teamAName,
          teamBName,
          teamAPlayers,
          teamBPlayers,
          teamAScore,
          teamBScore,
          balanceDiff,
          balanceLabel: balanceMeta.label,
          balanceColor: balanceMeta.color,
        });
      } catch (_guestTeamsError) {
        clearConfirmedTeams();
      }
    };

    loadGuestConfirmedTeams();

    return () => {
      isCancelled = true;
    };
  }, [mode, partidoId, partido, jugadores, codigoParam]);

  // Recheck membership for approved_pending_sync state
  async function recheckMembership(userUuid, matchId, originalReqId, attempt = 1) {
    const maxAttempts = 5;
    const intervalMs = 2000;

    if (attempt > maxAttempts) {
      console.warn('[RECHECK] Max attempts reached, falling back to none', { matchId, userUuid, originalReqId });

      // Only update if this is still the current request
      if (originalReqId === reqIdRef.current) {
        console.log('[PUBLIC_MATCH] setJoinStatus: none', {
          partidoId: matchId,
          userId: userUuid,
          source: 'recheck_timeout',
          reqId: originalReqId
        });
        setJoinStatus('none');
        showInlineNotice('warning', 'Tu aprobación aún no se reflejó. Reintentá más tarde.');
      }
      return;
    }

    console.log('[RECHECK] Attempt', { attempt, maxAttempts, matchId, userUuid, originalReqId });

    setTimeout(async () => {
      // Check if request is still current
      if (originalReqId !== reqIdRef.current) {
        console.log('[RECHECK] Aborting - request is stale', { originalReqId, current: reqIdRef.current });
        return;
      }

      const { isMember, jugadorRow } = await isUserMemberOfMatch(userUuid, matchId);

      // Check again after async operation
      if (originalReqId !== reqIdRef.current) {
        console.log('[RECHECK] Aborting - request became stale during check', { originalReqId, current: reqIdRef.current });
        return;
      }

      if (isMember) {
        console.log('[RECHECK] Success! User now in jugadores', { matchId, userUuid, jugadorRow, attempt, originalReqId });
        console.log('[PUBLIC_MATCH] setJoinStatus: approved', {
          partidoId: matchId,
          userId: userUuid,
          source: 'recheck_success',
          reqId: originalReqId
        });
        setJoinStatus('approved');
        openJoinSuccessModal();
      } else {
        console.log('[RECHECK] Not yet synced, retrying...', { attempt, matchId, userUuid, originalReqId });
        recheckMembership(userUuid, matchId, originalReqId, attempt + 1);
      }
    }, intervalMs);
  }

  // Si el usuario ya está logueado, ofrecerle sumar directamente
  useEffect(() => {
    if (user && partido && step === 'invitation') {
      // Usuario logueado puede sumarse directamente
    }
  }, [user, partido, step]);

  const handleSumarse = () => {
    if (isMatchClosed(partido)) {
      showInlineNotice('warning', 'Este partido fue cancelado o cerrado.');
      return;
    }

    const maxRoster = getMaxRosterSlots(partido);
    if (maxRoster > 0 && jugadores.length >= maxRoster) {
      showInlineNotice('warning', 'El partido ya está completo (incluye suplentes).');
      return;
    }

    if (mode === 'public') {
      handleSolicitarUnirme();
      return;
    }

    // Validar código antes de permitir suma
    if (!codigoValido) {
      showInlineNotice('warning', 'Link inválido o vencido.');
      return;
    }

    if (user) {
      // Usuario logueado: sumar directamente
      handleSumarseConCuenta();
    } else {
      // Usuario sin login: ingreso rápido con nombre + foto
      setStep('guest-form');
    }
  };

  const handleAddToCalendar = async () => {
    try {
      const { content, fileName } = buildMatchCalendarIcs(partido);
      await shareOrDownloadCalendarIcs({
        content,
        fileName,
        title: 'Agregar al calendario',
      });
    } catch (error) {
      console.error('[CALENDAR_ICS] Error creating calendar file', error);
      notifyBlockingError('No se pudo agregar el partido al calendario');
    }
  };

  const checkScheduleConflictAndMaybeWarn = async ({ skipWarning = false } = {}) => {
    if (!user?.id || !partido?.fecha || !partido?.hora) {
      return true;
    }

    const conflicts = await findUserScheduleConflicts({
      userId: user.id,
      excludeMatchId: Number(partidoId),
      targetMatch: {
        fecha: partido.fecha,
        hora: partido.hora,
        sede: partido.sede,
        nombre: partido.nombre,
      },
    });

    if (!skipWarning && conflicts.length > 0) {
      const first = conflicts[0];
      showScheduleWarning(
        `Ya tenés un partido en ese horario (${first.nombre || 'Partido'} · ${first.fecha} ${first.hora}).`,
      );
      return false;
    }

    return true;
  };

  const handleSolicitarUnirme = async (skipScheduleWarning = false) => {
    if (isMatchClosed(partido)) {
      showInlineNotice('warning', 'Este partido fue cancelado o cerrado.');
      return;
    }

    const maxRoster = getMaxRosterSlots(partido);
    if (maxRoster > 0 && jugadores.length >= maxRoster) {
      showInlineNotice('warning', 'El partido ya está completo (incluye suplentes).');
      return;
    }

    if (!user) {
      const currentUrl = window.location.pathname + window.location.search;
      navigate(`/login?returnTo=${encodeURIComponent(currentUrl)}`);
      return;
    }

    if (joinStatus !== 'none' || joinSubmitting) return;

    try {
      const canContinue = await checkScheduleConflictAndMaybeWarn({ skipWarning: skipScheduleWarning });
      if (!canContinue) {
        pendingContinueRef.current = async () => {
          closeScheduleWarning();
          await handleSolicitarUnirme(true);
        };
        return;
      }
    } catch (err) {
      console.error('[SOLICITAR_UNIRME] schedule check error', err);
      showInlineNotice('warning', 'No se pudo validar el conflicto de horario.');
      return;
    }

    setJoinSubmitting(true);
    try {
      console.log('[SOLICITAR_UNIRME] Creating join request for match:', partidoId, 'user:', user.id);

      // First, create the pending request
      const { data: newRequest, error: insertError } = await supabase
        .from('match_join_requests')
        .insert({
          match_id: Number(partidoId),
          user_id: user.id,
          status: 'pending'
        })
        .select('id')
        .single();

      if (insertError) {
        if (String(insertError.code) === '23505') {
          // Duplicate request - check existing status
          console.log('[SOLICITAR_UNIRME] Duplicate request detected, checking existing status');
          const { data: existingRequest } = await supabase
            .from('match_join_requests')
            .select('id, status')
            .eq('match_id', Number(partidoId))
            .eq('user_id', user.id)
            .single();

          if (existingRequest) {
            setJoinStatus(existingRequest.status);
            // No toast here: status is reflected in UI.
          }
          return;
        }
        throw insertError;
      }

      console.log('[SOLICITAR_UNIRME] Request created successfully:', newRequest.id);
      const requesterName = user?.user_metadata?.nombre || user?.email?.split('@')[0] || 'Un jugador';
      await notifyAdminJoinRequest({
        matchId: Number(partidoId),
        requestId: newRequest?.id || null,
        requesterUserId: user?.id || null,
        requesterName,
        adminUserId: partido?.creado_por || null,
      });
      setJoinStatus('pending');
      showInlineNotice('success', 'Solicitud enviada. Esperando aprobación del admin.');
    } catch (err) {
      console.error('[SOLICITAR_UNIRME] Error creating request:', {
        code: err.code,
        message: err.message,
        details: err.details,
        hint: err.hint
      });
      notifyBlockingError('No se pudo enviar la solicitud');
    } finally {
      setJoinSubmitting(false);
    }
  };

  const handleSumarseConCuenta = async (skipScheduleWarning = false) => {
    if (!user) {
      // Redirigir a login y volver a esta URL después
      const currentUrl = window.location.pathname + window.location.search;
      navigate(`/login?returnTo=${encodeURIComponent(currentUrl)}`);
      return;
    }

    const codigoFromUrl = String(codigoParam || '').trim();
    const codigoFromMatch = String(partido?.codigo || '').trim();
    const canBypassCodeValidation = inviteValidatedByNotification === true;

    // Validar código salvo cuando la invitación fue validada por notificación pendiente.
    if (!canBypassCodeValidation && codigoFromMatch && (!codigoFromUrl || codigoFromUrl !== codigoFromMatch)) {
      showInlineNotice('warning', 'Código inválido.');
      return;
    }

    if (mode === 'invite') {
      try {
        const inviteAccess = await fetchInviteAccessState({
          userId: user.id,
          matchId: partidoId,
        });

        const inviteInvalidated = inviteValidatedByNotification && !inviteAccess.hasActiveInvite;
        if (inviteAccess.blockedByKick || inviteInvalidated) {
          showInlineNotice('warning', 'Ya no tenés acceso a este partido.');
          navigate('/', { replace: true });
          return;
        }
      } catch (inviteAccessError) {
        console.error('[SUMARSE_CON_CUENTA] invite access check failed:', inviteAccessError);
      }
    }

    const buildPostJoinRoute = () => {
      return `/partido/${partidoId}`;
    };

    const maxRoster = getMaxRosterSlots(partido);
    if (maxRoster > 0 && jugadores.length >= maxRoster) {
      showInlineNotice('warning', 'El partido ya está completo (incluye suplentes).');
      return;
    }

    try {
      const canContinue = await checkScheduleConflictAndMaybeWarn({ skipWarning: skipScheduleWarning });
      if (!canContinue) {
        pendingContinueRef.current = async () => {
          closeScheduleWarning();
          await handleSumarseConCuenta(true);
        };
        return;
      }
    } catch (err) {
      console.error('[SUMARSE_CON_CUENTA] schedule check error', err);
      showInlineNotice('warning', 'No se pudo validar el conflicto de horario.');
      return;
    }

    setSubmitting(true);
    try {
      // Verificar si ya está en el partido
      const { data: existing } = await supabase
        .from('jugadores')
        .select('id')
        .eq('partido_id', partidoId)
        .eq('usuario_id', user.id)
        .maybeSingle();

      if (existing) {
        try {
          await markOwnMatchInviteAs({
            userId: user.id,
            matchId: partidoId,
            status: 'accepted',
          });
        } catch (markInviteError) {
          console.error('[SUMARSE_CON_CUENTA] Error marking existing invite as accepted:', markInviteError);
        }
        if (mode === 'invite') {
          navigate(buildPostJoinRoute());
        } else {
          setJoinStatus('approved');
        }
        return;
      }

      // Obtener datos del usuario
      const { data: userData } = await supabase
        .from('usuarios')
        .select('nombre, avatar_url')
        .eq('id', user.id)
        .maybeSingle();

      // Insertar jugador
      const { error: insertError } = await supabase
        .from('jugadores')
        .insert([{
          partido_id: Number(partidoId),
          usuario_id: user.id,
          nombre: userData?.nombre || user.email?.split('@')[0] || 'Jugador',
          avatar_url: userData?.avatar_url || null,
          is_goalkeeper: false,
        }]);

      if (insertError) {
        throw insertError;
      }

      try {
        await markOwnMatchInviteAs({
          userId: user.id,
          matchId: partidoId,
          status: 'accepted',
        });
      } catch (markInviteError) {
        console.error('[SUMARSE_CON_CUENTA] Error marking invite as accepted:', markInviteError);
      }

      const resolvedName = userData?.nombre || user.email?.split('@')[0] || 'Jugador';
      await notifyAdminPlayerJoined({
        matchId: Number(partidoId),
        playerName: resolvedName,
        playerUserId: user?.id || null,
        joinedVia: 'invite_link',
        adminUserId: partido?.creado_por || null,
      });

      if (mode === 'invite') {
        openJoinSuccessModal(() => {
          navigate(buildPostJoinRoute());
        });
      } else {
        setJoinStatus('approved');
        openJoinSuccessModal();
      }
    } catch (err) {
      console.error('[PartidoInvitacion] Error sumando con cuenta:', err);
      notifyBlockingError('No se pudo sumar al partido');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSumarseComoInvitado = async () => {
    if (!GUEST_SELF_JOIN_ENABLED) {
      showInlineNotice('info', 'Ingreso como invitado deshabilitado por ahora. El admin debe agregarte manualmente.');
      return;
    }

    // Protección double-click
    if (submitting) return;
    const maxRoster = getMaxRosterSlots(partido);
    if (maxRoster > 0 && jugadores.length >= maxRoster) {
      showInlineNotice('warning', 'El partido ya está completo (incluye suplentes).');
      return;
    }
    if (!guestName.trim()) {
      showInlineNotice('warning', 'Ingresá tu nombre.');
      return;
    }

    const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
    const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[INVITE] Missing env', { supabaseUrl: !!supabaseUrl, anonKey: !!anonKey });
      }
      showInlineNotice('warning', 'No se pudo validar la invitación. Reintentá en unos minutos.');
      return;
    }


    setSubmitting(true);
    try {
      const storageKey = getGuestStorageKey(partidoId, guestName);
      const existingGuestUuid = localStorage.getItem(storageKey);

      const response = await fetch(`${supabaseUrl}/functions/v1/join-match-guest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': anonKey,
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          partido_id: Number(partidoId),
          codigo: codigoParam,
          invite: inviteTokenParam,
          nombre: guestName.trim(),
          guest_uuid: existingGuestUuid || null,
          avatar_data_url: guestPhotoDataUrl || null,
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        // Log completo para debug
        console.error('[INVITE] join-match-guest error', { status: response.status, result });
        const reason = String(result?.reason || result?.code || '').toLowerCase();
        if (reason === 'invalid_code' || reason === 'invalidcode') {
          showInlineNotice('warning', 'Código inválido o vencido.');
          setCodigoValido(false);
          return;
        }
        if (reason === 'invalid_invite') {
          showInlineNotice('warning', 'Link vencido o inválido. Pedile al admin un link nuevo.');
          return;
        }
        if (reason === 'invite_consume_error') {
          showInlineNotice('warning', 'No se pudo validar el link. Reintentá en un momento.');
          return;
        }
        if (reason === 'full') {
          showInlineNotice('warning', 'El partido ya está completo.');
          return;
        }
        throw new Error(result.error || 'Error al sumarse');
      }

      if (result?.already_joined) {
        setAlreadyJoined(true);
        setStep('already-joined');
        showInlineNotice('info', `${guestName}, ya estabas anotado.`);
        return;
      }

      // Guardar en localStorage para idempotencia
      localStorage.setItem(storageKey, result.guest_uuid);

      setStep('success');
      showInlineNotice('success', `${guestName}, te sumaste al partido.`);

      // Redirigir después de 2 segundos a vista read-only (guest sin auth)
      setTimeout(() => {
        setStep('already-joined');
      }, 2000);
    } catch (err) {
      console.error('[PartidoInvitacion] Error sumando como invitado:', err);
      notifyBlockingError(err.message || 'No se pudo sumar al partido');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center p-4">
        <LoadingSpinner size="large" fullScreen />
      </div>
    );
  }

  if (error || !partido) {
    return (
      <div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 max-w-md w-full text-center">
          <div className="flex items-center justify-center mb-4">
            <CircleAlert className="w-10 h-10 text-white/70" />
          </div>
          <h2 className="text-white text-xl font-bold mb-2">Partido no encontrado</h2>
          <p className="text-white/70 mb-4">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="bg-primary text-white px-6 py-3 rounded-xl font-bold hover:brightness-110 transition-all"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  const maxRoster = getMaxRosterSlots(partido);
  const isMatchFull = maxRoster > 0 && jugadores.length >= maxRoster;

  // Pantalla 1: Invitación inicial o público
  if (step === 'invitation') {
    const isPublic = mode === 'public';
    const showBottomNav = !isPublic && !!user;
    const showViewTeamsButton = mode === 'invite'
      && (
        guestConfirmedTeams.isAvailable
        || guestConfirmedTeams.hasConfirmedFlag
        || Boolean(partido?.teams_confirmed)
        || normalizeTeamsPayload(partido?.equipos_json ?? partido?.equipos).length > 0
      );
    return (
      <>
        <SharedInviteLayout
          partido={partido}
          jugadores={jugadores}
          title={isPublic ? 'PARTIDO ABIERTO' : 'TE INVITARON A JUGAR'}
          showChatIcon={isPublic ? joinStatus === 'approved' : true}
          ctaVariant={isPublic ? 'public' : 'invite'}
          submitting={submitting || joinSubmitting}
          onSumarse={handleSumarse}
          onNavigateHome={() => navigate('/')}
          onNavigateBack={() => navigate(-1)}
          codigoValido={codigoValido}
          mode={mode}
          joinStatus={joinStatus}
          isMatchFull={isMatchFull}
          inlineNotice={inlineNotice}
          onClearInlineNotice={() => setInlineNotice(null)}
          onAddToCalendar={handleAddToCalendar}
          showViewTeamsButton={showViewTeamsButton}
          onViewTeams={() => setGuestTeamsModalOpen(true)}
          showBottomNav={showBottomNav}
        />
        {mode === 'invite' && (
          <GuestTeamsModal
            isOpen={guestTeamsModalOpen}
            onClose={() => setGuestTeamsModalOpen(false)}
            teamAName={guestConfirmedTeams.teamAName}
            teamBName={guestConfirmedTeams.teamBName}
            teamAPlayers={guestConfirmedTeams.teamAPlayers}
            teamBPlayers={guestConfirmedTeams.teamBPlayers}
            teamAScore={guestConfirmedTeams.teamAScore}
            teamBScore={guestConfirmedTeams.teamBScore}
            balanceDiff={guestConfirmedTeams.balanceDiff}
            balanceLabel={guestConfirmedTeams.balanceLabel}
            balanceColor={guestConfirmedTeams.balanceColor}
          />
        )}
        <ConfirmModal
          isOpen={scheduleWarning.isOpen}
          title="Conflicto de horario"
          message={scheduleWarning.message}
          confirmText="Continuar igual"
          cancelText="Cancelar"
          singleButton={false}
          onCancel={closeScheduleWarning}
          onConfirm={async () => {
            const fn = pendingContinueRef.current;
            if (typeof fn === 'function') {
              await fn();
              return;
            }
            closeScheduleWarning();
          }}
        />
        <ConfirmModal
          isOpen={joinSuccessModal.isOpen}
          title="Te has unido!"
          message="Podes acceder desde Mis partidos."
          confirmText="Aceptar"
          singleButton={true}
          onCancel={closeJoinSuccessModal}
          onConfirm={closeJoinSuccessModal}
        />
      </>
    );
  }

  // Pantalla 2: Elegir método (rápido o con cuenta)
  if (step === 'choose-method') {
    return (
      <div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="w-full flex justify-center mb-6">
            <img
              src={Logo}
              alt="ARMA2"
              className="h-[88px] w-auto drop-shadow-2xl"
            />
          </div>

          <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 w-full">
          <InlineNotice
            type={inlineNotice?.type}
            message={inlineNotice?.message}
            autoHideMs={4500}
            onClose={() => setInlineNotice(null)}
          />
          <div className="text-center mb-6">
            <h2 className="text-white text-2xl font-bold mb-2">¿Cómo querés sumarte?</h2>
            <p className="text-white/70 text-sm">Elegí la opción que prefieras</p>
          </div>

          {/* Opción A: Rápido (sin cuenta) */}
          <button
            onClick={() => setStep('guest-form')}
            className="w-full bg-white/15 border-2 border-white/30 hover:bg-white/20 hover:border-white/40 rounded-xl p-5 mb-4 text-left transition-all group"
          >
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
                <Zap className="w-6 h-6 text-white/85" />
              </div>
              <div className="flex-1">
                <h3 className="text-white font-bold text-lg mb-1 group-hover:text-primary transition-colors">
                  Sumarte rápido
                </h3>
                <p className="text-white/70 text-sm">
                  Solo tu nombre. Sin cuenta. Entrás directo al partido.
                </p>
              </div>
            </div>
          </button>

          {/* Opción B: Con cuenta */}
          <button
            onClick={handleSumarseConCuenta}
            disabled={submitting}
            className="w-full bg-white/15 border-2 border-white/30 hover:bg-white/20 hover:border-white/40 rounded-xl p-5 mb-4 text-left transition-all group disabled:opacity-50"
          >
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
                <LockKeyhole className="w-6 h-6 text-white/85" />
              </div>
              <div className="flex-1">
                <h3 className="text-white font-bold text-lg mb-1 group-hover:text-primary transition-colors">
                  Entrar con mi cuenta
                </h3>
                <p className="text-white/70 text-sm">
                  Iniciar sesión o crear cuenta. Guardá tus partidos y stats.
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => setStep('invitation')}
            className="w-full text-white/70 text-sm hover:text-white transition-all py-2"
          >
            ← Volver
          </button>
          </div>
        </div>
      </div>
    );
  }

  // Pantalla 3: Formulario invitado (solo nombre)
  if (step === 'guest-form') {
    return (
      <div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="w-full flex justify-center mb-6">
            <img
              src={Logo}
              alt="ARMA2"
              className="h-[88px] w-auto drop-shadow-2xl"
            />
          </div>
          <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 w-full">
          <InlineNotice
            type={inlineNotice?.type}
            message={inlineNotice?.message}
            autoHideMs={4500}
            onClose={() => setInlineNotice(null)}
          />
          <div className="text-center mb-6">
            <h2 className="text-white text-2xl font-bold mb-2">Sumarte rápido</h2>
            {partido?.nombre && (
              <p className="text-white/55 text-xs mt-2">
                Partido: <span className="text-white/80 font-semibold">{partido.nombre}</span>
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-white/70 text-xs">
              {partido?.fecha && (
                <span className="inline-flex items-center gap-1">
                  <Calendar size={12} />
                  {formatLocalDateShort(partido.fecha)}
                </span>
              )}
              {partido?.hora && (
                <span className="inline-flex items-center gap-1">
                  <Clock size={12} />
                  {partido.hora}
                </span>
              )}
              {partido?.sede && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={12} />
                  {String(partido.sede).split(/[,(]/)[0].trim()}
                </span>
              )}
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-white font-semibold mb-2">Tu foto (opcional)</label>
            <p className="text-white/60 text-xs mb-2">Poné tu selfie así la gente sabe quién sos.</p>
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-full overflow-hidden border border-white/30 bg-white/5 flex items-center justify-center shrink-0">
                {guestPhotoDataUrl ? (
                  <img src={guestPhotoDataUrl} alt="Tu foto" className="w-full h-full object-cover" />
                ) : (
                  <UserRound size={24} className="text-white/50" />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={openGuestPhotoPicker}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/20 bg-white/5 text-white/85 text-sm cursor-pointer hover:bg-white/10 transition-colors"
                >
                  <Camera size={16} />
                  {guestPhotoDataUrl ? 'Cambiar foto' : 'Subir foto'}
                </button>
                <input
                  ref={guestPhotoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleGuestPhotoChange}
                  className="hidden"
                />
              </div>
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-white font-semibold mb-2">Tu nombre</label>
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Ej: Juan Pérez"
              className="w-full bg-white/10 border border-white/20 text-white font-sans text-lg px-4 py-3 rounded-xl focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 placeholder:text-white/40"
              autoFocus
              maxLength={50}
            />
            <p className="text-white/50 text-xs mt-2">
              Así te van a ver en la lista de jugadores
            </p>
          </div>

          <button
            onClick={handleSumarseComoInvitado}
            disabled={!guestName.trim() || submitting}
            className="w-full text-white px-6 py-4 rounded-xl font-oswald font-semibold text-[18px] tracking-[0.01em] hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed mb-3 border shadow-[0_8px_24px_rgba(100,77,255,0.35)]"
            style={{
              background: INVITE_ACCEPT_BUTTON_VIOLET,
              borderColor: INVITE_ACCEPT_BUTTON_VIOLET_DARK,
            }}
          >
            {submitting ? 'Sumándote...' : 'Entrar al partido'}
          </button>
          </div>
        </div>
      </div>
    );
  }

  // Pantalla 4: Éxito
  if (step === 'success') {
    return (
      <div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="w-full flex justify-center mb-6">
            <img
              src={Logo}
              alt="ARMA2"
              className="h-[88px] w-auto drop-shadow-2xl"
            />
          </div>
          <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 w-full text-center">
          <div className="flex items-center justify-center mb-4">
            <CheckCircle2 className="w-12 h-12 text-emerald-300/90" />
          </div>
          <h2 className="text-white text-2xl font-bold mb-2">¡Listo!</h2>
          <p className="text-white/70 mb-4">
            Te sumaste al partido como <span className="font-bold text-white">{guestName}</span>
          </p>
          <p className="text-white/50 text-sm">
            Preparando vista...
          </p>
          </div>
        </div>
      </div>
    );
  }

  // Pantalla 5: Ya estás anotado (idempotencia)
  if (step === 'already-joined') {
    const venueFull = partido?.sede || '';
    const venueShort = getShortVenueName(venueFull);
    const venueMapsUrl = getGoogleMapsUrl(venueFull);

    return (
      <div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="w-full flex justify-center mb-6">
            <img
              src={Logo}
              alt="ARMA2"
              className="h-[88px] w-auto drop-shadow-2xl"
            />
          </div>

          <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 w-full">
          <div className="text-center mb-6">
            <div className="flex items-center justify-center mb-4">
              <CheckCircle2 className="w-12 h-12 text-emerald-300/90" />
            </div>
            <h2 className="text-white text-2xl font-bold mb-2">Ya estás anotado</h2>
            <p className="text-white/70 text-sm">
              Ya te sumaste a este partido anteriormente
            </p>
          </div>

          {/* Detalles del partido */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6 space-y-3">
            <div className="text-center mb-3">
              <h3 className="text-white text-lg font-bold">{partido?.nombre}</h3>
            </div>
            <div className="flex items-center gap-3 text-white">
              <Calendar className="w-6 h-6 text-white/80" />
              <div>
                <div className="text-sm text-white/60">Fecha</div>
                <div className="font-semibold">{partido?.fecha ? formatLocalDateShort(partido.fecha) : '-'}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 text-white">
              <Clock className="w-6 h-6 text-white/80" />
              <div>
                <div className="text-sm text-white/60">Hora</div>
                <div className="font-semibold">{partido?.hora || '-'}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 text-white">
              <MapPin className="w-6 h-6 text-white/80" />
              <div>
                <div className="text-sm text-white/60">Sede</div>
                {venueMapsUrl ? (
                  <a
                    href={venueMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-sm text-white underline decoration-white/50 underline-offset-2 hover:text-cyan-200 transition-colors"
                  >
                    {venueShort || '-'}
                  </a>
                ) : (
                  <div className="font-semibold text-sm">-</div>
                )}
              </div>
            </div>
          </div>

          <div className="text-center">
            <p className="text-white/60 text-sm mb-4">
              Te avisaremos novedades del partido
            </p>
            <button
              onClick={() => navigate('/')}
              className="text-white/70 text-sm hover:text-white transition-all"
            >
              Volver al inicio
            </button>
          </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
