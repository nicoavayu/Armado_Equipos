// src/VotingView.js
import React, { useState, useEffect } from "react";
import { supabase } from "./supabase";
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

// Componente estrellas slider con puntaje central único
function StarRating({ value, onChange, max = 10, hovered, setHovered }) {
  // Tamaño adaptativo (más chico en mobile)
  const [starSize, setStarSize] = useState(48);

  useEffect(() => {
    const handleResize = () => {
      setStarSize(window.innerWidth < 600 ? 30 : 48);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Manejador para detección continua en todo el bloque (sin gaps)
  const handleMouseMove = (e) => {
    const { left, width } = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - left;
    const star = Math.ceil((x / width) * max);
    setHovered(star < 1 ? 1 : star > max ? max : star);
  };

  return (
    <div
      className="star-rating-mobile"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        marginTop: window.innerWidth < 600 ? 16 : 48,
        userSelect: "none"
      }}
      onMouseLeave={() => setHovered(null)}
    >
      <div
        style={{ display: "flex", gap: 9, marginBottom: 13, cursor: "pointer" }}
        onMouseMove={handleMouseMove}
      >
        {[...Array(max)].map((_, i) => (
          <svg
            key={i}
            width={starSize}
            height={starSize}
            viewBox="0 0 24 24"
            onClick={() => onChange(i + 1)}
            style={{
              transition: "filter .18s, transform .12s",
              filter: (hovered !== null && i < hovered) || (hovered === null && i < value)
                ? "drop-shadow(0 0 7px #ffd700b0)"
                : "none",
              transform: (hovered !== null
                ? (i < hovered ? "scale(1.15)" : "scale(1)")
                : (i < value ? "scale(1.09)" : "scale(1)")
              ),
            }}
          >
            <polygon
              points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"
              fill={
                hovered !== null
                  ? (i < hovered ? "#FFD700" : "rgba(255,255,255,0.38)")
                  : (i < value ? "#FFD700" : "rgba(255,255,255,0.38)")
              }
            />
          </svg>
        ))}
      </div>
      <span className="star-score" style={{
        fontFamily: "'Bebas Neue', 'Oswald', Arial, sans-serif",
        color: "#fff",
        fontSize: window.innerWidth < 600 ? 24 : 70,
        fontWeight: 700,
        marginTop: 10,
        marginBottom: 4,
        letterSpacing: 1.3
      }}>
        {hovered !== null ? hovered : (value || 0)}
      </span>
    </div>
  );
}

export default function VotingView({ onReset }) {
  // Estados principales
  const [step, setStep] = useState(0);
  const [jugadores, setJugadores] = useState([]);
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

  // Cargar jugadores de Supabase al montar (usando uuid)
  useEffect(() => {
    async function fetchJugadores() {
      let { data, error } = await supabase
        .from("jugadores")
        .select("id, uuid, nombre, foto_url")
        .order("nombre", { ascending: true });
      if (error) {
        alert("Error cargando jugadores: " + error.message);
        setJugadores([]);
        return;
      }
      setJugadores(data || []);
    }
    fetchJugadores();
  }, []);

  // Al seleccionar nombre, setea jugador y foto
  useEffect(() => {
    if (!nombre) return;
    const j = jugadores.find(j => j.nombre === nombre);
    setJugador(j || null);
    setFotoPreview(j?.foto_url || null);
  }, [nombre, jugadores]);

  // Chequear si ya votó este jugador (uuid) en votos
  useEffect(() => {
    async function checkIfAlreadyVoted() {
      if (!jugador || !jugador.uuid) return;
      const { data, error } = await supabase
        .from("votos")
        .select("id")
        .eq("votante_id", jugador.uuid)
        .limit(1);
      if (!error && data && data.length > 0) setYaVoto(true);
      else setYaVoto(false);
    }
    checkIfAlreadyVoted();
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

    const fileExt = file.name.split('.').pop();
    const fileName = `${jugador.uuid}_${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from("jugadores-fotos")
      .upload(fileName, file, { upsert: true });

    if (uploadError) {
      alert("Error subiendo foto: " + uploadError.message);
      setSubiendoFoto(false);
      return;
    }

    const { data } = supabase
      .storage
      .from("jugadores-fotos")
      .getPublicUrl(fileName);

    const fotoUrl = data?.publicUrl;
    if (!fotoUrl) {
      alert("No se pudo obtener la URL pública de la foto.");
      setSubiendoFoto(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("jugadores")
      .update({ foto_url: fotoUrl })
      .eq("uuid", jugador.uuid);

    if (updateError) {
      alert("Error guardando foto: " + updateError.message);
      setSubiendoFoto(false);
      return;
    }

    setFotoPreview(fotoUrl);
    setSubiendoFoto(false);
    setFile(null);
    alert("¡Foto cargada!");
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
            ¿Querés que tus amigos vean tu foto? Cargala ahora.<br />(Opcional)
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
          <ul style={{
            listStyle: "none", padding: 0, width: "100%",
            maxWidth: 520, margin: "0 auto 24px auto"
          }}>
            {jugadoresParaVotar.map((j, idx) => (
              <li key={j.uuid} style={{
                display: "flex", alignItems: "center", gap: 16, marginBottom: 10,
                background: "rgba(255,255,255,0.11)", borderRadius: 14, padding: "11px 13px"
              }}>
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
              const votanteUuid = jugador?.uuid;
              for (const j of jugadoresParaVotar) {
                if (votos[j.uuid]) {
                  await supabase.from("votos").insert({
                    votado_id: j.uuid,
                    votante_id: votanteUuid,
                    puntaje: votos[j.uuid]
                  });
                }
              }
              setConfirmando(false);
              setFinalizado(true);
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
