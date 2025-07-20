import React, { useState } from "react";
import { toast } from 'react-toastify';
import { PlayerCardTrigger } from './ProfileComponents';

const onlyLetters = str => /^[A-Za-záéíóúÁÉÍÓÚñÑüÜ\s]+$/.test(str.trim()) && str.trim().length > 0;

function EditModal({ player, onSave, onCancel }) {
  const [name, setName] = useState(player.name || "");
  const [score, setScore] = useState(player.score || "");
  const [nickname, setNickname] = useState(player.nickname || "");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!onlyLetters(name)) {
      toast.warn("Solo se permiten letras para el nombre.");
      return;
    }
    const scoreNum = Number(score);
    if (!Number.isFinite(scoreNum) || scoreNum < 1 || scoreNum > 10) {
      toast.warn("El puntaje debe ser un número entre 1 y 10.");
      return;
    }
    onSave({ ...player, name: name.trim(), score: scoreNum, nickname: nickname.trim() });
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="voting-modern-card" style={{
        maxWidth: 320,
        background: 'rgba(30, 32, 50, 0.97)',
        border: '1px solid rgba(255,255,255,0.2)',
        backdropFilter: 'blur(10px)',
        borderRadius: 18,
        boxShadow: '0 4px 32px 0 rgba(0,0,0,0.18)',
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
      }} onClick={e => e.stopPropagation()}>
        <form onSubmit={handleSubmit} style={{display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', alignItems: 'center', justifyContent: 'center'}}>
          <h2 className="voting-title-modern" style={{fontSize: '1.2rem', marginBottom: 0, textAlign: 'center'}}>Editar Jugador</h2>
          <input
            className="input-modern"
            value={name}
            onChange={e => setName(e.target.value.replace(/[^A-Za-záéíóúÁÉÍÓÚñÑüÜ\s]/g, ""))}
            placeholder="Nombre"
            required
            style={{height: '44px', fontSize: '1rem', borderRadius: 0, width: '180px', marginBottom: 6, textAlign: 'center'}}
          />
          <input
            className="input-modern"
            value={nickname}
            onChange={e => setNickname(e.target.value)}
            placeholder="Apodo (opcional)"
            style={{height: '44px', fontSize: '1rem', borderRadius: 0, width: '180px', marginBottom: 6, textAlign: 'center'}}
          />
          <input
            className="input-modern"
            type="number"
            value={score}
            onChange={e => setScore(e.target.value)}
            placeholder="Puntaje (1-10)"
            required
            style={{height: '44px', fontSize: '1rem', borderRadius: 0, width: '180px', marginBottom: 10, textAlign: 'center'}}
          />
          <div style={{display: 'flex', gap: '8px', width: '180px', justifyContent: 'center'}}>
            <button type="submit" className="voting-confirm-btn wipe-btn" style={{flex: 1, borderRadius: 10, height: '36px', fontSize: '1rem', minWidth: 0, margin: 0}}>Guardar</button>
            <button type="button" onClick={onCancel} className="voting-confirm-btn wipe-btn" style={{background: 'rgba(222, 28, 73, 0.5)', flex: 1, borderRadius: 10, height: '36px', fontSize: '1rem', minWidth: 0, margin: 0}}>Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  );
}


export default function FrequentPlayers({
  players = [],
  onAdd,
  onDelete,
  playersInList = [],
  onEdit,
  onEditGlobal
}) {
  const [search, setSearch] = useState("");
  const [editingPlayer, setEditingPlayer] = useState(null);

  const filtered = players.filter(p =>
    (p.name || "").toLowerCase().includes(search.toLowerCase())
  );

  const handleSaveEdit = (editedPlayer) => {
    const newList = players.map(p => p.id === editedPlayer.id ? editedPlayer : p);
    onEdit(newList);
    if (typeof onEditGlobal === "function") {
      onEditGlobal(editedPlayer);
    }
    setEditingPlayer(null);
  };

  return (
    <div>
      <details open>
        <summary className="admin-list-title" style={{cursor: 'pointer', fontWeight: '400'}}>Jugadores Frecuentes</summary>
        <input
          className="input-modern"
          type="text"
          placeholder="Buscar..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ marginBottom: 8, width: '100%' }}
        />
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {filtered.map(p => {
            const isAdded = playersInList.some(j => (j.name || "").toLowerCase() === (p.name || "").toLowerCase());
            return (
              <PlayerCardTrigger key={p.uuid || p.id} profile={p}>
                <li className="admin-jugador-box" style={{padding: '5px'}}>
                  <span
                    className="admin-jugador-nombre"
                    onClick={(e) => {
                      e.stopPropagation(); // Prevent modal from opening when editing
                      setEditingPlayer(p);
                    }}
                    style={{flex: 1, cursor: 'pointer', textDecoration: 'underline'}}>
                    {p.name}
                  </span>
                  <button
                    className="remove-btn"
                    style={{background: isAdded ? '#808080' : '#25D366', cursor: isAdded ? 'not-allowed' : 'pointer'}}
                    disabled={isAdded}
                    title="Agregar a la lista"
                    onClick={(e) => {
                      e.stopPropagation(); // Prevent modal from opening when adding
                      onAdd(p);
                    }}
                  >
                    +
                  </button>
                  <button
                    className="remove-btn"
                    title="Eliminar"
                    onClick={(e) => {
                      e.stopPropagation(); // Prevent modal from opening when deleting
                      onDelete(p);
                    }}
                  >
                    ×
                  </button>
                </li>
              </PlayerCardTrigger>
            );
          })}
        </ul>
      </details>

      {editingPlayer && (
        <EditModal
          player={editingPlayer}
          onSave={handleSaveEdit}
          onCancel={() => setEditingPlayer(null)}
        />
      )}
    </div>
  );
}
