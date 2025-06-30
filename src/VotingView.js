import React, { useState } from "react";

// Componente de estrellas
function StarRating({ value, onChange, max = 10, hovered, setHovered }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 10 }}>
      {[...Array(max)].map((_, i) => (
        <svg
          key={i}
          width="34" height="34" viewBox="0 0 24 24"
          style={{
            cursor: "pointer",
            transform: hovered !== null ? (i < hovered ? "scale(1.22)" : "scale(1)") : (i < value ? "scale(1.15)" : "scale(1)"),
            transition: "transform .12s"
          }}
          onMouseEnter={() => setHovered(i + 1)}
          onMouseLeave={() => setHovered(null)}
          onClick={() => onChange(i + 1)}
        >
          <polygon
            points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"
            fill={
              hovered !== null
                ? (i < hovered ? "#DE1C49" : "#eceaf1")
                : (i < value ? "#DE1C49" : "#eceaf1")
            }
            stroke="#DE1C49"
            strokeWidth="1"
          />
        </svg>
      ))}
    </div>
  );
}

// Tus jugadores de ejemplo
const initialJugadores = [
  { nombre: "Nico" },
  { nombre: "Beto" },
  { nombre: "Fede" },
  { nombre: "Alex" }
];

export default function VotingView({ jugadorActual, onReset }) {
  const [yo, setYo] = useState(jugadorActual || null);
  const [jugadores, setJugadores] = useState(initialJugadores);
  const [step, setStep] = useState(jugadorActual ? 1 : 0);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [hovered, setHovered] = useState(null);

  // Autopuntaje
  const [miScore, setMiScore] = useState(5);

  // Votación
  const [current, setCurrent] = useState(0);
  const [votos, setVotos] = useState({});
  const [finalizado, setFinalizado] = useState(false);
  const [editingName, setEditingName] = useState(null);

  // REGISTRO + AUTOPUNTAJE
  function handleRegistro(e) {
    e.preventDefault();
    const nombre = e.target.nombre.value.trim();
    if (!nombre) return;
    setYo({ nombre, foto: photoUrl ? { url: photoUrl } : null, score: miScore });
    // Agrego a jugadores frecuentes con score >= 1
    const safeScore = Math.max(1, miScore);
    const jugador = { nombre, foto: photoUrl ? { url: photoUrl } : null, score: safeScore };
    // Guardar en jugadores frecuentes localStorage
    const prev = JSON.parse(localStorage.getItem("frequentPlayers")) || [];
    if (!prev.find(p => (p.nombre || p.name)?.toLowerCase() === nombre.toLowerCase())) {
      localStorage.setItem("frequentPlayers", JSON.stringify([...prev, jugador]));
    } else {
      // Si ya existe, lo actualiza
      const newList = prev.map(p =>
        (p.nombre || p.name)?.toLowerCase() === nombre.toLowerCase()
          ? { ...p, score: safeScore, foto: jugador.foto }
          : p
      );
      localStorage.setItem("frequentPlayers", JSON.stringify(newList));
    }
    if (!jugadores.find(j => j.nombre.toLowerCase() === nombre.toLowerCase())) {
      setJugadores(prev => [...prev, { nombre, foto: photoUrl ? { url: photoUrl } : null }]);
    }
    setStep(1);
  }

  // Mostrar solo jugadores a votar (sin mí mismo)
  const jugadoresParaVotar = jugadores.filter(j => j.nombre !== (yo && yo.nombre));

  function handleVote(valor) {
    const target = editingName 
      ? editingName 
      : jugadoresParaVotar[current].nombre;
    setVotos(prev => ({ ...prev, [target]: valor }));
    setHovered(null);
    setTimeout(() => {
      if (editingName) {
        setEditingName(null);
        setFinalizado(true);
      } else if (current < jugadoresParaVotar.length - 1) {
        setCurrent(c => c + 1);
      } else {
        setFinalizado(true);
      }
    }, 170);
  }

  // Edición puntual
  if (editingName) {
    const jugadorEditar = jugadoresParaVotar.find(j => j.nombre === editingName);
    return (
      <div style={{
        maxWidth: 390,
        margin: "44px auto 0 auto",
        padding: "26px 24px 36px 24px",
        background: "#fff",
        borderRadius: 32,
        boxShadow: "0 2px 18px 0 rgba(34, 40, 80, 0.10)",
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif"
      }}>
        <h2 style={{ color: "#DE1C49", textAlign: "center" }}>Editar puntaje</h2>
        <div style={{ textAlign: "center", fontWeight: 600, fontSize: 22, marginBottom: 12 }}>
          {jugadorEditar.nombre}
        </div>
        <div style={{
          width: 96, height: 96, borderRadius: "50%", border: "2px solid #eceaf1",
          background: jugadorEditar.foto ? `url(${jugadorEditar.foto.url}) center/cover` : "#f5f5f5",
          margin: "0 auto 16px auto", display: "flex", alignItems: "center", justifyContent: "center"
        }}>
          {!jugadorEditar.foto && (
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
              <circle cx="28" cy="28" r="28" fill="#eceaf1" />
              <circle cx="28" cy="23" r="11" fill="#bbb" />
              <ellipse cx="28" cy="42.5" rx="15" ry="9.5" fill="#bbb" />
            </svg>
          )}
        </div>
        <StarRating
          value={votos[jugadorEditar.nombre] || 0}
          onChange={handleVote}
          hovered={hovered}
          setHovered={setHovered}
        />
        <div style={{
          marginTop: 10,
          fontSize: 24,
          color: "#DE1C49",
          fontWeight: 700,
          letterSpacing: "-1px",
          textAlign: "center"
        }}>
          {hovered !== null ? hovered : (votos[jugadorEditar.nombre] || 0)}
        </div>
      </div>
    );
  }

  // RESUMEN - solo muestra a los demás jugadores, NO tu nombre
  if (finalizado) {
    return (
      <div style={{
        maxWidth: 470,
        margin: "44px auto 0 auto",
        padding: "26px 24px 36px 24px",
        background: "#fff",
        borderRadius: 32,
        boxShadow: "0 2px 18px 0 rgba(34, 40, 80, 0.10)",
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif"
      }}>
        <h2 style={{ color: "#DE1C49", textAlign: "center", fontSize: 38, fontWeight: 800, marginBottom: 30 }}>Tu votación</h2>
        <ul style={{ padding: 0, margin: "22px 0 0 0", listStyle: "none" }}>
          {jugadoresParaVotar.map(j => (
            <li key={j.nombre} style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontWeight: 700,
              color: "#232a32",
              marginBottom: 18,
              fontSize: 25
            }}>
              <span style={{ fontWeight: 800 }}>{j.nombre}:</span>
              <span style={{ color: "#DE1C49", minWidth: 36, textAlign: "center", fontWeight: 700 }}>
                {votos[j.nombre] || 0}
              </span>
              <button
                style={{
                  marginLeft: 16,
                  padding: "10px 26px",
                  fontWeight: 700,
                  borderRadius: 26,
                  background: "#09B1CD",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 23
                }}
                onClick={() => setEditingName(j.nombre)}
              >Editar</button>
            </li>
          ))}
        </ul>
        <div style={{ textAlign: "center", marginTop: 28, color: "#aaa", fontSize: 21, fontWeight: 500 }}>
          ¡Gracias por votar!
        </div>
        <div style={{ textAlign: "center", marginTop: 30 }}>
          <button
            onClick={() => {
              // Volver al inicio
              if (onReset) onReset();
            }}
            style={{
              fontSize: 27,
              fontWeight: 700,
              padding: "16px 0",
              background: "#09B1CD",
              border: "none",
              borderRadius: 28,
              color: "#fff",
              width: 320,
              boxShadow: "0 2px 10px #dde",
              marginTop: 18,
              cursor: "pointer"
            }}
          >Volver al inicio</button>
        </div>
      </div>
    );
  }

  // Votación normal
  if (step === 1 && yo) {
    const jugadorVotar = jugadoresParaVotar[current];
    return (
      <div style={{
        maxWidth: 390,
        margin: "44px auto 0 auto",
        padding: "26px 24px 36px 24px",
        background: "#fff",
        borderRadius: 32,
        boxShadow: "0 2px 18px 0 rgba(34, 40, 80, 0.10)",
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif"
      }}>
        <h2 style={{ color: "#DE1C49", textAlign: "center" }}>Calificá a tus compañeros</h2>
        <div style={{ textAlign: "center", fontWeight: 600, fontSize: 22, marginBottom: 12 }}>
          {jugadorVotar.nombre}
        </div>
        <div style={{
          width: 96, height: 96, borderRadius: "50%", border: "2px solid #eceaf1",
          background: jugadorVotar.foto ? `url(${jugadorVotar.foto.url}) center/cover` : "#f5f5f5",
          margin: "0 auto 16px auto", display: "flex", alignItems: "center", justifyContent: "center"
        }}>
          {!jugadorVotar.foto && (
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
              <circle cx="28" cy="28" r="28" fill="#eceaf1" />
              <circle cx="28" cy="23" r="11" fill="#bbb" />
              <ellipse cx="28" cy="42.5" rx="15" ry="9.5" fill="#bbb" />
            </svg>
          )}
        </div>
        <StarRating
          value={votos[jugadorVotar.nombre] || 0}
          onChange={handleVote}
          hovered={hovered}
          setHovered={setHovered}
        />
        <div style={{
          marginTop: 10,
          fontSize: 24,
          color: "#DE1C49",
          fontWeight: 700,
          letterSpacing: "-1px",
          textAlign: "center"
        }}>
          {hovered !== null ? hovered : (votos[jugadorVotar.nombre] || 0)}
        </div>
      </div>
    );
  }

  // REGISTRO + AUTOPUNTAJE
  return (
    <form onSubmit={handleRegistro} style={{
      maxWidth: 390, margin: "44px auto 0 auto", padding: "26px 24px 36px 24px",
      background: "#fff", borderRadius: 32, boxShadow: "0 2px 18px 0 rgba(34, 40, 80, 0.10)",
      fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif"
    }}>
      <h2 style={{ color: "#DE1C49", textAlign: "center" }}>Registrate</h2>
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 18 }}>
        <label>
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={e => {
              if (e.target.files && e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = (e2) => setPhotoUrl(e2.target.result);
                reader.readAsDataURL(e.target.files[0]);
              }
            }}
          />
          <div style={{
            width: 56, height: 56, borderRadius: "50%",
            background: photoUrl ? `url(${photoUrl}) center/cover` : "#eceaf1",
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: "pointer", border: "2px solid #eceaf1"
          }}>
            {!photoUrl && (
              <svg width="38" height="38" viewBox="0 0 38 38" fill="none">
                <circle cx="19" cy="19" r="19" fill="#eceaf1" />
                <circle cx="19" cy="14" r="7" fill="#bbb" />
                <ellipse cx="19" cy="29" rx="11" ry="7" fill="#bbb" />
                <text x="19" y="22" textAnchor="middle" fontSize="24" fill="#bbb" dy="0.5em">+</text>
              </svg>
            )}
          </div>
        </label>
        <input
          autoFocus
          required
          name="nombre"
          placeholder="Tu nombre"
          className="voting-input"
          style={{
            flex: 1, fontSize: 18, border: "none", borderBottom: "2px solid #DE1C49",
            outline: "none", padding: "12px 10px", fontWeight: 600, borderRadius: 7
          }}
        />
      </div>
      <div style={{ marginBottom: 22 }}>
        <label style={{ display: "block", marginBottom: 6, color: "#555", fontWeight: 700, fontSize: 17 }}>
          ¿Qué puntaje te das?
        </label>
        <StarRating
          value={miScore}
          onChange={v => setMiScore(Math.max(1, v))}
          hovered={hovered}
          setHovered={setHovered}
        />
        <div style={{
          fontSize: 20,
          color: "#DE1C49",
          textAlign: "center",
          fontWeight: 700
        }}>
          {hovered !== null ? hovered : miScore}
        </div>
        <div style={{ color: "#888", fontSize: 15, marginTop: 2, textAlign: "center", fontStyle: "italic" }}>
          Sé honesto 😉
        </div>
      </div>
      <button type="submit" style={{
        width: "100%", padding: "13px 0", fontWeight: 700, borderRadius: 17,
        background: "#DE1C49", color: "#fff", border: "none", fontSize: 17,
        boxShadow: "0 2px 8px rgba(30,10,30,0.13)", cursor: "pointer"
      }}>Entrar</button>
    </form>
  );
}
