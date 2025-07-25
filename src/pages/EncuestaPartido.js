import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase, checkPartidoCalificado } from '../supabase';
import { toast } from 'react-toastify';
import { useAuth } from '../components/AuthProvider';
import LoadingSpinner from '../components/LoadingSpinner';
import './EncuestaPartido.css';

/**
 * Página de encuesta post-partido
 * Permite al usuario calificar un partido en el que participó
 */
const EncuestaPartido = () => {
  const { partidoId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [partido, setPartido] = useState(null);
  const [formData, setFormData] = useState({
    se_jugo: true,
    partido_limpio: true,
    jugadores_ausentes: [],
    jugadores_violentos: [],
    mvp_id: '',
    arquero_id: '',
    jugador_sucio_id: '',
    comentarios: '',
  });
  const [jugadores, setJugadores] = useState([]);
  const [yaCalificado, setYaCalificado] = useState(false);

  // Cargar datos del partido y verificar si ya fue calificado
  useEffect(() => {
    const fetchPartidoData = async () => {
      if (!partidoId || !user) {
        navigate('/');
        return;
      }
      
      try {
        setLoading(true);
        
        // Verificar si ya calificó este partido
        const calificado = await checkPartidoCalificado(partidoId, user.id);
        if (calificado) {
          setYaCalificado(true);
          toast.info('Ya has calificado este partido');
          return;
        }
        
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
        
        // Extraer jugadores del partido
        if (partidoData.jugadores && Array.isArray(partidoData.jugadores)) {
          setJugadores(partidoData.jugadores);
        }
        
      } catch (error) {
        console.error('Error cargando datos del partido:', error);
        toast.error('Error cargando datos del partido');
      } finally {
        setLoading(false);
      }
    };
    
    fetchPartidoData();
  }, [partidoId, user, navigate]);

  // Manejar cambios en el formulario
  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Manejar selección/deselección de jugadores ausentes
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

  // Manejar selección/deselección de jugadores violentos
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

  // Enviar encuesta
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!user || !partidoId) {
      toast.error('Debes iniciar sesión para calificar un partido');
      return;
    }
    
    setSubmitting(true);
    
    try {
      // Preparar datos para guardar
      const surveyData = {
        user_id: user.id,
        partido_id: partidoId,
        se_jugo: formData.se_jugo,
        partido_limpio: formData.partido_limpio,
        asistieron_todos: formData.jugadores_ausentes.length === 0,
        jugadores_ausentes: formData.jugadores_ausentes,
        jugadores_violentos: formData.jugadores_violentos,
        mvp_id: formData.mvp_id || null,
        arquero_id: formData.arquero_id || null,
        jugador_sucio_id: formData.jugador_sucio_id || null,
        comentarios: formData.comentarios,
        created_at: new Date().toISOString(),
      };
      
      // Guardar encuesta
      const { error } = await supabase
        .from('post_match_surveys')
        .insert([surveyData]);
        
      if (error) throw error;
      
      // Guardar premios si se seleccionaron
      const premios = [];
      
      if (formData.mvp_id) {
        premios.push({
          jugador_id: formData.mvp_id,
          partido_id: partidoId,
          award_type: 'mvp',
          otorgado_por: user.id,
        });
      }
      
      if (formData.arquero_id) {
        premios.push({
          jugador_id: formData.arquero_id,
          partido_id: partidoId,
          award_type: 'goalkeeper',
          otorgado_por: user.id,
        });
      }
      
      if (formData.jugador_sucio_id) {
        premios.push({
          jugador_id: formData.jugador_sucio_id,
          partido_id: partidoId,
          award_type: 'negative_fair_play',
          otorgado_por: user.id,
        });
      }
      
      if (premios.length > 0) {
        const { error: premiosError } = await supabase
          .from('player_awards')
          .insert(premios);
          
        if (premiosError) {
          console.error('Error guardando premios:', premiosError);
        }
      }
      
      toast.success('¡Gracias por calificar el partido!');
      navigate('/');
      
    } catch (error) {
      console.error('Error guardando encuesta:', error);
      toast.error('Error guardando encuesta: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Formatear fecha para mostrar
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

  if (loading) {
    return (
      <div className="encuesta-loading">
        <LoadingSpinner size="large" />
        <p>Cargando datos del partido...</p>
      </div>
    );
  }

  if (yaCalificado) {
    return (
      <div className="encuesta-container">
        <div className="encuesta-header">
          <h2>Partido ya calificado</h2>
          <button className="encuesta-back-btn" onClick={() => navigate('/')}>
            Volver al inicio
          </button>
        </div>
        <div className="encuesta-content">
          <p>Ya has calificado este partido. ¡Gracias por tu participación!</p>
        </div>
      </div>
    );
  }

  if (!partido) {
    return (
      <div className="encuesta-error">
        <h2>Partido no encontrado</h2>
        <button className="encuesta-back-btn" onClick={() => navigate('/')}>
          Volver al inicio
        </button>
      </div>
    );
  }

  return (
    <div className="encuesta-container">
      <div className="encuesta-header">
        <h2>Encuesta Post-Partido</h2>
        <button className="encuesta-back-btn" onClick={() => navigate('/')}>
          Cancelar
        </button>
      </div>
      
      <div className="encuesta-partido-info">
        <div className="encuesta-fecha">{formatFecha(partido.fecha)}</div>
        <div className="encuesta-sede">{partido.sede || 'Sin ubicación'}</div>
        {partido.hora && <div className="encuesta-hora">{partido.hora}</div>}
      </div>
      
      <form className="encuesta-form" onSubmit={handleSubmit}>
        {/* ¿Se jugó el partido? */}
        <div className="encuesta-section">
          <h3>¿Se jugó el partido?</h3>
          <div className="encuesta-options">
            <label className={`encuesta-option ${formData.se_jugo ? 'selected' : ''}`}>
              <input
                type="radio"
                name="se_jugo"
                checked={formData.se_jugo}
                onChange={() => handleInputChange('se_jugo', true)}
              />
              <span>Sí</span>
            </label>
            <label className={`encuesta-option ${!formData.se_jugo ? 'selected' : ''}`}>
              <input
                type="radio"
                name="se_jugo"
                checked={!formData.se_jugo}
                onChange={() => handleInputChange('se_jugo', false)}
              />
              <span>No</span>
            </label>
          </div>
        </div>
        
        {formData.se_jugo && (
          <>
            {/* ¿Fue un partido limpio? */}
            <div className="encuesta-section">
              <h3>¿Fue un partido limpio?</h3>
              <div className="encuesta-options">
                <label className={`encuesta-option ${formData.partido_limpio ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="partido_limpio"
                    checked={formData.partido_limpio}
                    onChange={() => handleInputChange('partido_limpio', true)}
                  />
                  <span>Sí</span>
                </label>
                <label className={`encuesta-option ${!formData.partido_limpio ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="partido_limpio"
                    checked={!formData.partido_limpio}
                    onChange={() => handleInputChange('partido_limpio', false)}
                  />
                  <span>No</span>
                </label>
              </div>
            </div>
            
            {/* Jugadores ausentes */}
            <div className="encuesta-section">
              <h3>¿Faltó algún jugador?</h3>
              <div className="encuesta-jugadores-grid">
                {jugadores.map((jugador) => (
                  <label 
                    key={jugador.uuid} 
                    className={`encuesta-jugador-item ${formData.jugadores_ausentes.includes(jugador.uuid) ? 'selected' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={formData.jugadores_ausentes.includes(jugador.uuid)}
                      onChange={() => toggleJugadorAusente(jugador.uuid)}
                    />
                    <div className="encuesta-jugador-avatar">
                      {jugador.foto_url || jugador.avatar_url ? (
                        <img 
                          src={jugador.foto_url || jugador.avatar_url} 
                          alt={jugador.nombre} 
                        />
                      ) : (
                        <div className="encuesta-avatar-placeholder">
                          {jugador.nombre.charAt(0)}
                        </div>
                      )}
                    </div>
                    <span className="encuesta-jugador-nombre">{jugador.nombre}</span>
                  </label>
                ))}
              </div>
            </div>
            
            {/* Jugadores violentos (solo si no fue limpio) */}
            {!formData.partido_limpio && (
              <div className="encuesta-section">
                <h3>¿Quién jugó sucio?</h3>
                <div className="encuesta-jugadores-grid">
                  {jugadores.map((jugador) => (
                    <label 
                      key={jugador.uuid} 
                      className={`encuesta-jugador-item ${formData.jugadores_violentos.includes(jugador.uuid) ? 'selected-negative' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={formData.jugadores_violentos.includes(jugador.uuid)}
                        onChange={() => toggleJugadorViolento(jugador.uuid)}
                      />
                      <div className="encuesta-jugador-avatar">
                        {jugador.foto_url || jugador.avatar_url ? (
                          <img 
                            src={jugador.foto_url || jugador.avatar_url} 
                            alt={jugador.nombre} 
                          />
                        ) : (
                          <div className="encuesta-avatar-placeholder">
                            {jugador.nombre.charAt(0)}
                          </div>
                        )}
                      </div>
                      <span className="encuesta-jugador-nombre">{jugador.nombre}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            
            {/* MVP del partido */}
            <div className="encuesta-section">
              <h3>MVP del partido</h3>
              <select
                className="encuesta-select"
                value={formData.mvp_id}
                onChange={(e) => handleInputChange('mvp_id', e.target.value)}
              >
                <option value="">Seleccionar jugador</option>
                {jugadores
                  .filter((j) => !formData.jugadores_ausentes.includes(j.uuid))
                  .map((jugador) => (
                    <option key={jugador.uuid} value={jugador.uuid}>
                      {jugador.nombre}
                    </option>
                  ))
                }
              </select>
            </div>
            
            {/* Mejor arquero */}
            <div className="encuesta-section">
              <h3>Mejor arquero</h3>
              <select
                className="encuesta-select"
                value={formData.arquero_id}
                onChange={(e) => handleInputChange('arquero_id', e.target.value)}
              >
                <option value="">Seleccionar jugador</option>
                {jugadores
                  .filter((j) => !formData.jugadores_ausentes.includes(j.uuid))
                  .map((jugador) => (
                    <option key={jugador.uuid} value={jugador.uuid}>
                      {jugador.nombre}
                    </option>
                  ))
                }
              </select>
            </div>
            
            {/* Jugador más sucio */}
            {!formData.partido_limpio && (
              <div className="encuesta-section">
                <h3>Tarjeta negra</h3>
                <select
                  className="encuesta-select"
                  value={formData.jugador_sucio_id}
                  onChange={(e) => handleInputChange('jugador_sucio_id', e.target.value)}
                >
                  <option value="">Seleccionar jugador</option>
                  {jugadores
                    .filter((j) => !formData.jugadores_ausentes.includes(j.uuid))
                    .map((jugador) => (
                      <option key={jugador.uuid} value={jugador.uuid}>
                        {jugador.nombre}
                      </option>
                    ))
                  }
                </select>
              </div>
            )}
            
            {/* Comentarios */}
            <div className="encuesta-section">
              <h3>Comentarios adicionales</h3>
              <textarea
                className="encuesta-textarea"
                value={formData.comentarios}
                onChange={(e) => handleInputChange('comentarios', e.target.value)}
                placeholder="Comentarios sobre el partido..."
                rows={4}
              />
            </div>
          </>
        )}
        
        {/* Botón de envío */}
        <button 
          type="submit" 
          className="encuesta-submit-btn"
          disabled={submitting}
        >
          {submitting ? 'Enviando...' : 'Enviar Encuesta'}
        </button>
      </form>
    </div>
  );
};

export default EncuestaPartido;