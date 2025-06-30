// src/RegistroJugador.js
import React, { useState } from "react";

// Componente de estrellas (igual que antes)
function StarRating({ value, onChange, max = 10, hovered, setHovered }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 10 }}>
      {[...Array(max)].map((_, i) => (
        <svg
          key={i}
          width="34"
          height="34"
          viewBox="0 0 24 24"
          style={{
            cursor: "pointer",
            transform: hovered !== null
              ? (i < hovered ? "scale(1.22)" : "scale(1)")
              : (i < value ? "scale(1.15)" : "scale(1)"),
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

export default function RegistroJugador({ onRegister, jugadores = [] }) {
  const [selectedName, setSelectedName] = useState("");
  const [fotoURL, setFotoURL] = useState(null);
  const [puntaje, setPuntaje] = useState(5);
  const [hovered, setHovered] = useState(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState(jugadores?.length ? 0 : 1);

  function handleFoto(e) {
    if (e.target.files && e.target.files[0]) {
      setFotoURL(URL.createObjectURL(e.target.files[0]));
    }
  }

  function handleSelectName(e) {
    setSelectedName(e.target.value);
    setStep(1); // Pasa al paso 2 (foto y autopuntaje)
  }

  function handleSubmit(e) {
    e.preventDefault();
    const nombre = jugadores?.length ? selectedName : e.target.nombre.value.trim();
    if (!nombre) {
      setError("Elegí tu nombre");
      return;
    }
    setError("");

    const jugador = {
      nombre,
      foto: fotoURL ? { url: fotoURL } : null,
      score: puntaje
    };

    // Guardar en jugadores frecuentes (localStorage)
    const prev = JSON.parse(localStorage.getItem("frequentPlayers")) || [];
    if (!prev.find(p => p.nombre?.toLowerCase() === jugador.nombre.toLowerCase())) {
      localStorage.setItem("frequentPlayers", JSON.stringify([...prev, jugador]));
    }
    onRegister(jugador);
  }

  // Paso 0: Elegir el nombre
  if (jugadores?.length && step === 0) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(90deg,#DE1C49 0%,#0EA9C6 100%)"
      }}>
        <form
          style={{
            background: "#fff",
            borderRadius: 28,
            boxShadow: "0 2px 20px #ccc",
            padding: 32,
            minWidth: 320,
            textAlign: "center"
          }}>
          <h2 style={{ color: "#DE1C49", fontWeight: 800, marginBottom: 22 }}>
            Elegí tu nombre
          </h2>
          <select
            value={selectedName}
            onChange={handleSelectName}
            style={{
              width: "100%",
              padding: "13px 18px",
              fontSize: 18,
              borderRadius: 16,
              border: "1.5px solid #eceaf1",
              marginBottom: 18,
              background: "#f9f9fa",
              textAlign: "center"
            }}
          >
            <option value="">Seleccioná tu nombre...</option>
            {jugadores.map(n =>
              <option key={n} value={n}>{n}</option>
            )}
          </select>
          {error && <div style={{ color: "#DE1C49", fontSize: 15, marginBottom: 10 }}>{error}</div>}
        </form>
      </div>
    );
  }

  // Paso 1: Foto y autopuntaje
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(90deg,#DE1C49 0%,#0EA9C6 100%)"
    }}>
      <form
        onSubmit={handleSubmit}
        style={{
          background: "#fff",
          borderRadius: 28,
          boxShadow: "0 2px 20px #ccc",
          padding: 32,
          minWidth: 320,
          textAlign: "center"
        }}>
        <h2 style={{ color: "#DE1C49", fontWeight: 800, marginBottom: 22 }}>
          {selectedName || "Registrate para votar"}
        </h2>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="fotoJugador" style={{
            display: "inline-block",
            cursor: "pointer",
            borderRadius: "50%",
            width: 96,
            height: 96,
            background: "#eceaf1",
            overflow: "hidden",
            marginBottom: 8,
            border: "2px solid #eceaf1"
          }}>
            {fotoURL
              ? <img
                  src={fotoURL}
                  alt="Tu foto"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              : <span style={{
                  width: "100%", height: "100%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 44, color: "#bbb"
                }}>+</span>
            }
            <input
              type="file"
              id="fotoJugador"
              accept="image/*"
              onChange={handleFoto}
              style={{ display: "none" }}
            />
          </label>
        </div>
        {jugadores?.length === 0 &&
          <input
            type="text"
            placeholder="Tu nombre"
            value={selectedName}
            onChange={e => setSelectedName(e.target.value)}
            style={{
              width: "100%",
              padding: "13px 18px",
              fontSize: 18,
              borderRadius: 16,
              border: "1.5px solid #eceaf1",
              marginBottom: 18,
              background: "#f9f9fa",
              textAlign: "center",
            }}
          />
        }
        <div style={{ marginBottom: 18 }}>
          <label style={{ display: "block", marginBottom: 7, color: "#555" }}>
            ¿Con qué puntaje te calificás?
            <span style={{ color: "#999", fontWeight: 400, fontSize: 14, marginLeft: 7 }}>
              (Sé honesto)
            </span>
          </label>
          <StarRating
            value={puntaje}
            onChange={val => setPuntaje(val)}
            hovered={hovered}
            setHovered={setHovered}
          />
          <div style={{
            fontSize: 22,
            color: "#DE1C49",
            textAlign: "center",
            fontWeight: 700
          }}>
            {hovered !== null ? hovered : puntaje}
          </div>
        </div>
        {error && <div style={{ color: "#DE1C49", fontSize: 15, marginBottom: 10 }}>{error}</div>}
        <button
          type="submit"
          style={{
            width: "100%",
            padding: "14px 0",
            fontSize: 18,
            fontWeight: 700,
            color: "#fff",
            background: "#0EA9C6",
            border: "none",
            borderRadius: 16,
            cursor: "pointer"
          }}>
          Registrarme
        </button>
      </form>
    </div>
  );
}
