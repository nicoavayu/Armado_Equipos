import React, { useState } from 'react';
import { supabase } from '../../supabase';
import ListaDeFechasModal from './ListaDeFechasModal';
import './HistorialDePartidosButton.css';

/**
 * Botón que muestra el historial de partidos para un partido frecuente
 * Solo se muestra si el partido es frecuente
 * @param {Object} partidoFrecuente - Datos del partido frecuente
 */
const HistorialDePartidosButton = ({ partidoFrecuente }) => {
  const [showModal, setShowModal] = useState(false);
  const [historialPartidos, setHistorialPartidos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Obtener historial de partidos desde Supabase
  const fetchHistorialPartidos = async () => {
    if (!partidoFrecuente || !partidoFrecuente.id) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const { data, error } = await supabase
        .from('partidos')
        .select(`
          *,
          equipos:equipos_partidos(*)
        `)
        .eq('partido_frecuente_id', partidoFrecuente.id)
        .order('fecha', { ascending: false });
      
      if (error) throw error;
      setHistorialPartidos(data || []);
    } catch (err) {
      console.error('Error al cargar historial:', err);
      setError('No se pudo cargar el historial de partidos');
    } finally {
      setLoading(false);
    }
  };

  // Abrir modal y cargar datos
  const handleClick = () => {
    setShowModal(true);
    fetchHistorialPartidos();
  };

  // Cerrar modal
  const handleClose = () => {
    setShowModal(false);
  };

  // Solo mostrar el botón si es un partido frecuente
  if (!partidoFrecuente || !partidoFrecuente.es_frecuente) {
    return null;
  }

  return (
    <>
      <button 
        className="historial-button" 
        onClick={handleClick}
        disabled={loading}
      >
        {loading ? 'Cargando...' : 'Historial de partidos'}
      </button>
      
      {showModal && (
        <ListaDeFechasModal 
          partidos={historialPartidos} 
          onClose={handleClose}
          nombrePartido={partidoFrecuente.nombre || 'Partido'}
          error={error}
          loading={loading}
        />
      )}
    </>
  );
};

export default HistorialDePartidosButton;