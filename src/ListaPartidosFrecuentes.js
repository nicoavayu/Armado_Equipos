import React, { useState, useEffect } from 'react';
import { getPartidosFrecuentes, deletePartidoFrecuente } from './supabase';
import { toast } from 'react-toastify';
import { DIAS_SEMANA_CORTO } from './constants';

export default function ListaPartidosFrecuentes({ onEditar, onEntrar, onVolver }) {
  const [partidosFrecuentes, setPartidosFrecuentes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cargarPartidos();
  }, []);

  const cargarPartidos = async () => {
    try {
      console.log('Loading frequent matches...');
      const partidos = await getPartidosFrecuentes();
      console.log('Frequent matches loaded:', partidos);
      console.log('Image URLs found:', partidos.map(p => ({ nombre: p.nombre, imagen_url: p.imagen_url })));
      setPartidosFrecuentes(partidos);
    } catch (error) {
      console.error('Error loading frequent matches:', error);
      toast.error('Error al cargar partidos: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const eliminarPartido = async (id, nombre) => {
    if (!window.confirm(`¿Eliminar "${nombre}"?`)) return;
    try {
      await deletePartidoFrecuente(id);
      setPartidosFrecuentes(prev => prev.filter(p => p.id !== id));
      toast.success('Partido eliminado correctamente');
    } catch (error) {
      console.error('Error deleting frequent match:', error);
      toast.error('Error al eliminar el partido: ' + error.message);
    }
  };



  if (loading) {
    return (
      <div className="voting-bg content-with-tabbar">
        <div className="voting-modern-card">
          <div className="match-name">CARGANDO...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="voting-bg content-with-tabbar">
      <div className="voting-modern-card" style={{ padding: 42, maxWidth: 420, marginTop: 40, marginBottom: 40 }}>
        <div className="match-name" style={{ marginBottom: 24, marginTop: 20 }}>PARTIDOS FRECUENTES</div>
        
        {partidosFrecuentes.length === 0 ? (
          <div style={{ color: '#fff', textAlign: 'center', padding: '20px 0', fontFamily: 'Oswald, Arial, sans-serif' }}>
            <p>No hay partidos frecuentes configurados</p>
          </div>
        ) : (
          <div style={{ width: '100%', marginBottom: 22 }}>
            {partidosFrecuentes.map(partido => (
              <div key={partido.id} style={{ background: 'rgba(255,255,255,0.1)', border: '2px solid rgba(255,255,255,0.2)', borderRadius: '8px', padding: '16px', marginBottom: '16px', width: '100%', boxSizing: 'border-box' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  {partido.imagen_url ? (
                    <img 
                      src={partido.imagen_url} 
                      alt={partido.nombre}
                      style={{ 
                        width: '48px', 
                        height: '48px', 
                        borderRadius: '8px', 
                        objectFit: 'cover',
                        border: '2px solid rgba(255,255,255,0.3)'
                      }}
                      onError={(e) => console.error('Image failed to load:', partido.imagen_url)}
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
                      fontSize: '20px'
                    }}>
                      ⚽
                    </div>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#fff', fontSize: '18px', fontWeight: 'bold', marginBottom: '4px', fontFamily: 'Bebas Neue, Arial, sans-serif' }}>{partido.nombre}</div>
                    <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px', marginBottom: '2px', fontFamily: 'Oswald, Arial, sans-serif' }}>
                      {DIAS_SEMANA_CORTO[partido.dia_semana] || `Día ${partido.dia_semana}`} • {partido.hora}
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px', fontFamily: 'Oswald, Arial, sans-serif' }}>
                      {partido.sede}
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
                  <button 
                    className="frequent-action-btn delete-btn"
                    onClick={() => eliminarPartido(partido.id, partido.nombre)}
                  >
                    ELIMINAR
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Botón de volver eliminado ya que ahora tenemos el TabBar */}
      </div>
    </div>
  );
}