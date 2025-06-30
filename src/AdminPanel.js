import React, { useState, useEffect } from "react";
import { supabase } from "./supabase";

export default function AdminPanel({ onBackToHome }) {
  const [jugadores, setJugadores] = useState([]);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [editandoId, setEditandoId] = useState(null);
  const [editNombre, setEditNombre] = useState("");
  const [copyMsg, setCopyMsg] = useState("");
  const [loading, setLoading] = useState(false);

  // Cargar jugadores al inicio
  useEffect(() => {
    fetchJugadores();
    // eslint-disable-next-line
  }, []);

  async function fetchJugadores() {
    setLoading(true);
    let { data, error } = await supabase
      .from("jugadores")
      .select("id, nombre")
      .order("nombre", { ascending: true });
    setLoading(false);
    if (!error) setJugadores(data || []);
    else setJugadores([]);
  }

  // Agregar jugador a Supabase
  async function agregarJugador() {
    const nombre = nuevoNombre.trim();
    if (!nombre) return;
    // Evitar duplicados
    if (jugadores.some(j => j.nombre.toLowerCase() === nombre.toLowerCase())) return;
    setLoading(true);
    const { error } = await supabase
      .from("jugadores")
      .insert([{ nombre }]);
    setLoading(false);
    setNuevoNombre("");
    if (error) alert("Error agregando jugador: " + error.message);
    fetchJugadores();
  }

  // Eliminar jugador de Supabase
  async function eliminarJugador(id) {
    if (!window.confirm("¿Seguro que querés borrar este jugador?")) return;
    setLoading(true);
    await supabase.from("jugadores").delete().eq("id", id);
    setLoading(false);
    fetchJugadores();
  }

  // Editar jugador en Supabase
  async function editarJugador(id) {
    if (!editNombre.trim()) return;
    setLoading(true);
    await supabase.from("jugadores").update({ nombre: editNombre.trim() }).eq("id", id);
    setLoading(false);
    setEditandoId(null);
    setEditNombre("");
    fetchJugadores();
  }

  function handleCopyLink() {
    const url = window.location.origin + "/?modo=jugador";
    navigator.clipboard.writeText(url);
    setCopyMsg("¡Link copiado al portapapeles!");
    setTimeout(() => setCopyMsg(""), 2000);
  }

  return (
    <div style={{
      maxWidth: 390, margin: "80px auto", padding: 32, textAlign: "center",
      background: "#fff", borderRadius: 20, boxShadow: "0 2px 18px #ccc"
    }}>
      <h1 style={{ color: "#0EA9C6", fontWeight: 900, marginBottom: 28 }}>Panel de Administrador</h1>
      <button
        onClick={onBackToHome}
        style={{
          background: "#DE1C49", color: "#fff", fontWeight: 800, fontSize: 17,
          border: "none", borderRadius: 12, padding: "8px 18px", marginBottom: 25, cursor: "pointer"
        }}>
        Volver al inicio
      </button>

      <div style={{ margin: "35px 0" }}>
        <input
          type="text"
          value={nuevoNombre}
          onChange={e => setNuevoNombre(e.target.value)}
          placeholder="Nombre jugador"
          style={{
            padding: "11px 14px", fontSize: 18, borderRadius: 14, border: "1.5px solid #eceaf1",
            marginRight: 10, background: "#f9f9fa"
          }}
          disabled={loading}
        />
        <button
          onClick={agregarJugador}
          style={{
            background: "#0EA9C6", color: "#fff", fontWeight: 800, fontSize: 17,
            border: "none", borderRadius: 12, padding: "10px 18px", cursor: "pointer"
          }}
          disabled={loading}
        >
          Agregar
        </button>
      </div>

      <div style={{ marginBottom: 22 }}>
        <h3 style={{ marginBottom: 10, color: "#DE1C49", fontWeight: 700 }}>
          Jugadores ({jugadores.length})
        </h3>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {jugadores.map(j => (
            <li key={j.id} style={{
              margin: "7px 0", fontSize: 18, fontWeight: 600,
              display: "flex", alignItems: "center", justifyContent: "space-between"
            }}>
              {editandoId === j.id ? (
                <>
                  <input
                    type="text"
                    value={editNombre}
                    onChange={e => setEditNombre(e.target.value)}
                    style={{
                      fontSize: 18, padding: "5px 8px", borderRadius: 7, border: "1px solid #ccc"
                    }}
                  />
                  <button
                    style={{ marginLeft: 8, background: "#0EA9C6", color: "#fff", border: "none", borderRadius: 7, padding: "3px 11px", fontWeight: 700, cursor: "pointer" }}
                    onClick={() => editarJugador(j.id)}
                  >Guardar</button>
                  <button
                    style={{ marginLeft: 5, background: "#DE1C49", color: "#fff", border: "none", borderRadius: 7, padding: "3px 11px", fontWeight: 700, cursor: "pointer" }}
                    onClick={() => setEditandoId(null)}
                  >Cancelar</button>
                </>
              ) : (
                <>
                  <span>{j.nombre}</span>
                  <span>
                    <button
                      style={{ marginLeft: 6, background: "#0EA9C6", color: "#fff", border: "none", borderRadius: 9, padding: "4px 10px", fontWeight: 700, cursor: "pointer" }}
                      onClick={() => { setEditandoId(j.id); setEditNombre(j.nombre); }}
                    >Editar</button>
                    <button
                      onClick={() => eliminarJugador(j.id)}
                      style={{
                        marginLeft: 6, background: "#DE1C49", color: "#fff",
                        border: "none", borderRadius: 9, padding: "4px 13px",
                        fontWeight: 700, cursor: "pointer"
                      }}>X</button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>

      <button
        onClick={handleCopyLink}
        style={{
          background: "#0EA9C6", color: "#fff", fontWeight: 800, fontSize: 19,
          border: "none", borderRadius: 18, padding: "15px 34px", cursor: "pointer"
        }}>
        Copiar link para jugadores
      </button>
      {copyMsg && <div style={{ color: "#09B1CD", marginTop: 15, fontWeight: 700 }}>{copyMsg}</div>}
    </div>
  );
}
