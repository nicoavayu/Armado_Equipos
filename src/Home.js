// src/Home.js
import React from "react";

export default function Home({ onSelectModo }) {
  return (
    <div style={{ maxWidth: 390, margin: "80px auto", padding: 32, textAlign: "center" }}>
      <img src="logo.png" alt="Logo" style={{ width: 100, marginBottom: 30 }} />
      <h1 style={{ color: "#DE1C49", marginBottom: 32 }}>Armando Equipos</h1>
      <button
        style={buttonStyle}
        onClick={() => onSelectModo("simple")}
      >
        Modo Simple
      </button>
      <button
        style={buttonStyle}
        onClick={() => onSelectModo("jugador")}
      >
        Soy Jugador
      </button>
      <button
        style={buttonStyle}
        onClick={() => onSelectModo("admin")}
      >
        Panel Admin
      </button>
    </div>
  );
}

const buttonStyle = {
  width: "100%",
  padding: "18px 0",
  margin: "12px 0",
  fontSize: 20,
  borderRadius: 20,
  border: "none",
  fontWeight: 700,
  background: "#0EA9C6",
  color: "#fff",
  cursor: "pointer",
  boxShadow: "0 2px 8px rgba(30,10,30,0.13)"
};
