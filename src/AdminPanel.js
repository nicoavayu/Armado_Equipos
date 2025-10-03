import React from 'react';
import { useAuth } from './components/AuthProvider';
import { useAdminPanelState } from './hooks/useAdminPanelState';
import { useTeamFormation } from './hooks/useTeamFormation';

import 'react-lazy-load-image-component/src/effects/blur.css';
import './HomeStyleKit.css';
import './AdminPanel.css';
import './styles/PageLayout.css';

import ArmarEquiposView from './components/ArmarEquiposView';
import ChatButton from './components/ChatButton';
import LoadingSpinner from './components/LoadingSpinner';
import PageTitle from './components/PageTitle';
import MatchInfoSection from './components/MatchInfoSection';

import AdminActions from './components/admin/AdminActions';
import PlayersSection from './components/admin/PlayersSection';
import TeamsPanel from './components/admin/TeamsPanel';
import Modals from './components/admin/Modals';

/**
 * Main AdminPanel component for match management
 * @param {Object} props - Component props
 */
export default function AdminPanel({ onBackToHome, jugadores, onJugadoresChange, partidoActual }) {
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

  const showTeams =
    adminState.showTeamView &&
    Array.isArray(adminState.teams) &&
    adminState.teams.length === 2 &&
    adminState.teams.find((t) => t.id === 'equipoA') &&
    adminState.teams.find((t) => t.id === 'equipoB');

  if (!partidoActual || !adminState.invitationChecked) {
    return <LoadingSpinner size="large" />;
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
        />
      ) : (
        <>
          <PageTitle onBack={onBackToHome}>CONVOCA JUGADORES</PageTitle>
          
          <PlayersSection
            isAdmin={isAdmin}
            jugadores={jugadores}
            partidoActual={partidoActual}
            duplicatesDetected={adminState.duplicatesDetected}
            votantesConNombres={adminState.votantesConNombres}
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
          />
          
          <main className="page-body">
            {isAdmin && !showTeams && (
              <MatchInfoSection
                fecha={partidoActual?.fecha}
                hora={partidoActual?.hora}
                sede={partidoActual?.sede}
                modalidad={partidoActual?.modalidad}
                tipo={partidoActual?.tipo_partido}
              />
            )}
          
            <div className="main-content">
              <div className={`admin-panel-content${!isAdmin ? ' guest-view' : ''}`}>
                <TeamsPanel
                  showTeams={showTeams}
                  teams={adminState.teams}
                  jugadores={jugadores}
                  handleTeamsChange={handleTeamsChange}
                  onBackToHome={onBackToHome}
                  isAdmin={isAdmin}
                  partidoActual={partidoActual}
                />
                
                {!showTeams && (
                  <>
                    <AdminActions
                      isAdmin={isAdmin}
                      pendingInvitation={adminState.pendingInvitation}
                      nuevoNombre={adminState.nuevoNombre}
                      setNuevoNombre={adminState.setNuevoNombre}
                      loading={adminState.loading}
                      isClosing={adminState.isClosing}
                      partidoActual={partidoActual}
                      jugadores={jugadores}
                      agregarJugador={adminState.agregarJugador}
                      setShowInviteModal={adminState.setShowInviteModal}
                      user={user}
                      inputRef={adminState.inputRef}
                      faltanJugadoresState={adminState.faltanJugadoresState}
                      handleFaltanJugadores={adminState.handleFaltanJugadores}
                      handleArmarEquipos={handleArmarEquipos}
                      isPlayerInMatch={adminState.isPlayerInMatch}
                      eliminarJugador={adminState.eliminarJugador}
                      currentPlayerInMatch={adminState.currentPlayerInMatch}
                    />
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
          />
        </>
      )}
      
      {/* ChatButton */}
      {!isAdmin && (
        <>

          <ChatButton partidoId={partidoActual?.id} />
        </>
      )}
      {isAdmin && <ChatButton partidoId={partidoActual?.id} />}
    </>
  );
}