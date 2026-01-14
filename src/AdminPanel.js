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
import normalizePartidoForHeader from './utils/normalizePartidoForHeader';

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
          
          {isAdmin && !showTeams && (
            <MatchInfoSection
              partido={normalizePartidoForHeader(partidoActual)}
              fecha={partidoActual?.fecha}
              hora={partidoActual?.hora}
              sede={partidoActual?.sede}
              modalidad={partidoActual?.modalidad}
              tipo={partidoActual?.tipo_partido}
              precio={partidoActual?.valor_cancha || partidoActual?.valorCancha || partidoActual?.valor || partidoActual?.precio}
            />
          )}
          
          <main className="page-body">
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
                    />
                    
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
                    
                    {/* Toggle para abrir partido a la comunidad */}
                    {isAdmin && !adminState.pendingInvitation && (
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        gap: '12px', 
                        margin: '12px auto', 
                        fontSize: '14px', 
                        color: 'rgba(255,255,255,0.8)',
                        fontFamily: 'Oswald, Arial, sans-serif',
                      }}>
                        <span>¿Faltan jugadores?</span>
                        <label style={{ 
                          position: 'relative', 
                          display: 'inline-block', 
                          width: '50px', 
                          height: '24px',
                          cursor: (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores && !adminState.faltanJugadoresState) ? 'not-allowed' : 'pointer',
                        }}>
                          <input 
                            type="checkbox" 
                            checked={adminState.faltanJugadoresState}
                            onChange={adminState.handleFaltanJugadores}
                            disabled={partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores}
                            style={{ opacity: 0, width: 0, height: 0 }}
                          />
                          <span style={{
                            position: 'absolute',
                            cursor: 'inherit',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: adminState.faltanJugadoresState ? '#009dffff' : '#ccc',
                            transition: '0.3s',
                            borderRadius: '24px',
                            opacity: (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores) ? 0.5 : 1,
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
                        <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Abrir a la comunidad</span>
                      </div>
                    )}

                    {/* Botón ARMAR EQUIPOS PAREJOS */}
                    {isAdmin && !adminState.pendingInvitation && (
                      <div style={{ width: '90vw', maxWidth: '90vw', boxSizing: 'border-box', margin: '12px auto 0', textAlign: 'center' }}>
                        <button 
                          className="admin-btn-orange" 
                          onClick={handleArmarEquipos}
                          disabled={jugadores.length < 8}
                          style={{
                            width: '100%',
                          }}
                          title={jugadores.length < 8 ? 'Necesitás al menos 8 jugadores para armar los equipos.' : ''}
                        >
                          ARMAR EQUIPOS PAREJOS
                        </button>
                      </div>
                    )}
                      
                    {/* Botón para jugadores que están en el partido (solo admin) */}
                    {isAdmin && adminState.isPlayerInMatch && !adminState.pendingInvitation && (
                      <div style={{ width: '90vw', maxWidth: '90vw', boxSizing: 'border-box', margin: '8px auto 0' }}>
                        <button
                          className="guest-action-btn leave-btn"
                          onClick={() => {
                            if (window.confirm('¿Estás seguro de que quieres abandonar el partido?')) {
                              adminState.eliminarJugador(adminState.currentPlayerInMatch?.uuid || user.id, false);
                            }
                          }}
                          style={{ 
                            width: '100%',
                            fontSize: '13px',
                            padding: '10px 4px',
                          }}
                        >
                          ABANDONAR PARTIDO
                        </button>
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