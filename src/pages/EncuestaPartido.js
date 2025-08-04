import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase, checkPartidoCalificado } from '../supabase';
import { processAbsenceWithoutNotice } from '../utils/matchStatsManager';
import { toast } from 'react-toastify';
import { useAuth } from '../components/AuthProvider';
import { useBadges } from '../context/BadgeContext';
import LoadingSpinner from '../components/LoadingSpinner';

import ProfileCard from '../components/ProfileCard';
import '../VotingView.css';

const EncuestaPartido = () => {
  const { partidoId } = useParams();
  const { user } = useAuth();
  const { triggerBadgeRefresh } = useBadges();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [partido, setPartido] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);

  const [formData, setFormData] = useState({
    se_jugo: true,
    partido_limpio: true,
    asistieron_todos: true,
    jugadores_ausentes: [],
    jugadores_violentos: [],
    mvp_id: '',
    arquero_id: '',
    motivo_no_jugado: '',
    ganador: '',
    resultado: '',
  });
  const [jugadores, setJugadores] = useState([]);
  const [yaCalificado, setYaCalificado] = useState(false);
  const [showingBadgeAnimations, setShowingBadgeAnimations] = useState(false);
  const [badgeAnimations, setBadgeAnimations] = useState([]);
  const [currentAnimationIndex, setCurrentAnimationIndex] = useState(0);
  const [animationComplete, setAnimationComplete] = useState(false);
  const [animationProcessed, setAnimationProcessed] = useState(false);
  const [encuestaFinalizada, setEncuestaFinalizada] = useState(false);
  const toastShownRef = useRef(false);

  useEffect(() => {
    const fetchPartidoData = async () => {
      try {
        if (!partidoId || !user) {
          navigate('/');
          return;
        }
        
        setLoading(true);
        
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
        
      } catch (error) {
        console.error('Error cargando datos del partido:', error);
        toast.error('Error cargando datos del partido');
        navigate('/');
      } finally {
        setLoading(false);
      }
    };
    
    if (partidoId && user) {
      fetchPartidoData();
    }
  }, [partidoId, user, navigate]);

  useEffect(() => {
    try {
      if (showingBadgeAnimations && badgeAnimations.length > 0) {
        setCurrentAnimationIndex(0);
        setAnimationComplete(false);
      }
    } catch (error) {
      console.error('Error in badge animations useEffect:', error);
    }
  }, [showingBadgeAnimations, badgeAnimations.length]);

  // Control del ciclo de animaciones automático - la última card queda visible
  useEffect(() => {
    try {
      if (showingBadgeAnimations && badgeAnimations.length > 0 && !animationComplete) {
        if (currentAnimationIndex < badgeAnimations.length - 1) {
          const timer = setTimeout(() => {
            setCurrentAnimationIndex((prev) => prev + 1);
          }, 3000);
          return () => clearTimeout(timer);
        } else {
          // Llegamos a la última animación - mostrar botón ACEPTAR sin avanzar más
          setAnimationComplete(true);
        }
      }
    } catch (error) {
      console.error('Error in animation cycle useEffect:', error);
    }
  }, [currentAnimationIndex, showingBadgeAnimations, badgeAnimations.length, animationComplete]);

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };



  const toggleJugadorAusente = (jugadorId) => {
    setFormData((prev) => {
      const ausentes = [...prev.jugadores_ausentes];
      const index = ausentes.indexOf(jugadorId);
      
      if (index === -1) {
        ausentes.push(jugadorId);
      } else {
        ausentes.splice(index, 1);
      }
      
      return { ...prev, jugadores_ausentes: ausentes };
    });
  };

  const toggleJugadorViolento = (jugadorId) => {
    setFormData((prev) => {
      const violentos = [...prev.jugadores_violentos];
      const index = violentos.indexOf(jugadorId);
      
      if (index === -1) {
        violentos.push(jugadorId);
      } else {
        violentos.splice(index, 1);
      }
      
      return { ...prev, jugadores_violentos: violentos };
    });
  };

  const handleAcceptAnimations = async () => {
    try {
      // Limpiar todo el estado de animaciones
      setShowingBadgeAnimations(false);
      setBadgeAnimations([]);
      setCurrentAnimationIndex(0);
      setAnimationComplete(false);
      setAnimationProcessed(false);
      
      // Ir directamente al home después de las animaciones
      toast.success('¡Gracias por calificar el partido!');
      navigate('/');
    } catch (error) {
      console.error('Error in handleAcceptAnimations:', error);
      navigate('/');
    }
  };

  const continueSubmitFlow = async () => {
    try {
      // Convertir UUIDs a IDs numéricos para la base de datos
      const mvpPlayer = formData.mvp_id ? jugadores.find(j => j.uuid === formData.mvp_id) : null;
      const arqueroPlayer = formData.arquero_id ? jugadores.find(j => j.uuid === formData.arquero_id) : null;
      
      // Encontrar el jugador actual para obtener su ID numérico
      const currentUserPlayer = jugadores.find(j => j.usuario_id === user.id);
      
      const surveyData = {
        partido_id: parseInt(partidoId),
        votante_id: currentUserPlayer?.id || null,
        se_jugo: formData.se_jugo,
        motivo_no_jugado: formData.motivo_no_jugado || null,
        asistieron_todos: formData.asistieron_todos,
        jugadores_ausentes: formData.jugadores_ausentes,
        partido_limpio: formData.partido_limpio,
        jugadores_violentos: formData.jugadores_violentos,
        mejor_jugador_eq_a: mvpPlayer?.id || null,
        mejor_jugador_eq_b: null,
        created_at: new Date().toISOString(),
      };
      
      if (formData.jugadores_ausentes.length > 0) {
        for (const jugadorUuid of formData.jugadores_ausentes) {
          try {
            // Encontrar el jugador y obtener su usuario_id
            const jugador = jugadores.find(j => j.uuid === jugadorUuid);
            if (jugador && jugador.usuario_id) {
              await processAbsenceWithoutNotice(jugador.usuario_id, parseInt(partidoId), user.id);
            }
          } catch (error) {
            console.error('Error processing absence without notice:', error);
          }
        }
      }
      
      const { error } = await supabase
        .from('post_match_surveys')
        .insert([surveyData]);
        
      if (error) throw error;
      
      // Match result update removed - columns don't exist in current schema
      
      const premios = [];
      
      if (mvpPlayer) {
        premios.push({
          jugador_id: mvpPlayer.id,
          partido_id: parseInt(partidoId),
          award_type: 'mvp',
          otorgado_por: user.id,
        });
      }
      
      if (arqueroPlayer) {
        premios.push({
          jugador_id: arqueroPlayer.id,
          partido_id: parseInt(partidoId),
          award_type: 'guante_dorado',
          otorgado_por: user.id,
        });
      }
      
      if (formData.jugadores_violentos.length > 0) {
        formData.jugadores_violentos.forEach((jugadorUuid) => {
          const jugadorViolento = jugadores.find(j => j.uuid === jugadorUuid);
          if (jugadorViolento) {
            premios.push({
              jugador_id: jugadorViolento.id,
              partido_id: parseInt(partidoId),
              award_type: 'tarjeta_roja',
              otorgado_por: user.id,
            });
          }
        });
      }
      
      if (premios.length > 0) {
        try {
          // Remover campo otorgado_por si no existe en la tabla
          const premiosLimpios = premios.map(({ otorgado_por, ...resto }) => resto);
          
          await supabase
            .from('player_awards')
            .insert(premiosLimpios);
          
          triggerBadgeRefresh();
        } catch (awardsError) {
          console.warn('Error inserting awards:', awardsError);
          // Continuar sin fallar si no se pueden insertar los premios
        }
      }
      
      // Solo procesar la base de datos, no mostrar UI adicional
      setEncuestaFinalizada(true);
      
      // Limpiar estado del formulario y animaciones
      setFormData({
        se_jugo: true,
        partido_limpio: true,
        asistieron_todos: true,
        jugadores_ausentes: [],
        jugadores_violentos: [],
        mvp_id: '',
        arquero_id: '',
        motivo_no_jugado: '',
        ganador: '',
        resultado: '',
      });
      setBadgeAnimations([]);
      setAnimationProcessed(false);
      
    } catch (error) {
      console.error('Error guardando encuesta:', error);
      toast.error('Error guardando encuesta: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!user || !partidoId) {
      toast.error('Debes iniciar sesión para calificar un partido');
      return;
    }
    
    if (submitting || animationProcessed || encuestaFinalizada) {
      return;
    }
    
    setSubmitting(true);
    setAnimationProcessed(true);
    
    const animations = [];
    const addedPlayers = new Set();
    
    if (formData.se_jugo) {
      if (formData.mvp_id) {
        const player = jugadores.find((j) => j.uuid === formData.mvp_id);
        if (player && !addedPlayers.has(player.uuid + '_mvp')) {
          animations.push({
            playerName: player.nombre,
            playerAvatar: player.avatar_url || player.foto_url,
            playerData: player,
            badgeType: 'mvp',
            badgeText: 'MVP',
            badgeIcon: '🏆',
          });
          addedPlayers.add(player.uuid + '_mvp');
        }
      }
      if (formData.arquero_id) {
        const player = jugadores.find((j) => j.uuid === formData.arquero_id);
        if (player && !addedPlayers.has(player.uuid + '_guante_dorado')) {
          animations.push({
            playerName: player.nombre,
            playerAvatar: player.avatar_url || player.foto_url,
            playerData: player,
            badgeType: 'guante_dorado',
            badgeText: 'GUANTE DORADO',
            badgeIcon: '🧤',
          });
          addedPlayers.add(player.uuid + '_guante_dorado');
        }
      }
      if (formData.jugadores_violentos.length > 0) {
        const firstViolentPlayer = jugadores.find((j) => j.uuid === formData.jugadores_violentos[0]);
        if (firstViolentPlayer && !addedPlayers.has(firstViolentPlayer.uuid + '_tarjeta_roja')) {
          animations.push({
            playerName: firstViolentPlayer.nombre,
            playerAvatar: firstViolentPlayer.avatar_url || firstViolentPlayer.foto_url,
            playerData: firstViolentPlayer,
            badgeType: 'tarjeta_roja',
            badgeText: 'TARJETA ROJA',
            badgeIcon: '🟥',
          });
          addedPlayers.add(firstViolentPlayer.uuid + '_tarjeta_roja');
        }
      }
      
      // Agregar ausencias injustificadas al final - evitar duplicados
      if (formData.jugadores_ausentes.length > 0) {
        formData.jugadores_ausentes.forEach((jugadorId) => {
          const player = jugadores.find((j) => j.uuid === jugadorId);
          // Triple verificación para evitar duplicados
          if (player && 
              !addedPlayers.has(player.uuid + '_ausencia') && 
              !animations.some(a => a.badgeType === 'ausencia_injustificada' && a.playerName === player.nombre)) {
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
    }
    
    if (animations.length > 0) {
      setBadgeAnimations(animations);
      setShowingBadgeAnimations(true);
      return;
    } else {
      await continueSubmitFlow();
    }
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

  // Hooks for BadgeAnimation component - moved to top level
  const [localAnimatedScore, setLocalAnimatedScore] = useState(null);
  const scoreAnimatingRef = useRef(false);
  const lastAnimatedScoreRef = useRef(null);

  const BadgeAnimation = ({ animations }) => {
    if (!animations || animations.length === 0) return null;
    
    // Mostrar la animación actual o la última si ya terminó el ciclo
    const animation = animations[Math.min(currentAnimationIndex, animations.length - 1)];
    if (!animation) return null;
    
    const player = animation.playerData || jugadores.find((j) => j.nombre === animation.playerName);
    const isAbsence = animation.badgeType === 'ausencia_injustificada';
    // Animation logic is now handled by top-level useEffect hooks
    
    return (
      // Centrado perfecto: flex con center en ambos ejes
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        width: '100%',
        padding: '20px',
        boxSizing: 'border-box',
        position: 'relative',
      }}>
        {/* Fondo con patrón radial giratorio mejorado */}
        <div className="radial-background"></div>
        <div className="radial-background-secondary"></div>
        <style>
          {`
            @keyframes slideInFromLeft {
              0% {
                transform: translateX(-100%) scale(0.9);
                opacity: 0;
              }
              100% {
                transform: translateX(0) scale(0.9);
                opacity: 1;
              }
            }
            @keyframes titleFadeIn {
              0% {
                opacity: 0;
                transform: translateY(-20px);
              }
              100% {
                opacity: 1;
                transform: translateY(0);
              }
            }
            @keyframes emojiZoomIn {
              0% {
                opacity: 0;
                transform: scale(0);
              }
              100% {
                opacity: 1;
                transform: scale(1);
              }
            }
            @keyframes rotateRays {
              0% {
                transform: rotate(0deg) scale(1.5);
              }
              100% {
                transform: rotate(360deg) scale(1.5);
              }
            }
            @keyframes rotateRaysReverse {
              0% {
                transform: rotate(0deg) scale(1.8);
              }
              100% {
                transform: rotate(-360deg) scale(1.8);
              }
            }
            .radial-background {
              position: fixed;
              top: -50%;
              left: -50%;
              width: 200vw;
              height: 200vh;
              background: conic-gradient(
                from 0deg,
                rgba(0, 255, 255, 0.4) 0deg,
                rgba(255, 255, 255, 0.3) 7.5deg,
                rgba(0, 255, 255, 0.4) 15deg,
                rgba(255, 255, 255, 0.3) 22.5deg,
                rgba(0, 255, 255, 0.4) 30deg,
                rgba(255, 255, 255, 0.3) 37.5deg,
                rgba(0, 255, 255, 0.4) 45deg,
                rgba(255, 255, 255, 0.3) 52.5deg,
                rgba(0, 255, 255, 0.4) 60deg,
                rgba(255, 255, 255, 0.3) 67.5deg,
                rgba(0, 255, 255, 0.4) 75deg,
                rgba(255, 255, 255, 0.3) 82.5deg,
                rgba(0, 255, 255, 0.4) 90deg,
                rgba(255, 255, 255, 0.3) 97.5deg,
                rgba(0, 255, 255, 0.4) 105deg,
                rgba(255, 255, 255, 0.3) 112.5deg,
                rgba(0, 255, 255, 0.4) 120deg,
                rgba(255, 255, 255, 0.3) 127.5deg,
                rgba(0, 255, 255, 0.4) 135deg,
                rgba(255, 255, 255, 0.3) 142.5deg,
                rgba(0, 255, 255, 0.4) 150deg,
                rgba(255, 255, 255, 0.3) 157.5deg,
                rgba(0, 255, 255, 0.4) 165deg,
                rgba(255, 255, 255, 0.3) 172.5deg,
                rgba(0, 255, 255, 0.4) 180deg,
                rgba(255, 255, 255, 0.3) 187.5deg,
                rgba(0, 255, 255, 0.4) 195deg,
                rgba(255, 255, 255, 0.3) 202.5deg,
                rgba(0, 255, 255, 0.4) 210deg,
                rgba(255, 255, 255, 0.3) 217.5deg,
                rgba(0, 255, 255, 0.4) 225deg,
                rgba(255, 255, 255, 0.3) 232.5deg,
                rgba(0, 255, 255, 0.4) 240deg,
                rgba(255, 255, 255, 0.3) 247.5deg,
                rgba(0, 255, 255, 0.4) 255deg,
                rgba(255, 255, 255, 0.3) 262.5deg,
                rgba(0, 255, 255, 0.4) 270deg,
                rgba(255, 255, 255, 0.3) 277.5deg,
                rgba(0, 255, 255, 0.4) 285deg,
                rgba(255, 255, 255, 0.3) 292.5deg,
                rgba(0, 255, 255, 0.4) 300deg,
                rgba(255, 255, 255, 0.3) 307.5deg,
                rgba(0, 255, 255, 0.4) 315deg,
                rgba(255, 255, 255, 0.3) 322.5deg,
                rgba(0, 255, 255, 0.4) 330deg,
                rgba(255, 255, 255, 0.3) 337.5deg,
                rgba(0, 255, 255, 0.4) 345deg,
                rgba(255, 255, 255, 0.3) 352.5deg,
                rgba(0, 255, 255, 0.4) 360deg
              );
              animation: rotateRays 12s linear infinite;
              z-index: -2;
            }
            .radial-background-secondary {
              position: fixed;
              top: -50%;
              left: -50%;
              width: 200vw;
              height: 200vh;
              background: conic-gradient(
                from 45deg,
                rgba(0, 200, 255, 0.2) 0deg,
                rgba(255, 255, 255, 0.15) 12deg,
                rgba(0, 200, 255, 0.2) 24deg,
                rgba(255, 255, 255, 0.15) 36deg,
                rgba(0, 200, 255, 0.2) 48deg,
                rgba(255, 255, 255, 0.15) 60deg,
                rgba(0, 200, 255, 0.2) 72deg,
                rgba(255, 255, 255, 0.15) 84deg,
                rgba(0, 200, 255, 0.2) 96deg,
                rgba(255, 255, 255, 0.15) 108deg,
                rgba(0, 200, 255, 0.2) 120deg,
                rgba(255, 255, 255, 0.15) 132deg,
                rgba(0, 200, 255, 0.2) 144deg,
                rgba(255, 255, 255, 0.15) 156deg,
                rgba(0, 200, 255, 0.2) 168deg,
                rgba(255, 255, 255, 0.15) 180deg,
                rgba(0, 200, 255, 0.2) 192deg,
                rgba(255, 255, 255, 0.15) 204deg,
                rgba(0, 200, 255, 0.2) 216deg,
                rgba(255, 255, 255, 0.15) 228deg,
                rgba(0, 200, 255, 0.2) 240deg,
                rgba(255, 255, 255, 0.15) 252deg,
                rgba(0, 200, 255, 0.2) 264deg,
                rgba(255, 255, 255, 0.15) 276deg,
                rgba(0, 200, 255, 0.2) 288deg,
                rgba(255, 255, 255, 0.15) 300deg,
                rgba(0, 200, 255, 0.2) 312deg,
                rgba(255, 255, 255, 0.15) 324deg,
                rgba(0, 200, 255, 0.2) 336deg,
                rgba(255, 255, 255, 0.15) 348deg,
                rgba(0, 200, 255, 0.2) 360deg
              );
              animation: rotateRaysReverse 16s linear infinite;
              z-index: -1;
            }
          `}
        </style>
        
        {/* Contenedor central compacto - elementos más juntos y centrados */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '400px', /* Reducido para mejor distribución */
          maxWidth: '400px',
          width: '100%',
          position: 'relative',
          zIndex: 1,
          margin: 'auto', /* Centrado automático */
        }}>
          
          {/* Título del badge con ribbon container */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '20px',
            textAlign: 'center',
            width: '100%',
          }}>
            <div style={{
              background: 'linear-gradient(135deg, rgba(255, 215, 0, 0.9) 0%, rgba(255, 193, 7, 0.9) 50%, rgba(255, 215, 0, 0.9) 100%)',
              border: '3px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '25px',
              padding: '12px 30px',
              position: 'relative',
              boxShadow: '0 8px 32px rgba(255, 215, 0, 0.3), inset 0 2px 8px rgba(255, 255, 255, 0.2)',
              animation: 'titleFadeIn 0.8s ease-out 0.2s both',
              transform: 'perspective(1000px) rotateX(5deg)',
              backdropFilter: 'blur(10px)',
            }}>
              <div style={{
                color: '#1a1a2e',
                fontSize: '28px',
                fontWeight: '800',
                fontFamily: "'Oswald', Arial, sans-serif",
                textShadow: '1px 1px 2px rgba(255, 255, 255, 0.5)',
                letterSpacing: '1px',
                lineHeight: '1.2',
                wordWrap: 'break-word',
                maxWidth: '100%',
              }}>
                {animation.badgeType === 'mvp' ? 'MVP' :
                  animation.badgeType === 'guante_dorado' ? 'GUANTE DORADO' :
                    animation.badgeType === 'tarjeta_roja' ? 'TARJETA ROJA' :
                      animation.badgeType === 'ausencia_injustificada' ? 'AUSENCIAS INJUSTIFICADAS' : animation.badgeText}
              </div>
              {/* Decorative corners */}
              <div style={{
                position: 'absolute',
                top: '-3px',
                left: '-3px',
                width: '12px',
                height: '12px',
                background: 'linear-gradient(45deg, rgba(255, 255, 255, 0.8), rgba(255, 215, 0, 0.8))',
                borderRadius: '50%',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
              }}></div>
              <div style={{
                position: 'absolute',
                top: '-3px',
                right: '-3px',
                width: '12px',
                height: '12px',
                background: 'linear-gradient(45deg, rgba(255, 255, 255, 0.8), rgba(255, 215, 0, 0.8))',
                borderRadius: '50%',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
              }}></div>
              <div style={{
                position: 'absolute',
                bottom: '-3px',
                left: '-3px',
                width: '12px',
                height: '12px',
                background: 'linear-gradient(45deg, rgba(255, 255, 255, 0.8), rgba(255, 215, 0, 0.8))',
                borderRadius: '50%',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
              }}></div>
              <div style={{
                position: 'absolute',
                bottom: '-3px',
                right: '-3px',
                width: '12px',
                height: '12px',
                background: 'linear-gradient(45deg, rgba(255, 255, 255, 0.8), rgba(255, 215, 0, 0.8))',
                borderRadius: '50%',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
              }}></div>
            </div>
          </div>
          
          {/* ProfileCard - margen reducido */}
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
                animation: 'slideInFromLeft 0.8s ease-out 0.4s both',
              }}>
                <ProfileCard
                  profile={player}
                  enableTilt={false}
                  isVisible={true}
                  currentUserId={user?.id}
                />
              </div>
            )}
          </div>
          
          {/* Emoji con contenedor circular destacado */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '10px',
          }}>
            <div style={{
              width: '120px',
              height: '120px',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(255, 255, 255, 0.9) 0%, rgba(255, 215, 0, 0.8) 70%, rgba(255, 193, 7, 0.9) 100%)',
              border: '4px solid rgba(255, 255, 255, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 12px 40px rgba(255, 215, 0, 0.4), inset 0 4px 12px rgba(255, 255, 255, 0.3)',
              animation: 'emojiZoomIn 0.6s ease-out 1.2s both',
              position: 'relative',
              backdropFilter: 'blur(5px)',
            }}>
              <div style={{
                fontSize: '60px',
                filter: 'drop-shadow(2px 2px 4px rgba(0, 0, 0, 0.3))',
              }}>
                {animation.badgeIcon}
              </div>
              {/* Shine effect */}
              <div style={{
                position: 'absolute',
                top: '15px',
                left: '25px',
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(255, 255, 255, 0.6) 0%, transparent 70%)',
                animation: 'emojiZoomIn 0.6s ease-out 1.4s both',
              }}></div>
            </div>
          </div>
          
          {/* Texto de puntos penalizados - pegado al emoji */}
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
                animation: 'titleFadeIn 0.8s ease-out 2s both',
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

  if (yaCalificado) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="voting-title-modern">YA CALIFICASTE</div>
          <div style={{ color: '#fff', fontSize: 26, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30, textAlign: 'center' }}>
            Ya has calificado este partido.<br />¡Gracias por tu participación!
          </div>
          <button className="voting-confirm-btn" onClick={() => navigate('/')}>
            VOLVER AL INICIO
          </button>
        </div>
      </div>
    );
  }

  if (!partido) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="voting-title-modern">PARTIDO NO ENCONTRADO</div>
          <button className="voting-confirm-btn" onClick={() => navigate('/')}>
            VOLVER AL INICIO
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="voting-bg">
      {/* Overlay de animaciones - centrado perfecto */}
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
          {/* Contenedor de animaciones - centrado vertical y horizontal con padding superior */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            width: '100%',
            paddingTop: '60px',
            paddingBottom: '120px',
          }}>
            {/* Mostrar animación siempre mientras el overlay esté activo */}
            {badgeAnimations.length > 0 && (
              <BadgeAnimation animations={badgeAnimations} />
            )}
          </div>
          
          {/* Botón siempre visible - solo para saltear animaciones */}
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
        </div>
      )}
      
      <div className="voting-modern-card">
        {currentStep === 0 && (
          <div className="player-vote-card slide-in">
            <div className="voting-title-modern">
              ¿SE JUGÓ EL PARTIDO?
            </div>
            <div style={{ color: '#fff', fontSize: 20, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30, textAlign: 'center' }}>
              {formatFecha(partido.fecha)}<br />
              {partido.hora && `${partido.hora} - `}{partido.sede ? partido.sede.split(/[,(]/)[0].trim() : 'Sin ubicación'}
            </div>
            <div className="player-select-grid">
              <button
                className={`player-select-btn${formData.se_jugo ? ' selected' : ''}`}
                onClick={() => {
                  handleInputChange('se_jugo', true);
                  setCurrentStep(1);
                }}
                type="button"
                style={{ borderRadius: '12px' }}
              >
                SÍ
              </button>
              <button
                className={`player-select-btn${!formData.se_jugo ? ' selected' : ''}`}
                onClick={() => {
                  handleInputChange('se_jugo', false);
                  setCurrentStep(10);
                }}
                type="button"
                style={{ borderRadius: '12px' }}
              >
                NO
              </button>
            </div>
          </div>
        )}

        {currentStep === 1 && (
          <div className="player-vote-card slide-in">
            <div className="voting-title-modern">
              ¿ASISTIERON TODOS?
            </div>
            <div className="player-select-grid">
              <button
                className="player-select-btn"
                onClick={() => {
                  handleInputChange('asistieron_todos', true);
                  setCurrentStep(2);
                }}
                type="button"
                style={{ borderRadius: '12px' }}
              >
                SÍ
              </button>
              <button
                className="player-select-btn"
                onClick={() => {
                  handleInputChange('asistieron_todos', false);
                  setCurrentStep(12);
                }}
                type="button"
                style={{ borderRadius: '12px' }}
              >
                NO
              </button>
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className="player-vote-card slide-in">
            <div className="voting-title-modern">
              ¿QUIÉN FUE EL MEJOR JUGADOR?
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', margin: '15px auto', maxWidth: '85%' }}>
              {jugadores.map((jugador) => (
                <div
                  key={jugador.uuid}
                  onClick={() => handleInputChange('mvp_id', jugador.uuid)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '10px',
                    borderRadius: '6px',
                    backgroundColor: formData.mvp_id === jugador.uuid ? '#00D49B' : '#2a2a40',
                    border: formData.mvp_id === jugador.uuid ? '1px solid #00D49B' : '1px solid #444',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    minHeight: '90px',
                  }}
                >
                  <div style={{
                    width: '55px',
                    height: '55px',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: '6px',
                    backgroundColor: '#1a1a2e',
                    flexShrink: 0,
                  }}>
                    {jugador.avatar_url || jugador.foto_url ? (
                      <img 
                        src={jugador.avatar_url || jugador.foto_url} 
                        alt={jugador.nombre}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#999',
                        fontSize: '16px',
                        fontWeight: '600',
                      }}>
                        {jugador.nombre.charAt(0)}
                      </div>
                    )}
                  </div>
                  <span style={{
                    color: 'white',
                    fontSize: '10px',
                    fontWeight: '500',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    width: '100%',
                  }}>
                    {jugador.nombre}
                  </span>
                </div>
              ))}
            </div>
            <button
              className="voting-confirm-btn"
              onClick={() => {
                setBadgeAnimations([]);
                setShowingBadgeAnimations(false);
                setAnimationProcessed(false);
                setCurrentStep(3);
              }}
              style={{ marginTop: '20px' }}
            >
              SIGUIENTE
            </button>
          </div>
        )}

        {currentStep === 3 && (
          <div className="player-vote-card slide-in">
            <div className="voting-title-modern">
              ¿QUIÉN FUE EL MEJOR ARQUERO?
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', margin: '15px auto', maxWidth: '85%' }}>
              {jugadores.map((jugador) => (
                <div
                  key={jugador.uuid}
                  onClick={() => handleInputChange('arquero_id', jugador.uuid)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '10px',
                    borderRadius: '6px',
                    backgroundColor: formData.arquero_id === jugador.uuid ? '#FFD700' : '#2a2a40',
                    border: formData.arquero_id === jugador.uuid ? '1px solid #FFD700' : '1px solid #444',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    minHeight: '90px',
                  }}
                >
                  <div style={{
                    width: '55px',
                    height: '55px',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: '6px',
                    backgroundColor: '#1a1a2e',
                    flexShrink: 0,
                  }}>
                    {jugador.avatar_url || jugador.foto_url ? (
                      <img 
                        src={jugador.avatar_url || jugador.foto_url} 
                        alt={jugador.nombre}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#999',
                        fontSize: '16px',
                        fontWeight: '600',
                      }}>
                        {jugador.nombre.charAt(0)}
                      </div>
                    )}
                  </div>
                  <span style={{
                    color: 'white',
                    fontSize: '10px',
                    fontWeight: '500',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    width: '100%',
                  }}>
                    {jugador.nombre}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
              <button
                className="player-select-btn"
                onClick={() => {
                  handleInputChange('arquero_id', '');
                  setCurrentStep(4);
                }}
                style={{
                  backgroundColor: 'rgba(255, 87, 34, 0.3)',
                  borderColor: '#fff',
                  borderRadius: '12px',
                  width: '90%',
                }}
              >
                NO HUBO ARQUEROS FIJOS
              </button>
            </div>
            <button
              className="voting-confirm-btn"
              onClick={() => setCurrentStep(4)}
              style={{ marginTop: '10px' }}
            >
              SIGUIENTE
            </button>
          </div>
        )}

        {currentStep === 4 && (
          <div className="player-vote-card slide-in">
            <div className="voting-title-modern">
              ¿FUE UN PARTIDO LIMPIO?
            </div>
            <div className="player-select-grid">
              <button
                className={`player-select-btn${formData.partido_limpio ? ' selected' : ''}`}
                onClick={() => {
                  handleInputChange('partido_limpio', true);
                  setCurrentStep(5);
                }}
                type="button"
                style={{ borderRadius: '12px' }}
              >
                SÍ
              </button>
              <button
                className={`player-select-btn${!formData.partido_limpio ? ' selected' : ''}`}
                onClick={() => {
                  handleInputChange('partido_limpio', false);
                  setCurrentStep(6);
                }}
                type="button"
                style={{ borderRadius: '12px' }}
              >
                NO
              </button>
            </div>
          </div>
        )}

        {currentStep === 5 && (
          <div className="player-vote-card slide-in">
            <div className="voting-title-modern">
              ¿QUIÉN GANÓ?
            </div>
            <div className="player-select-grid">
              <button
                className={`player-select-btn${formData.ganador === 'equipo_a' ? ' selected' : ''}`}
                onClick={() => handleInputChange('ganador', 'equipo_a')}
                type="button"
                style={{
                  backgroundColor: formData.ganador === 'equipo_a' ? '#9C27B0' : 'rgba(156, 39, 176, 0.3)',
                  borderColor: '#fff',
                  borderRadius: '12px',
                }}
              >
                EQUIPO A
              </button>
              <button
                className={`player-select-btn${formData.ganador === 'equipo_b' ? ' selected' : ''}`}
                onClick={() => handleInputChange('ganador', 'equipo_b')}
                type="button"
                style={{
                  backgroundColor: formData.ganador === 'equipo_b' ? '#FF9800' : 'rgba(255, 152, 0, 0.3)',
                  borderColor: '#fff',
                  borderRadius: '12px',
                }}
              >
                EQUIPO B
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', width: '100%', marginBottom: '20px' }}>
              <input
                type="text"
                className="input-modern"
                style={{ 
                  width: '90%', 
                  padding: '15px',
                  textAlign: 'center',
                  fontFamily: "'Oswald', Arial, sans-serif",
                  backgroundColor: '#2a2a40',
                  border: '1px solid #444',
                  borderRadius: '8px',
                  color: 'white',
                }}
                value={formData.resultado || ''}
                onChange={(e) => handleInputChange('resultado', e.target.value)}
                placeholder="¿Te acordás cómo salió?"
              />
            </div>
            <button
              className="voting-confirm-btn"
              onClick={handleSubmit}
              style={{ marginTop: '20px' }}
            >
              FINALIZAR ENCUESTA
            </button>
          </div>
        )}

        {currentStep === 6 && (
          <div className="player-vote-card slide-in">
            <div className="voting-title-modern">
              ¿QUIÉN JUGÓ SUCIO?
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', margin: '15px auto', maxWidth: '85%' }}>
              {jugadores.map((jugador) => (
                <div
                  key={jugador.uuid}
                  onClick={() => toggleJugadorViolento(jugador.uuid)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '10px',
                    borderRadius: '6px',
                    backgroundColor: formData.jugadores_violentos.includes(jugador.uuid) ? '#DE1C49' : '#2a2a40',
                    border: formData.jugadores_violentos.includes(jugador.uuid) ? '1px solid #DE1C49' : '1px solid #444',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    minHeight: '90px',
                  }}
                >
                  <div style={{
                    width: '55px',
                    height: '55px',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: '6px',
                    backgroundColor: '#1a1a2e',
                    flexShrink: 0,
                  }}>
                    {jugador.avatar_url || jugador.foto_url ? (
                      <img 
                        src={jugador.avatar_url || jugador.foto_url} 
                        alt={jugador.nombre}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#999',
                        fontSize: '16px',
                        fontWeight: '600',
                      }}>
                        {jugador.nombre.charAt(0)}
                      </div>
                    )}
                  </div>
                  <span style={{
                    color: 'white',
                    fontSize: '10px',
                    fontWeight: '500',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    width: '100%',
                  }}>
                    {jugador.nombre}
                  </span>
                </div>
              ))}
            </div>
            <button
              className="voting-confirm-btn"
              onClick={() => setCurrentStep(5)}
              style={{ marginTop: '20px' }}
            >
              SIGUIENTE
            </button>
          </div>
        )}

        {currentStep === 10 && (
          <div className="player-vote-card slide-in">
            <div className="voting-title-modern">
              ¿POR QUÉ NO SE JUGÓ?
            </div>
            <textarea
              className="input-modern"
              style={{ 
                width: '90%', 
                height: '80px', 
                resize: 'none',
                marginBottom: '20px',
                padding: '15px',
                textAlign: 'center',
                fontFamily: "'Oswald', Arial, sans-serif",
              }}
              value={formData.motivo_no_jugado || ''}
              onChange={(e) => handleInputChange('motivo_no_jugado', e.target.value)}
              placeholder="Explica por qué no se pudo jugar..."
              rows={2}
            />
            <button
              className="player-select-btn"
              onClick={() => setCurrentStep(11)}
              style={{
                backgroundColor: '#DE1C49',
                marginBottom: '15px',
                width: '90%',
              }}
            >
              AUSENCIA SIN AVISO
            </button>
            <button
              className="voting-confirm-btn"
              onClick={handleSubmit}
            >
              FINALIZAR
            </button>
          </div>
        )}

        {currentStep === 11 && (
          <div className="player-vote-card slide-in">
            <div className="voting-title-modern">
              SELECCIONA JUGADORES AUSENTES
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', margin: '15px auto', maxWidth: '85%' }}>
              {jugadores.map((jugador) => (
                <div
                  key={jugador.uuid}
                  onClick={() => toggleJugadorAusente(jugador.uuid)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '10px',
                    borderRadius: '6px',
                    backgroundColor: formData.jugadores_ausentes.includes(jugador.uuid) ? '#DE1C49' : '#2a2a40',
                    border: formData.jugadores_ausentes.includes(jugador.uuid) ? '1px solid #DE1C49' : '1px solid #444',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    minHeight: '90px',
                  }}
                >
                  <div style={{
                    width: '55px',
                    height: '55px',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: '6px',
                    backgroundColor: '#1a1a2e',
                    flexShrink: 0,
                  }}>
                    {jugador.avatar_url || jugador.foto_url ? (
                      <img 
                        src={jugador.avatar_url || jugador.foto_url} 
                        alt={jugador.nombre}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#999',
                        fontSize: '16px',
                        fontWeight: '600',
                      }}>
                        {jugador.nombre.charAt(0)}
                      </div>
                    )}
                  </div>
                  <span style={{
                    color: 'white',
                    fontSize: '10px',
                    fontWeight: '500',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    width: '100%',
                  }}>
                    {jugador.nombre}
                  </span>
                </div>
              ))}
            </div>
            <button
              className="voting-confirm-btn"
              onClick={handleSubmit}
              style={{ marginTop: '20px' }}
            >
              FINALIZAR
            </button>
          </div>
        )}

        {currentStep === 12 && (
          <div className="player-vote-card slide-in">
            <div className="voting-title-modern">
              ¿QUIÉNES FALTARON?
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', margin: '15px auto', maxWidth: '85%' }}>
              {jugadores.map((jugador) => (
                <div
                  key={jugador.uuid}
                  onClick={() => toggleJugadorAusente(jugador.uuid)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '10px',
                    borderRadius: '6px',
                    backgroundColor: formData.jugadores_ausentes.includes(jugador.uuid) ? '#DE1C49' : '#2a2a40',
                    border: formData.jugadores_ausentes.includes(jugador.uuid) ? '1px solid #DE1C49' : '1px solid #444',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    minHeight: '90px',
                  }}
                >
                  <div style={{
                    width: '55px',
                    height: '55px',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: '6px',
                    backgroundColor: '#1a1a2e',
                    flexShrink: 0,
                  }}>
                    {jugador.avatar_url || jugador.foto_url ? (
                      <img 
                        src={jugador.avatar_url || jugador.foto_url} 
                        alt={jugador.nombre}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#999',
                        fontSize: '16px',
                        fontWeight: '600',
                      }}>
                        {jugador.nombre.charAt(0)}
                      </div>
                    )}
                  </div>
                  <span style={{
                    color: 'white',
                    fontSize: '10px',
                    fontWeight: '500',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    width: '100%',
                  }}>
                    {jugador.nombre}
                  </span>
                </div>
              ))}
            </div>
            <button
              className="voting-confirm-btn"
              onClick={() => setCurrentStep(2)}
              style={{ marginTop: '20px' }}
            >
              SIGUIENTE
            </button>
          </div>
        )}

        {currentStep === 99 && (
          <div className="player-vote-card slide-in">
            <div className="voting-title-modern">
              ¡GRACIAS POR FINALIZAR LA ENCUESTA!
            </div>
            <div style={{ color: '#fff', fontSize: 26, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30, textAlign: 'center' }}>
              En 6 horas publicaremos los resultados
            </div>
            <button 
              className="voting-confirm-btn"
              onClick={() => navigate('/')}
            >
              VOLVER AL INICIO
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default EncuestaPartido;