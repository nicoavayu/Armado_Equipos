import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';
import { useAuth } from '../components/AuthProvider';
import LoadingSpinner from '../components/LoadingSpinner';
import ProfileCard from '../components/ProfileCard';
import '../VotingView.css';

const ResultadosEncuesta = () => {
  const { partidoId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [partido, setPartido] = useState(null);
  const [results, setResults] = useState(null);
  const [jugadores, setJugadores] = useState([]);
  const [showingBadgeAnimations, setShowingBadgeAnimations] = useState(false);
  const [badgeAnimations, setBadgeAnimations] = useState([]);
  const [currentAnimationIndex, setCurrentAnimationIndex] = useState(0);
  const [animationComplete, setAnimationComplete] = useState(false);

  useEffect(() => {
    const fetchResultsData = async () => {
      if (!partidoId || !user) {
        navigate('/');
        return;
      }
      
      try {
        setLoading(true);
        
        // Obtener datos del partido
        const { data: partidoData, error: partidoError } = await supabase
          .from('partidos')
          .select('*')
          .eq('id', partidoId)
          .single();
          
        if (partidoError) throw partidoError;
        if (!partidoData) {
          toast.error('Partido no encontrado');
          navigate('/');
          return;
        }
        
        setPartido(partidoData);
        
        if (partidoData.jugadores && Array.isArray(partidoData.jugadores)) {
          setJugadores(partidoData.jugadores);
        }
        
        // Obtener resultados de la encuesta
        const { data: resultsData, error: resultsError } = await supabase
          .from('survey_results')
          .select('*')
          .eq('partido_id', partidoId)
          .single();
        
        if (resultsError && resultsError.code !== 'PGRST116') {
          throw resultsError;
        }
        
        if (!resultsData) {
          toast.error('Resultados no disponibles aún');
          navigate('/');
          return;
        }
        
        setResults(resultsData);
        
        // Preparar animaciones
        const animations = [];
        const addedPlayers = new Set();
        
        // MVP
        if (resultsData.mvp_id) {
          const player = partidoData.jugadores.find((j) => j.uuid === resultsData.mvp_id);
          if (player && !addedPlayers.has(player.uuid + '_mvp')) {
            animations.push({
              playerName: player.nombre,
              playerAvatar: player.avatar_url || player.foto_url,
              badgeType: 'mvp',
              badgeText: 'MVP',
              badgeIcon: '🏆',
              votes: resultsData.mvp_votes,
            });
            addedPlayers.add(player.uuid + '_mvp');
          }
        }
        
        // Arquero
        if (resultsData.arquero_id) {
          const player = partidoData.jugadores.find((j) => j.uuid === resultsData.arquero_id);
          if (player && !addedPlayers.has(player.uuid + '_guante_dorado')) {
            animations.push({
              playerName: player.nombre,
              playerAvatar: player.avatar_url || player.foto_url,
              badgeType: 'guante_dorado',
              badgeText: 'GUANTE DORADO',
              badgeIcon: '🧤',
              votes: resultsData.arquero_votes,
            });
            addedPlayers.add(player.uuid + '_guante_dorado');
          }
        }
        
        // Jugadores violentos
        if (resultsData.jugadores_violentos && resultsData.jugadores_violentos.length > 0) {
          const firstViolentPlayer = partidoData.jugadores.find((j) => j.uuid === resultsData.jugadores_violentos[0]);
          if (firstViolentPlayer && !addedPlayers.has(firstViolentPlayer.uuid + '_tarjeta_roja')) {
            animations.push({
              playerName: firstViolentPlayer.nombre,
              playerAvatar: firstViolentPlayer.avatar_url || firstViolentPlayer.foto_url,
              badgeType: 'tarjeta_roja',
              badgeText: 'TARJETA ROJA',
              badgeIcon: '🟥',
            });
            addedPlayers.add(firstViolentPlayer.uuid + '_tarjeta_roja');
          }
        }
        
        // Ausencias
        if (resultsData.jugadores_ausentes && resultsData.jugadores_ausentes.length > 0) {
          resultsData.jugadores_ausentes.forEach((jugadorId) => {
            const player = partidoData.jugadores.find((j) => j.uuid === jugadorId);
            if (player && !addedPlayers.has(player.uuid + '_ausencia')) {
              animations.push({
                playerName: player.nombre,
                playerAvatar: player.avatar_url || player.foto_url,
                playerData: player,
                badgeType: 'ausencia_injustificada',
                badgeText: 'AUSENCIAS INJUSTIFICADAS',
                badgeIcon: '📉',
                pointsLost: -0.3,
              });
              addedPlayers.add(player.uuid + '_ausencia');
            }
          });
        }
        
        if (animations.length > 0) {
          setBadgeAnimations(animations);
          setShowingBadgeAnimations(true);
        }
        
      } catch (error) {
        console.error('Error cargando resultados:', error);
        toast.error('Error cargando resultados');
      } finally {
        setLoading(false);
      }
    };
    
    fetchResultsData();
  }, [partidoId, user, navigate]);

  // Control del ciclo de animaciones
  useEffect(() => {
    if (showingBadgeAnimations && badgeAnimations.length > 0 && !animationComplete) {
      if (currentAnimationIndex < badgeAnimations.length - 1) {
        const timer = setTimeout(() => {
          setCurrentAnimationIndex((prev) => prev + 1);
        }, 3000);
        return () => clearTimeout(timer);
      } else {
        setAnimationComplete(true);
      }
    }
  }, [currentAnimationIndex, showingBadgeAnimations, badgeAnimations.length, animationComplete]);

  const handleAcceptAnimations = () => {
    setShowingBadgeAnimations(false);
    setBadgeAnimations([]);
    setCurrentAnimationIndex(0);
    setAnimationComplete(false);
  };

  const formatFecha = (fechaStr) => {
    try {
      const fecha = new Date(fechaStr);
      return fecha.toLocaleDateString('es-ES', { 
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch (e) {
      return fechaStr || 'Fecha no disponible';
    }
  };

  // Reutilizar el componente BadgeAnimation de EncuestaPartido
  const BadgeAnimation = ({ animations }) => {
    if (!animations || animations.length === 0) return null;
    
    const animation = animations[Math.min(currentAnimationIndex, animations.length - 1)];
    if (!animation) return null;
    
    const player = jugadores.find((j) => j.nombre === animation.playerName);
    const isAbsence = animation.badgeType === 'ausencia_injustificada';
    
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        width: '100%',
        padding: '20px',
        boxSizing: 'border-box',
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '500px',
          maxWidth: '400px',
          width: '100%',
        }}>
          
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '15px',
            textAlign: 'center',
            width: '100%',
          }}>
            <div style={{
              color: '#FFD700',
              fontSize: '32px',
              fontWeight: '700',
              fontFamily: "'Oswald', Arial, sans-serif",
              lineHeight: '1.2',
              wordWrap: 'break-word',
              maxWidth: '100%',
            }}>
              {animation.badgeType === 'mvp' ? 'MVP' : 
                animation.badgeType === 'guante_dorado' ? 'GUANTE DORADO' : 
                  animation.badgeType === 'tarjeta_roja' ? 'TARJETA ROJA' :
                    animation.badgeType === 'ausencia_injustificada' ? 'AUSENCIAS INJUSTIFICADAS' : animation.badgeText}
            </div>
          </div>
          
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '0px',
          }}>
            {player && (
              <div style={{ 
                pointerEvents: 'none',
                opacity: 1,
                transition: 'none',
                transform: 'scale(0.9)',
              }}>
                <ProfileCard 
                  profile={player}
                  enableTilt={false}
                  isVisible={true}
                />
              </div>
            )}
          </div>
          
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '5px',
          }}>
            <div style={{
              fontSize: '55px',
            }}>
              {animation.badgeIcon}
            </div>
          </div>
          
          {animation.votes && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <div style={{
                color: '#FFD700',
                fontSize: '24px',
                fontWeight: '700',
                fontFamily: "'Oswald', Arial, sans-serif",
              }}>
                {animation.votes} VOTOS
              </div>
            </div>
          )}
          
          {isAbsence && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <div style={{
                color: '#FFD700',
                fontSize: '24px',
                fontWeight: '700',
                fontFamily: "'Oswald', Arial, sans-serif",
              }}>
                {animation.pointsLost} PUNTOS
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <LoadingSpinner size="large" />
        </div>
      </div>
    );
  }

  if (!partido || !results) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="voting-title-modern">RESULTADOS NO DISPONIBLES</div>
          <button className="voting-confirm-btn" onClick={() => navigate('/')}>
            VOLVER AL INICIO
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="voting-bg">
      {showingBadgeAnimations && (
        <div className="badge-animations-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          zIndex: 999,
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{
            position: 'absolute',
            top: '40px',
            left: 0,
            right: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1001,
          }}>
            <div className="voting-title-modern">
              RESULTADOS DE LA ENCUESTA
            </div>
          </div>
          
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            width: '100%',
          }}>
            {badgeAnimations.length > 0 && (
              <BadgeAnimation animations={badgeAnimations} />
            )}
          </div>
          
          {animationComplete && (
            <button 
              className="voting-confirm-btn"
              onClick={handleAcceptAnimations}
              style={{
                position: 'absolute',
                bottom: '50px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 1002,
                width: '300px',
                maxWidth: '90vw',
              }}
            >
              ACEPTAR
            </button>
          )}
        </div>
      )}
      
      <div className="voting-modern-card">
        <div className="voting-title-modern">
          RESULTADOS DE LA ENCUESTA
        </div>
        <div style={{ color: '#fff', fontSize: 20, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30, textAlign: 'center' }}>
          {partido.nombre || 'Partido'}<br />
          {formatFecha(partido.fecha)}
        </div>
        
        {!showingBadgeAnimations && (
          <button 
            className="voting-confirm-btn"
            onClick={() => {
              if (badgeAnimations.length > 0) {
                setShowingBadgeAnimations(true);
                setCurrentAnimationIndex(0);
                setAnimationComplete(false);
              } else {
                navigate('/');
              }
            }}
          >
            {badgeAnimations.length > 0 ? 'VER RESULTADOS' : 'VOLVER AL INICIO'}
          </button>
        )}
      </div>
    </div>
  );
};

export default ResultadosEncuesta;