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
        tipo_partido: tipoPartido
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

          <AutocompleteSede
            value={sede}
            onSelect={(info) => {
              setSede(info.description);
              setSedeInfo(info);
            }}
          />
          
          {/* Selector de tipo de partido */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ 
              fontWeight: 500, 
              color: "#fff", 
              marginBottom: 8, 
              display: "block", 
              fontFamily: "'Oswald', Arial, sans-serif",
              fontSize: "14px" 
            }}>
              Tipo de partido
            </label>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "8px",
              width: "100%"
            }}>
              {['Masculino', 'Femenino', 'Mixto'].map(tipo => (
                <button
                  key={tipo}
                  type="button"
                  onClick={() => setTipoPartido(tipo)}
                  style={{
                    padding: "10px 8px",
                    fontSize: "14px",
                    fontWeight: tipoPartido === tipo ? "700" : "500",
                    fontFamily: "'Oswald', Arial, sans-serif",
                    border: tipoPartido === tipo ? "2px solid #8178e5" : "1.5px solid #8178e5",
                    borderRadius: "6px",
                    background: tipoPartido === tipo ? "#8178e5" : "rgba(255,255,255,0.9)",
                    color: tipoPartido === tipo ? "#fff" : "#333",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    minHeight: "40px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                >
                  {tipo}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button 
          className="voting-confirm-btn"
          onClick={guardarCambios}
          disabled={loading}
          style={{ width: "100%", marginBottom: 12, fontSize: '1.5rem', height: '64px', borderRadius: '9px' }}
        >
          {loading ? 'GUARDANDO...' : 'GUARDAR CAMBIOS'}
        </button>
        {/* Botón de volver eliminado ya que ahora tenemos el TabBar */}
      </div>
    </div>
  );
}