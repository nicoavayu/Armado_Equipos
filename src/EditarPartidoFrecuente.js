import React, { useState } from 'react';
import { updatePartidoFrecuente, crearPartidoDesdeFrec, supabase } from './supabase';
import { toast } from 'react-toastify';
import AutocompleteSede from './AutocompleteSede';
import PageTitle from './components/PageTitle';
import './EditarPartidoFrecuente.css';

export default function EditarPartidoFrecuente({ partido, onGuardado, onVolver }) {
  const [nombre, setNombre] = useState(partido.nombre);
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [hora, setHora] = useState(partido.hora);
  const [sede, setSede] = useState(partido.sede);
  const [sedeInfo, setSedeInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState(null);
  const [fotoPreview, setFotoPreview] = useState(partido.imagen_url);
  const [tipoPartido, setTipoPartido] = useState(partido.tipo_partido || 'Masculino');



  const handleFile = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setFotoPreview(URL.createObjectURL(e.target.files[0]));
    }
  };

  const guardarCambios = async () => {
    try {
      setLoading(true);
      
      let imagenUrl = partido.imagen_url;
      
      // Upload new image if provided
      if (file) {
        const fileExt = file.name.split('.').pop();
        const fileName = `partido_${Date.now()}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from('jugadores-fotos')
          .upload(fileName, file, { upsert: true });
          
        if (uploadError) throw uploadError;
        
        const { data } = supabase.storage
          .from('jugadores-fotos')
          .getPublicUrl(fileName);
          
        imagenUrl = data?.publicUrl;
      }
      
      await updatePartidoFrecuente(partido.id, {
        nombre,
        hora,
        sede,
        dia_semana: new Date(fecha).getDay(),
        imagen_url: imagenUrl,
        tipo_partido: tipoPartido,
      });
      toast.success('Cambios guardados');
      onGuardado && onGuardado();
    } catch (error) {
      toast.error('Error al guardar cambios');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="voting-bg content-with-tabbar">
      <div className="voting-modern-card" style={{ 
        padding: '100px 0 42px 0', 
        maxWidth: '100vw',
        minHeight: 'calc(100vh - 60px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}>
        <PageTitle onBack={onVolver}>EDITAR</PageTitle>
        
        <div className="edit-form-container" style={{ width: '90vw', maxWidth: '400px' }}>
          <div className="photo-section">
            <div
              className="photo-upload"
              onClick={() => document.getElementById('edit-partido-foto-input').click()}
              title={fotoPreview ? 'Cambiar foto' : 'Agregar foto'}
            >
              {fotoPreview ? (
                <img src={fotoPreview} alt="foto partido" />
              ) : (
                <span className="photo-placeholder">+</span>
              )}
              <input
                id="edit-partido-foto-input"
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleFile}
              />
            </div>
            <div className="photo-label">
              Foto del partido (opcional)
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">
              Nombre del partido
            </label>
            <input
              className="input-modern"
              type="text"
              placeholder="Nombre del partido"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          <div className="form-field">
            <label className="form-label">
              Fecha
            </label>
            <input
              className="input-modern"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              title="Seleccionar fecha"
              style={{ width: '100%' }}
            />
          </div>

          <div className="form-field">
            <label className="form-label">
              Hora
            </label>
            <input
              className="input-modern"
              type="time"
              value={hora}
              onChange={(e) => setHora(e.target.value)}
              title="Seleccionar hora"
              style={{ width: '100%' }}
            />
          </div>

          <div className="form-field">
            <label className="form-label">
              Sede
            </label>
            <div style={{ width: '100%' }}>
              <AutocompleteSede
                value={sede}
                onSelect={(info) => {
                  setSede(info.description);
                  setSedeInfo(info);
                }}
              />
            </div>
          </div>
          
          {/* Selector de tipo de partido */}
          <div className="form-field">
            <label className="form-label">
              Tipo de partido
            </label>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '8px',
              width: '100%',
            }}>
              {['Masculino', 'Femenino', 'Mixto'].map((tipo) => (
                <button
                  key={tipo}
                  type="button"
                  onClick={() => setTipoPartido(tipo)}
                  style={{
                    padding: '10px 8px',
                    fontSize: '14px',
                    fontWeight: tipoPartido === tipo ? '700' : '500',
                    fontFamily: "'Oswald', Arial, sans-serif",
                    border: tipoPartido === tipo ? '2px solid #0865b2' : '1.5px solid #0865b2',
                    borderRadius: '6px',
                    background: tipoPartido === tipo ? '#0865b2' : 'rgba(255,255,255,0.9)',
                    color: tipoPartido === tipo ? '#fff' : '#333',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    minHeight: '40px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {tipo}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button 
          className="voting-confirm-btn save-button"
          onClick={guardarCambios}
          disabled={loading}
        >
          {loading ? 'GUARDANDO...' : 'GUARDAR CAMBIOS'}
        </button>
        {/* Botón de volver eliminado ya que ahora tenemos el TabBar */}
      </div>
    </div>
  );
}