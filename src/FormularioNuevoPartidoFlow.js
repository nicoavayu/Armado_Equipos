import React, { useState } from "react";
import AutocompleteSede from "./AutocompleteSede";
import { crearPartidoFrecuente, crearPartidoDesdeFrec, crearPartido, supabase } from "./supabase";
import { handleError, handleSuccess, safeAsync } from "./utils/errorHandler";
import "./VotingView.css";
import "./FormularioNuevoPartidoFlow.css";

const STEPS = {
  NAME: 1,
  WHEN: 2,
  WHERE: 3,
  CONFIRM: 4
};

export default function FormularioNuevoPartidoFlow({ onConfirmar, onVolver }) {
  const [step, setStep] = useState(STEPS.NAME);
  const [nombrePartido, setNombrePartido] = useState("");
  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState("");
  const [sede, setSede] = useState("");
  const [sedeInfo, setSedeInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [animation, setAnimation] = useState('slide-in');
  const [editMode, setEditMode] = useState(false);

  // Foto opcional para el partido
  const [file, setFile] = useState(null);
  const [fotoPreview, setFotoPreview] = useState(null);

  const handleFile = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setFotoPreview(URL.createObjectURL(e.target.files[0]));
    }
  };

  const nextStep = () => {
    setAnimation('slide-out');
    setTimeout(() => {
      setStep(prev => prev + 1);
      setAnimation('slide-in');
    }, 300);
  };

  const prevStep = () => {
    setAnimation('slide-out');
    setTimeout(() => {
      setStep(prev => prev - 1);
      setAnimation('slide-in');
    }, 300);
  };

  const goToStep = (targetStep) => {
    setAnimation('slide-out');
    setTimeout(() => {
      setStep(targetStep);
      setAnimation('slide-in');
    }, 300);
  };

  const editField = (targetStep) => {
    setEditMode(true);
    setAnimation('slide-out');
    setTimeout(() => {
      setStep(targetStep);
      setAnimation('slide-in');
    }, 300);
  };

  const saveAndReturn = () => {
    setEditMode(false);
    setAnimation('slide-out');
    setTimeout(() => {
      setStep(STEPS.CONFIRM);
      setAnimation('slide-in');
    }, 300);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      let partido;
      
      if (user) {
        // Upload image if provided
        let imagenUrl = null;
        if (file) {
          try {
            // Create a unique filename for the match image
            const fileExt = file.name.split('.').pop();
            const fileName = `partido_${Date.now()}.${fileExt}`;
            
            // Upload to supabase storage
            const { error: uploadError } = await supabase.storage
              .from('jugadores-fotos')
              .upload(fileName, file, { upsert: true });
              
            if (uploadError) throw uploadError;
            
            // Get public URL
            const { data } = supabase.storage
              .from('jugadores-fotos')
              .getPublicUrl(fileName);
              
            imagenUrl = data?.publicUrl;
            console.log('Match image uploaded successfully:', imagenUrl);
          } catch (error) {
            console.error('Error uploading match image:', error);
          }
        }
        
        const partidoFrecuente = await safeAsync(
          () => crearPartidoFrecuente({
            nombre: nombrePartido.trim(),
            sede: sede.trim(),
            hora: hora.trim(),
            jugadores_frecuentes: [],
            dia_semana: new Date(fecha).getDay(),
            habilitado: true,
            imagen_url: imagenUrl
          }),
          'Error al crear el partido frecuente'
        );
        
        partido = await safeAsync(
          () => crearPartidoDesdeFrec(partidoFrecuente, fecha),
          'Error al crear el partido'
        );
        
        partido.from_frequent_match_id = partidoFrecuente.id;
      } else {
        partido = await safeAsync(
          () => crearPartido({
            fecha,
            hora: hora.trim(),
            sede: sede.trim(),
            sedeMaps: sedeInfo?.place_id || ""
          }),
          'Error al crear el partido'
        );
        
        partido.nombre = nombrePartido.trim();
      }
      
      if (!partido) {
        setError("No se pudo crear el partido");
        return;
      }
      
      await onConfirmar(partido);
      handleSuccess('Partido creado correctamente');
      
    } catch (err) {
      setError(err.message || "Error al procesar la solicitud");
    } finally {
      setLoading(false);
    }
  };

  // Paso 1: Nombre del partido
  if (step === STEPS.NAME) {
    return (
      <div className="voting-bg new-match-flow">
        <div className="player-vote-card">
          <div className="voting-modern-card" style={{ padding: '20px', maxWidth: 'none', width: '100vw', margin: '0', boxSizing: 'border-box' }}>
            <div className="match-name">INGRESÁ EL NOMBRE<br />DEL PARTIDO</div>
            
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 18 }}>
              <div
                className="voting-photo-box"
                onClick={() => document.getElementById("partido-foto-input").click()}
                style={{ cursor: "pointer", width: 280, height: 280 }}
                title={fotoPreview ? "Cambiar foto" : "Agregar foto opcional"}
              >
                {fotoPreview ? (
                  <img
                    src={fotoPreview}
                    alt="foto partido"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <span className="photo-plus">+</span>
                )}
                <input
                  id="partido-foto-input"
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handleFile}
                />
              </div>
              <div style={{
                fontSize: 16,
                color: "rgba(255,255,255,0.7)",
                textAlign: "center",
                marginTop: 12,
                fontFamily: "'Oswald', Arial, sans-serif"
              }}>
                Agregá una imagen para el partido (opcional)
              </div>
            </div>

            <input
              className="input-modern"
              type="text"
              placeholder="Ej: Partido del Viernes"
              value={nombrePartido}
              onChange={e => setNombrePartido(e.target.value)}
              style={{ marginBottom: 22, width: "100%", boxSizing: "border-box" }}
              autoFocus
            />

            <button
              className="voting-confirm-btn"
              disabled={!nombrePartido.trim()}
              style={{ opacity: nombrePartido.trim() ? 1 : 0.4, marginBottom: 12 }}
              onClick={editMode ? saveAndReturn : nextStep}
            >
              {editMode ? "GUARDAR" : "CONTINUAR"}
            </button>
            
            <button
              className="voting-confirm-btn"
              style={{ background: 'rgba(255,255,255,0.1)', borderColor: '#fff', color: '#fff' }}
              onClick={editMode ? saveAndReturn : onVolver}
            >
              {editMode ? "CANCELAR" : "VOLVER AL INICIO"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Paso 2: Fecha y hora
  if (step === STEPS.WHEN) {
    return (
      <div className="voting-bg new-match-flow">
        <div className={`player-vote-card ${animation}`}>
          <div className="voting-modern-card" style={{ padding: '20px', maxWidth: 'none', width: '100vw', margin: '0', boxSizing: 'border-box' }}>
            <div className="match-name">¿CUÁNDO SE JUEGA?</div>
            
            <div style={{ 
              fontSize: 18, 
              color: "rgba(255,255,255,0.8)",
              textAlign: "center", 
              marginBottom: 24, 
              fontFamily: "'Oswald', Arial, sans-serif" 
            }}>
              Seleccioná la fecha y hora del partido
            </div>

            <input
              className="input-modern"
              type="date"
              value={fecha}
              onChange={e => setFecha(e.target.value)}
              style={{ marginBottom: 22, width: "100%" }}
            />

            <input
              className="input-modern"
              type="time"
              value={hora}
              onChange={e => setHora(e.target.value)}
              style={{ marginBottom: 22, width: "100%", height: 55 }}
            />

            <button
              className="voting-confirm-btn"
              disabled={!fecha || !hora}
              style={{ opacity: (fecha && hora) ? 1 : 0.4, marginBottom: 12 }}
              onClick={editMode ? saveAndReturn : nextStep}
            >
              {editMode ? "GUARDAR" : "CONTINUAR"}
            </button>
            
            <button
              className="voting-confirm-btn"
              style={{ background: 'rgba(255,255,255,0.1)', borderColor: '#fff', color: '#fff' }}
              onClick={editMode ? saveAndReturn : prevStep}
            >
              {editMode ? "CANCELAR" : "VOLVER ATRÁS"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Paso 3: Sede
  if (step === STEPS.WHERE) {
    return (
      <div className="voting-bg new-match-flow">
        <div className={`player-vote-card ${animation}`}>
          <div className="voting-modern-card" style={{ padding: '20px', maxWidth: 'none', width: '100vw', margin: '0', boxSizing: 'border-box' }}>
            <div className="match-name">¿DÓNDE SE JUEGA?</div>
            
            <div style={{ 
              fontSize: 18, 
              color: "rgba(255,255,255,0.8)",
              textAlign: "center", 
              marginBottom: 24, 
              fontFamily: "'Oswald', Arial, sans-serif" 
            }}>
              Ingresá la dirección o nombre del lugar
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
              disabled={!sede}
              style={{ opacity: sede ? 1 : 0.4, marginBottom: 12 }}
              onClick={editMode ? saveAndReturn : nextStep}
            >
              {editMode ? "GUARDAR" : "CONTINUAR"}
            </button>
            
            <button
              className="voting-confirm-btn"
              style={{ background: 'rgba(255,255,255,0.1)', borderColor: '#fff', color: '#fff' }}
              onClick={editMode ? saveAndReturn : prevStep}
            >
              {editMode ? "CANCELAR" : "VOLVER ATRÁS"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Paso 4: Confirmación
  if (step === STEPS.CONFIRM) {
    return (
      <div className="voting-bg new-match-flow">
        <div className={`player-vote-card ${animation}`}>
          <div className="voting-modern-card" style={{ padding: '20px', maxWidth: 'none', width: '100vw', margin: '0', boxSizing: 'border-box' }}>
            <div className="match-name">CONFIRMÁ LOS DATOS</div>
            
            {fotoPreview && (
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
                <img
                  src={fotoPreview}
                  alt="foto partido"
                  style={{ 
                    width: 120, 
                    height: 120, 
                    objectFit: "cover", 
                    borderRadius: 12,
                    border: "2px solid rgba(255,255,255,0.3)"
                  }}
                />
              </div>
            )}

            <ul className="confirmation-list">
              <li className="confirmation-item">
                <span className="confirmation-item-name">Nombre:</span>
                <span className="confirmation-item-score">{nombrePartido}</span>
                <button
                  className="confirmation-item-edit-btn"
                  onClick={() => editField(STEPS.NAME)}
                >EDITAR</button>
              </li>
              <li className="confirmation-item">
                <span className="confirmation-item-name">Fecha:</span>
                <span className="confirmation-item-score">{new Date(fecha).toLocaleDateString()}</span>
                <button
                  className="confirmation-item-edit-btn"
                  onClick={() => editField(STEPS.WHEN)}
                >EDITAR</button>
              </li>
              <li className="confirmation-item">
                <span className="confirmation-item-name">Hora:</span>
                <span className="confirmation-item-score">{hora}</span>
                <button
                  className="confirmation-item-edit-btn"
                  onClick={() => editField(STEPS.WHEN)}
                >EDITAR</button>
              </li>
              <li className="confirmation-item">
                <span className="confirmation-item-name">Sede:</span>
                <span className="confirmation-item-score" style={{ fontSize: 16, textAlign: "right" }}>
                  {sede.length > 30 ? sede.substring(0, 30) + "..." : sede}
                </span>
                <button
                  className="confirmation-item-edit-btn"
                  onClick={() => editField(STEPS.WHERE)}
                >EDITAR</button>
              </li>
            </ul>

            {error && (
              <div style={{
                color: "#ff5555",
                padding: "10px",
                marginBottom: "15px",
                fontSize: "16px",
                textAlign: "center",
                background: "rgba(255,0,0,0.1)",
                borderRadius: "8px"
              }}>
                {error}
              </div>
            )}
            
            <button
              className="voting-confirm-btn"
              style={{ marginBottom: 12 }}
              disabled={loading}
              onClick={handleSubmit}
            >
              {loading ? "CREANDO..." : "CREAR PARTIDO"}
            </button>
            
            <button
              className="voting-confirm-btn"
              style={{ 
                background: 'rgba(255,255,255,0.1)', 
                borderColor: '#fff', 
                color: '#fff',
                fontSize: '1.2rem', 
                height: '54px'
              }}
              onClick={prevStep}
              disabled={loading}
            >
              VOLVER ATRÁS
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}