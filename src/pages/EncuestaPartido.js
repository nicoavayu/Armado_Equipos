import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase, checkPartidoCalificado } from '../supabase';
import { processAbsenceWithoutNotice } from '../utils/matchStatsManager';
import { toast } from 'react-toastify';
import { handleError, AppError, ERROR_CODES } from '../lib/errorHandler';
import { useAuth } from '../components/AuthProvider';
import { useBadges } from '../context/BadgeContext';
import LoadingSpinner from '../components/LoadingSpinner';
import { finalizeIfComplete } from '../services/surveyCompletionService';
import { toBigIntId } from '../utils';
import { useNotifications } from '../context/NotificationContext';

import ProfileCard from '../components/ProfileCard';
import '../VotingView.css';

const EncuestaPartido = () => {
  const { partidoId, matchId } = useParams();
  const id = partidoId ?? matchId;
  const { user } = useAuth();
  const { triggerBadgeRefresh } = useBadges();
  const { fetchNotifications } = useNotifications();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [partido, setPartido] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);

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
  const [encuestaFinalizada, setEncuestaFinalizada] = useState(false);
  const toastShownRef = useRef(false);

  useEffect(() => {
    const fetchPartidoData = async () => {
      try {
        if (!id || !user) {
          navigate('/');
          return;
        }
        
        setLoading(true);
        
        // Check if user already submitted survey
        const currentUserPlayer = await supabase
          .from('jugadores')
          .select('id')
          .eq('partido_id', id)
          .eq('usuario_id', user.id)
          .single();
        
        if (currentUserPlayer.data?.id) {
          const { data: existingSurvey } = await supabase
            .from('post_match_surveys')
            .select('id')
            .eq('partido_id', parseInt(id))
            .eq('votante_id', currentUserPlayer.data.id)
            .single();
          
          if (existingSurvey) {
            setAlreadySubmitted(true);
          }
        }
        
        const { data: partidoData, error: partidoError } = await supabase
          .from('partidos')
          .select('*')
          .eq('id', id)
          .single();
          
        if (partidoError) throw partidoError;
        if (!partidoData) {
          throw new AppError('Partido no encontrado', ERROR_CODES.NOT_FOUND);
        }
        
        setPartido(partidoData);
        
        if (partidoData.jugadores && Array.isArray(partidoData.jugadores)) {
          setJugadores(partidoData.jugadores);
        }
        
      } catch (error) {
        handleError(error, { showToast: true, onError: () => {} });
        navigate('/');
      } finally {
        setLoading(false);
      }
    };
    
    if (id && user) {
      fetchPartidoData();
    }
  }, [id, user, navigate]);

  // Mark survey related notifications as read when entering survey page
  useEffect(() => {
    const markNotificationRead = async () => {
      if (!id || !user?.id) return;
      try {
        const nowIso = new Date().toISOString();
        const partidoIdNum = Number(id);

        // Prefer the canonical fields inserted by the DB cron: top-level partido_id and data.match_id (string)
        await Promise.all([
          supabase.from('notifications')
            .update({ read: true, read_at: nowIso })
            .eq('user_id', user.id)
            .in('type', ['survey_start', 'post_match_survey'])
            .eq('partido_id', partidoIdNum),

          supabase.from('notifications')
            .update({ read: true, read_at: nowIso })
            .eq('user_id', user.id)
            .in('type', ['survey_start', 'post_match_survey'])
            .contains('data', { match_id: String(id) }),
        ]);

        try { await fetchNotifications?.(); } catch {}
      } catch (error) {
        console.error('[MARK_NOTIF_READ] Error:', error);
      }
    };

    markNotificationRead();
  }, [id, user?.id, fetchNotifications]);



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



  const continueSubmitFlow = async () => {
    try {
      if (alreadySubmitted) {
        toast.info('Ya completaste esta encuesta');
        return;
      }
      
      // Convertir UUIDs a IDs numéricos para la base de datos
      const mvpPlayer = formData.mvp_id ? jugadores.find(j => j.uuid === formData.mvp_id) : null;
      const arqueroPlayer = formData.arquero_id ? jugadores.find(j => j.uuid === formData.arquero_id) : null;
      
      // Encontrar el jugador actual para obtener su ID numérico
      const currentUserPlayer = jugadores.find(j => j.usuario_id === user.id);
      
      // Convertir arrays de UUID a IDs numéricos
      const uuidToId = new Map(jugadores.map(j => [j.uuid, j.id]));
      const violentosIds = (formData.jugadores_violentos || [])
        .map(u => uuidToId.get(u))
        .filter(Boolean);
      const ausentesIds = (formData.jugadores_ausentes || [])
        .map(u => uuidToId.get(u))
        .filter(Boolean);
      
      const surveyData = {
        partido_id: parseInt(id),
        votante_id: currentUserPlayer?.id || null,
        se_jugo: formData.se_jugo,
        motivo_no_jugado: formData.motivo_no_jugado || null,
        asistieron_todos: formData.asistieron_todos,
        jugadores_ausentes: ausentesIds,
        partido_limpio: formData.partido_limpio,
        jugadores_violentos: violentosIds,
        mejor_jugador_eq_a: mvpPlayer?.id || null,
        mejor_jugador_eq_b: arqueroPlayer?.id || null,
        created_at: new Date().toISOString(),
      };
      
      if (formData.jugadores_ausentes.length > 0) {
        for (const jugadorUuid of formData.jugadores_ausentes) {
          try {
            // Encontrar el jugador y obtener su usuario_id
            const jugador = jugadores.find(j => j.uuid === jugadorUuid);
            if (jugador && jugador.usuario_id) {
              await processAbsenceWithoutNotice(jugador.usuario_id, parseInt(id), user.id);
            }
          } catch (error) {
            console.error('Error processing absence without notice:', error);
          }
        }
      }
      
      // 1) guardar encuesta
      const { error } = await supabase
        .from('post_match_surveys')
        .insert([surveyData]);
        
      if (error) throw error;
      
      // 2) Marcar notificaciones relacionadas como leídas (usa contrato canónico)
      try {
        const nowIso = new Date().toISOString();
        const partidoIdNum = Number(id);
        await Promise.all([
          supabase.from('notifications').update({ read: true, read_at: nowIso })
            .eq('user_id', user.id).in('type', ['survey_start', 'post_match_survey']).eq('partido_id', partidoIdNum),

          supabase.from('notifications').update({ read: true, read_at: nowIso })
            .eq('user_id', user.id).in('type', ['survey_start', 'post_match_survey']).contains('data', { match_id: String(id) }),
        ]);
        try { await fetchNotifications?.(); } catch {}
      } catch (notifError) {
        console.error('[MARK_NOTIF_READ] Error:', notifError);
      }
      
      // 3) intentar cierre si ya están todos (no bloquear el flujo si falla)
      try {
        await finalizeIfComplete(parseInt(id));
      } catch (e) {
        console.warn('[finalizeIfComplete] non-blocking error:', e);
      }
      
      // 4) Mostrar pantalla final interna (sin toast, sin redirect)
      setAlreadySubmitted(true);
      setEncuestaFinalizada(true);
      setCurrentStep(99);
      
    } catch (error) {
      handleError(error, { showToast: true, onError: () => {} });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!user || !id) {
      toast.error('Debes iniciar sesión para calificar un partido');
      return;
    }
    
    if (alreadySubmitted) {
      toast.info('Ya completaste esta encuesta');
      return;
    }
    
    if (submitting || encuestaFinalizada) {
      return;
    }
    
    setSubmitting(true);
    
    await continueSubmitFlow();
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

  const formatFechaCorta = (fechaStr) => {
    try {
      const fecha = new Date(fechaStr);
      return fecha.toLocaleDateString('es-ES', { 
        weekday: 'short',
        day: 'numeric',
        month: 'numeric',
      });
    } catch (e) {
      return fechaStr || 'Fecha no disponible';
    }
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

  if (yaCalificado || alreadySubmitted) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="voting-title-modern">YA COMPLETASTE LA ENCUESTA</div>
          <div style={{ color: '#fff', fontSize: 26, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30, textAlign: 'center' }}>
            Ya has completado la encuesta de este partido.<br />¡Gracias por tu participación!
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
                style={{ borderRadius: '6px' }}
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
                style={{ borderRadius: '6px' }}
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
                style={{ borderRadius: '6px' }}
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
                style={{ borderRadius: '6px' }}
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
              onClick={() => setCurrentStep(3)}
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
                  backgroundColor: 'rgba(255, 86, 34, 0.92)',
                  borderColor: '#fff',
                  borderRadius: '6px',
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
                style={{ borderRadius: '6px' }}
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
                style={{ borderRadius: '6px' }}
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
                  borderRadius: '6px',
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
                  borderRadius: '6px',
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
            <div style={{ display: 'flex', justifyContent: 'center', width: '100%', marginBottom: '20px' }}>
              <textarea
                style={{ 
                  width: '90%', 
                  height: '80px', 
                  resize: 'none',
                  padding: '15px',
                  textAlign: 'center',
                  fontFamily: "'Oswald', Arial, sans-serif",
                  backgroundColor: '#2a2a40',
                  border: '1px solid #444',
                  borderRadius: '8px',
                  color: 'white',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              value={formData.motivo_no_jugado || ''}
              onChange={(e) => handleInputChange('motivo_no_jugado', e.target.value)}
              placeholder="Explica por qué no se pudo jugar..."
                rows={2}
              />
            </div>
            <style>
              {`
                textarea:focus {
                  background-color: #2a2a40 !important;
                  color: white !important;
                  border: 1px solid #444 !important;
                  outline: none !important;
                }
              `}
            </style>
            <button
              className="voting-confirm-btn"
              onClick={() => setCurrentStep(11)}
              style={{
                backgroundColor: '#DE1C49',
                borderColor: '#DE1C49',
                marginBottom: '15px',
              }}
            >
              AUSENCIA SIN AVISO
            </button>
            <button
              className="voting-confirm-btn"
              onClick={continueSubmitFlow}
            >
              FINALIZAR
            </button>
          </div>
        )}

        {currentStep === 11 && (
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
              ¡GRACIAS POR CALIFICAR!
            </div>
            <div style={{ color: '#fff', fontSize: 26, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30, textAlign: 'center' }}>
              Los resultados se publicarán en ~6 horas.
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