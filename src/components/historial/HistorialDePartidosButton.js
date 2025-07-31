import React, { useState } from 'react';
import { supabase } from '../../supabase';
import ListaDeFechasModal from './ListaDeFechasModal';
import './HistorialDePartidosButton.css';

const HistorialDePartidosButton = ({ partidoFrecuente }) => {
  const [showModal, setShowModal] = useState(false);
  const [historialPartidos, setHistorialPartidos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Obtener historial de partidos desde Supabase
  const fetchHistorialPartidos = async () => {
    if (!partidoFrecuente || !partidoFrecuente.id) {
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      // Usar partido_frecuente_id si existe, sino usar el id del partido actual
      const idBusqueda = partidoFrecuente.partido_frecuente_id || partidoFrecuente.id;
      
      const { data, error } = await supabase
        .from('partidos')
        .select('*')
        .eq('partido_frecuente_id', idBusqueda)
        .eq('estado', 'equipos_formados')
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

  return (
    <>
      <button 
        className="historial-button" 
        onClick={handleClick}
        disabled={loading}
      >
        {loading ? 'Cargando...' : 'Historial'}
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