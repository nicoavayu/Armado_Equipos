import React, { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthProvider';
import { useAdminPanelState } from '../hooks/useAdminPanelState';
import { useTeamFormation } from '../hooks/useTeamFormation';
import { useSearchParams } from 'react-router-dom';
import { usePendingRequestsCount } from '../hooks/usePendingRequestsCount';
import { useNativeFeatures } from '../hooks/useNativeFeatures';
import { supabase } from '../supabase';
import { notifyBlockingError } from 'utils/notifyBlockingError';

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
import { parseLocalDate } from '../utils/dateLocal';
import { buildWhatsAppRosterMessage } from '../utils/buildWhatsAppRosterMessage';

import AdminActions from '../components/admin/AdminActions';
import PlayersSection from '../components/admin/PlayersSection';
import TeamsPanel from '../components/admin/TeamsPanel';
import Modals from '../components/admin/Modals';
import AdminTabs from '../components/admin/AdminTabs';
import SolicitudesSection from '../components/admin/SolicitudesSection';

/**
 * Main AdminPanel component for match management
 * @param {Object} props - Component props
 */
export default function AdminPanel({ onBackToHome, jugadores, onJugadoresChange, partidoActual }) {
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
  });

  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState({ open: false, type: null });
  const [processingAction, setProcessingAction] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [cachedJoinLink, setCachedJoinLink] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState('jugadores');

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

  useEffect(() => {
    setCachedJoinLink('');
  }, [partidoActual?.id, partidoActual?.codigo]);

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
  const displayedJugadores = Array.isArray(adminState.jugadoresActuales)
    ? adminState.jugadoresActuales
    : (Array.isArray(jugadores) ? jugadores : []);
  const starterCapacity = Number(partidoActual?.cupo_jugadores || 0);
  const maxRosterSlots = starterCapacity > 0 ? starterCapacity + 2 : 0;
  const isRosterFull = maxRosterSlots > 0 && displayedJugadores.length >= maxRosterSlots;
  const canOpenChatFromHeader = Boolean(isAdmin || adminState.isPlayerInMatch);

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
      console.info('Aceptá la invitación para habilitar el chat del partido.');
      return;
    }

    console.info('Sumate al partido para usar el chat.');
  };

  const handleAbandon = async () => {
    if (!adminState.currentPlayerInMatch && !user?.id) return;
    setProcessingAction(true);
    setProcessingAction(true);
    try {
      // Must pass the numerical ID (PK) of the player, not the UUID
      const playerId = adminState.currentPlayerInMatch?.id;
      if (!playerId) {
        console.error('Cannot abandon: No player ID found for current user');
        return;
      }
      await adminState.eliminarJugador(playerId, false);
    } finally {
      setProcessingAction(false);
      setConfirmConfig({ open: false, type: null });
    }
  };

  const resolveMatchJoinLink = async () => {
    if (cachedJoinLink) {
      return cachedJoinLink;
    }

    const matchId = partidoActual?.id;
    const matchCode = String(partidoActual?.codigo || '').trim();
    if (!matchId || !matchCode) {
      notifyBlockingError('No se pudo generar el link de invitación');
      return null;
    }

    // Guest self-join needs a short-lived token (6h / 14 uses).
    // Admin-only RPC enforces permissions server-side.
    const { data: inviteRows, error: inviteErr } = await supabase.rpc('create_guest_match_invite', {
      p_partido_id: Number(matchId),
    });

    if (inviteErr || !inviteRows?.[0]?.token) {
      console.error('[SHARE_INVITE] create_guest_match_invite failed', inviteErr);
      notifyBlockingError('No se pudo generar el link (token inválido)');
      return null;
    }

    const inviteToken = String(inviteRows[0].token || '').trim();
    const baseUrl = getPublicBaseUrl() || window.location.origin;
    const joinLink = `${baseUrl}/partido/${matchId}/invitacion?codigo=${encodeURIComponent(matchCode)}&invite=${encodeURIComponent(inviteToken)}`;
    setCachedJoinLink(joinLink);
    return joinLink;
  };

  const openWhatsAppShare = async ({ title, text, url }) => {
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;

    if (isNative) {
      try {
        await shareContent(title, text, url);
        return true;
      } catch (nativeShareError) {
        console.warn('[WHATSAPP_SHARE] Native share failed, fallback to wa.me', nativeShareError);
      }
    }

    const opened = window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
    if (opened) return true;

    window.location.href = whatsappUrl;
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
      console.error('Error sharing:', err);
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
      console.warn('[SHARE_ROSTER] Using local players after refresh error', error);
    }

    const joinLink = await resolveMatchJoinLink();
    if (!joinLink) return false;

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
      console.error('[SHARE_ROSTER] Error sharing update', error);
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
              />
            </div>
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
                />
              )}
              <div className={`w-full max-w-full mx-auto flex flex-col gap-3 overflow-x-hidden min-w-0 ${isAdmin ? 'pt-3' : 'pt-0'}`}>

                {!showTeams && (
                  <>
                    {/* Tabs - only show for admin */}
                    {isAdmin && !adminState.pendingInvitation && (
                      <AdminTabs
                        activeTab={activeTab}
                        onTabChange={handleTabChange}
                        pendingCount={pendingRequestsCount}
                      />
                    )}

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

                    {/* Toggle para abrir partido a la comunidad - only on Jugadores tab */}
                    {isAdmin && !adminState.pendingInvitation && activeTab === 'jugadores' && (
                      <div className="flex flex-col items-center gap-1 my-3 mx-auto text-sm text-white/80 font-oswald">
                        <div className="flex items-center justify-center gap-3">
                          <span>¿Faltan jugadores?</span>
                          <label style={{
                            position: 'relative',
                            display: 'inline-block',
                            width: '50px',
                            height: '24px',
                            cursor: (isRosterFull && !adminState.faltanJugadoresState) ? 'not-allowed' : 'pointer',
                          }}>
                            <input
                              type="checkbox"
                              checked={adminState.faltanJugadoresState}
                              onChange={adminState.handleFaltanJugadores}
                              disabled={isRosterFull}
                              style={{ opacity: 0, width: 0, height: 0 }}
                            />
                            <span style={{
                              position: 'absolute',
                              cursor: 'inherit',
                              top: 0,
                              left: 0,
                              right: 0,
                              bottom: 0,
                              backgroundColor: adminState.faltanJugadoresState ? '#009dff' : '#ccc',
                              transition: '0.3s',
                              borderRadius: '24px',
                              opacity: isRosterFull ? 0.5 : 1,
                            }}>
                              <span style={{
                                position: 'absolute',
                                content: '',
                                height: '18px',
                                width: '18px',
                                left: adminState.faltanJugadoresState ? '29px' : '3px',
                                bottom: '3px',
                                backgroundColor: 'white',
                                transition: '0.3s',
                                borderRadius: '50%',
                              }} />
                            </span>
                          </label>
                          <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.75)' }}>Abrir a la comunidad</span>
                        </div>
                        <div className="text-[11px] text-white/60 leading-snug text-center">
                          Permite que otros jugadores se sumen automáticamente si hay cupos.
                        </div>
                      </div>
                    )}

                    {/* Botón ARMAR EQUIPOS PAREJOS - only on Jugadores tab */}
                    {isAdmin && !adminState.pendingInvitation && activeTab === 'jugadores' && (
                      <div className="w-full max-w-full mx-auto mt-3 mb-8 text-center">
                        <button
                          className="w-full bg-primary text-white font-oswald text-[18px] px-4 py-3 rounded-xl hover:brightness-110 transition-all disabled:opacity-35 disabled:cursor-not-allowed shadow-[0_8px_32px_rgba(129,120,229,0.3)] border border-white/20 active:scale-95 tracking-[0.01em] font-semibold"
                          onClick={handleArmarEquipos}
                          disabled={jugadores.length < 8}
                          title={jugadores.length < 8 ? 'Necesitás al menos 8 jugadores para armar los equipos.' : ''}
                        >
                          Armar equipos parejos
                        </button>
                        {jugadores.length < 8 && (
                          <div className="text-[11px] text-white/50 mt-2 leading-snug">
                            Disponible cuando haya al menos 8 jugadores
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
          />
        </>
      )}

      <ConfirmModal
        isOpen={confirmConfig.open}
        title={confirmConfig.type === 'abandon' ? 'Abandonar partido' : ''}
        message={confirmConfig.type === 'abandon' ? 'Vas a dejar tu lugar en este partido. Esta acción no elimina el partido para los demás.' : ''}
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
