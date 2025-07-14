import React, { useState, useEffect } from "react";
import { toast } from 'react-toastify';
import { STEPS } from "./constants";
import {
  checkIfAlreadyVoted,
  uploadFoto,
  submitVotos,
} from "./supabase";
import StarRating from "./StarRating";
import "./VotingView.css";
import { useNativeFeatures } from "./hooks/useNativeFeatures";
import CameraUpload from "./components/CameraUpload";

import { useGuestSession } from "./hooks/useGuestSession";

const DefaultAvatar = (
  <div className="voting-photo-placeholder">
    <svg width="80" height="80" viewBox="0 0 38 38" fill="none">
      <rect width="38" height="38" rx="6" fill="#eceaf1" />
      <circle cx="19" cy="14" r="7" fill="#bbb" />
      <ellipse cx="19" cy="29" rx="11" ry="7" fill="#bbb" />
    </svg>
  </div>
);

export default function VotingView({ onReset, jugadores, partidoActual }) {
  // Initialize guest session for this match
  useGuestSession(partidoActual?.id);
  const { vibrate, takePicture, saveData, getData } = useNativeFeatures();
  
  // All React hooks must be called at the top level
  const [step, setStep] = useState(STEPS.IDENTIFY);
  const [nombre, setNombre] = useState("");
  const [jugador, setJugador] = useState(null);

  // Foto
  const [file, setFile] = useState(null);
  const [fotoPreview, setFotoPreview] = useState(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);

  // Votación
  const [current, setCurrent] = useState(0);
  const [votos, setVotos] = useState({});
  const [hovered, setHovered] = useState(null);
  const [animation, setAnimation] = useState('slide-in');

  // Edición y confirmación
  const [editandoIdx, setEditandoIdx] = useState(null);
  const [confirmando, setConfirmando] = useState(false);
  const [finalizado, setFinalizado] = useState(false);
  const [yaVoto, setYaVoto] = useState(false);

  // Jugadores a votar: todos menos yo
  const jugadoresParaVotar = (jugadores || []).filter(j => j.nombre !== nombre);

  useEffect(() => {
    if (step === 2 && current > jugadoresParaVotar.length - 1) {
      setCurrent(jugadoresParaVotar.length - 1);
    }
  }, [jugadoresParaVotar.length, step, current]);

  useEffect(() => {
    if (step === 3 && Object.keys(votos).length < jugadoresParaVotar.length) {
      setCurrent(Object.keys(votos).length);
      setStep(2);
    }
  }, [jugadoresParaVotar.length, votos, step]);

  useEffect(() => {
    if (!nombre) return;
    const j = (jugadores || []).find(j => j.nombre === nombre);
    setJugador(j || null);
    setFotoPreview(j?.foto_url || null);
  }, [nombre, jugadores]);

  useEffect(() => {
    async function checkVoteStatus() {
      if (!partidoActual?.id) return;
      try {
        const hasVoted = await checkIfAlreadyVoted(null, partidoActual.id);
        console.log('Vote status check result:', { partidoId: partidoActual.id, hasVoted });
        setYaVoto(hasVoted);
      } catch (error) {
        console.error('Error checking vote status:', error);
        // Don't show error toast for vote status check failures
        setYaVoto(false); // Allow voting if check fails
      }
    }
    checkVoteStatus();
  }, [partidoActual, finalizado]); // Re-check when voting is completed

  // Show loading state while partido is being loaded
  if (partidoActual === undefined) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="match-name">CARGANDO...</div>
          <div style={{ color: "#fff", fontSize: 18, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30, textAlign: "center" }}>
            Cargando información del partido...
          </div>
        </div>
      </div>
    );
  }

  // Show error only if partido is explicitly null (failed to load)
  if (partidoActual === null) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="match-name">ERROR</div>
          <div style={{ color: "#fff", fontSize: 18, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30, textAlign: "center" }}>
            No se pudo cargar la información del partido.<br />
            Verificá el código e intentá de nuevo.
          </div>
          <button
            className="voting-confirm-btn"
            onClick={() => window.location.reload()}
            style={{ marginTop: 16, width: '100%', fontSize: '1.5rem' }}
          >REINTENTAR</button>
        </div>
      </div>
    );
  }

  // Validation for missing partido ID
  if (!partidoActual.id) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="match-name">ERROR</div>
          <div style={{ color: "#fff", fontSize: 18, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30, textAlign: "center" }}>
            El partido no tiene un ID válido.<br />
            Contactá al administrador.
          </div>
        </div>
      </div>
    );
  }

  if (yaVoto) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="match-name">
            ¡YA VOTASTE!
          </div>
          <div style={{ color: "#fff", fontSize: 26, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30 }}>
            Ya registraste tus votos. <br />No podés votar de nuevo.
          </div>
          <button
            className="voting-confirm-btn"
            onClick={onReset}
            style={{ marginTop: 16, width: '100%', fontSize: '1.5rem' }}
          >VOLVER AL INICIO</button>
        </div>
      </div>
    );
  }

  // Paso 0: Identificarse
  if (step === STEPS.IDENTIFY) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="match-name">¿QUIÉN SOS?</div>
          <div className="player-select-grid">
            {(jugadores || []).map(j => (
              <button
                key={j.uuid}
                className={`player-select-btn${nombre === j.nombre ? " selected" : ""}`}
                onClick={() => setNombre(j.nombre)}
                type="button"
              >
                <span className="player-select-txt">{j.nombre}</span>
              </button>
            ))}
          </div>
          {(!jugadores || jugadores.length === 0) && (
            <div style={{ color: "#fff", fontSize: 18, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30, textAlign: "center" }}>
              No hay jugadores disponibles para este partido.
            </div>
          )}
          <button
            className="voting-confirm-btn"
            disabled={!nombre}
            style={{ opacity: nombre ? 1 : 0.4, pointerEvents: nombre ? "auto" : "none" }}
            onClick={() => setStep(STEPS.PHOTO)}
          >
            CONFIRMAR
          </button>
        </div>
      </div>
    );
  }

  // Paso 1: Subir foto (opcional)
  if (step === STEPS.PHOTO) {
    const handleFile = async (e) => {
      if (e.target.files && e.target.files[0]) {
        const selectedFile = e.target.files[0];
        setFile(selectedFile);
        setFotoPreview(URL.createObjectURL(selectedFile));
        
        // Auto-upload the photo immediately
        if (jugador) {
          setSubiendoFoto(true);
          try {
            const fotoUrl = await uploadFoto(selectedFile, jugador);
            setFotoPreview(fotoUrl);
            setJugador(prev => ({ ...prev, foto_url: fotoUrl }));
            setFile(null);
            toast.success("¡Foto cargada!");
          } catch (error) {
            toast.error("Error al subir la foto: " + error.message);
          } finally {
            setSubiendoFoto(false);
          }
        }
      }
    };

    const handleFotoUpload = async () => {
      if (!file || !jugador) return;
      setSubiendoFoto(true);
      try {
        const fotoUrl = await uploadFoto(file, jugador);
        setFotoPreview(fotoUrl);
        // Update local jugador object with new photo
        setJugador(prev => ({ ...prev, foto_url: fotoUrl }));
        setFile(null);
        toast.success("¡Foto cargada!");
      } catch (error) {
        toast.error("Error al subir la foto: " + error.message);
      } finally {
        setSubiendoFoto(false);
      }
    };

    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="match-name">¡HOLA, {nombre}!</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 18 }}>
            <CameraUpload onPhotoTaken={async (photo) => {
              if (jugador) {
                setSubiendoFoto(true);
                try {
                  // Convert data URL to blob for upload
                  const response = await fetch(photo);
                  const blob = await response.blob();
                  const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
                  
                  const fotoUrl = await uploadFoto(file, jugador);
                  setFotoPreview(fotoUrl);
                  setJugador(prev => ({ ...prev, foto_url: fotoUrl }));
                  toast.success("¡Foto cargada!");
                } catch (error) {
                  toast.error("Error al subir la foto: " + error.message);
                } finally {
                  setSubiendoFoto(false);
                }
              }
            }}>
              <div
                className="voting-photo-box"
                style={{ cursor: "pointer" }}
                title={fotoPreview ? "Cambiar foto" : "Tomar foto o subir desde galería"}
              >
                {fotoPreview ? (
                  <img
                    src={fotoPreview}
                    alt="foto"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <span className="photo-plus">+</span>
                )}
              </div>
            </CameraUpload>
            <input
              id="foto-input"
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFile}
            />
          </div>

          {!fotoPreview && (
            <div style={{
              fontSize: 18, color: "rgba(255,255,255,0.7)",
              textAlign: "center", marginBottom: 18, fontFamily: "'Oswald', Arial, sans-serif"
            }}>
             Mandale Selfie, asi saben quien sos.<br />
            </div>
          )}
          {subiendoFoto && (
            <div style={{
              fontSize: 16,
              color: "rgba(255,255,255,0.8)",
              textAlign: "center",
              marginTop: 12,
              fontFamily: "'Oswald', Arial, sans-serif"
            }}>
              Subiendo foto...
            </div>
          )}
          <button
            className="voting-confirm-btn"
            style={{ marginTop: 8 }}
            onClick={() => setStep(STEPS.VOTE)}
          >
            {fotoPreview ? "CONTINUAR" : "CONTINUAR SIN FOTO"}
          </button>
        </div>
      </div>
    );
  }

  // Paso 2: Votar a los demás jugadores
if (step === STEPS.VOTE || editandoIdx !== null) {
  const jugadoresNoVotados = jugadoresParaVotar.filter(j => !(j.uuid in votos));
  let jugadorVotar;
  if (editandoIdx !== null) {
    jugadorVotar = jugadoresParaVotar[editandoIdx];
  } else {
    jugadorVotar = jugadoresNoVotados[0];
  }

  if (jugadorVotar) {
    const valor = votos[jugadorVotar.uuid];

    const handleVote = async (newValue) => {
      await vibrate('light');
      setVotos(prev => {
        const nuevosVotos = { ...prev, [jugadorVotar.uuid]: newValue };
        if (editandoIdx !== null) {
          setTimeout(() => {
            setEditandoIdx(null);
          }, 0);
        }
        setHovered(null);
        return nuevosVotos;
      });
      if (editandoIdx === null) {
        setAnimation('slide-out');
        setTimeout(() => {
          setAnimation('slide-in');
        }, 300);
      }
    };

    return (
      <div className="voting-bg">
        <div className={`player-vote-card ${animation}`}>
          <div className="voting-modern-card" style={{ background: "transparent", boxShadow: "none", padding: 0 }}>
            <div className="match-name">
              CALIFICÁ A TUS COMPAÑEROS
            </div>

            <div className="voting-player-name">{jugadorVotar.nombre}</div>

            <div className="voting-photo-box">
              {jugadorVotar.foto_url ? (
                <img src={jugadorVotar.foto_url} alt="foto" />
              ) : (
                DefaultAvatar
              )}
            </div>

            <StarRating
              value={valor}
              onRate={handleVote}
              hovered={hovered}
              setHovered={setHovered}
            />

            <button
              className="voting-confirm-btn"
              style={{ marginTop: 35, marginBottom: 0, fontWeight: 400 }}
              onClick={() => handleVote(-1)}
            >
              NO LO CONOZCO
            </button>
            
            <div style={{
              fontSize: 16,
              fontFamily: "'Oswald', Arial, sans-serif",
              color: "rgba(255,255,255,0.7)",
              marginTop: 20,
              textAlign: "center",
              fontStyle: "italic"
            }}>
              Los votos son secretos, nadie se entera lo que pones
            </div>
          </div>
        </div>
      </div>
    );
  } else {
    setTimeout(() => setStep(STEPS.CONFIRM), 200);
    return null;
  }
}


  // Paso 3: Resumen y edición antes de confirmar
  if (step === STEPS.CONFIRM && !finalizado) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="match-name">
            CONFIRMÁ TUS<br />CALIFICACIONES
          </div>
          <ul className="confirmation-list">
            {jugadoresParaVotar.map((j, idx) => (
              <li key={j.uuid} className="confirmation-item">
                {j.foto_url ?
                  <img src={j.foto_url} alt="foto" className="confirmation-item-photo" />
                  : <div className="confirmation-item-photo">{DefaultAvatar}</div>
                }
                <span className="confirmation-item-name">{j.nombre}</span>
                <span className="confirmation-item-score" style={{
                  fontSize: 22, fontWeight: 700, minWidth: 72, textAlign: 'center'
                }}>
                  {(votos[j.uuid] && votos[j.uuid] > 0)
                    ? `${votos[j.uuid]}/10`
                    : <span style={{ fontSize: 16, fontWeight: 500 }}>No calificado</span>
                  }
                </span>
                <button
                  className="confirmation-item-edit-btn"
                  onClick={() => setEditandoIdx(idx)}
                >EDITAR</button>
              </li>
            ))}
          </ul>
          <button
            className="voting-confirm-btn"
            style={{ marginTop: 8, fontWeight: 700, letterSpacing: 1.2 }}
            onClick={async () => {
  // Validate required data before submitting
  if (!jugador?.uuid) {
    toast.error('Error: No se pudo identificar al jugador');
    return;
  }
  if (!partidoActual?.id) {
    toast.error('Error: No se pudo identificar el partido');
    return;
  }
  if (Object.keys(votos).length === 0) {
    toast.error('Error: No hay votos para guardar');
    return;
  }
  
  setConfirmando(true);
  try {
    await submitVotos(votos, jugador.uuid, partidoActual.id, jugador.nombre, fotoPreview);
    // Save voting completion locally
    await saveData(`voted_${partidoActual.id}`, true);
    await vibrate('heavy');
    // Immediately update voting status
    setYaVoto(true);
    setFinalizado(true);
    toast.success('¡Votos guardados correctamente!');
  } catch (error) {
    console.error('Error submitting votes:', error);
    toast.error(error.message);
  } finally {
    setConfirmando(false);
  }
}}

            disabled={confirmando}
          >
            {confirmando ? "GUARDANDO..." : "CONFIRMAR MIS VOTOS"}
          </button>
        </div>
      </div>
    );
  }

  // Paso 4: Mensaje final
  if (finalizado) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="match-name">
            YA VOTASTE
          </div>
          <div
            style={{
              color: "#fff",
              fontFamily: "'Oswald', Arial, sans-serif",
              fontSize: 27,
              marginBottom: 27,
              letterSpacing: 1.1,
              textAlign: "center",
              width: "100%",
              display: "block"
            }}
          >
            tus votos quedaron registrados<br />
            podés cerrar esta ventana.
          </div>
          {/* El botón "VOLVER AL INICIO" ha sido removido para los jugadores */}
        </div>
      </div>
    );
  }

  return null;
}
