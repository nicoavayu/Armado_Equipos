// src/App.js
import React, { useState } from "react";
import Home from "./Home";
import AppNormal from "./AppNormal";
import VotingView from "./VotingView";
import RegistroJugador from "./RegistroJugador";

export default function App() {
  const [modo, setModo] = useState(null);
  const [jugador, setJugador] = useState(null);

  // Esta función resetea TODO a home:
  function handleReset() {
    setModo(null);
    setJugador(null);
  }

  if (!modo) return <Home onSelectModo={setModo} />;

  // --- CORREGIDO: Prop correcta para AppNormal ---
  if (modo === "simple") return <AppNormal onBackToHome={handleReset} />;

  // El modo jugador: primero registrar el jugador, después votar
  if (modo === "jugador") {
    if (!jugador) {
      return <RegistroJugador onRegister={setJugador} />;
    }
    // Pasás los datos del jugador y el onReset al VotingView
    return <VotingView jugadorActual={jugador} onReset={handleReset} />;
  }

  if (modo === "admin") return (
    <div style={{ textAlign: "center", marginTop: 100, color: "#0EA9C6" }}>
      <h1>Panel de Administrador</h1>
      <p>(En construcción...)</p>
    </div>
  );
}
