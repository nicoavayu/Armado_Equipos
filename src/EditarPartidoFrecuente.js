import React, { useState } from 'react';
import { updatePartidoFrecuente, crearPartidoDesdeFrec, supabase } from './supabase';
import { toast } from 'react-toastify';
import AutocompleteSede from './AutocompleteSede';
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
        imagen_url: imagenUrl
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
    <div className="voting-bg">
      <div className="voting-modern-card" style={{ padding: 42, maxWidth: 420 }}>
        <div className="match-name" style={{ marginBottom: 24 }}>EDITAR PARTIDO FRECUENTE</div>
        
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: 18 }}>
          <div
            onClick={() => document.getElementById("edit-partido-foto-input").click()}
            style={{ 
              cursor: "pointer", 
              width: 60, 
              height: 60,
              borderRadius: "8px",
              background: "rgba(255,255,255,0.12)",
              border: "2px solid rgba(255,255,255,0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              flexShrink: 0
            }}
            title={fotoPreview ? "Cambiar foto" : "Agregar foto"}
          >
            {fotoPreview ? (
              <img
                src={fotoPreview}
                alt="foto partido"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <span style={{ color: "#fff", fontSize: "24px", opacity: 0.5 }}>+</span>
            )}
            <input
              id="edit-partido-foto-input"
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFile}
            />
          </div>
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "14px", fontFamily: "'Oswald', Arial, sans-serif" }}>
            Foto del partido (opcional)
          </div>
        </div>
        
        <div className="edit-form-container">
          <input
            className="input-modern"
            type="text"
            placeholder="Nombre del partido"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />

          <input
            className="input-modern"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            title="Seleccionar fecha"
          />

          <input
            className="input-modern"
            type="time"
            value={hora}
            onChange={(e) => setHora(e.target.value)}
            title="Seleccionar hora"
          />
        </div>

        <AutocompleteSede
          value={sede}
          onSelect={(info) => {
            setSede(info.description);
            setSedeInfo(info);
          }}
        />

        <button 
          className="voting-confirm-btn"
          onClick={guardarCambios}
          disabled={loading}
          style={{ width: "100%", marginBottom: 12, fontSize: '1.5rem', height: '64px', borderRadius: '9px' }}
        >
          {loading ? 'GUARDANDO...' : 'GUARDAR CAMBIOS'}
        </button>
        <button 
          className="voting-confirm-btn wipe-btn"
          onClick={onVolver}
          style={{ background: '#DE1C49', width: '100%', fontSize: '1.5rem', height: '64px', borderRadius: '9px', marginBottom: '0' }}
        >
          VOLVER AL INICIO
        </button>
      </div>
    </div>
  );
}