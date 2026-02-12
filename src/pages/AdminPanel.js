import React, { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthProvider';
import { useAdminPanelState } from '../hooks/useAdminPanelState';
import { useTeamFormation } from '../hooks/useTeamFormation';
import { useSearchParams } from 'react-router-dom';
import { usePendingRequestsCount } from '../hooks/usePendingRequestsCount';
import { useNativeFeatures } from '../hooks/useNativeFeatures';
import { toast } from 'react-toastify';
import { supabase } from '../supabase';

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState('jugadores');

  // Get pending requests count with realtime updates
  const pendingRequestsCount = usePendingRequestsCount(partidoActual?.id);
  const { shareContent } = useNativeFeatures();

  // Handle tab from URL
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'solicitudes') {
      setActiveTab('solicitudes');
    }
  }, [searchParams]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (tab === 'solicitudes') {
      setSearchParams({ tab: 'solicitudes' });
    } else {
      setSearchParams({});
    }
  };

  const handleRequestAccepted = async () => {
    // Refresh players list from server
    await adminState.fetchJugadores();
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

  const handleHeaderChatClick = () => {
    if (canOpenChatFromHeader) {
      setIsChatOpen(true);
      return;
    }

    if (adminState.pendingInvitation && !adminState.isPlayerInMatch) {
      toast.info('Aceptá la invitación para habilitar el chat del partido.');
      return;
    }

    toast.info('Sumate al partido para usar el chat.');
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

  const handleShare = async () => {
    const matchId = partidoActual?.id;
    const matchCode = String(partidoActual?.codigo || '').trim();
    if (!matchId || !matchCode) {
      toast.error('No se pudo generar el link de invitación');
      return;
    }

    // Guest self-join needs a short-lived token (6h / 14 uses).
    // Admin-only RPC enforces permissions server-side.
    const { data: inviteRows, error: inviteErr } = await supabase.rpc('create_guest_match_invite', {
      p_partido_id: Number(matchId),
    });

    if (inviteErr || !inviteRows?.[0]?.token) {
      console.error('[SHARE_INVITE] create_guest_match_invite failed', inviteErr);
      toast.error('No se pudo generar el link (token inválido)');
      return;
    }

    const inviteToken = String(inviteRows[0].token || '').trim();
    const baseUrl = getPublicBaseUrl() || window.location.origin;
    const url = `${baseUrl}/partido/${matchId}/invitacion?codigo=${encodeURIComponent(matchCode)}&invite=${encodeURIComponent(inviteToken)}`;
    const text = `Sumate al partido "${partidoActual.nombre || 'Partido'}"\n${url}`;
    try {
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
      const opened = window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
      if (!opened) {
        await shareContent('Invitar al partido', text, url);
      }
    } catch (err) {
      console.error('Error sharing:', err);
      toast.error('No se pudo abrir WhatsApp');
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
          onBackToAdmin={() => adminState.setShowArmarEquiposView(false)}
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
            <div className="w-full overflow-x-clip">
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

          <main className="pb-20 pt-0 overflow-x-clip">
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
              <div className={`w-full max-w-full mx-auto pb-[70px] flex flex-col gap-3 overflow-x-hidden min-w-0 ${isAdmin ? 'pt-3' : 'pt-0'}`}>

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
                        unirseAlPartido={adminState.unirseAlPartido}
                      />
                    ) : (
                      <SolicitudesSection
                        partidoActual={partidoActual}
                        onRequestAccepted={handleRequestAccepted}
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
                      <div className="w-full max-w-full mx-auto mt-3 text-center">
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
