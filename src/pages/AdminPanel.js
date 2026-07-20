import logger from '../utils/logger';
import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../components/AuthProvider';
import { useAdminPanelState } from '../hooks/useAdminPanelState';
import { useTeamFormation } from '../hooks/useTeamFormation';
import { useSearchParams } from 'react-router-dom';
import { usePendingRequestsCount } from '../hooks/usePendingRequestsCount';
import { useNativeFeatures } from '../hooks/useNativeFeatures';
import { useScrollResetOnChange } from '../hooks/useScrollReset';
import { supabase } from '../supabase';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import { canAbandonWithoutPenalty, incrementMatchesAbandoned } from '../utils/matchStatsManager';
import { cancelPartidoWithNotification, leaveOwnedMatchWithTransfer, getJugadoresDelPartido, resetVotacion } from '../services/db/matches';
import { getTeamsFromDatabase } from '../services/db/teams';
import { requestImmediatePushDispatch } from '../services/pushDispatchService';

import 'react-lazy-load-image-component/src/effects/blur.css';
// import '../HomeStyleKit.css'; // Removed in Tailwind migration
// import './AdminPanel.css'; // Removed in Tailwind migration

import ArmarEquiposView from '../components/ArmarEquiposView';
import ChatButton from '../components/ChatButton';
import LoadingSpinner from '../components/LoadingSpinner';
import PageTitle from '../components/PageTitle';
import MatchInfoSection from '../components/MatchInfoSection';
import normalizePartidoForHeader from '../utils/normalizePartidoForHeader';
import ConfirmModal from '../components/ConfirmModal';
import { getPublicBaseUrl } from '../utils/publicBaseUrl';
import { buildGuestMatchInviteLink } from '../utils/guestMatchInviteLink';
import { parseLocalDate } from '../utils/dateLocal';
import { buildWhatsAppRosterMessage } from '../utils/buildWhatsAppRosterMessage';
import { analyzeTeamsAgainstRoster } from '../utils/teamRosterValidity';

import AdminActions from '../components/admin/AdminActions';
import PlayersSection from '../components/admin/PlayersSection';
import TeamsPanel from '../components/admin/TeamsPanel';
import Modals from '../components/admin/Modals';
import AdminTabs from '../components/admin/AdminTabs';
import SolicitudesSection from '../components/admin/SolicitudesSection';
import { getConvocatoriaDescription } from '../utils/matchSearchFilters';

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
    F9: 18,
    F11: 22,
  };

  return fallbackByType[normalized] || 10;
};

// Teams are persisted as a 2-item array ([equipoA, equipoB]) either inline on the
// match (equipos_json/equipos) or in the DB. These mirror ArmarEquiposView so we
// can detect "already armed" at the AdminPanel level and skip the intermediate.
const normalizeTeamsPayload = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      return Array.isArray(parsed) ? parsed : null;
    } catch (_error) {
      return null;
    }
  }
  return null;
};

const hasExpectedTeamShape = (teams) => (
  Array.isArray(teams) &&
  teams.length === 2 &&
  teams.find((t) => t?.id === 'equipoA') &&
  teams.find((t) => t?.id === 'equipoB')
);

const resolveInlineTeams = (match) => {
  for (const candidate of [match?.equipos_json, match?.equipos]) {
    const normalized = normalizeTeamsPayload(candidate);
    if (hasExpectedTeamShape(normalized)) return normalized;
  }
  return null;
};

/**
 * Main AdminPanel component for match management
 * @param {Object} props - Component props
 */
export default function AdminPanel({
  onBackToHome,
  jugadores,
  onJugadoresChange,
  onMatchChange,
  partidoActual,
}) {
  // Rebuild trace
  const { user } = useAuth();
  const isAdmin = user?.id && partidoActual?.creado_por === user.id;

  const adminState = useAdminPanelState({
    jugadores,
    onJugadoresChange,
    partidoActual,
    user,
    isAdmin,
    onBackToHome,
    onMatchChange,
  });

  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState({ open: false, type: null });
  const [processingAction, setProcessingAction] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState('jugadores');

  useScrollResetOnChange(activeTab);

  // Get pending requests count with realtime updates
  const { count: pendingRequestsCount, refreshCount: refreshPendingRequestsCount } = usePendingRequestsCount(partidoActual?.id);
  const { shareContent, isNative } = useNativeFeatures();

  // Handle tab from URL
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'solicitudes') {
      setActiveTab('solicitudes');
    }
  }, [searchParams]);

  useEffect(() => {
    const viewParam = searchParams.get('view');
    if (viewParam === 'armar-equipos') {
      adminState.setShowArmarEquiposView(true);
    }
  }, [searchParams, adminState.setShowArmarEquiposView]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (tab === 'solicitudes') {
      setSearchParams({ tab: 'solicitudes' });
    } else {
      setSearchParams({});
    }
  };

  const handleBackToAdminFromArmar = () => {
    adminState.setShowArmarEquiposView(false);

    if (searchParams.has('view')) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('view');
      setSearchParams(nextParams, { replace: true });
    }
  };

  const handleRequestAccepted = async () => {
    // Refresh players list from server
    await adminState.fetchJugadores();
    await refreshPendingRequestsCount();
  };

  const handleRequestResolved = async () => {
    await refreshPendingRequestsCount();
  };

  const { safeSetTeams, handleArmarEquipos: handleArmarEquiposUtil } = useTeamFormation();

  const handleTeamsChange = (newTeams) => {
    safeSetTeams(adminState.setTeams)(newTeams);
  };

  const handleTeamsFormed = (newTeams, updatedPlayers) => {
    safeSetTeams(adminState.setTeams)(newTeams);
    adminState.setShowTeamView(true);
    adminState.setShowArmarEquiposView(false);
    onJugadoresChange(updatedPlayers);
  };

  const handleArmarEquipos = () => {
    handleArmarEquiposUtil(jugadores, adminState.setShowArmarEquiposView);
  };
  const handleReviewStaleTeams = () => {
    adminState.setShowArmarEquiposView(true);
  };
  const displayedJugadores = Array.isArray(adminState.jugadoresActuales)
    ? adminState.jugadoresActuales
    : (Array.isArray(jugadores) ? jugadores : []);
  const starterCapacity = Number(partidoActual?.cupo_jugadores || 0);
  const balancedTeamsRequiredPlayers = resolveSlotsFromMatchType(partidoActual);
  const maxRosterSlots = starterCapacity > 0 ? starterCapacity + 4 : 0;
  const isRosterFull = maxRosterSlots > 0 && displayedJugadores.length >= maxRosterSlots;
  const canBuildBalancedTeams = displayedJugadores.length >= balancedTeamsRequiredPlayers;
  const buildTeamsLockedMessage = balancedTeamsRequiredPlayers > 0
    ? `Necesitás completar el plantel para armar los equipos (${displayedJugadores.length}/${balancedTeamsRequiredPlayers}).`
    : 'Necesitás completar el plantel para armar los equipos.';
  const buildTeamsHelperText = 'Disponible cuando el plantel esté completo';

  // --- "Equipos ya armados" shortcut ------------------------------------------------
  // When teams already exist, the main admin button jumps straight to the final
  // EQUIPOS ARMADOS view (TeamDisplay) instead of routing through the intermediate
  // ARMAR EQUIPOS / voting screen ("dos toques" → uno).
  const [existingTeams, setExistingTeams] = useState(() => resolveInlineTeams(partidoActual));

  useEffect(() => {
    let cancelled = false;
    const detectTeams = async () => {
      const matchId = partidoActual?.id;
      if (!matchId) {
        if (!cancelled) setExistingTeams(null);
        return;
      }
      const inline = resolveInlineTeams(partidoActual);
      if (inline) {
        if (!cancelled) setExistingTeams(inline);
        return;
      }
      if (partidoActual?.estado !== 'equipos_formados') {
        if (!cancelled) setExistingTeams(null);
        return;
      }
      try {
        const persisted = normalizeTeamsPayload(await getTeamsFromDatabase(matchId));
        if (!cancelled) setExistingTeams(hasExpectedTeamShape(persisted) ? persisted : null);
      } catch (_error) {
        if (!cancelled) setExistingTeams(null);
      }
    };
    detectTeams();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partidoActual?.id, partidoActual?.estado, partidoActual?.equipos_json, partidoActual?.equipos]);

  const existingTeamsAnalysis = useMemo(
    () => analyzeTeamsAgainstRoster(existingTeams, displayedJugadores),
    [existingTeams, displayedJugadores],
  );
  const staleTeamsDetected = existingTeamsAnalysis.hasTeamShape && existingTeamsAnalysis.isStale;
  const teamsAlreadyFormed = existingTeamsAnalysis.isValid;

  const handleViewExistingTeams = async () => {
    let teams = hasExpectedTeamShape(existingTeams) ? existingTeams : resolveInlineTeams(partidoActual);
    if (!hasExpectedTeamShape(teams) && partidoActual?.id) {
      try {
        teams = normalizeTeamsPayload(await getTeamsFromDatabase(partidoActual.id));
      } catch (_error) {
        teams = null;
      }
    }
    if (!hasExpectedTeamShape(teams)) {
      // No persisted teams found — fall back to the regular build/voting flow.
      handleArmarEquipos();
      return;
    }
    let matchPlayers = displayedJugadores.length > 0 ? displayedJugadores : null;
    if (!matchPlayers && partidoActual?.id) {
      matchPlayers = await getJugadoresDelPartido(partidoActual.id);
    }
    handleTeamsFormed(teams, matchPlayers || displayedJugadores || []);
  };

  // Reset triggered from the final EQUIPOS ARMADOS view: wipe votes/teams and drop
  // the admin back into the intermediate voting screen so they can re-arm.
  const handleResetVotingFromTeams = async () => {
    if (!partidoActual?.id) return;
    await resetVotacion(partidoActual.id);
    setExistingTeams(null);
    adminState.setShowTeamView(false);
    adminState.setShowArmarEquiposView(true);
    try {
      await adminState.fetchJugadores?.();
    } catch (_error) {
      // non-blocking
    }
  };
  const canOpenChatFromHeader = Boolean(isAdmin || adminState.isPlayerInMatch);
  const invitationsOpen = Boolean(
    partidoActual?.invitations_open
    ?? adminState.faltanJugadoresState
    ?? partidoActual?.falta_jugadores
    ?? partidoActual?.faltan_jugadores
    ?? false,
  );
  const playerDirectInvitesEnabled = Boolean(
    adminState.isPlayerInMatch
    && partidoActual?.player_invites_enabled === true
  );

  const formatInviteDateTime = (fechaRaw, horaRaw) => {
    const fecha = String(fechaRaw || '').trim().slice(0, 10);
    const hora = String(horaRaw || '').trim().slice(0, 5);

    if (!fecha && !hora) return '';
    if (!fecha) return hora ? `${hora} hs` : '';

    try {
      const dt = parseLocalDate(fecha);
      const day = dt.getDate();
      const month = dt.getMonth() + 1;
      const yearShort = String(dt.getFullYear()).slice(-2);
      const datePart = `${day}/${month}/${yearShort}`;
      return hora ? `${datePart} ${hora} hs` : datePart;
    } catch (_e) {
      return hora ? `${fecha} ${hora} hs` : fecha;
    }
  };

  const handleHeaderChatClick = () => {
    if (canOpenChatFromHeader) {
      setIsChatOpen(true);
      return;
    }

    if (adminState.pendingInvitation && !adminState.isPlayerInMatch) {
      logger.info('Aceptá la invitación para habilitar el chat del partido.');
      return;
    }

    logger.info('Sumate al partido para usar el chat.');
  };

  const handleAbandon = async () => {
    if (!partidoActual?.id || !user?.id) return;
    setProcessingAction(true);
    try {
      if (isAdmin) {
        const leaveResult = await leaveOwnedMatchWithTransfer(partidoActual.id);

        if (leaveResult?.mode === 'cancel_required') {
          await cancelPartidoWithNotification(
            partidoActual.id,
            'Partido cancelado porque el admin abandonó y no había otro jugador conectado para transferir la administración',
          );
          logger.info('No había otro jugador conectado. El partido fue cancelado.');
        } else {
          try {
            await requestImmediatePushDispatch({
              eventType: 'match_player_left',
              matchId: partidoActual.id,
              limit: 20,
            });
          } catch (dispatchError) {
            logger.error('[ADMIN_LEAVE] Error dispatching immediate admin-leave push:', dispatchError);
          }

          try {
            const canAbandonSafely = canAbandonWithoutPenalty(
              partidoActual?.fecha,
              partidoActual?.hora,
            );
            if (!canAbandonSafely) {
              await incrementMatchesAbandoned(user.id);
            }
          } catch (abandonError) {
            logger.error('[ADMIN_LEAVE] Error incrementing abandonment counter:', abandonError);
          }

          logger.info('Abandonaste el partido y la administración fue transferida.');
        }

        setTimeout(() => onBackToHome?.(), 1000);
        return;
      }

      // Must pass the numerical ID (PK) of the player, not the UUID
      const playerId = adminState.currentPlayerInMatch?.id;
      if (!playerId) {
        logger.error('Cannot abandon: No player ID found for current user');
        return;
      }

      await adminState.eliminarJugador(playerId, false);
    } finally {
      setProcessingAction(false);
      setConfirmConfig({ open: false, type: null });
    }
  };

  const resolveMatchJoinLink = async () => {
    const matchId = partidoActual?.id;
    const matchCode = String(partidoActual?.codigo || '').trim();
    if (!matchId || !matchCode) {
      notifyBlockingError('No se pudo generar el link de invitación');
      return null;
    }

    // Guest self-join token expires exactly at kickoff and supports larger rosters (min 26 uses).
    // Admin-only RPC enforces permissions server-side.
    const { data: inviteRows, error: inviteErr } = await supabase.rpc('create_guest_match_invite', {
      p_partido_id: Number(matchId),
    });

    if (inviteErr || !inviteRows?.[0]?.token) {
      logger.error('[SHARE_INVITE] create_guest_match_invite failed', inviteErr);
      const rawMessage = String(inviteErr?.message || '').toLowerCase();
      if (rawMessage.includes('match_already_started')) {
        notifyBlockingError('El partido ya empezó. El link de invitación venció.');
      } else if (rawMessage.includes('match_without_start_datetime')) {
        notifyBlockingError('El partido no tiene fecha/hora válida para generar el link.');
      } else {
        notifyBlockingError('No se pudo generar el link (token inválido)');
      }
      return null;
    }

    const inviteToken = String(inviteRows[0].token || '').trim();
    const baseUrl = getPublicBaseUrl() || window.location.origin;
    return buildGuestMatchInviteLink({
      baseUrl,
      matchId,
      matchCode,
      inviteToken,
    });
  };

  const openWhatsAppShare = async ({ title, text, url }) => {
    const safeText = String(text || '').trim();
    const safeUrl = String(url || '').trim();
    const payloadText = safeText
      ? (safeUrl && !safeText.includes(safeUrl) ? `${safeText}\n${safeUrl}` : safeText)
      : safeUrl;
    const encodedText = encodeURIComponent(payloadText);
    const whatsappWebUrl = `https://api.whatsapp.com/send?text=${encodedText}`;
    const whatsappAppUrl = `whatsapp://send?text=${encodedText}`;
    const isMobileWeb = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');

    if (isNative) {
      try {
        await shareContent(title, payloadText, undefined);
        return true;
      } catch (nativeShareError) {
        logger.warn('[WHATSAPP_SHARE] Native share failed, fallback to wa.me', nativeShareError);
      }
    }

    // On mobile web force WhatsApp app deep-link to open contact selector directly.
    if (isMobileWeb) {
      window.location.href = whatsappAppUrl;
      return true;
    }

    const opened = window.open(whatsappWebUrl, '_blank', 'noopener,noreferrer');
    if (opened) return true;

    window.location.href = whatsappWebUrl;
    return true;
  };

  const handleShare = async () => {
    const url = await resolveMatchJoinLink();
    if (!url) return;

    const dateTimeLabel = formatInviteDateTime(partidoActual?.fecha, partidoActual?.hora);
    const text = dateTimeLabel
      ? `Sumate al partido "${partidoActual.nombre || 'Partido'}"\n${dateTimeLabel}\n${url}`
      : `Sumate al partido "${partidoActual.nombre || 'Partido'}"\n${url}`;

    try {
      await openWhatsAppShare({
        title: 'Invitar al partido',
        text,
        url,
      });
    } catch (err) {
      logger.error('Error sharing:', err);
      notifyBlockingError('No se pudo abrir WhatsApp');
    }
  };

  const handleShareRosterUpdate = async () => {
    const matchId = partidoActual?.id;
    const capacity = Number(partidoActual?.cupo_jugadores || 0);
    if (!matchId || capacity <= 0) return false;

    let latestPlayers = displayedJugadores;
    try {
      const refreshedPlayers = await adminState.fetchJugadores();
      if (Array.isArray(refreshedPlayers)) {
        latestPlayers = refreshedPlayers;
      }
    } catch (error) {
      logger.warn('[SHARE_ROSTER] Using local players after refresh error', error);
    }

    let joinLink = null;
    if (isAdmin) {
      joinLink = await resolveMatchJoinLink();
      if (!joinLink) return false;
    }

    const message = buildWhatsAppRosterMessage({
      ...partidoActual,
      capacity,
      players: latestPlayers,
      locationName: partidoActual?.locationName || partidoActual?.sede || partidoActual?.cancha || partidoActual?.nombre_cancha || partidoActual?.lugar,
      address: partidoActual?.address || partidoActual?.direccion,
      startAt: partidoActual?.startAt,
    }, joinLink);

    try {
      await openWhatsAppShare({
        title: 'Update del partido',
        text: message,
        url: joinLink,
      });
      return true;
    } catch (error) {
      logger.error('[SHARE_ROSTER] Error sharing update', error);
      notifyBlockingError('No se pudo compartir el update por WhatsApp');
      return false;
    }
  };

  const showTeams =
    adminState.showTeamView &&
    Array.isArray(adminState.teams) &&
    adminState.teams.length === 2 &&
    adminState.teams.find((t) => t.id === 'equipoA') &&
    adminState.teams.find((t) => t.id === 'equipoB');

  if (!partidoActual || !adminState.invitationChecked) {
    return <LoadingSpinner size="large" fullScreen />;
  }

  return (
    <>
      {adminState.showArmarEquiposView ? (
        <ArmarEquiposView
          onBackToAdmin={handleBackToAdminFromArmar}
          jugadores={jugadores}
          onJugadoresChange={onJugadoresChange}
          partidoActual={partidoActual}
          onTeamsFormed={handleTeamsFormed}
          onChatClick={handleHeaderChatClick}
          chatUnreadCount={chatUnreadCount}
        />
      ) : (
        <>
          <PageTitle
            title={isAdmin ? 'CONVOCA JUGADORES' : 'TE INVITARON A JUGAR'}
            onBack={onBackToHome}
            showChatButton={true}
            onChatClick={handleHeaderChatClick}
            unreadCount={chatUnreadCount}
          />

          {!showTeams && (
            <div className="w-full overflow-visible">
              <MatchInfoSection
                partido={normalizePartidoForHeader(partidoActual)}
                fecha={partidoActual?.fecha}
                hora={partidoActual?.hora}
                sede={partidoActual?.sede}
                modalidad={partidoActual?.modalidad}
                tipo={partidoActual?.tipo_partido}
                precio={partidoActual?.valor_cancha || partidoActual?.valorCancha || partidoActual?.valor || partidoActual?.precio}
                topOffsetClassName="mt-[52px] md:mt-[48px]"
                flushTop
              />
            </div>
          )}

          {/* Tabs full-bleed outside padded/clip containers */}
          {!showTeams && isAdmin && !adminState.pendingInvitation && (
            <AdminTabs
              activeTab={activeTab}
              onTabChange={handleTabChange}
              pendingCount={pendingRequestsCount}
            />
          )}

          <main className={`pt-0 ${showTeams ? 'overflow-visible' : 'overflow-x-clip'}`}>
            <div className="main-content">
              {showTeams && (
                <TeamsPanel
                  showTeams={showTeams}
                  teams={adminState.teams}
                  jugadores={displayedJugadores}
                  handleTeamsChange={handleTeamsChange}
                  onBackToHome={onBackToHome}
                  isAdmin={isAdmin}
                  partidoActual={partidoActual}
                  onResetVoting={handleResetVotingFromTeams}
                />
              )}
              <div className={`w-full max-w-full mx-auto flex flex-col gap-3 overflow-visible min-w-0 ${isAdmin ? 'pt-3' : 'pt-0'}`}>

                {!showTeams && (
                  <>
                    {/* Show AdminActions only on Jugadores tab */}
                    {activeTab === 'jugadores' && (
                      <AdminActions
                        isAdmin={isAdmin}
                        pendingInvitation={adminState.pendingInvitation}
                        nuevoNombre={adminState.nuevoNombre}
                        setNuevoNombre={adminState.setNuevoNombre}
                        loading={adminState.loading}
                        isClosing={adminState.isClosing}
                        partidoActual={partidoActual}
                        jugadores={displayedJugadores}
                        agregarJugador={adminState.agregarJugador}
                        setShowInviteModal={adminState.setShowInviteModal}
                        user={user}
                        inputRef={adminState.inputRef}
                        onShareClick={handleShare}
                      />
                    )}

                    {/* Conditional content based on active tab */}
                    {activeTab === 'jugadores' ? (
                      <PlayersSection
                        isAdmin={isAdmin}
                        jugadores={displayedJugadores}
                        partidoActual={partidoActual}
                        duplicatesDetected={adminState.duplicatesDetected}
                        votantesConNombres={adminState.votantesConNombres}
                        votantes={adminState.votantes}
                        transferirAdmin={adminState.transferirAdmin}
                        user={user}
                        eliminarJugador={adminState.eliminarJugador}
                        isClosing={adminState.isClosing}
                        isPlayerInMatch={adminState.isPlayerInMatch}
                        pendingInvitation={adminState.pendingInvitation}
                        aceptarInvitacion={adminState.aceptarInvitacion}
                        rechazarInvitacion={adminState.rechazarInvitacion}
                        invitationLoading={adminState.invitationLoading}
                        setShowInviteModal={adminState.setShowInviteModal}
                        currentPlayerInMatch={adminState.currentPlayerInMatch}
                        actionsMenuOpen={actionsMenuOpen}
                        setActionsMenuOpen={setActionsMenuOpen}
                        confirmConfig={confirmConfig}
                        setConfirmConfig={setConfirmConfig}
                        processingAction={processingAction}
                        handleAbandon={handleAbandon}
                        invitationStatus={adminState.invitationStatus}
                        onInviteFriends={() => adminState.setShowInviteModal(true)}
                        onAddManual={adminState.agregarJugador}
                        onShareClick={handleShare}
                        onShareRosterUpdate={handleShareRosterUpdate}
                        unirseAlPartido={adminState.unirseAlPartido}
                      />
                    ) : (
                      <SolicitudesSection
                        partidoActual={partidoActual}
                        onRequestAccepted={handleRequestAccepted}
                        onRequestResolved={handleRequestResolved}
                      />
                    )}

                    {/* ¿Faltan jugadores? — two independent toggles (Jugadores /
                        Arquero) on the same line. Only on the Jugadores tab. */}
                    {isAdmin && !adminState.pendingInvitation && activeTab === 'jugadores' && (
                      <div className="flex flex-col items-center gap-1.5 my-3 mx-auto w-full max-w-[440px] text-white/80 font-oswald">
                        <span className="text-sm">¿Faltan jugadores?</span>
                        <div className="flex items-stretch justify-center gap-2 w-full">
                          {[
                            {
                              key: 'players',
                              label: 'Jugadores',
                              checked: adminState.faltanJugadoresState,
                              onChange: adminState.handleFaltanJugadores,
                            },
                            {
                              key: 'goalkeeper',
                              label: 'Arquero',
                              checked: adminState.buscaArqueroState,
                              onChange: adminState.handleBuscaArquero,
                            },
                          ].map((toggle) => {
                            const disabled = isRosterFull && !toggle.checked;
                            return (
                              <label
                                key={toggle.key}
                                className="flex-1 min-w-0 flex items-center justify-between gap-2 rounded-xl border border-[rgba(148,134,255,0.22)] bg-[rgba(20,16,41,0.6)] px-3 py-2.5"
                                style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
                              >
                                <span className="text-[13px] font-semibold text-white/90 truncate">{toggle.label}</span>
                                <span
                                  role="switch"
                                  aria-checked={toggle.checked}
                                  aria-label={toggle.label}
                                  aria-disabled={disabled}
                                  onClick={() => { if (!disabled) toggle.onChange(); }}
                                  style={{
                                    position: 'relative',
                                    display: 'inline-block',
                                    flexShrink: 0,
                                    width: '46px',
                                    height: '24px',
                                    borderRadius: '24px',
                                    backgroundColor: toggle.checked ? '#6a43ff' : 'rgba(255,255,255,0.22)',
                                    transition: '0.25s',
                                    opacity: disabled ? 0.5 : 1,
                                  }}
                                >
                                  <span style={{
                                    position: 'absolute',
                                    height: '18px',
                                    width: '18px',
                                    left: toggle.checked ? '25px' : '3px',
                                    top: '3px',
                                    backgroundColor: 'white',
                                    transition: '0.25s',
                                    borderRadius: '50%',
                                  }} />
                                </span>
                              </label>
                            );
                          })}
                        </div>
                        <div className="text-[11px] text-white/60 leading-snug text-center min-h-[15px]">
                          {getConvocatoriaDescription(adminState.faltanJugadoresState, adminState.buscaArqueroState)}
                        </div>
                      </div>
                    )}

                    {/* Botón principal - only on Jugadores tab.
                        Si los equipos ya están armados → "VER EQUIPOS" directo a la
                        vista final; si no → "ARMAR EQUIPOS" (flujo de votación). */}
                    {isAdmin && !adminState.pendingInvitation && activeTab === 'jugadores' && (
                      <div className="w-full max-w-full mx-auto mt-3 mb-8 flex flex-col items-center">
                        <button
                          className="w-[90%] max-w-[620px] h-[58px] border text-white font-oswald text-[17px] px-4 transition-all disabled:opacity-45 disabled:cursor-not-allowed tracking-[0.06em] font-bold hover:brightness-110"
                          style={{
                            transform: 'none',
                            borderRadius: 18,
                            background: 'linear-gradient(135deg, #8b5cff 0%, #6a43ff 52%, #5430e0 100%)',
                            borderColor: 'rgba(255, 255, 255, 0.18)',
                            boxShadow: (teamsAlreadyFormed || canBuildBalancedTeams)
                              ? '0 8px 24px rgba(106, 67, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.22)'
                              : 'none',
                          }}
                          onClick={staleTeamsDetected
                            ? handleReviewStaleTeams
                            : (teamsAlreadyFormed ? handleViewExistingTeams : handleArmarEquipos)}
                          disabled={staleTeamsDetected ? false : (teamsAlreadyFormed ? false : !canBuildBalancedTeams)}
                          title={(!staleTeamsDetected && !teamsAlreadyFormed && !canBuildBalancedTeams) ? buildTeamsLockedMessage : ''}
                        >
                          <span
                            className="w-full inline-flex items-center justify-center"
                            style={{ transform: 'none' }}
                          >
                            {staleTeamsDetected ? 'REVISAR VOTACIÓN' : (teamsAlreadyFormed ? 'VER EQUIPOS' : 'ARMAR EQUIPOS')}
                          </span>
                        </button>
                        {staleTeamsDetected ? (
                          <div
                            className="w-[90%] max-w-[620px] mt-3 rounded-xl border px-4 py-3 text-center"
                            style={{
                              borderColor: 'rgba(245, 158, 11, 0.52)',
                              background: 'rgba(120, 53, 15, 0.18)',
                            }}
                            role="status"
                          >
                            <div className="font-oswald text-sm font-semibold text-amber-200">
                              Los equipos quedaron desactualizados
                            </div>
                            <div className="mt-1 text-[12px] leading-snug text-white/70">
                              El plantel cambió. Reseteá la votación para volver a armar con los jugadores actuales.
                            </div>
                          </div>
                        ) : teamsAlreadyFormed ? (
                          <div className="text-[11px] text-white/50 mt-2 leading-snug">
                            Mirá los equipos ya armados de este partido
                          </div>
                        ) : !canBuildBalancedTeams && (
                          <div className="text-[11px] text-white/50 mt-2 leading-snug">
                            {buildTeamsHelperText}
                          </div>
                        )}
                      </div>
                    )}

                  </>
                )}
              </div>
            </div>
          </main>

          <Modals
            showInviteModal={adminState.showInviteModal}
            setShowInviteModal={adminState.setShowInviteModal}
            partidoActual={partidoActual}
            user={user}
            jugadores={jugadores}
            inviteMode={(isAdmin || playerDirectInvitesEnabled) ? 'direct' : 'request_join'}
            invitationsOpen={invitationsOpen}
          />
        </>
      )}

      <ConfirmModal
        isOpen={confirmConfig.open}
        title={confirmConfig.type === 'abandon' ? 'Abandonar partido' : ''}
        message={confirmConfig.type === 'abandon'
          ? (
            isAdmin
              ? 'Si abandonás el partido siendo admin, el manejo se transferirá a otro usuario conectado. Si no hay nadie disponible, el partido se cancelará.'
              : 'Vas a dejar tu lugar en este partido. Esta acción no elimina el partido para los demás.'
          )
          : ''}
        onConfirm={handleAbandon}
        onCancel={() => {
          if (processingAction) return;
          setConfirmConfig({ open: false, type: null });
          setActionsMenuOpen(false);
        }}
        confirmText={confirmConfig.type === 'abandon' ? 'Abandonar' : 'Confirmar'}
        cancelText="Cancelar"
        isDeleting={processingAction}
      />

      {/* ChatButton */}
      <ChatButton
        partidoId={partidoActual?.id}
        isOpen={isChatOpen}
        onOpenChange={setIsChatOpen}
        onUnreadCountChange={setChatUnreadCount}
        hideTrigger={adminState.showArmarEquiposView}
      />
    </>
  );
}
