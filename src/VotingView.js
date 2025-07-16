// src/VotingView.js
import React, { useState, useEffect } from "react";
import {
  checkIfAlreadyVoted,
  uploadFoto,
  submitVotos,
} from "./supabase";
import { toast } from 'react-toastify';
import StarRating from "./StarRating";
import "./HomeStyleKit.css";

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

  // Edición y confirmación
  const [editandoIdx, setEditandoIdx] = useState(null);
  const [confirmando, setConfirmando] = useState(false);
  const [finalizado, setFinalizado] = useState(false);
  const [yaVoto, setYaVoto] = useState(false);

  // No es necesario cargar jugadores aquí, se reciben por props

  // Al seleccionar nombre, setea jugador y foto
  useEffect(() => {
    if (!nombre) return;
    const j = jugadores.find(j => j.nombre === nombre);
    setJugador(j || null);
    setFotoPreview(j?.foto_url || null);
  }, [nombre, jugadores]);

  // Chequear si ya votó este jugador (uuid) en votos
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

  // BLOQUEO: si ya votó, mostrá mensaje y bloqueá el resto del flujo
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
  // Manejador de archivo
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
        
        {/* FOTO GRANDE CON “+” PARA AGREGAR/CAMBIAR */}
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
            Mandale selfie <br />
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


  // Jugadores a votar: todos menos yo
  const jugadoresParaVotar = jugadores.filter(j => j.nombre !== nombre);

  // Paso 2: Votar a los demás jugadores
  if (step === 2 || editandoIdx !== null) {
    const index = editandoIdx !== null ? editandoIdx : current;
    if (index >= jugadoresParaVotar.length) {
      setTimeout(() => setStep(3), 300);
      return null;
    }
    const jugadorVotar = jugadoresParaVotar[index];
    const valor = votos[jugadorVotar.uuid] || 0;

    return (
      <div className="voting-bg">
        <div className="voting-modern-card" style={{ background: "transparent", boxShadow: "none", padding: 0 }}>
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
            onChange={valor => {
              setVotos(prev => ({ ...prev, [jugadorVotar.uuid]: valor }));
              if (editandoIdx !== null) {
                setEditandoIdx(null);
                setStep(3);
              } else {
                setCurrent(cur => cur + 1);
              }
              setHovered(null);
            }}
            hovered={hovered}
            setHovered={setHovered}
          />
          <button
            className="voting-confirm-btn"
            style={{ marginTop: 35, marginBottom: 0, fontWeight: 400 }}
            onClick={() => {
              setVotos(prev => ({ ...prev, [jugadorVotar.uuid]: undefined }));
              if (editandoIdx !== null) {
                setEditandoIdx(null);
                setStep(3);
              } else {
                setCurrent(cur => cur + 1);
              }
              setHovered(null);
            }}
          >
            NO LO CONOZCO
          </button>
        </div>
      </div>
    );
  }

  // Paso 3: Resumen y edición antes de confirmar
  if (step === 3 && !finalizado) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="voting-title-modern">
            CONFIRMÁ TUS<br />CALIFICACIONES
          </div>
          <ul className="voting-list-grid">
            {jugadoresParaVotar.map((j, idx) => (
              <li key={j.uuid}>
                {j.foto_url ?
                  <img src={j.foto_url} alt="foto" style={{ width: 46, height: 46, borderRadius: "50%", objectFit: "cover" }} />
                  : DefaultAvatar
                }
                <span style={{
                  flex: 1, fontWeight: 700, fontSize: 25, fontFamily: "'Oswald', Arial, sans-serif", color: "#fff", letterSpacing: 1
                }}>{j.nombre}</span>
                <span style={{ color: "#fff", fontSize: 22, fontWeight: 800, minWidth: 70, textAlign: "right", fontFamily: "'Oswald', Arial, sans-serif" }}>
                  {votos[j.uuid] ? votos[j.uuid] + "/10" : "No calificado"}
                </span>
                <button
                  className="voting-name-btn"
                  style={{ width: 70, height: 38, fontSize: 18, border: "2px solid #fff", margin: 0 }}
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
            ¡GRACIAS POR VOTAR!
          </div>
          <div style={{
            color: "#fff", fontFamily: "'Oswald', Arial, sans-serif",
            fontSize: 27, marginBottom: 27, letterSpacing: 1.1
          }}>
            Tus votos fueron registrados.<br />Podés cerrar esta ventana.
          </div>
          <button
            className="voting-confirm-btn"
            style={{ marginTop: 16 }}
            onClick={onReset}
          >VOLVER AL INICIO</button>
        </div>
      </div>
    );
  }

  return null;
}
