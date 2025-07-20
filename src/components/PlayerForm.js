import React, { useState } from "react";
import { toast } from 'react-toastify';
import LoadingSpinner from "./LoadingSpinner";

// Sólo letras y espacios (acentos incluidos)
const onlyLetters = str => /^[A-Za-záéíóúÁÉÍÓÚñÑüÜ\s]+$/.test(str.trim()) && str.trim().length > 0;

export default function PlayerForm({ onAddPlayer }) {
  const [name, setName] = useState("");
  const [score, setScore] = useState("");
  const [nickname, setNickname] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!onlyLetters(name)) {
      toast.warn("Solo se permiten letras y espacios para el nombre.");
      return;
    }
    const puntajeNum = Number(score);
    if (!Number.isFinite(puntajeNum) || puntajeNum < 1 || puntajeNum > 10) {
      toast.warn("El puntaje debe ser un número entre 1 y 10.");
      return;
    }
    
    setLoading(true);
    try {
      await onAddPlayer({
        name: name.trim(),
        score: puntajeNum,
        nickname: nickname.trim(),
      });
      setName("");
      setScore("");
      setNickname("");
    } catch (error) {
      toast.error("Error al agregar jugador");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <input
        type="text"
        value={name}
        onChange={e => setName(e.target.value.replace(/[^A-Za-záéíóúÁÉÍÓÚñÑüÜ\s]/g, ""))}
        placeholder="Nombre del Jugador"
        required
        maxLength={18}
        className="input-modern"
        style={{height: '48px', fontSize: '1.1rem'}}
      />
      <input
        type="text"
        value={nickname}
        onChange={e => setNickname(e.target.value)}
        placeholder="Apodo (opcional)"
        maxLength={16}
        className="input-modern"
        style={{height: '48px', fontSize: '1.1rem'}}
      />
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
        className="input-modern"
        style={{height: '48px', fontSize: '1.1rem'}}
      />
      <button 
        type="submit" 
        className="voting-confirm-btn wipe-btn" 
        style={{background: 'rgba(52, 152, 219, 0.5)', minWidth: 0, maxWidth: '100%', width: 'auto', fontSize: '1.1rem', letterSpacing: 0, padding: '10px 8px', whiteSpace: 'nowrap', overflow: 'auto', textOverflow: 'unset', marginTop: '10px', marginBottom: '0'}}
        disabled={loading}
      >
        {loading ? <LoadingSpinner size="small" /> : 'Agregar Jugador'}
      </button>
    </form>
  );
}
