import React, { useState } from "react";

// Función simple para crear un código de sesión aleatorio
function generarCodigoSesion() {
  return "PARTIDO-" + Math.floor(Math.random() * 100000);
}

export default function AdminPanel() {
  const [codigo, setCodigo] = useState(() => {
    // Si ya hay sesión creada, la levanta de localStorage
    return localStorage.getItem("codigoSesion") || "";
  });

  function crearNuevaSesion() {
    const nuevoCodigo = generarCodigoSesion();
    setCodigo(nuevoCodigo);
    localStorage.setItem("codigoSesion", nuevoCodigo);
    // Acá podrías limpiar datos previos, si querés
    localStorage.setItem(`votacion_${nuevoCodigo}`, JSON.stringify({ jugadores: [], votos: {} }));
  }

  return (
    <div style={{
      maxWidth: 430, margin: "45px auto", padding: 24, background: "#fff",
      borderRadius: 28, boxShadow: "0 2px 16px #ddd"
    }}>
      <h2 style={{ color: "#DE1C49", textAlign: "center" }}>Panel Admin</h2>
      {!codigo ? (
        <button
          style={{
            display: "block", margin: "24px auto", padding: "15px 40px", fontWeight: 800,
            background: "linear-gradient(90deg,#DE1C49 0%,#0EA9C6 100%)", color: "#fff",
            border: "none", borderRadius: 22, fontSize: 20, cursor: "pointer"
          }}
          onClick={crearNuevaSesion}
        >Crear nueva votación</button>
      ) : (
        <>
          <div style={{ textAlign: "center", marginBottom: 18 }}>
            <div>Código de votación:</div>
            <div style={{
              fontSize: 28, letterSpacing: 2, color: "#DE1C49", fontWeight: 900,
              background: "#f8f8ff", borderRadius: 14, padding: "13px 0"
            }}>{codigo}</div>
            <div style={{ margin: "16px 0", color: "#0EA9C6", fontSize: 15 }}>
              Compartí este código con tus amigos para que puedan votar.
            </div>
          </div>
          {/* Acá luego irá la lista de jugadores/votos/resumen */}
          {/* <VotacionResumen codigo={codigo} /> */}
        </>
      )}
    </div>
  );
}
