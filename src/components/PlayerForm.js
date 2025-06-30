import React, { useState } from "react";

// Sólo letras y espacios (acentos incluidos)
const onlyLetters = str => /^[A-Za-záéíóúÁÉÍÓÚñÑüÜ\s]+$/.test(str.trim()) && str.trim().length > 0;

export default function PlayerForm({ onAddPlayer, players }) {
  const [name, setName] = useState("");
  const [score, setScore] = useState("");
  const [nickname, setNickname] = useState("");
  const [foto, setFoto] = useState(null);

  function handleSubmit(e) {
    e.preventDefault();
    // Validación nombre SOLO LETRAS
    if (!onlyLetters(name)) {
      alert("Solo se permiten letras y espacios para el nombre.");
      return;
    }
    // Validación puntaje numérico de 1 a 10
    const puntajeNum = Number(score);
    if (!Number.isFinite(puntajeNum) || puntajeNum < 1 || puntajeNum > 10) {
      alert("El puntaje debe ser un número entre 1 y 10.");
      return;
    }
    onAddPlayer({
      name: name.trim(),
      score: puntajeNum,
      nickname: nickname.trim(),
      foto: foto || null
    });
    setName("");
    setScore("");
    setNickname("");
    setFoto(null);
  }

  return (
    <form className="player-form" onSubmit={handleSubmit} autoComplete="off">
      <label>Nombre</label>
      <input
        type="text"
        value={name}
        onChange={e =>
          setName(e.target.value.replace(/[^A-Za-záéíóúÁÉÍÓÚñÑüÜ\s]/g, ""))
        }
        placeholder="Nombre"
        required
        maxLength={18}
      />
      <label>Apodo</label>
      <input
        type="text"
        value={nickname}
        onChange={e => setNickname(e.target.value)}
        placeholder="Apodo (opcional)"
        maxLength={16}
      />
      <label>Puntaje</label>
      <input
        type="number"
        value={score}
        onChange={e => setScore(e.target.value.replace(/[^0-9]/g, ""))}
        min={1}
        max={10}
        placeholder="Puntaje (1-10)"
        required
        maxLength={2}
        inputMode="numeric"
        pattern="[0-9]*"
      />
      <button type="submit" style={{ marginTop: 10 }}>Agregar jugador</button>
    </form>
  );
}
