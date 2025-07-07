// src/VotingView.js
import React, { useState, useEffect } from "react";
import {
  checkIfAlreadyVoted,
  uploadFoto,
  submitVotos,
} from "./supabase";
import { toast } from 'react-toastify';
import StarRating from "./StarRating";
import "./VotingView.css";
import Logo from "./Logo.png";

// Avatar cuadrado por defecto (SVG simple)
const DefaultAvatar = (
  <div className="voting-photo-placeholder">
    <svg width="80" height="80" viewBox="0 0 38 38" fill="none">
      <rect width="38" height="38" rx="6" fill="#eceaf1" />
      <circle cx="19" cy="14" r="7" fill="#bbb" />
      <ellipse cx="19" cy="29" rx="11" ry="7" fill="#bbb" />
    </svg>
  </div>
);

export default function VotingView({ onReset, jugadores }) {
  // Estados principales
  const [step, setStep] = useState(0);
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
  const jugadoresParaVotar = jugadores.filter(j => j.nombre !== nombre);

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
    const j = jugadores.find(j => j.nombre === nombre);
    setJugador(j || null);
    setFotoPreview(j?.foto_url || null);
  }, [nombre, jugadores]);

  useEffect(() => {
    async function checkVoteStatus() {
      if (!jugador || !jugador.uuid) return;
      try {
        const hasVoted = await checkIfAlreadyVoted(jugador.uuid);
        setYaVoto(hasVoted);
      } catch (error) {
        toast.error("Error verificando el estado del voto: " + error.message);
      }
    }
    checkVoteStatus();
  }, [jugador]);

  if (yaVoto) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="voting-title-modern">
            ¡YA VOTASTE!
          </div>
          <div style={{ color: "#fff", fontSize: 26, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30 }}>
            Ya registraste tus votos. <br />No podés votar de nuevo.
          </div>
          <button
            className="voting-confirm-btn"
            onClick={onReset}
            style={{ marginTop: 16 }}
          >VOLVER AL INICIO</button>
        </div>
      </div>
    );
  }

  // Paso 0: Identificarse
  if (step === 0) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="voting-title-modern">¿QUIÉN SOS?</div>
          <div className="player-select-grid">
            {jugadores.map(j => (
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
          <button
            className="voting-confirm-btn"
            disabled={!nombre}
            style={{ opacity: nombre ? 1 : 0.4, pointerEvents: nombre ? "auto" : "none" }}
            onClick={() => setStep(1)}
          >
            CONFIRMAR
          </button>
        </div>
      </div>
    );
  }

  // Paso 1: Subir foto (opcional)
  if (step === 1) {
    const handleFile = (e) => {
      if (e.target.files && e.target.files[0]) {
        setFile(e.target.files[0]);
        setFotoPreview(URL.createObjectURL(e.target.files[0]));
      }
    };

    const handleFotoUpload = async () => {
      if (!file || !jugador) return;
      setSubiendoFoto(true);
      try {
        const fotoUrl = await uploadFoto(file, jugador);
        setFotoPreview(fotoUrl);
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
          <div className="voting-title-modern">¡HOLA, {nombre}!</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 18 }}>
            <div
              className="voting-photo-box"
              onClick={() => document.getElementById("foto-input").click()}
              style={{ cursor: "pointer" }}
              title={fotoPreview ? "Cambiar foto" : "Agregar foto"}
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
              <input
                id="foto-input"
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleFile}
              />
            </div>
          </div>

          {!fotoPreview && (
            <div style={{
              fontSize: 18, color: "rgba(255,255,255,0.7)",
              textAlign: "center", marginBottom: 18, fontFamily: "'Oswald', Arial, sans-serif"
            }}>
             Mandale Selfie, asi saben quien sos.<br />
            </div>
          )}
          {file && (
            <button
              className="voting-confirm-btn"
              style={{ background: "rgba(255,255,255,0.17)", borderColor: "#fff", color: "#fff" }}
              disabled={subiendoFoto}
              onClick={handleFotoUpload}
            >
              {subiendoFoto ? "SUBIENDO..." : "GUARDAR FOTO"}
            </button>
          )}
          <button
            className="voting-confirm-btn"
            style={{ marginTop: 8 }}
            onClick={() => setStep(2)}
          >
            {fotoPreview ? "CONTINUAR" : "CONTINUAR SIN FOTO"}
          </button>
        </div>
      </div>
    );
  }

  // Paso 2: Votar a los demás jugadores
if (step === 2 || editandoIdx !== null) {
  const jugadoresNoVotados = jugadoresParaVotar.filter(j => !(j.uuid in votos));
  let jugadorVotar;
  if (editandoIdx !== null) {
    jugadorVotar = jugadoresParaVotar[editandoIdx];
  } else {
    jugadorVotar = jugadoresNoVotados[0];
  }

  if (jugadorVotar) {
    const valor = votos[jugadorVotar.uuid];

    const handleVote = (newValue) => {
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
            
            {/* Mensaje agregado */}
            <div style={{
              fontSize: 20,
              fontFamily: "'Oswald', Arial, sans-serif",
              color: "#fff",
              marginBottom: 12,
              textAlign: "center"
            }}>
              Los votos son secretos, nadie se entera lo que pones
            </div>

            <div className="voting-title-modern">
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
          </div>
        </div>
      </div>
    );
  } else {
    setTimeout(() => setStep(3), 200);
    return null;
  }
}


  // Paso 3: Resumen y edición antes de confirmar
  if (step === 3 && !finalizado) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="voting-title-modern">
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
              setConfirmando(true);
              try {
                await submitVotos(votos, jugador?.uuid);
                setFinalizado(true);
              } catch (error) {
                toast.error("Error al guardar los votos: " + error.message);
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
          <div className="voting-title-modern">
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
