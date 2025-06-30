import React, { useState } from "react";

const onlyLetters = str => /^[A-Za-záéíóúÁÉÍÓÚñÑüÜ\s]+$/.test(str.trim()) && str.trim().length > 0;

export default function FrequentPlayers({
  players = [],
  onAdd,
  onDelete,
  playersInList = [],
  onEdit,
  onEditGlobal
}) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState("");
  const [editScore, setEditScore] = useState("");
  const [editNickname, setEditNickname] = useState("");

  const filtered = players.filter(p =>
    (p.name || "")
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const startEdit = (player) => {
    setEditing(player.id);
    setEditName(player.name || "");
    setEditScore(player.score || "");
    setEditNickname(player.nickname || "");
    document.body.style.overflow = 'hidden';
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditName("");
    setEditScore("");
    setEditNickname("");
    document.body.style.overflow = '';
  };

  const handleEditSubmit = (e) => {
    e.preventDefault();
    if (!onlyLetters(editName)) {
      alert("Solo se permiten letras para el nombre.");
      return;
    }
    const score = Number(editScore);
    if (!Number.isFinite(score) || score < 1 || score > 10) {
      alert("El puntaje debe ser un número entre 1 y 10.");
      return;
    }
    const idx = players.findIndex(p => p.id === editing);
    if (idx === -1) {
      cancelEdit();
      return;
    }
    const nuevaLista = [...players];
    nuevaLista[idx] = {
      ...nuevaLista[idx],
      name: editName.trim(),
      score,
      nickname: editNickname,
    };
    onEdit(nuevaLista);
    // NUEVO: también actualizamos la lista global (en AppNormal)
    if (typeof onEditGlobal === "function") {
      onEditGlobal(nuevaLista[idx]);
    }
    cancelEdit();
  };

  const handleBackdrop = (e) => {
    if (e.target.className && typeof e.target.className === "string" && e.target.className.includes('modal-backdrop')) {
      cancelEdit();
    }
  };

  return (
    <div>
      <div className="frequent-header">
        <span style={{ fontWeight: 700 }}>Jugadores frecuentes</span>
      </div>
      <input
        className="frequent-search"
        type="text"
        placeholder="Buscar frecuentes..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <ul className="frequent-list-ul">
        {filtered.map(p => (
          <li key={p.id} className="frequent-player-item" style={{ marginBottom: 5 }}>
            <span
              className="frequent-player-name"
              style={{
                cursor: "pointer",
                color: "#0EA9C6",
                fontWeight: 700,
                fontSize: "1em",
                marginRight: 4,
                textDecoration: "underline",
                transition: "color .13s"
              }}
              title="Editar jugador frecuente"
              onClick={() => startEdit(p)}
            >
              {p.name}
            </span>
            <button
              className="add-player-button"
              disabled={playersInList.some(j => (j.name || "").toLowerCase() === (p.name || "").toLowerCase())}
              title="Agregar a la lista"
              onClick={() => onAdd(p)}
              style={{ marginLeft: 2, background: "#babec4" }}
            >
              +
            </button>
            <button
              className="delete-player-button"
              title="Eliminar"
              onClick={() => onDelete(p)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {/* MODAL */}
      {editing && (
        <div
          className="modal-backdrop"
          onClick={handleBackdrop}
          style={{
            position: "fixed",
            zIndex: 2000,
            left: 0, top: 0, width: "100vw", height: "100vh",
            background: "rgba(32,37,54,0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          <div
            className="floating-modal"
            style={{
              background: "#fff",
              borderRadius: 32,
              boxShadow: "0 8px 38px 0 rgba(34, 40, 80, 0.15)",
              maxWidth: 420,
              width: "95vw",
              padding: "38px 32px 34px 32px",
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch"
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{
              fontSize: 30,
              color: "#DE1C49",
              fontWeight: 800,
              textAlign: "center",
              marginBottom: 18
            }}>
              Editar jugador
            </div>
            <form onSubmit={handleEditSubmit}>
              <div style={{ marginBottom: 15 }}>
                <label style={{ fontWeight: 700, fontSize: 18, color: "#232a32" }}>Nombre</label>
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value.replace(/[^A-Za-záéíóúÁÉÍÓÚñÑüÜ\s]/g, ""))}
                  placeholder="Nombre"
                  style={{
                    width: "100%",
                    border: "2px solid #DE1C49",
                    borderRadius: 11,
                    padding: "11px 13px",
                    fontSize: 20,
                    fontWeight: 600,
                    marginBottom: 7
                  }}
                  autoFocus
                  maxLength={18}
                />
              </div>
              <div style={{ marginBottom: 15 }}>
                <label style={{ fontWeight: 700, fontSize: 18, color: "#232a32" }}>Apodo</label>
                <input
                  value={editNickname}
                  onChange={e => setEditNickname(e.target.value)}
                  placeholder="Apodo"
                  style={{
                    width: "100%",
                    border: "1.4px solid #bbb",
                    borderRadius: 11,
                    padding: "11px 13px",
                    fontSize: 18,
                    marginBottom: 7
                  }}
                  maxLength={16}
                />
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={{ fontWeight: 700, fontSize: 18, color: "#232a32" }}>Puntaje</label>
                <input
                  value={editScore}
                  onChange={e => setEditScore(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="Puntaje"
                  style={{
                    width: "100%",
                    border: "2px solid #0EA9C6",
                    borderRadius: 11,
                    padding: "11px 13px",
                    fontSize: 20,
                    textAlign: "center",
                    fontWeight: 600
                  }}
                  maxLength={2}
                  inputMode="numeric"
                  pattern="[0-9]*"
                />
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 26 }}>
                <button
                  type="submit"
                  style={{
                    background: "#09B1CD",
                    color: "#fff",
                    border: "none",
                    borderRadius: 18,
                    padding: "16px 0",
                    fontWeight: 700,
                    fontSize: 23,
                    width: "50%",
                    boxShadow: "0 2px 10px #dde",
                    cursor: "pointer"
                  }}
                >Aceptar</button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  style={{
                    background: "#ececec",
                    color: "#444",
                    border: "none",
                    borderRadius: 18,
                    padding: "16px 0",
                    fontWeight: 700,
                    fontSize: 23,
                    width: "50%",
                    boxShadow: "0 2px 10px #dde",
                    cursor: "pointer"
                  }}
                >Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
