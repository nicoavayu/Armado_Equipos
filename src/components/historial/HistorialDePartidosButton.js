import React, { useState } from 'react';
import { supabase } from '../../supabase';
import LoadingSpinner from '../LoadingSpinner';
import ListaDeFechasModal from './ListaDeFechasModal';
import './HistorialDePartidosButton.css';

const HistorialDePartidosButton = ({ partidoFrecuente }) => {
  const [showModal, setShowModal] = useState(false);
  const [historialPartidos, setHistorialPartidos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Obtener historial de plantillas desde 'partidos_frecuentes'
  const fetchHistorialPartidos = async () => {
    setLoading(true);
    setError(null);

    try {
      // Intentamos ordenar por created_at si existe; si falla, reintentamos por id.
      let res = await supabase
        .from('partidos_frecuentes')
        .select('*')
        .order('created_at', { ascending: false });

      if (res.error) {
        // Si el error sugiere que no existe created_at, reintentar por id
        console.debug('created_at no existe o error al ordenar, reintentando por id', res.error.message || res.error);
        res = await supabase
          .from('partidos_frecuentes')
          .select('*')
          .order('id', { ascending: false });
      }

      if (res.error) throw res.error;

      // Normalizar salida para que el modal pueda mostrar campos esperados
      const data = (res.data || []).map((item) => ({
        id: item.id,
        nombre: item.nombre ?? item.lugar ?? 'Sin nombre',
        lugar: item.lugar ?? 'Sin lugar',
        fecha: item.fecha ?? null,
        hora: item.hora ?? null,
        tipo_partido: item.tipo_partido ?? item.tipo ?? 'Sin tipo',
        modalidad: item.modalidad ?? 'Sin modalidad',
        raw: item, // mantener original por si el modal necesita más campos
      }));

      setHistorialPartidos(data);
    } catch (err) {
      console.error('Error al cargar historial de plantillas:', err);
      setError('No se pudo cargar el historial de plantillas');
      setHistorialPartidos([]);
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
        {loading ? <LoadingSpinner size="small" /> : 'Historial'}
      </button>
      
      {showModal && (
        <ListaDeFechasModal 
          partidosFrecuentes={historialPartidos}
          onClose={handleClose}
          nombrePartido={partidoFrecuente?.nombre ?? 'Plantillas'}
          error={error}
          loading={loading}
        />
      )}
    </>
  );
};

export default HistorialDePartidosButton;