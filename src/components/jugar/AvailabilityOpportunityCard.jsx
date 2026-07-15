import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import ReactDOM from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Check,
  ChevronRight,
  ClipboardList,
  Clock3,
  Crown,
  MapPin,
  MessageCircle,
  Search,
  Sparkles,
  Users,
} from 'lucide-react';

import { useAuth } from '../AuthProvider';
import AutoMatchOrganizeSheet from './AutoMatchOrganizeSheet';
import DistanceSlider from './DistanceSlider';
import PageTitle from '../PageTitle';
import { PlayerCardTrigger } from '../ProfileComponents';
import { supabase } from '../../lib/supabaseClient';
import { PRIMARY_CTA_BUTTON_CLASS } from '../../styles/buttonClasses';
import { hasValidCoordinates, toCoordinateNumber } from '../../utils/matchLocation';
import { captureException } from '../../utils/monitoring/sentry';
import {
  AUTO_MATCH_REFRESH_STEPS,
  getAutoMatchRefreshMessage,
  getAutoMatchRetryDelay,
  isAutoMatchOnline,
  runAutoMatchRefreshStep,
} from '../../utils/autoMatchRefresh';
import {
  ALLOWED_FORMATS,
  cancelMyAvailability,
  claimAutoMatchOrganizer,
  getAutoMatchProposalMembers,
  getAutoMatchProposalResponseError,
  getMyActiveAvailability,
  getMyActiveProposals,
  respondToAutoMatchProposal,
  respondToAutoMatchSubstitute,
  saveMyAvailability,
  syncMyAutoMatchGestations,
  syncMyAutoMatchLocationFromProfile,
} from '../../services/db/availability';

// El chat arrastra Capacitor Keyboard y la infra de realtime: se carga recién
// cuando el jugador abre la ventana de chat de la gestación.
const MatchChat = React.lazy(() => import('../MatchChat'));

const DAY_OPTIONS = [
  { value: 1, short: 'LU', label: 'Lun' },
  { value: 2, short: 'MA', label: 'Mar' },
  { value: 3, short: 'MI', label: 'Mié' },
  { value: 4, short: 'JU', label: 'Jue' },
  { value: 5, short: 'VI', label: 'Vie' },
  { value: 6, short: 'SA', label: 'Sáb' },
  { value: 7, short: 'DO', label: 'Dom' },
];

const START_HOURS = Array.from({ length: 17 }, (_, index) => `${String(index + 7).padStart(2, '0')}:00`);
const END_HOURS = Array.from({ length: 17 }, (_, index) => `${String(index + 8).padStart(2, '0')}:00`);
const REFRESH_MS = 30000;

const TIME_SELECT = 'h-[52px] w-full appearance-none rounded-xl border border-[#8b7cff]/35 bg-[#161130] [&>option]:bg-[#161130] [&>option]:text-white px-2 text-center font-bebas-real text-[26px] text-white outline-none [color-scheme:dark] focus:border-[#8b7cff] disabled:opacity-55';

const toMinutes = (value) => {
  const [hours, minutes] = String(value || '0:0').split(':').map(Number);
  return hours * 60 + (minutes || 0);
};

const displayTime = (value) => {
  const hhmm = String(value || '').slice(0, 5);
  return hhmm === '24:00' ? '00:00' : hhmm;
};

const formatWindow = (availability) => {
  if (!availability) return '';
  const days = (availability.days_of_week || [])
    .map((day) => DAY_OPTIONS.find((option) => option.value === day)?.label)
    .filter(Boolean)
    .join(' · ');
  return `${days} · ${displayTime(availability.time_start)}–${displayTime(availability.time_end)}`;
};

const formatProposalDate = (value) => new Date(value).toLocaleString('es-AR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const formatDeadline = (value) => new Date(value).toLocaleString('es-AR', {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const CANCELLED_REASONS = {
  member_declined: 'Una persona no pudo sumarse y se reorganizó la búsqueda.',
  below_threshold: 'Se bajaron varios jugadores y no hubo reemplazos disponibles.',
  no_organizer: 'Nadie tomó la organización a tiempo.',
  expired: 'No se llegó a completar a tiempo.',
  duplicate_slot: 'Se unificó con otra propuesta del mismo horario.',
};

// Estado visible de la GESTACIÓN para la UI. Una propuesta ya materializada
// ('created') no es una gestación: se resuelve aparte como invitación al partido
// real (ver isMatchInvite) o como redirección al partido. Exportado para tests.
export const resolveProposalStage = (proposal) => {
  const status = String(proposal?.status || '');
  if (status === 'created') return { key: 'created', label: 'Partido creado' };
  if (status === 'cancelled' || status === 'expired') return { key: 'cancelled', label: 'Cancelado' };
  if (status === 'ready') {
    return proposal?.organizer_id
      ? { key: 'organizing', label: 'Organizando' }
      : { key: 'needs_organizer', label: 'Falta organizador' };
  }
  const memberCount = Number(proposal?.member_count || 0);
  const maxPlayers = Number(proposal?.max_players || 0);
  return memberCount >= maxPlayers && maxPlayers > 0
    ? { key: 'waiting', label: 'Esperando respuestas' }
    : { key: 'searching', label: 'Buscando jugadores' };
};

// Una GESTACIÓN viva (collecting/ready): las únicas que aparecen en "Tus
// partidos en gestación" y las únicas con chat. Exportado para tests.
const INACTIVE_MEMBERSHIP_RESPONSES = new Set(['declined', 'expired', 'waitlisted', 'cancelled', 'canceled']);

const isPastTimestamp = (value, now) => {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp <= now;
};

export const isLiveGestation = (proposal, now = Date.now()) => {
  if (!proposal?.id) return false;
  if (!['collecting', 'ready'].includes(String(proposal.status || ''))) return false;
  if (!['searching', 'waiting', 'needs_organizer', 'organizing'].includes(resolveProposalStage(proposal).key)) return false;

  const membershipResponse = String(proposal.my_response || '').toLowerCase();
  if (INACTIVE_MEMBERSHIP_RESPONSES.has(membershipResponse)) return false;
  if (isPastTimestamp(proposal.expires_at, now)) return false;
  if (isPastTimestamp(proposal.proposed_starts_at, now)) return false;
  if (membershipResponse === 'pending' && isPastTimestamp(proposal.my_invite_expires_at, now)) return false;

  return true;
};

// Invitación a un partido YA creado (el plantel se materializó y me quedó una
// invitación pendiente). No es una gestación revivida: es una invitación al
// partido real. Exportado para tests.
export const isMatchInvite = (proposal) => (
  String(proposal?.status || '') === 'created'
  && proposal?.my_response === 'pending'
  && Boolean(proposal?.partido_id)
);

// §6: vacante de titular vs banco de suplente. El backend expone roster_slot_kind.
export const inviteSlotKind = (proposal) => (proposal?.roster_slot_kind === 'titular' ? 'titular' : 'suplente');

// La gestación pide algo del usuario: responder, tomar la organización o
// completar los datos del partido. Exportado para tests.
export const proposalNeedsAction = (proposal, userId) => {
  const stage = resolveProposalStage(proposal);
  if (stage.key === 'created' || stage.key === 'cancelled') return false;
  if (proposal?.my_response === 'pending') return true;
  if (stage.key === 'needs_organizer' && proposal?.my_response === 'accepted') return true;
  if (stage.key === 'organizing' && proposal?.organizer_id === userId) return true;
  return false;
};

// Orden de la lista: primero lo que requiere acción, después lo más próximo.
export const sortProposalsForList = (proposals, userId) => [...(proposals || [])].sort((a, b) => (
  Number(proposalNeedsAction(b, userId)) - Number(proposalNeedsAction(a, userId))
  || new Date(a?.proposed_starts_at || 0) - new Date(b?.proposed_starts_at || 0)
));

const STAGE_BADGE = {
  searching: 'border-[#9b7bff]/25 bg-[#6a43ff]/12 text-[#cfc4ff]',
  waiting: 'border-[#9b7bff]/25 bg-[#6a43ff]/12 text-[#cfc4ff]',
  needs_organizer: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
  organizing: 'border-[#2dd4bf]/30 bg-[#2dd4bf]/10 text-[#99f6e4]',
  created: 'border-[#2dd4bf]/30 bg-[#2dd4bf]/10 text-[#99f6e4]',
  substitute: 'border-[#fdb022]/30 bg-[#fdb022]/10 text-[#ffe1a6]',
  cancelled: 'border-white/12 bg-white/[0.05] text-white/50',
};

// El roster de la gestación expone user_id/nombre/avatar_url; el ProfileCard
// resuelve la cuenta real desde usuario_id/user_id/id y trae reputación,
// premios y acciones sociales al abrirse.
const memberToProfile = (member) => ({
  id: member.user_id,
  usuario_id: member.user_id,
  user_id: member.user_id,
  nombre: member.nombre,
  avatar_url: member.avatar_url,
  foto_url: member.avatar_url,
});

const MemberStatusLine = ({ member }) => {
  if (member.is_organizer) {
    return (
      <span className="mt-0.5 flex items-center gap-1 font-sans text-[9.5px] font-semibold text-[#ffe1a6]/85">
        <Crown size={10} className="text-[#fdb022]" /> Organiza
      </span>
    );
  }
  if (member.response === 'declined') {
    return <span className="mt-0.5 block font-sans text-[9.5px] text-white/40">No juega</span>;
  }
  if (member.response === 'accepted') {
    return (
      <span className="mt-0.5 flex items-center gap-1 font-sans text-[9.5px] text-white/50">
        <span className="h-1.5 w-1.5 rounded-full bg-[#2dd4bf]" /> Confirmado
      </span>
    );
  }
  return (
    <span className="mt-0.5 flex items-center gap-1 font-sans text-[9.5px] text-white/50">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-300" /> Pendiente
    </span>
  );
};

// Tile de jugador tappable: abre el ProfileCard del jugador (reputación,
// premios, solicitar amistad). Se apoya en PlayerCardTrigger.
const PlayerTile = ({ member }) => (
  <PlayerCardTrigger profile={memberToProfile(member)}>
    <div
      data-testid={`gestation-player-${member.user_id}`}
      className={`flex h-full items-center gap-2.5 rounded-2xl border border-white/[0.08] bg-black/20 px-3 py-2.5 transition-all hover:border-[#9b7bff]/40 hover:bg-black/30 ${member.response === 'declined' ? 'opacity-45' : ''}`}
    >
      {member.avatar_url ? (
        <img src={member.avatar_url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#6a43ff]/25 font-sans text-[13px] font-bold text-[#c8baff]">
          {String(member.nombre || '?').trim().charAt(0).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-oswald text-[13px] font-semibold text-white">{member.nombre || 'Jugador'}</span>
        <MemberStatusLine member={member} />
      </span>
    </div>
  </PlayerCardTrigger>
);

// Variante compacta para la lista: solo lo esencial y toda el área tocable.
export const CompactProposalCard = ({ proposal, onOpen }) => {
  const stage = resolveProposalStage(proposal);
  const accepted = Number(proposal.accepted_count || 0);
  const total = Number(proposal.max_players || 0);
  const progress = total > 0 ? Math.min(100, (accepted / total) * 100) : 0;

  return (
    <button
      type="button"
      data-testid={`gestation-card-${proposal.id}`}
      onClick={() => onOpen(proposal.id)}
      className="mb-2 flex w-full items-center gap-3 rounded-2xl border border-[rgba(148,134,255,0.2)] bg-[linear-gradient(150deg,rgba(39,30,85,0.72),rgba(13,10,31,0.94))] px-3.5 py-3 text-left shadow-[0_8px_24px_rgba(5,2,20,0.24),inset_0_1px_0_rgba(255,255,255,0.05)] transition-all hover:border-[rgba(148,134,255,0.4)] active:scale-[0.99] motion-reduce:transition-none"
    >
      <div className="min-w-0 flex-1">
        <p className="font-oswald text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#aa94ff]">Partido en gestación</p>
        <p className="mt-0.5 truncate font-oswald text-[13.5px] font-bold text-white">
          {proposal.format}
          <span className="mx-1.5 font-normal text-white/35">·</span>
          <span className="font-semibold capitalize text-white/80">{formatProposalDate(proposal.proposed_starts_at)}</span>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`rounded-full border px-2 py-0.5 font-sans text-[8.5px] font-bold uppercase tracking-[0.06em] ${STAGE_BADGE[stage.key]}`}>
            {stage.label}
          </span>
          <span className="font-sans text-[10.5px] font-semibold text-white/55">{accepted}/{total} confirmados</span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,#6a43ff,#a78bfa)] transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      <ChevronRight size={17} className="shrink-0 text-white/35" aria-hidden="true" />
    </button>
  );
};

// Card de invitación a un partido ya creado (§6/§10/§12). Estética propia
// (acento teal/dorado), distinta de la gestación: es una invitación al partido
// real, no una sala revivida.
export const MatchInviteCard = ({ proposal, onOpen }) => {
  const isTitular = inviteSlotKind(proposal) === 'titular';
  return (
    <button
      type="button"
      data-testid={`match-invite-card-${proposal.id}`}
      onClick={() => onOpen(proposal.id)}
      className="mb-2 flex w-full items-center gap-3 rounded-2xl border border-[rgba(45,212,191,0.28)] bg-[linear-gradient(150deg,rgba(17,58,55,0.66),rgba(11,20,30,0.94))] px-3.5 py-3 text-left shadow-[0_8px_24px_rgba(2,14,16,0.24),inset_0_1px_0_rgba(255,255,255,0.05)] transition-all hover:border-[rgba(45,212,191,0.5)] active:scale-[0.99] motion-reduce:transition-none"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#2dd4bf]/30 bg-[#2dd4bf]/15 text-[#99f6e4]">
        <Check size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-oswald text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#8fe9d8]">Te invitan a un partido</p>
        <p className="mt-0.5 truncate font-oswald text-[13.5px] font-bold text-white">
          {proposal.format}
          <span className="mx-1.5 font-normal text-white/35">·</span>
          <span className="font-semibold capitalize text-white/80">{formatProposalDate(proposal.proposed_starts_at)}</span>
        </p>
        <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 font-sans text-[8.5px] font-bold uppercase tracking-[0.06em] ${isTitular ? 'border-[#2dd4bf]/30 bg-[#2dd4bf]/10 text-[#99f6e4]' : 'border-[#fdb022]/30 bg-[#fdb022]/10 text-[#ffe1a6]'}`}>
          {isTitular ? 'Hay un lugar' : 'De suplente'}
        </span>
      </div>
      <ChevronRight size={17} className="shrink-0 text-white/35" aria-hidden="true" />
    </button>
  );
};

// Variante completa: el desglose de la pantalla de detalle. Sin card exterior:
// los elementos van directo sobre el fondo de la vista (el título de la
// pantalla ya anuncia "Partido en gestación").
export const ProposalDetail = ({
  proposal,
  members,
  userId,
  loading,
  onRespond,
  onClaim,
  onOrganize,
  onOpenMatch,
}) => {
  const stage = resolveProposalStage(proposal);
  const pending = proposal.my_response === 'pending';
  const accepted = Number(proposal.accepted_count || 0);
  const total = Number(proposal.max_players || 0);
  const memberCount = Number(proposal.member_count || 0);
  const capacity = Number(proposal.invitation_capacity || total);
  const missing = Math.max(0, Number(proposal.titular_slots_left ?? (total - accepted)));
  const mySeat = proposal.my_seat || null;
  const inviteDeadline = proposal.my_invite_expires_at || null;
  const progress = total > 0 ? Math.min(100, (accepted / total) * 100) : 0;
  const iAmOrganizer = Boolean(proposal.organizer_id) && proposal.organizer_id === userId;
  const iAccepted = proposal.my_response === 'accepted';
  const active = stage.key !== 'created' && stage.key !== 'cancelled';
  const visibleMembers = (members || []).filter((member) => member.response !== 'declined');
  const declinedMembers = (members || []).filter((member) => member.response === 'declined');
  const orderedMembers = [...visibleMembers, ...declinedMembers];
  // El chat de la gestación existe SOLO mientras la gestación está viva
  // (collecting/ready y dentro de expires_at). Una vez materializado el partido,
  // cancelado o vencido, el chat se cierra definitivamente: NO hay modo lectura.
  // Las comunicaciones futuras van al partido real. Al cerrarse se corta el
  // acceso y la suscripción realtime del canal anterior.
  const liveGestation = isLiveGestation(proposal);
  const chatAvailable = liveGestation
    && (!proposal.expires_at || new Date(proposal.expires_at).getTime() > Date.now());
  const iAmActiveMember = Boolean(proposal.my_response)
    && proposal.my_response !== 'declined'
    && chatAvailable;

  const proposalId = proposal.id;
  const chatReadKey = `chat_read_proposal:${proposalId}`;
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);

  // Si la gestación deja de estar disponible mientras el chat está abierto (se
  // materializó por una condición de carrera), se cierra el chat de inmediato:
  // desmonta MatchChat y con él las suscripciones realtime del canal anterior.
  useEffect(() => {
    if (chatOpen && !chatAvailable) setChatOpen(false);
  }, [chatOpen, chatAvailable]);

  // Contador de no leídos (best-effort): mismo criterio que ChatButton, con
  // scope por proposal_id. Si la consulta falla, simplemente no hay badge.
  useEffect(() => {
    if (!proposalId || chatOpen || !iAmActiveMember) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const lastRead = localStorage.getItem(chatReadKey);
        const lastReadTime = lastRead ? new Date(parseInt(lastRead, 10)) : new Date(0);
        const { data, error } = await supabase
          .from('mensajes_partido')
          .select('id')
          .eq('proposal_id', proposalId)
          .gt('timestamp', lastReadTime.toISOString());
        if (error || cancelled) return;
        setChatUnread(data?.length || 0);
      } catch (_error) {
        // best-effort: sin badge si falla
      }
    })();
    return () => { cancelled = true; };
  }, [proposalId, chatOpen, chatReadKey, iAmActiveMember]);

  return (
    <div className="pb-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#9b7bff]/25 bg-[#6a43ff]/15 text-[#c8baff]">
              <Sparkles size={18} />
            </span>
            <h3 className="font-bebas-real text-[34px] leading-none tracking-[0.03em] text-white">PARTIDO {proposal.format}</h3>
          </div>
          <p className="mt-2.5 font-oswald text-[13px] capitalize text-white/62">{formatProposalDate(proposal.proposed_starts_at)}</p>
          <p className="mt-1 flex items-center gap-1.5 font-sans text-[11px] text-white/42">
            <MapPin size={13} className="text-[#aa94ff]" />
            {stage.key === 'created'
              ? 'La cancha está definida en el partido'
              : 'La cancha la define quien organiza'}
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 font-sans text-[9px] font-bold uppercase tracking-[0.08em] ${STAGE_BADGE[stage.key]}`}>
          {stage.label}
        </span>
      </div>

      <div className="mt-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="font-oswald text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">Confirmados</p>
            <strong className="font-bebas-real text-[40px] leading-none text-white">{accepted}/{total}</strong>
          </div>
          <div className="text-right font-sans text-[11px] text-white/45">
            <p>{memberCount} convocados{capacity > total ? ` · hasta ${capacity}` : ''}</p>
            <p>{missing === 0 ? 'Titulares completos' : `Quedan ${missing} lugar${missing === 1 ? '' : 'es'} titular${missing === 1 ? '' : 'es'}`}</p>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,#6a43ff,#a78bfa,#2dd4bf)] shadow-[0_0_12px_rgba(139,92,255,0.45)] transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-2 font-sans text-[9.5px] text-white/32">Los lugares titulares se asignan por orden de confirmación.</p>
        {iAccepted && mySeat ? (
          <p
            data-testid="my-seat"
            className={`mt-1.5 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-sans text-[10px] font-bold uppercase tracking-[0.05em] ${mySeat === 'titular' ? 'border-[#2dd4bf]/30 bg-[#2dd4bf]/10 text-[#99f6e4]' : 'border-amber-400/30 bg-amber-400/10 text-amber-100'}`}
          >
            {mySeat === 'titular' ? 'Quedaste titular' : 'Quedaste suplente'}
          </p>
        ) : null}
        {pending && active && inviteDeadline ? (
          <p className="mt-1.5 flex items-center gap-1.5 font-sans text-[10px] text-white/45">
            <Clock3 size={12} className="text-[#aa94ff]" /> Podés responder hasta {formatDeadline(inviteDeadline)}
          </p>
        ) : null}
      </div>

      {orderedMembers.length > 0 ? (
        <div className="mt-6">
          <div className="mb-2.5 flex items-baseline justify-between gap-2">
            <p className="font-oswald text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">Jugadores</p>
            <p className="font-sans text-[10px] text-white/35">Tocá un jugador para ver su perfil</p>
          </div>
          <div className="grid grid-cols-2 gap-2" data-testid="proposal-roster">
            {orderedMembers.map((member) => <PlayerTile key={member.user_id} member={member} />)}
          </div>
          <p className="mt-2.5 font-sans text-[9.5px] text-white/32">
            <span className="mr-3"><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[#2dd4bf]" />confirmado</span>
            <span className="mr-3"><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-300" />pendiente</span>
            {declinedMembers.length > 0 ? (
              <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-white/40" />no juega</span>
            ) : null}
          </p>
        </div>
      ) : null}

      {iAmActiveMember ? (
        <button
          type="button"
          onClick={() => { setChatOpen(true); setChatUnread(0); }}
          data-testid="gestation-chat-button"
          className="mt-6 flex w-full items-center gap-3 rounded-2xl border border-[#0EA9C6]/25 bg-[#0EA9C6]/[0.08] px-3.5 py-3 text-left transition-all hover:bg-[#0EA9C6]/[0.14] active:scale-[0.99] motion-reduce:transition-none"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#0EA9C6]/35 bg-[#0EA9C6]/15 text-[#7fe3f5]">
            <MessageCircle size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-oswald text-[13.5px] font-semibold text-white">Chat del grupo</span>
            <span className="mt-0.5 block font-sans text-[10.5px] text-white/45">Coordiná con los jugadores de esta gestación</span>
          </span>
          {chatUnread > 0 ? (
            <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[#0EA9C6] px-1.5 font-sans text-[10px] font-bold text-white">
              {chatUnread > 99 ? '99+' : chatUnread}
            </span>
          ) : (
            <ChevronRight size={18} className="shrink-0 text-white/35" aria-hidden="true" />
          )}
        </button>
      ) : null}

      {proposal.organizer_id ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#fdb022]/20 bg-[#fdb022]/[0.07] px-3 py-2.5 font-oswald text-[11.5px] font-semibold text-[#ffe1a6]">
          <Crown size={14} className="shrink-0 text-[#fdb022]" />
          {iAmOrganizer ? 'Vos organizás este partido.' : `Organiza ${proposal.organizer_nombre || 'un jugador'}.`}
        </div>
      ) : null}

      {pending && active ? (
        <div className="mt-3">
          <p className="mb-2 font-oswald text-[11px] text-white/58">¿Te sumás a esta oportunidad?</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => onRespond(proposal.id, 'declined')}
              className="min-h-11 rounded-xl border border-white/12 bg-white/[0.035] font-oswald text-[13px] font-semibold text-white/58 transition-all hover:bg-white/[0.07] active:scale-[0.98] motion-reduce:transition-none"
            >
              Esta vez no
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => onRespond(proposal.id, 'accepted')}
              className="min-h-11 rounded-xl border border-white/15 bg-cta-gradient font-oswald text-[13px] font-bold text-white shadow-[0_7px_22px_rgba(106,67,255,0.3)] transition-all active:scale-[0.98] motion-reduce:transition-none"
            >
              <Check size={15} className="mr-1 inline" /> Me sumo
            </button>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => onRespond(proposal.id, 'accepted', { canOrganize: true })}
            className="mt-2 min-h-11 w-full rounded-xl border border-[#fdb022]/25 bg-[#fdb022]/[0.08] font-oswald text-[13px] font-semibold text-[#ffe1a6] transition-all hover:bg-[#fdb022]/[0.13] active:scale-[0.98] motion-reduce:transition-none"
          >
            <Crown size={14} className="mr-1.5 inline" /> Me sumo y puedo organizar
          </button>
        </div>
      ) : null}

      {stage.key === 'needs_organizer' ? (
        <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3">
          <p className="font-oswald text-[11.5px] font-semibold text-amber-100">
            Ya están todos los jugadores. Falta que alguien organice el partido.
          </p>
          {proposal.organizer_deadline_at ? (
            <p className="mt-1 font-sans text-[10px] text-amber-100/60">
              Reservado hasta {formatDeadline(proposal.organizer_deadline_at)}. Si nadie lo toma, se cancela.
            </p>
          ) : null}
          {iAccepted ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => onClaim(proposal.id)}
              className={`${PRIMARY_CTA_BUTTON_CLASS} mt-3 !min-h-[46px]`}
            >
              <Crown size={16} className="mr-2" /> Yo lo organizo
            </button>
          ) : null}
        </div>
      ) : null}

      {stage.key === 'organizing' && iAmOrganizer ? (
        <button
          type="button"
          disabled={loading}
          onClick={() => onOrganize(proposal)}
          className={`${PRIMARY_CTA_BUTTON_CLASS} mt-3 !min-h-[46px]`}
        >
          <ClipboardList size={16} className="mr-2" /> Completar datos del partido
        </button>
      ) : null}

      {stage.key === 'organizing' && !iAmOrganizer && iAccepted ? (
        <div className="mt-3 rounded-xl border border-white/[0.075] bg-black/15 px-3 py-2 font-sans text-[10.5px] leading-relaxed text-white/46">
          {proposal.organizer_nombre || 'Quien organiza'} está definiendo cancha, hora exacta y precio. Te avisamos al confirmarse.
        </div>
      ) : null}

      {stage.key === 'created' && proposal.partido_id ? (
        <div className="mt-3">
          <p className="mb-2 font-oswald text-[12px] font-semibold text-[#99f6e4]">
            El partido ya fue creado. Las comunicaciones siguen en el partido.
          </p>
          <button
            type="button"
            onClick={() => onOpenMatch(proposal.partido_id, iAmOrganizer)}
            className={`${PRIMARY_CTA_BUTTON_CLASS} !min-h-[46px]`}
          >
            <Check size={16} className="mr-2" /> Ir al partido
          </button>
        </div>
      ) : null}

      {stage.key === 'cancelled' ? (
        <div className="mt-3 rounded-xl border border-white/[0.075] bg-black/15 px-3 py-2 font-sans text-[10.5px] leading-relaxed text-white/46">
          {CANCELLED_REASONS[proposal.cancelled_reason] || 'La propuesta no siguió adelante.'} Tu disponibilidad sigue activa.
        </div>
      ) : null}

      {active && iAccepted && stage.key !== 'needs_organizer' && stage.key !== 'organizing' ? (
        <div className="mt-3 rounded-xl border border-white/[0.075] bg-black/15 px-3 py-2 font-sans text-[10.5px] leading-relaxed text-white/46">
          Ya confirmaste. Arma2 te avisará cuando cambie el estado.
        </div>
      ) : null}

      {chatOpen && chatAvailable ? (
        <React.Suspense fallback={null}>
          <MatchChat
            proposalId={proposalId}
            isOpen
            title="Chat de la gestación"
            canSend
            onClose={() => setChatOpen(false)}
          />
        </React.Suspense>
      ) : null}
    </div>
  );
};

// Invitación a un partido YA creado (§6/§10/§12). NO es una gestación revivida
// ni tiene chat: es una invitación al partido real. El texto y el CTA
// distinguen una vacante de titular ("hay un lugar, ¿te sumás?") de una de
// suplente ("los titulares están completos, ¿de suplente?").
export const MatchInviteView = ({ proposal, loading, onRespondSubstitute }) => {
  const slotKind = inviteSlotKind(proposal);
  const isTitular = slotKind === 'titular';
  const deadline = proposal.my_invite_expires_at || null;

  return (
    <div className="pb-1" data-testid="match-invite-view">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#2dd4bf]/25 bg-[#2dd4bf]/15 text-[#99f6e4]">
              <Check size={18} />
            </span>
            <h3 className="font-bebas-real text-[34px] leading-none tracking-[0.03em] text-white">PARTIDO {proposal.format}</h3>
          </div>
          <p className="mt-2.5 font-oswald text-[13px] capitalize text-white/62">{formatProposalDate(proposal.proposed_starts_at)}</p>
          <p className="mt-1 flex items-center gap-1.5 font-sans text-[11px] text-white/42">
            <MapPin size={13} className="text-[#2dd4bf]" /> El partido ya tiene cancha definida
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 font-sans text-[9px] font-bold uppercase tracking-[0.08em] ${isTitular ? 'border-[#2dd4bf]/30 bg-[#2dd4bf]/10 text-[#99f6e4]' : 'border-[#fdb022]/30 bg-[#fdb022]/10 text-[#ffe1a6]'}`}>
          {isTitular ? 'Te invitan a jugar' : 'Te invitan de suplente'}
        </span>
      </div>

      <div className="mt-6 rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-4">
        <p className="font-oswald text-[14px] font-semibold text-white">
          {isTitular
            ? 'Hay un lugar disponible. ¿Querés sumarte al partido?'
            : 'Los titulares ya están completos. ¿Querés sumarte como suplente?'}
        </p>
        <p className="mt-1.5 font-sans text-[11px] leading-relaxed text-white/45">
          {isTitular
            ? 'Al aceptar entrás al partido como titular y accedés a su chat.'
            : 'Al aceptar entrás al banco de suplentes y accedés al chat del partido.'}
        </p>
        {deadline ? (
          <p className="mt-2 flex items-center gap-1.5 font-sans text-[10px] text-white/45">
            <Clock3 size={12} className="text-[#aa94ff]" /> Podés responder hasta {formatDeadline(deadline)}
          </p>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={() => onRespondSubstitute(proposal.id, 'declined')}
          className="min-h-11 rounded-xl border border-white/12 bg-white/[0.035] font-oswald text-[13px] font-semibold text-white/58 transition-all hover:bg-white/[0.07] active:scale-[0.98] motion-reduce:transition-none"
        >
          No, gracias
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => onRespondSubstitute(proposal.id, 'accepted')}
          data-testid="match-invite-accept"
          className={`min-h-11 rounded-xl border font-oswald text-[13px] font-bold transition-all active:scale-[0.98] motion-reduce:transition-none ${isTitular
            ? 'border-white/15 bg-cta-gradient text-white shadow-[0_7px_22px_rgba(106,67,255,0.3)]'
            : 'border-[#fdb022]/30 bg-[#fdb022]/[0.12] text-[#ffe1a6]'}`}
        >
          <Check size={15} className="mr-1 inline" /> {isTitular ? 'Sumarme al partido' : 'Sumarme de suplente'}
        </button>
      </div>
    </div>
  );
};

export default function AvailabilityOpportunityCard() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [availability, setAvailability] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [proposalsLoaded, setProposalsLoaded] = useState(false);
  const [membersByProposal, setMembersByProposal] = useState({});
  const [profileLocation, setLocation] = useState(null);
  const [days, setDays] = useState([]);
  const [timeStart, setTimeStart] = useState('20:00');
  const [timeEnd, setTimeEnd] = useState('23:00');
  const [formats, setFormats] = useState(['F5', 'F7']);
  const [distance, setDistance] = useState(8);
  const [canOrganize, setCanOrganize] = useState(false);
  const [organizingProposal, setOrganizingProposal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [refreshIssue, setRefreshIssue] = useState(null);
  const [notice, setNotice] = useState('');
  const [listNotice, setListNotice] = useState('');
  const refreshAttemptRef = useRef(0);
  const refreshInFlightRef = useRef(false);

  const proposalParam = useMemo(
    () => new URLSearchParams(location.search).get('proposal'),
    [location.search],
  );

  // Invitación a un partido ya creado (vacante de titular o de suplente). Abre
  // una vista de invitación asociada al partido, no el detalle de la gestación.
  const inviteParam = useMemo(
    () => new URLSearchParams(location.search).get('invite'),
    [location.search],
  );

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('auto') || params.get('proposal') || params.get('invite')) setOpen(true);
  }, [location.search]);

  const close = useCallback(() => {
    setOpen(false);
    const params = new URLSearchParams(location.search);
    if (params.get('auto') || params.get('proposal') || params.get('invite')) {
      navigate(location.pathname, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  // Detalle → lista. Si se llegó desde la lista hay un entry propio en el
  // historial; si se entró por deep link, se reemplaza para no salir de la app.
  const backFromDetail = useCallback(() => {
    if (location.state?.fromAutoList) {
      navigate(-1);
    } else {
      navigate(`${location.pathname}?auto=1`, { replace: true });
    }
  }, [location.pathname, location.state, navigate]);

  const openProposal = useCallback((proposalId) => {
    setListNotice('');
    navigate(`${location.pathname}?auto=1&proposal=${proposalId}`, { state: { fromAutoList: true } });
  }, [location.pathname, navigate]);

  const openInvite = useCallback((proposalId) => {
    setListNotice('');
    navigate(`${location.pathname}?auto=1&invite=${proposalId}`, { state: { fromAutoList: true } });
  }, [location.pathname, navigate]);

  const recordRefreshFailure = useCallback((err, source) => {
    const online = isAutoMatchOnline();
    refreshAttemptRef.current += 1;
    setRefreshIssue({
      message: getAutoMatchRefreshMessage({ online }),
      attempt: refreshAttemptRef.current,
    });
    captureException(err?.cause || err, {
      feature: 'auto_match',
      flow: 'refresh',
      operation: err?.operation || 'unknown',
      target: err?.target || 'unknown',
      method: err?.method || 'unknown',
      source,
      online,
      retry_attempt: refreshAttemptRef.current,
    });
  }, []);

  const loadLocation = useCallback(async (source = 'profile_location') => {
    if (!user?.id) return false;
    try {
      const { data, error: profileError } = await runAutoMatchRefreshStep(
        AUTO_MATCH_REFRESH_STEPS.profileLocation,
        async () => {
          const response = await supabase
            .from('usuarios')
            .select('latitud, longitud')
            .eq('id', user.id)
            .maybeSingle();
          if (response.error) throw response.error;
          return response;
        },
      );

      if (!hasValidCoordinates(data?.latitud, data?.longitud)) {
        setLocation(null);
        return true;
      }

      setLocation({
        lat: toCoordinateNumber(data.latitud),
        lng: toCoordinateNumber(data.longitud),
      });
      // Idempotente: si la búsqueda ya tenía estas coordenadas no modifica la
      // fila. Si estaba incompleta, la vuelve elegible y corre el sync.
      await runAutoMatchRefreshStep(
        AUTO_MATCH_REFRESH_STEPS.location,
        () => syncMyAutoMatchLocationFromProfile(),
      );
      return true;
    } catch (err) {
      recordRefreshFailure(err, source);
      return false;
    }
  }, [recordRefreshFailure, user?.id]);

  const loadMembers = useCallback(async (proposalRows) => {
    const results = await Promise.all((proposalRows || []).map(async (proposal) => {
      try {
        const rows = await runAutoMatchRefreshStep(
          AUTO_MATCH_REFRESH_STEPS.members,
          () => getAutoMatchProposalMembers(proposal.id),
        );
        return { proposalId: proposal.id, rows, error: null };
      } catch (memberError) {
        return { proposalId: proposal.id, rows: null, error: memberError };
      }
    }));

    setMembersByProposal((current) => {
      const next = { ...current };
      results.forEach(({ proposalId, rows }) => {
        if (rows) next[proposalId] = rows;
      });
      return next;
    });

    const failure = results.find(({ error: memberError }) => memberError)?.error;
    if (failure) throw failure;
  }, []);

  const load = useCallback(async ({
    sync = false,
    source = 'unknown',
    force = false,
    refreshLocation = false,
  } = {}) => {
    if (!user?.id) return true;
    if (refreshInFlightRef.current) {
      if (!force) return null;
      await refreshInFlightRef.current;
    }
    let releaseRefresh;
    const inFlight = new Promise((resolve) => { releaseRefresh = resolve; });
    refreshInFlightRef.current = inFlight;
    try {
      const locationSucceeded = refreshLocation ? await loadLocation(source) : true;
      const active = await runAutoMatchRefreshStep(
        AUTO_MATCH_REFRESH_STEPS.availability,
        () => getMyActiveAvailability(user.id),
      );
      setAvailability(active);
      if (active) {
        setDays(active.days_of_week || []);
        setTimeStart(String(active.time_start).slice(0, 5));
        setTimeEnd(String(active.time_end).slice(0, 5));
        setFormats(active.formats || ['F5']);
        setDistance(active.max_distance_km || 8);
        setCanOrganize(Boolean(active.can_organize));
        if (sync && hasValidCoordinates(active.latitude, active.longitude)) {
          await runAutoMatchRefreshStep(
            AUTO_MATCH_REFRESH_STEPS.sync,
            () => syncMyAutoMatchGestations(),
          );
        }
      }
      const nextProposals = await runAutoMatchRefreshStep(
        AUTO_MATCH_REFRESH_STEPS.proposals,
        () => getMyActiveProposals(user.id),
      );
      setProposals(nextProposals);
      setProposalsLoaded(true);
      await loadMembers(nextProposals);
      refreshAttemptRef.current = 0;
      if (locationSucceeded) setRefreshIssue(null);
      return locationSucceeded;
    } catch (err) {
      recordRefreshFailure(err, source);
      return false;
    } finally {
      releaseRefresh();
      if (refreshInFlightRef.current === inFlight) refreshInFlightRef.current = null;
    }
  }, [loadLocation, loadMembers, recordRefreshFailure, user?.id]);

  useEffect(() => {
    let cancelled = false;
    const initialLoad = async () => {
      if (!cancelled) {
        await load({
          sync: true,
          source: 'initial_load',
          refreshLocation: true,
        });
      }
    };
    initialLoad();
    return () => { cancelled = true; };
  }, [load]);

  // Refresco periódico sin solapamientos. Ante un error conserva el último
  // estado válido y reintenta con backoff; al volver la conectividad adelanta
  // el próximo intento. El backend ya inicia gestaciones por cron, por lo que
  // este polling sólo refresca la vista y no es una dependencia del matcher.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    let timer = null;

    const schedule = (delay) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const succeeded = await load({
          sync: false,
          source: 'scheduled_refresh',
          refreshLocation: true,
        });
        if (cancelled) return;
        if (succeeded === null) {
          schedule(1000);
          return;
        }
        schedule(succeeded
          ? REFRESH_MS
          : getAutoMatchRetryDelay(refreshAttemptRef.current, { online: isAutoMatchOnline() }));
      }, delay);
    };

    const retryWhenOnline = () => schedule(0);
    schedule(refreshIssue
      ? getAutoMatchRetryDelay(refreshIssue.attempt, { online: isAutoMatchOnline() })
      : REFRESH_MS);
    window.addEventListener('online', retryWhenOnline);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener('online', retryWhenOnline);
    };
  }, [load, open, refreshIssue]);

  const retryRefresh = async () => {
    setRefreshing(true);
    await load({
      sync: false,
      source: 'manual_retry',
      force: true,
      refreshLocation: true,
    });
    setRefreshing(false);
  };

  const reportActionFailure = useCallback((err, {
    operation,
    target,
    message,
  }) => {
    captureException(err, {
      feature: 'auto_match',
      flow: 'action',
      operation,
      target,
      method: 'POST',
      online: isAutoMatchOnline(),
    });
    setError(message);
  }, []);

  const orderedProposals = useMemo(
    () => sortProposalsForList(proposals, user?.id),
    [proposals, user?.id],
  );

  // La lista "Tus partidos en gestación" muestra SOLO gestaciones vivas
  // (collecting/ready). Una propuesta materializada (created) desaparece de la
  // lista: si me toca, aparece en "Invitaciones a partidos" (isMatchInvite) o
  // se resuelve como redirección al partido real. Canceladas/vencidas tampoco
  // se acumulan como cards eternas.
  const visibleProposals = useMemo(
    () => orderedProposals.filter((proposal) => isLiveGestation(proposal)),
    [orderedProposals],
  );

  // §10/§12: invitaciones a partidos ya creados (vacante de titular o suplente).
  const matchInvites = useMemo(
    () => orderedProposals.filter(isMatchInvite),
    [orderedProposals],
  );

  const detailProposal = useMemo(() => {
    if (!proposalParam) return null;
    return proposals.find((proposal) => String(proposal.id) === String(proposalParam)) || null;
  }, [proposalParam, proposals]);

  const inviteProposal = useMemo(() => {
    if (!inviteParam) return null;
    return proposals.find((proposal) => String(proposal.id) === String(inviteParam)) || null;
  }, [inviteParam, proposals]);

  // Deep link viejo a ?proposal= que ya se materializó: la gestación (y su chat)
  // se cerraron. Se resuelve de forma controlada, sin reabrir el chat viejo ni
  // mostrar un error genérico:
  //  - si pertenezco al plantel (accepted) → al partido real;
  //  - si tengo una invitación pendiente → a la vista de invitación (?invite=);
  //  - si quedé fuera (no figura en mis propuestas) → aviso de estado final.
  useEffect(() => {
    if (!open || !proposalParam || !proposalsLoaded) return;
    const proposal = proposals.find((row) => String(row.id) === String(proposalParam));
    if (!proposal) {
      setListNotice('Esa gestación ya no está disponible.');
      navigate(`${location.pathname}?auto=1`, { replace: true });
      return;
    }
    if (String(proposal.status || '') === 'created' && proposal.partido_id) {
      if (proposal.my_response === 'pending') {
        navigate(`${location.pathname}?auto=1&invite=${proposal.id}`, { replace: true });
      } else {
        setNotice('El partido ya fue creado. Te llevamos al partido.');
        navigate(`/partido-publico/${proposal.partido_id}`, { replace: true });
      }
    }
  }, [location.pathname, navigate, open, proposalParam, proposals, proposalsLoaded]);

  // Deep link a ?invite= que ya no corresponde (aceptado, rechazado, vencido o
  // el plantel se completó): volver a la lista con un aviso de estado final.
  useEffect(() => {
    if (!open || !inviteParam || !proposalsLoaded) return;
    const proposal = proposals.find((row) => String(row.id) === String(inviteParam));
    if (!proposal) {
      setListNotice('Esa invitación ya no está disponible.');
      navigate(`${location.pathname}?auto=1`, { replace: true });
      return;
    }
    // Si ya soy parte del plantel (acepté), voy directo al partido.
    if (String(proposal.status || '') === 'created' && proposal.my_response === 'accepted' && proposal.partido_id) {
      navigate(`/partido-publico/${proposal.partido_id}`, { replace: true });
    }
  }, [location.pathname, navigate, open, inviteParam, proposals, proposalsLoaded]);

  const toggleDay = (day) => {
    setDays((current) => current.includes(day)
      ? current.filter((item) => item !== day)
      : [...current, day].sort((a, b) => a - b));
  };

  const changeTimeStart = (value) => {
    setTimeStart(value);
    if (toMinutes(timeEnd) - toMinutes(value) < 60) {
      const bumped = Math.min(24 * 60, toMinutes(value) + 180);
      setTimeEnd(`${String(Math.floor(bumped / 60)).padStart(2, '0')}:00`);
    }
  };

  const toggleFormat = (format) => {
    setFormats((current) => current.includes(format)
      ? current.filter((item) => item !== format)
      : [...current, format]);
  };

  const save = async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await saveMyAvailability({
        days,
        timeStart,
        timeEnd,
        formats,
        maxDistanceKm: distance,
        latitude: profileLocation?.lat,
        longitude: profileLocation?.lng,
        canOrganize,
      });
      // Solo lectores de pantalla: el resumen y el botón ya comunican el estado.
      setNotice('Búsqueda activada.');
      await load({ sync: true, source: 'availability_saved', force: true });
    } catch (err) {
      reportActionFailure(err, {
        operation: 'save_availability',
        target: 'rpc:upsert_my_availability',
        message: 'No pudimos activar la búsqueda. Probá de nuevo.',
      });
    } finally {
      setLoading(false);
    }
  };

  const cancel = async () => {
    setLoading(true);
    setError('');
    try {
      await cancelMyAvailability();
      setAvailability(null);
      setRefreshIssue(null);
      setNotice('Búsqueda desactivada.');
    } catch (err) {
      reportActionFailure(err, {
        operation: 'cancel_availability',
        target: 'rpc:cancel_my_availability',
        message: 'No pudimos detener la búsqueda. Tu búsqueda sigue activa.',
      });
    } finally {
      setLoading(false);
    }
  };

  const respond = async (proposalId, response, { canOrganize: respondCanOrganize = false } = {}) => {
    setLoading(true);
    setError('');
    try {
      await respondToAutoMatchProposal(proposalId, response, { canOrganize: respondCanOrganize });
      setNotice(response === 'accepted'
        ? 'Te sumaste. Arma2 te avisará cuando se complete.'
        : 'Saliste de esta propuesta. El grupo sigue y buscamos un reemplazo; tu disponibilidad queda activa.');
      if (response === 'declined' && String(proposalParam || '') === String(proposalId)) {
        backFromDetail();
      }
      await load({ sync: false, source: 'proposal_response' });
    } catch (err) {
      const expectedError = getAutoMatchProposalResponseError(err);
      if (expectedError) {
        setError(expectedError.message);
        if (expectedError.refreshSource) {
          await load({ sync: false, source: expectedError.refreshSource });
        }
      } else {
        reportActionFailure(err, {
          operation: 'respond_to_proposal',
          target: 'rpc:respond_to_auto_match_proposal',
          message: 'No pudimos guardar tu respuesta. Probá de nuevo.',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  // §6/§10/§12: aceptar/rechazar la invitación a un partido ya creado. Al
  // aceptar, el backend suma al partido real y devuelve su id → redirige al
  // partido. Al rechazar, la invitación desaparece.
  const respondSubstitute = async (proposalId, response) => {
    setLoading(true);
    setError('');
    try {
      const invited = proposals.find((row) => String(row.id) === String(proposalId));
      const isTitular = invited?.roster_slot_kind === 'titular';
      const partidoId = await respondToAutoMatchSubstitute(proposalId, response);
      if (response === 'accepted' && partidoId) {
        setNotice(isTitular
          ? '¡Entraste al partido! Te llevamos ahí.'
          : '¡Entraste como suplente! Te llevamos al partido.');
        navigate(`/partido-publico/${partidoId}`);
        return;
      }
      setNotice('Listo, no te sumás a este partido.');
      if (String(inviteParam || '') === String(proposalId)) backFromDetail();
      await load({ sync: false, source: 'match_invite_response' });
    } catch (err) {
      const message = err?.message || '';
      if (/match_roster_full/.test(message)) {
        setError('El lugar ya se ocupó. Tu disponibilidad sigue activa.');
        await load({ sync: false, source: 'match_roster_full' });
      } else if (/match_already_started/.test(message)) {
        setError('El partido ya empezó.');
        await load({ sync: false, source: 'match_started' });
      } else if (/substitute_invite_closed|proposal_member_not_found|proposal_not_materialized/.test(message)) {
        setError('Esta invitación ya no está disponible.');
        await load({ sync: false, source: 'match_invite_closed' });
      } else {
        reportActionFailure(err, {
          operation: 'respond_to_match_invite',
          target: 'rpc:respond_to_auto_match_substitute',
          message: 'No pudimos guardar tu respuesta. Probá de nuevo.',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const claim = async (proposalId) => {
    setLoading(true);
    setError('');
    try {
      await claimAutoMatchOrganizer(proposalId);
      setNotice('¡La organización es tuya! Completá cancha, hora y precio.');
      await load({ sync: false, source: 'organizer_claimed' });
    } catch (err) {
      const message = err?.message || '';
      if (/organizer_already_assigned/.test(message)) {
        setError('Otra persona tomó la organización primero.');
        await load({ sync: false, source: 'organizer_already_assigned' });
      } else if (/proposal_not_open|proposal_not_found|proposal_member_not_found/.test(message)) {
        setError('Esta propuesta ya no está esperando organización.');
        await load({ sync: false, source: 'organizer_proposal_closed' });
      } else {
        reportActionFailure(err, {
          operation: 'claim_organizer',
          target: 'rpc:claim_auto_match_organizer',
          message: 'No pudimos asignarte la organización. Probá de nuevo.',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const openMatch = useCallback((partidoId, asAdmin) => {
    navigate(asAdmin ? `/admin/${partidoId}` : `/partido-publico/${partidoId}`);
  }, [navigate]);

  const openProfileForLocation = useCallback(() => {
    setOpen(false);
    navigate('/profile', { state: { returnTo: `${location.pathname}?auto=1` } });
  }, [location.pathname, navigate]);

  if (!user?.id || !open) return null;

  const searchActive = Boolean(availability);
  const searchEligible = searchActive
    && hasValidCoordinates(availability?.latitude, availability?.longitude);
  const endOptions = END_HOURS.filter((option) => toMinutes(option) - toMinutes(timeStart) >= 60);
  const visibleError = error || refreshIssue?.message;
  const errorBanner = visibleError ? (
    <div role="alert" className="mt-3 rounded-xl border border-amber-400/24 bg-amber-400/10 px-3 py-2.5 font-oswald text-[11.5px] text-amber-100">
      <p>
        {visibleError}
        {!error && refreshIssue && searchActive
          ? (searchEligible ? ' Tu búsqueda sigue activa.' : ' Tu búsqueda sigue guardada.')
          : ''}
      </p>
      {!error && refreshIssue ? (
        <button
          type="button"
          disabled={refreshing}
          onClick={retryRefresh}
          className="mt-2 min-h-8 rounded-lg border border-amber-200/25 px-3 text-[10.5px] font-semibold text-amber-50 disabled:opacity-50"
        >
          {refreshing ? 'Reintentando…' : 'Reintentar'}
        </button>
      ) : null}
    </div>
  ) : null;

  return ReactDOM.createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Partido automático"
      className="fixed inset-0 z-[1200] overflow-y-auto bg-[linear-gradient(180deg,#141031_0%,#100b26_46%,#090715_100%)] text-white"
    >
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_50%_-8%,rgba(118,78,255,0.22),transparent_48%),radial-gradient(circle_at_8%_56%,rgba(73,43,171,0.14),transparent_32%)]" />
      <PageTitle respectSafeArea onBack={close}>PARTIDO AUTOMÁTICO</PageTitle>

      <main className="relative z-10 mx-auto w-full max-w-[560px] px-4 pb-[max(34px,var(--safe-bottom,0px))] pt-[calc(var(--safe-top,0px)+92px)] font-oswald">

        {/* Búsqueda: siempre primero y directamente sobre el fondo, sin card
            exterior. La misma estructura sirve para activa e inactiva: cuando
            está activa aparece el resumen arriba y los controles se apagan. */}
        <section aria-label="Tu búsqueda" data-testid="auto-search-section">
          <h2 className="mb-5 text-center font-bebas-real text-[clamp(36px,10vw,46px)] leading-[0.92] tracking-[0.035em] text-white drop-shadow-[0_8px_26px_rgba(5,2,20,0.7)]">
            ¿CUÁNDO PODÉS JUGAR?
          </h2>
          {searchActive ? (
            <div
              className="mb-4 flex items-start gap-3"
              data-testid={searchEligible ? 'search-active-summary' : 'search-incomplete-summary'}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#9b7bff]/25 bg-[#6a43ff]/15 text-[#c8baff]">
                {searchEligible ? <Search size={16} /> : <MapPin size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-oswald text-[13px] font-bold text-white">
                  {searchEligible ? 'Tu búsqueda está activa' : 'Tu búsqueda necesita ubicación'}
                </p>
                {!searchEligible ? (
                  <p className="mt-0.5 font-sans text-[10.5px] text-amber-100/75">
                    Agregá una ubicación para buscar jugadores cerca tuyo.
                  </p>
                ) : null}
                <p className="mt-0.5 font-oswald text-[11.5px] text-white/52">{formatWindow(availability)}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-sans text-[10px] text-white/42">
                  <span>{(availability.formats || []).join(' · ')}</span>
                  {availability.can_organize ? (
                    <span className="flex items-center gap-1 text-[#ffe1a6]/80">
                      <Crown size={10} className="text-[#fdb022]" /> Te ofreciste para organizar
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
          ) : null}

          <div className={searchActive ? 'opacity-55' : ''} aria-disabled={searchActive}>
            <div>
              <p className="mb-2 font-oswald text-[9px] font-semibold uppercase tracking-[0.14em] text-white/40">Días de la semana</p>
              <div className="grid grid-cols-7 gap-1">
                {DAY_OPTIONS.map((day) => {
                  const active = days.includes(day.value);
                  return (
                    <button
                      type="button"
                      key={day.value}
                      disabled={searchActive}
                      onClick={() => toggleDay(day.value)}
                      aria-pressed={active}
                      className={`min-h-11 rounded-xl border font-oswald text-[11.5px] font-bold transition-all active:scale-[0.95] motion-reduce:transition-none ${active
                        ? 'border-[#9b7bff] bg-[linear-gradient(145deg,rgba(112,48,255,0.62),rgba(57,24,132,0.8))] text-white shadow-[0_8px_22px_rgba(75,38,180,0.28)]'
                        : 'border-white/10 bg-white/[0.035] text-white/42 hover:border-[#9b7bff]/32 hover:text-white/68'}`}
                    >
                      {day.short}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/[0.075] bg-black/15 px-3.5 py-3">
              <div className="mb-2 flex items-center gap-1.5 font-oswald text-[9px] font-semibold uppercase tracking-[0.14em] text-white/40">
                <Clock3 size={13} className="text-[#9d82ff]" /> Rango horario
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <label>
                  <span className="sr-only">Desde</span>
                  <select aria-label="Desde" disabled={searchActive} value={timeStart} onChange={(event) => changeTimeStart(event.target.value)} className={TIME_SELECT}>
                    {START_HOURS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <span className="font-oswald text-[12px] font-semibold text-white/40">a</span>
                <label>
                  <span className="sr-only">Hasta</span>
                  <select aria-label="Hasta" disabled={searchActive} value={timeEnd} onChange={(event) => setTimeEnd(event.target.value)} className={TIME_SELECT}>
                    {endOptions.map((option) => <option key={option} value={option}>{displayTime(option)}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div className="mt-5">
              <p className="mb-2 font-oswald text-[9px] font-semibold uppercase tracking-[0.14em] text-white/40">Formatos aceptados</p>
              <div className="grid grid-cols-6 gap-1.5">
                {ALLOWED_FORMATS.map((format) => {
                  const active = formats.includes(format);
                  return (
                    <button
                      type="button"
                      key={format}
                      disabled={searchActive}
                      onClick={() => toggleFormat(format)}
                      aria-pressed={active}
                      className={`min-h-11 rounded-xl border font-oswald text-[12.5px] font-bold transition-all active:scale-[0.97] motion-reduce:transition-none ${active
                        ? 'border-[#9b7bff] bg-[linear-gradient(145deg,rgba(112,48,255,0.62),rgba(57,24,132,0.8))] text-white shadow-[0_8px_22px_rgba(75,38,180,0.28)]'
                        : 'border-white/10 bg-white/[0.035] text-white/42 hover:border-[#9b7bff]/32 hover:text-white/68'}`}
                    >
                      {format}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/[0.075] bg-black/15 px-3.5 py-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-oswald text-[9px] font-semibold uppercase tracking-[0.14em] text-white/40">Distancia máxima</span>
                <span className="rounded-full border border-[#9b7bff]/25 bg-[#6a43ff]/12 px-2.5 py-1 font-sans text-[10px] font-bold text-[#c8baff]">{distance} km</span>
              </div>
              <DistanceSlider
                min={1}
                max={30}
                step={1}
                value={distance}
                disabled={searchActive}
                onChange={setDistance}
                ariaLabel="Distancia máxima para partido automático"
                valueText={`${distance} km`}
              />
            </div>

            <button
              type="button"
              disabled={searchActive}
              onClick={() => setCanOrganize((current) => !current)}
              aria-pressed={canOrganize}
              className={`mt-5 flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all active:scale-[0.99] motion-reduce:transition-none ${canOrganize
                ? 'border-[#fdb022]/45 bg-[#fdb022]/[0.09]'
                : 'border-white/[0.075] bg-black/15 hover:border-[#fdb022]/25'}`}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${canOrganize
                ? 'border-[#fdb022]/40 bg-[#fdb022]/15 text-[#fdb022]'
                : 'border-white/10 bg-white/[0.04] text-white/40'}`}
              >
                <Crown size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-oswald text-[12.5px] font-semibold text-white">Puedo organizar el partido</span>
                <span className="mt-0.5 block font-sans text-[10px] leading-relaxed text-white/40">
                  Opcional. Si el grupo se completa, podés quedar como organizador para definir cancha y precio.
                </span>
              </span>
              <span
                aria-hidden="true"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${canOrganize
                  ? 'border-[#fdb022] bg-[#fdb022] text-[#241a02]'
                  : 'border-white/20 bg-transparent text-transparent'}`}
              >
                <Check size={15} strokeWidth={3} />
              </span>
            </button>

            <div className="mt-3 flex items-start gap-2 rounded-xl border border-white/[0.075] bg-white/[0.03] px-3 py-2.5 font-sans text-[10.5px] leading-relaxed text-white/42">
              <MapPin size={15} className="mt-0.5 shrink-0 text-[#aa94ff]" />
              {profileLocation
                ? 'Tu ubicación exacta solo se usa para calcular compatibilidad. No se comparte con los demás.'
                : 'Agregá una ubicación para buscar jugadores cerca tuyo. Sin ella, la búsqueda no participa del matching.'}
            </div>
          </div>

          {searchActive ? (
            <>
              {!searchEligible ? (
                <button
                  type="button"
                  onClick={openProfileForLocation}
                  className={`${PRIMARY_CTA_BUTTON_CLASS} mt-5 !min-h-[50px]`}
                >
                  <MapPin size={18} className="mr-2" /> Agregar ubicación
                </button>
              ) : null}
              <button
                type="button"
                disabled={loading}
                onClick={cancel}
                className={`${searchEligible ? 'mt-5' : 'mt-3'} min-h-[50px] w-full rounded-xl border border-rose-400/20 bg-rose-400/[0.07] font-oswald text-[13px] font-semibold text-rose-100/80 transition-all hover:bg-rose-400/10 active:scale-[0.985] motion-reduce:transition-none`}
              >
                Dejar de buscar
              </button>
            </>
          ) : profileLocation ? (
            <button
              type="button"
              disabled={loading || formats.length === 0 || days.length === 0}
              onClick={save}
              className={`${PRIMARY_CTA_BUTTON_CLASS} mt-5 !min-h-[50px]`}
            >
              <Users size={18} className="mr-2" /> Activar búsqueda
            </button>
          ) : (
            <button
              type="button"
              onClick={openProfileForLocation}
              className={`${PRIMARY_CTA_BUTTON_CLASS} mt-5 !min-h-[50px]`}
            >
              <MapPin size={18} className="mr-2" /> Agregar ubicación
            </button>
          )}
        </section>

        {/* Invitaciones a partidos ya creados: sección propia (no es gestación). */}
        {matchInvites.length > 0 ? (
          <section aria-label="Invitaciones a partidos" data-testid="match-invite-list-section" className="mt-7">
            <p className="mb-2 font-oswald text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8fe9d8]">Invitaciones a partidos</p>
            {matchInvites.map((proposal) => (
              <MatchInviteCard key={proposal.id} proposal={proposal} onOpen={openInvite} />
            ))}
          </section>
        ) : null}

        {listNotice ? (
          <p role="status" className="mt-7 font-sans text-[10.5px] text-white/40">{listNotice}</p>
        ) : null}

        {/* Lista compacta de gestaciones: sólo existe mientras haya cards vivas. */}
        {visibleProposals.length > 0 ? (
          <section aria-label="Tus partidos en gestación" data-testid="gestation-list-section" className="mt-7">
            <p className="mb-2 font-oswald text-[10px] font-semibold uppercase tracking-[0.16em] text-white/44">Tus partidos en gestación</p>
            {visibleProposals.map((proposal) => (
              <CompactProposalCard key={proposal.id} proposal={proposal} onOpen={openProposal} />
            ))}
          </section>
        ) : null}

        <p className="sr-only" role="status" aria-live="polite">{notice}</p>
        {errorBanner}
      </main>

      {/* Pantalla de detalle: capa propia sobre la lista, que queda montada
          debajo para conservar scroll y estado al volver. */}
      {proposalParam ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Partido en gestación"
          data-testid="gestation-detail-screen"
          className="fixed inset-0 z-[1250] overflow-y-auto bg-[linear-gradient(180deg,#141031_0%,#100b26_46%,#090715_100%)] text-white"
        >
          <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_50%_-8%,rgba(118,78,255,0.22),transparent_48%)]" />
          <PageTitle respectSafeArea onBack={backFromDetail}>PARTIDO EN GESTACIÓN</PageTitle>
          <main className="relative z-10 mx-auto w-full max-w-[560px] px-4 pb-[max(34px,var(--safe-bottom,0px))] pt-[calc(var(--safe-top,0px)+92px)] font-oswald">
            {detailProposal ? (
              <ProposalDetail
                proposal={detailProposal}
                members={membersByProposal[detailProposal.id] || []}
                userId={user.id}
                loading={loading}
                onRespond={respond}
                onClaim={claim}
                onOrganize={setOrganizingProposal}
                onOpenMatch={openMatch}
              />
            ) : (
              <p className="mt-6 text-center font-oswald text-[13px] text-white/50">Cargando gestación…</p>
            )}
            {errorBanner}
          </main>
        </div>
      ) : null}

      {/* Vista de invitación a un partido creado: capa propia, sin chat y sin
          el marco de "gestación". */}
      {inviteParam ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Invitación a un partido"
          data-testid="match-invite-screen"
          className="fixed inset-0 z-[1250] overflow-y-auto bg-[linear-gradient(180deg,#141031_0%,#100b26_46%,#090715_100%)] text-white"
        >
          <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_50%_-8%,rgba(45,212,191,0.16),transparent_48%)]" />
          <PageTitle respectSafeArea onBack={backFromDetail}>INVITACIÓN AL PARTIDO</PageTitle>
          <main className="relative z-10 mx-auto w-full max-w-[560px] px-4 pb-[max(34px,var(--safe-bottom,0px))] pt-[calc(var(--safe-top,0px)+92px)] font-oswald">
            {inviteProposal ? (
              <MatchInviteView
                proposal={inviteProposal}
                loading={loading}
                onRespondSubstitute={respondSubstitute}
              />
            ) : (
              <p className="mt-6 text-center font-oswald text-[13px] text-white/50">Cargando invitación…</p>
            )}
            {errorBanner}
          </main>
        </div>
      ) : null}

      {organizingProposal ? (
        <AutoMatchOrganizeSheet
          proposal={organizingProposal}
          onClose={() => setOrganizingProposal(null)}
          onFinalized={(partidoId) => {
            setOrganizingProposal(null);
            navigate(`/admin/${partidoId}`);
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}
