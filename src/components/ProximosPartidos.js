import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { useNotifications } from '../context/NotificationContext';
import { useInterval } from '../hooks/useInterval';
import { supabase } from '../supabase';
import { clearMatchFromList } from '../services/matchFinishService';
import { parseLocalDateTime, formatLocalDateShort, formatLocalDM } from '../utils/dateLocal';
import { toBigIntId } from '../utils';
import LoadingSpinner from './LoadingSpinner';
import PageTitle from './PageTitle';
import ConfirmModal from './ConfirmModal';
import './ProximosPartidos.css';

const ProximosPartidos = ({ onClose }) => {
  const { user } = useAuth();
  const { createNotification } = useNotifications();
  const navigate = useNavigate();
  const [partidos, setPartidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [sortBy, setSortBy] = useState('proximidad');
  const [clearedMatches, setClearedMatches] = useState(new Set());
  const [completedSurveys, setCompletedSurveys] = useState(new Set());
  const [notifiedMatches, setNotifiedMatches] = useState(new Set());
  const [userJugadorIds, setUserJugadorIds] = useState([]);

  useEffect(() => {
    if (user) {
      fetchUserMatches();
    }
  }, [user]);
  
  // Suscripción en tiempo real a inserts de encuestas
  useEffect(() => {
    if (!user || !userJugadorIds.length) return;
    const channel = supabase
      .channel('post_match_surveys_inserts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_match_surveys' }, (payload) => {
        const { partido_id, votante_id } = payload.new || {};
        if (!partido_id || !votante_id) return;
        if (!userJugadorIds.includes(votante_id)) return; // solo mis encuestas
        setCompletedSurveys(prev => new Set([...prev, partido_id]));
        setPartidos(prev => prev.filter(p => p.id !== partido_id)); // limpia inmediatamente
      });
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, userJugadorIds]);
  
  // Refetch al volver con ?surveyDone=1
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('surveyDone') === '1') {
      fetchUserMatches();
      navigate('/proximos', { replace: true });
    }
  }, [navigate]);
  
  // Force re-render every minute to update match status
  const { setIntervalSafe, clearIntervalSafe } = useInterval();
  
  useEffect(() => {
    setIntervalSafe(() => {
      setPartidos(prev => [...prev]); // Force re-render
    }, 60000);
    
    return () => clearIntervalSafe();
  }, [setIntervalSafe, clearIntervalSafe]);

  const fetchUserMatches = async () => {
    if (!user) return;
    
    try {
      const { data: jugadoresData, error: jugadoresError } = await supabase
        .from('jugadores')
        .select('partido_id')
        .eq('usuario_id', user.id);
        
      if (jugadoresError) throw jugadoresError;
      
      const partidosComoJugador = jugadoresData?.map((j) => j.partido_id) || [];
      
      const { data: partidosComoAdmin, error: adminError } = await supabase
        .from('partidos')
        .select('id')
        .eq('creado_por', user.id);
        
      if (adminError) throw adminError;
      
      const partidosAdminIds = partidosComoAdmin?.map((p) => p.id) || [];
      const todosLosPartidosIds = [...new Set([...partidosComoJugador, ...partidosAdminIds])];
      
      if (todosLosPartidosIds.length === 0) {
        setPartidos([]);
        setLoading(false);
        return;
      }
      
      // Get cleared matches for this user
      let clearedMatchIds = new Set();
      try {
        const { data: clearedData, error: clearedError } = await supabase
          .from('cleared_matches')
          .select('partido_id')
          .eq('user_id', user.id);
          
        if (!clearedError) {
          clearedMatchIds = new Set(clearedData?.map((c) => c.partido_id) || []);
        } else {
          // Fallback to localStorage
          const key = `cleared_matches_${user.id}`;
          const existing = JSON.parse(localStorage.getItem(key) || '[]');
          clearedMatchIds = new Set(existing);
        }
      } catch (error) {
        // Fallback to localStorage
        const key = `cleared_matches_${user.id}`;
        const existing = JSON.parse(localStorage.getItem(key) || '[]');
        clearedMatchIds = new Set(existing);
      }
      setClearedMatches(clearedMatchIds);
      
      // Get completed surveys for this user
      try {
        // First get the user's jugador IDs from all their matches
        const { data: userJugadorIdsData, error: jugadorError } = await supabase
          .from('jugadores')
          .select('id, partido_id')
          .eq('usuario_id', user.id);
          
        if (!jugadorError && userJugadorIdsData && userJugadorIdsData.length > 0) {
          const jugadorIds = userJugadorIdsData.map(j => j.id);
          setUserJugadorIds(jugadorIds);
          
          const { data: surveysData, error: surveysError } = await supabase
            .from('post_match_surveys')
            .select('partido_id')
            .in('votante_id', jugadorIds);
            
          if (!surveysError) {
            setCompletedSurveys(new Set(surveysData?.map((s) => s.partido_id) || []));
          }
        }
      } catch (error) {
        console.error('Error fetching completed surveys:', error);
      }
      
      const { data: partidosData, error: partidosError } = await supabase
        .from('partidos')
        .select(`
          *,
          jugadores(count)
        `)
        .in('id', todosLosPartidosIds)
        .order('fecha', { ascending: true })
        .order('hora', { ascending: true });
        
      if (partidosError) throw partidosError;
      
      const now = new Date();
      const partidosFiltrados = partidosData.filter((partido) => {
        // Filter out cleared matches
        if (clearedMatchIds.has(partido.id)) {
          return false;
        }
        
        // Filter out matches with completed surveys (el partido desaparece cuando el usuario completa la encuesta)
        if (completedSurveys.has(partido.id)) {
          return false;
        }
        
        if (!partido.fecha || !partido.hora) {
          return true;
        }
        
        try {
          const partidoDateTime = parseLocalDateTime(partido.fecha, partido.hora);
          if (!partidoDateTime) return true;
          // Show match until 1 hour after it started, then it becomes finished
          const partidoMasUnaHora = new Date(partidoDateTime.getTime() + 60 * 60 * 1000);
          return now <= partidoMasUnaHora;
        } catch (error) {
          return true;
        }
      });
      
      const partidosEnriquecidos = partidosFiltrados.map((partido) => ({
        ...partido,
        userRole: partidosAdminIds.includes(partido.id) ? 'admin' : 'player',
      }));
      
      // Check for finished matches and send notifications
      for (const partido of partidosEnriquecidos) {
        if (isMatchFinished(partido) && !notifiedMatches.has(partido.id)) {
          try {
            // --- CANONICAL MODE CHECK: prevent client creation when DB is canonical ---
            const SURVEY_FANOUT_MODE = process.env.NEXT_PUBLIC_SURVEY_FANOUT_MODE || "db";
            if (SURVEY_FANOUT_MODE === "db") {
              setNotifiedMatches(prev => new Set([...prev, partido.id]));
              continue;
            }

            await createNotification(
              'post_match_survey',
              '¡Encuesta lista!',
              `La encuesta ya está lista para completar sobre el partido ${partido.nombre || formatMatchDate(partido.fecha)}.`,
              {
                partido_id: partido.id,
                partido_nombre: partido.nombre,
                partido_fecha: partido.fecha,
                partido_hora: partido.hora,
                partido_sede: partido.sede
              }
            );
            setNotifiedMatches(prev => new Set([...prev, partido.id]));
          } catch (error) {
            console.error('Error sending match finish notification:', error);
          }
        }
      }
      
      setPartidos(partidosEnriquecidos);
      
    } catch (error) {
      console.error('Error fetching matches:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMatchClick = (partido) => {
    onClose();
    navigate(`/admin/${partido.id}`);
  };

  const handleDeleteClick = (e, partido) => {
    e.stopPropagation();
    setSelectedMatch(partido);
    setShowDeleteModal(true);
  };

  const handleSurveyClick = (e, partido) => {
    e.stopPropagation();
    navigate(`/encuesta/${partido.id}`);
  };

  const handleClearMatch = (e, partido) => {
    e.stopPropagation();
    setSelectedMatch(partido);
    setShowClearModal(true);
  };

  const handleClearConfirm = async () => {
    if (!selectedMatch) return;
    
    try {
      const success = await clearMatchFromList(user.id, selectedMatch.id);
      if (success) {
        // Remove from local state
        setPartidos((prev) => prev.filter((p) => p.id !== selectedMatch.id));
        setClearedMatches((prev) => new Set([...prev, selectedMatch.id]));
      }
    } catch (error) {
      console.error('Error clearing match:', error);
    } finally {
      setShowClearModal(false);
      setSelectedMatch(null);
    }
  };

  const isMatchFinished = (partido) => {
    if (!partido.fecha || !partido.hora) return false;
    
    try {
      const partidoDateTime = parseLocalDateTime(partido.fecha, partido.hora);
      if (!partidoDateTime) return false;
      const now = new Date();
      
      return now >= partidoDateTime;
    } catch (error) {
      console.error('Error checking match finish:', error);
      return false;
    }
  };

  const handleDeleteConfirm = async () => {
    if (!selectedMatch) return;
    
    try {
      if (selectedMatch.userRole === 'admin') {
        await supabase.from('partidos').delete().eq('id', selectedMatch.id);
      } else {
        await supabase
          .from('jugadores')
          .delete()
          .eq('partido_id', selectedMatch.id)
          .eq('usuario_id', user.id);
      }
      
      setShowDeleteModal(false);
      setSelectedMatch(null);
      fetchUserMatches();
    } catch (error) {
      console.error('Error deleting match:', error);
    }
  };

  const getDeleteModalText = () => {
    if (!selectedMatch) return '';
    
    if (selectedMatch.userRole === 'admin') {
      return '¿Seguro que deseas eliminar este partido? Se notificará a todos los jugadores y la estructura se borrará.';
    } else {
      return '¿Seguro que deseas abandonar este partido? Se notificará a todos los jugadores.';
    }
  };

  const formatDate = (dateString) => formatLocalDateShort(dateString);

  const formatMatchDate = (fecha) => formatLocalDM(fecha);

  const getRoleIcon = (role) => {
    if (role === 'admin') {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="14" height="14" fill="currentColor">
          <path d="M345 151.2C354.2 143.9 360 132.6 360 120C360 97.9 342.1 80 320 80C297.9 80 280 97.9 280 120C280 132.6 285.9 143.9 295 151.2L226.6 258.8C216.6 274.5 195.3 278.4 180.4 267.2L120.9 222.7C125.4 216.3 128 208.4 128 200C128 177.9 110.1 160 88 160C65.9 160 48 177.9 48 200C48 221.8 65.5 239.6 87.2 240L119.8 457.5C124.5 488.8 151.4 512 183.1 512L456.9 512C488.6 512 515.5 488.8 520.2 457.5L552.8 240C574.5 239.6 592 221.8 592 200C592 177.9 574.1 160 552 160C529.9 160 512 177.9 512 200C512 208.4 514.6 216.3 519.1 222.7L459.7 267.3C444.8 278.5 423.5 274.6 413.5 258.9L345 151.2z"/>
        </svg>
      );
    } else {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="14" height="14" fill="currentColor">
          <path d="M481.3 424.1L409.7 419.3C404.5 419 399.4 420.4 395.2 423.5C391 426.6 388 430.9 386.8 436L369.2 505.6C353.5 509.8 337 512 320 512C303 512 286.5 509.8 270.8 505.6L253.2 436C251.9 431 248.9 426.6 244.8 423.5C240.7 420.4 235.5 419 230.3 419.3L158.7 424.1C141.1 396.9 130.2 364.9 128.3 330.5L189 292.3C193.4 289.5 196.6 285.3 198.2 280.4C199.8 275.5 199.6 270.2 197.7 265.4L171 198.8C192 173.2 219.3 153 250.7 140.9L305.9 186.9C309.9 190.2 314.9 192 320 192C325.1 192 330.2 190.2 334.1 186.9L389.3 140.9C420.6 153 448 173.2 468.9 198.8L442.2 265.4C440.3 270.2 440.1 275.5 441.7 280.4C443.3 285.3 446.6 289.5 450.9 292.3L511.6 330.5C509.7 364.9 498.8 396.9 481.2 424.1zM320 576C461.4 576 576 461.4 576 320C576 178.6 461.4 64 320 64C178.6 64 64 178.6 64 320C64 461.4 178.6 576 320 576zM334.1 250.3C325.7 244.2 314.3 244.2 305.9 250.3L258 285C249.6 291.1 246.1 301.9 249.3 311.8L267.6 368.1C270.8 378 280 384.7 290.4 384.7L349.6 384.7C360 384.7 369.2 378 372.4 368.1L390.7 311.8C393.9 301.9 390.4 291.1 382 285L334.1 250.2z"/>
        </svg>
      );
    }
  };

  const getRoleText = (role) => {
    return role === 'admin' ? 'Admin' : 'Jugador';
  };

  const getModalidadClass = (modalidad) => {
    if (!modalidad) return 'futbol-5';
    if (modalidad.includes('5')) return 'futbol-5';
    if (modalidad.includes('6')) return 'futbol-6';
    if (modalidad.includes('7')) return 'futbol-7';
    if (modalidad.includes('8')) return 'futbol-8';
    if (modalidad.includes('11')) return 'futbol-11';
    return 'futbol-5';
  };

  const getTipoClass = (tipo) => {
    if (!tipo) return 'masculino';
    const tipoLower = tipo.toLowerCase();
    if (tipoLower.includes('masculino')) return 'masculino';
    if (tipoLower.includes('femenino')) return 'femenino';
    if (tipoLower.includes('mixto')) return 'mixto';
    return 'masculino';
  };

  const getSortedPartidos = () => {
    const partidosCopy = [...partidos];
    if (sortBy === 'proximidad') {
      return partidosCopy.sort((a, b) => {
        const dateA = parseLocalDateTime(a.fecha, a.hora);
        const dateB = parseLocalDateTime(b.fecha, b.hora);
        return dateA - dateB;
      });
    } else {
      return partidosCopy.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  };

  return (
    <div className="proximos-partidos-container">
      <PageTitle onBack={onClose}>PRÓXIMOS PARTIDOS</PageTitle>

      <div className="proximos-partidos-content">
        {loading ? (
          <div className="loading-state">
            <LoadingSpinner size="medium" />

          </div>
        ) : partidos.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📅</div>
            <p>No tienes partidos próximos</p>
            <span>Crea un partido o únete a uno para verlo aquí</span>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', width: '100%', maxWidth: '500px' }}>
              <button 
                onClick={() => setSortBy('proximidad')}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  background: sortBy === 'proximidad' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '8px',
                  color: sortBy === 'proximidad' ? 'white' : 'rgba(255, 255, 255, 0.7)',
                  fontFamily: 'Oswald, Arial, sans-serif',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  textTransform: 'uppercase',
                }}
              >
                📅 Proximidad
              </button>
              <button 
                onClick={() => setSortBy('recientes')}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  background: sortBy === 'recientes' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '8px',
                  color: sortBy === 'recientes' ? 'white' : 'rgba(255, 255, 255, 0.7)',
                  fontFamily: 'Oswald, Arial, sans-serif',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  textTransform: 'uppercase',
                }}
              >
                🕒 Recientes
              </button>
            </div>
            <div className="partidos-list">
              {getSortedPartidos().map((partido) => {
                const matchFinished = isMatchFinished(partido);

                return (
                <div key={partido.id} className={`partido-card ${matchFinished ? 'finished' : ''}`}>
                  <div className="card-header" style={{ marginBottom: '12px' }}>
                    <div className="match-datetime-xl" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="20" height="20" fill="currentColor">
                        <path d="M224 64C206.3 64 192 78.3 192 96L192 128L160 128C124.7 128 96 156.7 96 192L96 240L544 240L544 192C544 156.7 515.3 128 480 128L448 128L448 96C448 78.3 433.7 64 416 64C398.3 64 384 78.3 384 96L384 128L256 128L256 96C256 78.3 241.7 64 224 64zM96 288L96 480C96 515.3 124.7 544 160 544L480 544C515.3 544 544 515.3 544 480L544 288L96 288z"/>
                      </svg>
                      <span className={matchFinished ? 'finished-text' : ''}>{formatDate(partido.fecha)} • {partido.hora}</span>
                    </div>
                    <div className="partido-badges">
                      {matchFinished ? (
                        <div className="finished-badge">
                          ✓ Finalizado
                        </div>
                      ) : (
                        <div className="partido-role">
                          {getRoleIcon(partido.userRole)}
                          <span className="role-text">{getRoleText(partido.userRole)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <div className={`match-type-large ${getModalidadClass(partido.modalidad)}`} style={{ fontSize: '12px', padding: '4px 8px' }}>
                        {partido.modalidad || 'F5'}
                      </div>
                      <div className={`gender-large ${getTipoClass(partido.tipo_partido)}`} style={{ fontSize: '12px', padding: '4px 8px' }}>
                        {partido.tipo_partido || 'Masculino'}
                      </div>
                    </div>
                    {matchFinished ? (
                      <div className="players-admin-container">
                        {(() => {
                          const jugadoresCount = partido.jugadores?.[0]?.count || 0;
                          const cupoMaximo = partido.cupo_jugadores || 20;
                          
                          return (
                            <div className="players-needed-badge">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="12" height="12" fill="currentColor">
                                <path d="M320 312C386.3 312 440 258.3 440 192C440 125.7 386.3 72 320 72C253.7 72 200 125.7 200 192C200 258.3 253.7 312 320 312zM290.3 368C191.8 368 112 447.8 112 546.3C112 562.7 125.3 576 141.7 576L498.3 576C514.7 576 528 562.7 528 546.3C528 447.8 448.2 368 349.7 368L290.3 368z"/>
                              </svg>
                              {jugadoresCount}/{cupoMaximo}
                            </div>
                          );
                        })()}
                        <div className="partido-role">
                          {getRoleIcon(partido.userRole)}
                          <span className="role-text">{getRoleText(partido.userRole)}</span>
                        </div>
                      </div>
                    ) : (
                      (() => {
                        const jugadoresCount = partido.jugadores?.[0]?.count || 0;
                        const cupoMaximo = partido.cupo_jugadores || 20;
                        
                        return (
                          <div className="players-needed-badge">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="12" height="12" fill="currentColor">
                              <path d="M320 312C386.3 312 440 258.3 440 192C440 125.7 386.3 72 320 72C253.7 72 200 125.7 200 192C200 258.3 253.7 312 320 312zM290.3 368C191.8 368 112 447.8 112 546.3C112 562.7 125.3 576 141.7 576L498.3 576C514.7 576 528 562.7 528 546.3C528 447.8 448.2 368 349.7 368L290.3 368z"/>
                            </svg>
                            {jugadoresCount}/{cupoMaximo}
                          </div>
                        );
                      })()
                    )}
                  </div>
                  
                  <div className="venue-large" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="16" height="16" fill="rgba(255, 255, 255, 0.9)">
                      <path d="M0 188.6C0 84.4 86 0 192 0S384 84.4 384 188.6c0 119.3-120.2 262.3-170.4 316.8-11.8 12.8-31.5 12.8-43.3 0-50.2-54.5-170.4-197.5-170.4-316.8zM192 256a64 64 0 1 0 0-128 64 64 0 1 0 0 128z"/>
                    </svg>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{partido.sede}</span>
                  </div>
                  
                  <div className="partido-actions">
                    {matchFinished ? (
                      <>
                        <button 
                          className="action-btn survey-btn-highlight"
                          onClick={(e) => handleSurveyClick(e, partido)}
                        >
                          Completar Encuesta
                        </button>
                        <button 
                          className="action-btn clear-btn"
                          onClick={(e) => handleClearMatch(e, partido)}
                        >
                          Limpiar Partido
                        </button>
                      </>
                    ) : (
                      <>
                        <button 
                          className="action-btn enter-btn"
                          onClick={() => handleMatchClick(partido)}
                        >
                          Ingresar al Partido
                        </button>
                        <button 
                          className="action-btn delete-btn"
                          onClick={(e) => handleDeleteClick(e, partido)}
                        >
                          {partido.userRole === 'admin' ? 'Eliminar Partido' : 'Abandonar Partido'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={showDeleteModal}
        title="CONFIRMAR ACCIÓN"
        message={getDeleteModalText()}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setShowDeleteModal(false)}
        confirmText="CONFIRMAR"
        cancelText="CANCELAR"
      />

      <ConfirmModal
        isOpen={showClearModal}
        title="LIMPIAR PARTIDO"
        message="¿Estás seguro que querés limpiar este partido sin llenar la encuesta?"
        onConfirm={handleClearConfirm}
        onCancel={() => setShowClearModal(false)}
        confirmText="LIMPIAR"
        cancelText="CANCELAR"
      />
    </div>
  );
};

export default ProximosPartidos;