import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from './supabase';
// PostMatchSurvey removed - using EncuestaPartido page instead
import { useAuth } from './components/AuthProvider';
import './TestSurvey.css';

/**
 * Test component for manually opening and testing the post-match survey
 * 
 * Usage:
 * - Access via /test-survey
 * - Optionally provide partido_id and user_id in URL: /test-survey/:partidoId/:userId
 * - Or enter them manually in the form
 * 
 * This component is for development/testing only and should not be linked in production navigation
 */
const TestSurvey = () => {
  const { partidoId: urlPartidoId, userId: urlUserId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [partidoId, setPartidoId] = useState(urlPartidoId || '');
  const [userId, setUserId] = useState(urlUserId || (user ? user.id : ''));
  const [partido, setPartido] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [existingSurvey, setExistingSurvey] = useState(null);

  // Load match data if IDs are provided in URL
  useEffect(() => {
    if (urlPartidoId) {
      fetchPartido(urlPartidoId);
    }
    if (urlPartidoId && (urlUserId || user?.id)) {
      checkExistingSurvey(urlPartidoId, urlUserId || user?.id);
    }
  }, [urlPartidoId, urlUserId, user]);

  // Fetch match data
  const fetchPartido = async (id) => {
    if (!id) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const { data, error } = await supabase
        .from('partidos')
        .select('*')
        .eq('id', id)
        .single();
        
      if (error) throw error;
      
      if (data) {
        // The jugadores field is already included in the partido data as an array/JSON
        setPartido(data);
      } else {
        setError('Partido no encontrado');
      }
    } catch (err) {
      setError(`Error al cargar el partido: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Check if survey already exists
  const checkExistingSurvey = async (matchId, playerId) => {
    if (!matchId || !playerId) return;
    
    try {
      const { data, error } = await supabase
        .from('post_match_surveys')
        .select('*')
        .eq('partido_id', matchId)
        .eq('votante_id', playerId)
        .single();
        
      if (error && error.code !== 'PGRST116') {
        console.error('Error checking existing survey:', error);
      }
      
      setExistingSurvey(data || null);
    } catch (err) {
      console.error('Error checking existing survey:', err);
    }
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!partidoId) {
      setError('Por favor ingresa un ID de partido');
      return;
    }
    
    if (!userId) {
      setError('Por favor ingresa un ID de usuario');
      return;
    }
    
    // Update URL with IDs for easy sharing/bookmarking
    navigate(`/test-survey/${partidoId}/${userId}`);
    
    // Fetch match data and check for existing survey
    await fetchPartido(partidoId);
    await checkExistingSurvey(partidoId, userId);
  };



  return (
    <div className="test-survey-container">
      <div className="test-survey-card">
        <h1>Test de Encuesta Post-Partido</h1>
        <p className="test-survey-description">
          Esta página es solo para pruebas. Permite abrir manualmente la encuesta 
          post-partido
          para cualquier partido y usuario.
        </p>
        
        <form onSubmit={handleSubmit} className="test-survey-form">
          <div className="form-group">
            <label htmlFor="partidoId">ID del Partido:</label>
            <input
              type="text"
              id="partidoId"
              value={partidoId}
              onChange={(e) => setPartidoId(e.target.value)}
              placeholder="Ej: 123"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="userId">ID del Usuario:</label>
            <input
              type="text"
              id="userId"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="Ej: abc-123-def"
            />
          </div>
          
          <button type="submit" className="test-survey-button" disabled={loading}>
            {loading ? 'Cargando...' : 'Cargar Datos'}
          </button>
        </form>
        
        {error && <div className="test-survey-error">{error}</div>}
        
        {partido && (
          <div className="test-survey-match-info">
            <h2>Información del Partido</h2>
            <p><strong>Nombre:</strong> {partido.nombre || 'Sin nombre'}</p>
            <p><strong>Fecha:</strong> {new Date(partido.fecha || partido.created_at).toLocaleDateString()}</p>
            <p><strong>Jugadores:</strong> {partido.jugadores?.length || 0}</p>
            
            {existingSurvey ? (
              <div className="test-survey-warning">
                <p>⚠️ Este usuario ya completó la encuesta para este partido.</p>
                <p>ID de la encuesta: {existingSurvey.id}</p>
                <p>Fecha de envío: {new Date(existingSurvey.created_at).toLocaleString()}</p>
              </div>
            ) : (
              <button 
                className="test-survey-button open-survey" 
                onClick={() => window.location.href = `/encuesta/${partidoId}`}
              >
                Abrir Encuesta
              </button>
            )}
          </div>
        )}
      </div>
      

    </div>
  );
};

export default TestSurvey;