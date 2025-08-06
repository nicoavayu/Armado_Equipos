import React, { useState, useEffect } from 'react';
import { getPartidosFrecuentes, deletePartidoFrecuente } from './supabase';
import { toast } from 'react-toastify';
import { DIAS_SEMANA } from './constants';
import PageTitle from './components/PageTitle';
import LoadingSpinner from './components/LoadingSpinner';
import { HistorialDePartidosButton } from './components/historial';
import ConfirmModal from './components/ConfirmModal';

function formatearSede(sede) {
  if (sede === 'La Terraza Fútbol 5, 8') return 'La Terraza Fútbol 5 y 8';
  // Agregá más casos especiales si necesitás
  return sede;
}

export default function ListaPartidosFrecuentes({ onEditar, onEntrar, onVolver }) {
  const [partidosFrecuentes, setPartidosFrecuentes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [partidoToDelete, setPartidoToDelete] = useState(null);

  useEffect(() => {
    cargarPartidos();
  }, []);

  const cargarPartidos = async () => {
    try {
      const partidos = await getPartidosFrecuentes();
      setPartidosFrecuentes(partidos);
    } catch (error) {
      toast.error('Error al cargar partidos: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (partido) => {
    setPartidoToDelete(partido);
    setShowConfirmModal(true);
  };

  const confirmarEliminacion = async () => {
    if (!partidoToDelete) return;
    
    try {
      await deletePartidoFrecuente(partidoToDelete.id);
      setPartidosFrecuentes((prev) => prev.filter((p) => p.id !== partidoToDelete.id));
      toast.success('Partido eliminado correctamente');
    } catch (error) {
      toast.error('Error al eliminar el partido: ' + error.message);
    } finally {
      setShowConfirmModal(false);
      setPartidoToDelete(null);
    }
  };

  const cancelarEliminacion = () => {
    setShowConfirmModal(false);
    setPartidoToDelete(null);
  };

  if (loading) {
    return (
      <div
        className="voting-bg content-with-tabbar"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <LoadingSpinner size="large" />
      </div>
    );
  }

  return (
    <div className="voting-bg content-with-tabbar" style={{ paddingBottom: '100px' }}>
      <div
        className="voting-modern-card"
        style={{
          padding: '100px 0 0 0',
          maxWidth: '100vw',
          minHeight: 'calc(100vh - 60px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <PageTitle onBack={onVolver}>HISTORIAL</PageTitle>
        <div style={{
          width: '90vw',
          marginTop: '70px',
        }}>
          {partidosFrecuentes.length === 0 ? (
            <div style={{ color: '#fff', textAlign: 'center', padding: '20px 0', fontFamily: 'Oswald, Arial, sans-serif' }}>
              <p>No hay partidos frecuentes configurados</p>
            </div>
          ) : (
            <div style={{ width: '100%' }}>
              {partidosFrecuentes.map((partido, index) => (
                <div
                  key={partido.id}
                  style={{
                    background: 'rgb(4 48 106 / 22%)',
                    border: '2px solid rgba(255,255,255,0.2)',
                    borderRadius: '12px',
                    padding: '16px',
                    marginBottom: index === partidosFrecuentes.length - 1 ? '40px' : '10px',
                    boxSizing: 'border-box',
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                    {partido.imagen_url ? (
                      <img
                        src={partido.imagen_url}
                        alt={partido.nombre}
                        style={{
                          width: '48px',
                          height: '48px',
                          borderRadius: '8px',
                          objectFit: 'cover',
                          border: '2px solid rgba(255,255,255,0.3)',
                        }}
                        onError={(e) => e.target.style.display = 'none'}
                      />
                    ) : (
                      <div style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '8px',
                        background: 'rgba(255,255,255,0.1)',
                        border: '2px solid rgba(255,255,255,0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '20px',
                      }}>
                        ⚽
                      </div>
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#fff', fontSize: '18px', fontWeight: 'bold', marginBottom: '4px', fontFamily: 'Bebas Neue, Arial, sans-serif' }}>
                        {partido.nombre}
                      </div>
                      <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '15px', marginBottom: '2px', fontFamily: 'Oswald, Arial, sans-serif' }}>
                        {DIAS_SEMANA[partido.dia_semana]?.toUpperCase() || `Día ${partido.dia_semana}`} • {partido.hora}
                      </div>
                      <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '14px', fontFamily: 'Oswald, Arial, sans-serif', wordBreak: 'break-word' }}>
                        {formatearSede(partido.sede)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      className="frequent-action-btn edit-btn"
                      onClick={() => onEntrar(partido)}
                    >
                      ENTRAR
                    </button>
                    <button
                      className="frequent-action-btn edit-btn"
                      onClick={() => onEditar(partido)}
                    >
                      EDITAR
                    </button>
                    <HistorialDePartidosButton partidoFrecuente={partido} />
                    <button
                      className="frequent-action-btn delete-btn"
                      onClick={() => handleDeleteClick(partido)}
                    >
                      ELIMINAR
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
      <ConfirmModal
        isOpen={showConfirmModal}
        title="CONFIRMAR ACCIÓN"
        message={`¿Seguro que deseas eliminar este partido? Se notificará a todos los jugadores y la estructura se borrará.`}
        onConfirm={confirmarEliminacion}
        onCancel={cancelarEliminacion}
        confirmText="CONFIRMAR"
        cancelText="CANCELAR"
      />
    </div>
  );
}
