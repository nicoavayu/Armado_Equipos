import "./AdminPanel.css";
import React, { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";

export default function AdminPanel({ onBackToHome }) {
  const [jugadores, setJugadores] = useState([]);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [copyMsg, setCopyMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [votantes, setVotantes] = useState([]);
  const [votacionCerrada, setVotacionCerrada] = useState(false);
  const [promedios, setPromedios] = useState([]);
  const [equipos, setEquipos] = useState([]);
  const inputRef = useRef();

  useEffect(() => { fetchJugadores(); }, []);

  async function fetchJugadores() {
    setLoading(true);
    let { data, error } = await supabase
      .from("jugadores")
      .select("id, nombre, foto_url")
      .order("nombre", { ascending: true });
    setLoading(false);
    setJugadores(!error ? data || [] : []);
  }

  useEffect(() => {
    if (votacionCerrada) return;
    async function fetchVotantes() {
      let { data } = await supabase.from("votos").select("votante_id");
      const ids = Array.from(new Set((data || []).map(v => v.votante_id)));
      setVotantes(ids);
    }
    fetchVotantes();
    const interval = setInterval(fetchVotantes, 5000);
    return () => clearInterval(interval);
  }, [votacionCerrada]);

  async function agregarJugador(e) {
    if (e) e.preventDefault();
    const nombre = nuevoNombre.trim();
    if (!nombre) return;
    if (jugadores.some(j => j.nombre.toLowerCase() === nombre.toLowerCase())) return;
    setLoading(true);
    const { error } = await supabase.from("jugadores").insert([{ nombre }]);
    setLoading(false);
    setNuevoNombre("");
    inputRef.current && inputRef.current.blur();
    if (error) alert("Error agregando jugador: " + error.message);
    fetchJugadores();
  }

  async function eliminarJugador(id) {
    if (!window.confirm("¿Seguro que querés borrar este jugador?")) return;
    setLoading(true);
    await supabase.from("jugadores").delete().eq("id", id);
    setLoading(false);
    fetchJugadores();
  }

  function handleCopyLink() {
    const url = window.location.origin + "/?modo=jugador";
    navigator.clipboard.writeText(url);
    setCopyMsg("¡Link copiado al portapapeles!");
    setTimeout(() => setCopyMsg(""), 2000);
  }

  function handleWhatsApp() {
    const url = window.location.origin + "/?modo=jugador";
    window.open(`https://wa.me/?text=${encodeURIComponent("Entrá a votar para armar los equipos: " + url)}`, "_blank");
  }

  async function calcularPromedios() {
    let { data: votos } = await supabase.from("votos").select("votado_id, puntaje");
    let resultado = {};
    votos.forEach(({ votado_id, puntaje }) => {
      if (!resultado[votado_id]) resultado[votado_id] = [];
      resultado[votado_id].push(puntaje);
    });
    const lista = jugadores.map(jug => ({
      ...jug,
      promedio: resultado[jug.id]?.length
        ? (resultado[jug.id].reduce((a, b) => a + b, 0) / resultado[jug.id].length).toFixed(2)
        : "Sin votos"
    }));
    setPromedios(lista);
  }

  function generarEquipos() {
    const ordenados = [...promedios]
      .filter(j => j.promedio !== "Sin votos")
      .sort((a, b) => b.promedio - a.promedio);
    const equipo1 = [], equipo2 = [];
    ordenados.forEach((jug, i) => { (i % 2 === 0 ? equipo1 : equipo2).push(jug); });
    setEquipos([equipo1, equipo2]);
  }

  return (
    <div className="admin-panel-container">
      <h1 className="admin-title">Modo Participativo</h1>

      {/* Agregar jugador */}
      <form className="admin-add-row" onSubmit={agregarJugador} autoComplete="off">
        <input
          className="admin-input"
          type="text"
          value={nuevoNombre}
          onChange={e => setNuevoNombre(e.target.value)}
          placeholder="Nombre jugador"
          disabled={loading}
          ref={inputRef}
        />
        <button className="admin-add-btn" type="submit" disabled={loading}>Agregar</button>
      </form>

      {/* Listado de jugadores */}
      <div style={{ marginBottom: 22 }}>
        <h3 className="admin-list-title">
          Jugadores ({jugadores.length})
        </h3>
        <ul className="admin-jugadores-list">
          {jugadores.map(j => (
            <li className="admin-jugador-row" key={j.id}>
              <span>{j.nombre}</span>
              <button
                className="admin-delete-btn"
                onClick={() => eliminarJugador(j.id)}
              >X</button>
            </li>
          ))}
        </ul>
      </div>

      {/* Botones de compartir */}
      <div className="admin-share-row">
        <button className="admin-link-btn" onClick={handleCopyLink}>
          Copiar link para jugadores
        </button>
        <button className="admin-whatsapp-btn" onClick={handleWhatsApp}>
          Compartir por WhatsApp
        </button>
      </div>
      {copyMsg && <div className="admin-copy-msg">{copyMsg}</div>}

      {/* Votación */}
      <div className="admin-votos-status">
        Votaron <span style={{ color: "#0EA9C6" }}>{votantes.length}</span> de <span style={{ color: "#DE1C49" }}>{jugadores.length}</span>
      </div>
      {!votacionCerrada && (
        <button className="admin-cerrar-btn" onClick={async () => {
          setVotacionCerrada(true);
          await calcularPromedios();
        }}>
          Cerrar votación y ver promedios actuales
        </button>
      )}

      {votacionCerrada && (
        <>
          <h2 style={{ marginTop: 32, color: "#DE1C49" }}>Promedios</h2>
          <ul className="admin-promedios-list">
            {promedios.map(j => (
              <li className="admin-promedio-row" key={j.id}>
                {j.nombre}: <span style={{ color: "#0EA9C6" }}>{j.promedio}</span>
              </li>
            ))}
          </ul>
          <button className="admin-generar-btn" onClick={generarEquipos}>
            Generar equipos balanceados
          </button>
        </>
      )}

      {equipos.length > 0 && (
        <div className="admin-equipos-row">
          {equipos.map((equipo, idx) => (
            <div className="admin-equipo-card" key={idx}>
              <h3 className="admin-equipo-title">Equipo {idx + 1}</h3>
              <ul className="admin-equipo-list">
                {equipo.map(j => (
                  <li className="admin-equipo-jugador" key={j.id}>
                    {j.nombre} <span className="admin-equipo-promedio">({j.promedio})</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Botón volver al final */}
      <button className="admin-volver-btn" onClick={onBackToHome}>
        Volver al inicio
      </button>
    </div>
  );
}
