import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPartidosPendientesCalificacion, supabase } from '../supabase';

/**
 * Componente que muestra una notificación de partidos pendientes de calificación
 * y permite al usuario acceder a las encuestas correspondientes
 * @param {Object} props
 * @param {string} [props.userId] - ID del usuario actual (opcional). Si no se provee, el componente
 * intentará obtener el usuario autenticado vía Supabase.
 */
const PartidosPendientesNotification = ({ userId }) => {
  const [partidosPendientes, setPartidosPendientes] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Cargar partidos pendientes al montar el componente
  useEffect(() => {
    const fetchPartidosPendientes = async () => {
      try {
        setLoading(true);
        let uid = userId;
        if (!uid) {
          const { data: { user }, error: authError } = await supabase.auth.getUser();
          if (authError || !user) {
            setPartidosPendientes([]);
            setLoading(false);
            return;
          }
          uid = user.id;
        }

        const partidos = await getPartidosPendientesCalificacion(uid);
        setPartidosPendientes(partidos || []);

        // Mostrar en consola para testing
        console.log('IDs de partidos para testing:', (partidos || []).map((p) => p.id));
      } catch (error) {
        console.error('Error cargando partidos pendientes:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPartidosPendientes();
  }, [userId]);

  // Si no hay partidos pendientes, no mostrar nada
  if (loading || partidosPendientes.length === 0) {
    return null;
  }

  // Formatear fecha para mostrar
  const formatFecha = (fechaStr) => {
    try {
      const fecha = new Date(fechaStr);
      return fecha.toLocaleDateString('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'numeric',
      });
    } catch (e) {
      return fechaStr || 'Fecha no disponible';
    }
  };

  // Ir a la encuesta del partido seleccionado
  const handleCalificar = (partidoId) => {
    setShowModal(false);
    navigate(`/encuesta/${partidoId}`);
  };

  return (
    <>
      <style>
        {`
          @keyframes pulse-shadow {
            0% { box-shadow: 0 0 0 0 rgba(255, 107, 53, 0.7); }
            70% { box-shadow: 0 0 0 10px rgba(255, 107, 53, 0); }
            100% { box-shadow: 0 0 0 0 rgba(255, 107, 53, 0); }
          }
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes slideUp {
            from { transform: translateY(50px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
        `}
      </style>
      {/* Botón de notificación */}
      <div
        className="bg-[#ff6b35] text-white py-[10px] px-[15px] rounded-[50px] flex items-center gap-[10px] cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.2)] my-[10px] mx-0 transition-all duration-200 font-medium max-w-full animate-[pulse-shadow_2s_infinite] hover:bg-[#e85a2a] hover:-translate-y-[2px] hover:shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
        onClick={() => setShowModal(true)}
      >
        <span className="text-[1.2rem]">🔔</span>
        <span className="text-[0.9rem] whitespace-nowrap overflow-hidden text-ellipsis">
          Tienes {partidosPendientes.length} partido{partidosPendientes.length !== 1 ? 's' : ''} sin calificar
        </span>
      </div>

      {/* Modal con lista de partidos pendientes */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex justify-center items-center z-[1000] animate-[fadeIn_0.3s_ease]" onClick={() => setShowModal(false)}>
          <div className="bg-[#1a1a2e] w-[90%] max-w-[500px] max-h-[90vh] rounded-xl overflow-hidden flex flex-col shadow-[0_5px_20px_rgba(0,0,0,0.5)] animate-[slideUp_0.3s_ease] md:w-[95%] md:max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center px-5 py-[15px] bg-[#16162e] border-b border-[#2a2a40]">
              <h3 className="m-0 text-white text-[1.2rem]">Partidos pendientes de calificación</h3>
              <button className="bg-none border-none text-white text-2xl cursor-pointer" onClick={() => setShowModal(false)}>×</button>
            </div>

            <div className="p-[15px] overflow-y-auto max-h-[60vh]">
              {partidosPendientes.map((partido) => (
                <div key={partido.id} className="flex justify-between items-center p-[15px] border-b border-[#2a2a40] mb-[10px] bg-[#242440] rounded-lg max-[768px]:flex-col max-[768px]:items-start">
                  <div className="flex-1">
                    <div className="font-semibold text-white mb-[5px] capitalize">
                      {formatFecha(partido.fecha)}
                    </div>
                    <div className="text-[#aaa] text-[0.9rem]">
                      {partido.sede || 'Sin ubicación'} - {partido.hora || 'Sin hora'}
                    </div>
                  </div>
                  <button
                    className="bg-[#8178e5] text-white border-none rounded-[50px] py-2 px-[15px] font-semibold cursor-pointer transition-all duration-200 hover:bg-[#6a63c7] hover:-translate-y-[2px] max-[768px]:mt-[10px] max-[768px]:self-end"
                    onClick={() => handleCalificar(partido.id)}
                  >
                    Calificar
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PartidosPendientesNotification;