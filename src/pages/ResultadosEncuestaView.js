import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { db } from '../api/supabaseWrapper';
import { toast } from 'react-toastify';
import { useAuth } from '../components/AuthProvider';
import LoadingSpinner from '../components/LoadingSpinner';
import ProfileCard from '../components/ProfileCard';
import AbsencePenaltyAnimation from '../components/awards/AbsencePenaltyAnimation';
import '../VotingView.css';
import './ResultadosEncuesta.css';

const ResultadosEncuestaView = () => {
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
  const [absences, setAbsences] = useState([]);

  useEffect(() => {
    const fetchResultsData = async () => {
      if (!partidoId || !user) {
        navigate('/');
        return;
      }
      
      try {
        setLoading(true);
        
        // Obtener datos del partido
        let partidoData;
        try {
          partidoData = await db.fetchOne('partidos', { id: partidoId });
        } catch (error) {
          toast.error('Partido no encontrado');
          navigate('/');
          return;
        }
        
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
        
        // Preparar animaciones - usar los campos correctos (mvp, golden_glove)
        const animations = [];
        const addedPlayers = new Set();
        
        // MVP
        if (resultsData.mvp) {
          const player = partidoData.jugadores.find((j) => j.uuid === resultsData.mvp || j.usuario_id === resultsData.mvp);
          if (player && !addedPlayers.has(player.uuid + '_mvp')) {
            animations.push({
              playerName: player.nombre,
              playerAvatar: player.avatar_url || player.foto_url,
              badgeType: 'mvp',
              badgeText: 'MVP',
              badgeIcon: '🏆',
              votes: resultsData.mvp_votes || 1,
            });
            addedPlayers.add(player.uuid + '_mvp');
          }
        }
        
        // Arquero
        if (resultsData.golden_glove) {
          const player = partidoData.jugadores.find((j) => j.uuid === resultsData.golden_glove || j.usuario_id === resultsData.golden_glove);
          if (player && !addedPlayers.has(player.uuid + '_guante_dorado')) {
            animations.push({
              playerName: player.nombre,
              playerAvatar: player.avatar_url || player.foto_url,
              badgeType: 'guante_dorado',
              badgeText: 'GUANTE DORADO',
              badgeIcon: '🧤',
              votes: resultsData.arquero_votes || 1,
            });
            addedPlayers.add(player.uuid + '_guante_dorado');
          }
        }
        
        // Jugadores violentos
        if (resultsData.red_cards && resultsData.red_cards.length > 0) {
          const firstViolentPlayer = partidoData.jugadores.find((j) => j.uuid === resultsData.red_cards[0] || j.usuario_id === resultsData.red_cards[0]);
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
        
        // Obtener penalizaciones por ausencia
        let penalties = [];
        try {
          penalties = await db.fetchMany('no_show_penalties', { match_id: partidoId });
        } catch (error) {
          console.error('Error fetching penalties:', error);
        }
        
        if (penalties && penalties.length > 0) {
          const penalizedPlayers = [];
          for (const penalty of penalties) {
            const player = partidoData.jugadores.find(j => j.id === penalty.player_id);
            if (player) {
              penalizedPlayers.push({
                ...player,
                penalty: penalty.amount
              });
            }
          }
          setAbsences(penalizedPlayers);
        }
        
        // Auto-iniciar animaciones si viene con showAwards=1
        const showAwardsParam = new URLSearchParams(window.location.search).get('showAwards') === '1';
        if (animations.length > 0) {
          setBadgeAnimations(animations);
          if (showAwardsParam) {
            setShowingBadgeAnimations(true);
          }
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

  // Componente BadgeAnimation con contenedor dorado
  const BadgeAnimation = ({ animations }) => {
    if (!animations || animations.length === 0) return null;
    
    const animation = animations[Math.min(currentAnimationIndex, animations.length - 1)];
    if (!animation) return null;
    
    const player = jugadores.find((j) => j.nombre === animation.playerName);
    
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
        <div className="award-container">
          <div className="award-text" style={{ marginBottom: '20px', textAlign: 'center' }}>
            {animation.badgeType === 'mvp' ? 'MVP' : 
              animation.badgeType === 'guante_dorado' ? 'GUANTE DORADO' : 
                animation.badgeType === 'tarjeta_roja' ? 'TARJETA ROJA' : animation.badgeText}
          </div>
          
          {player && (
            <div className="profile-card-animation" style={{
              display: 'flex',
              justifyContent: 'center',
              marginBottom: '20px',
            }}>
              <ProfileCard 
                profile={player}
                enableTilt={false}
                isVisible={true}
              />
            </div>
          )}
          
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '10px',
          }}>
            <div className="award-icon">
              {animation.badgeIcon}
            </div>
          </div>
          
          {animation.votes && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <div className="award-text" style={{ fontSize: '24px' }}>
                {animation.votes} VOTOS
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
        <div className="badge-animations-overlay">
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
            {absences.length > 0 && (
              <AbsencePenaltyAnimation players={absences} />
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

export default ResultadosEncuestaView;