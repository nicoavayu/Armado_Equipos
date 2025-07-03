import "./AdminPanel.css";
import React, { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";

// Componente Avatar miniatura (foto o random)
function MiniAvatar({ foto_url, nombre, size = 34 }) {
  const url = foto_url
    ? foto_url
    : `https://api.dicebear.com/6.x/pixel-art/svg?seed=${encodeURIComponent(nombre)}`;
  return (
    <img
      src={url}
      alt={nombre}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        objectFit: "cover",
        border: "1.5px solid #eceaf1",
        background: "#fafafc",
        marginRight: 10,
      }}
    />
  );
}

// Canchita simple con los equipos y nombres editables
function Canchita({ equipos, equipoNames, onEquipoNameChange }) {
  return (
    <div style={{
      width: "100%",
      maxWidth: 480,
      margin: "40px auto 0 auto",
      background: "#eaf6fa",
      borderRadius: 24,
      border: "2px solid #0EA9C6",
      padding: 28,
      position: "relative",
      minHeight: 330,
      boxShadow: "0 3px 22px rgba(34,40,80,0.12)"
    }}>
      {/* Línea central */}
      <div style={{
        position: "absolute", left: "50%", top: 10, bottom: 10, width: 4,
        background: "#0EA9C6", borderRadius: 2, transform: "translateX(-2px)", opacity: 0.13
      }}></div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: 260 }}>
        {equipos.map((equipo, idx) => (
          <div key={idx} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
            <input
              style={{
                color: "#0EA9C6", fontWeight: 800, fontSize: 16, marginBottom: 7,
                textAlign: "center", background: "#fff", border: "1px solid #bbb",
                borderRadius: 8, padding: "4px 6px", width: 110
              }}
              value={equipoNames[idx]}
              onChange={e => onEquipoNameChange(idx, e.target.value)}
              maxLength={18}
            />
            {equipo.map(j => (
              <div key={j.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "#fff", borderRadius: 12, padding: "7px 14px", boxShadow: "0 1px 8px #0001"
              }}>
                <MiniAvatar foto_url={j.foto_url} nombre={j.nombre} size={32} />
                <span style={{ fontWeight: 700 }}>{j.nombre}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* Puntaje total abajo */}
      <div style={{
        position: "absolute", bottom: 10, left: 0, right: 0,
        display: "flex", justifyContent: "space-between", padding: "0 25px"
      }}>
        {equipos.map((equipo, idx) => (
          <span key={idx} style={{ color: "#DE1C49", fontWeight: 700, fontSize: 15 }}>
            Puntaje equipo: {equipo.reduce((a, j) => a + Number(j.promedio), 0).toFixed(2)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function AdminPanel({ onBackToHome }) {
  const [jugadores, setJugadores] = useState([]);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [copyMsg, setCopyMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [votantes, setVotantes] = useState([]);
  const [votacionCerrada, setVotacionCerrada] = useState(false);
  const [promedios, setPromedios] = useState([]);
  const [equipos, setEquipos] = useState([]);
  const [equiposError, setEquiposError] = useState("");
  const [mostrarPromedios, setMostrarPromedios] = useState(false);
  const [equipoNames, setEquipoNames] = useState(["Equipo 1", "Equipo 2"]);
  const inputRef = useRef();

  // --- VOTOS Y PROMEDIOS EN VIVO ---
  useEffect(() => {
    async function fetchAll() {
      // Jugadores
      let { data: jugadoresDb } = await supabase
        .from("jugadores")
        .select("id, nombre, foto_url")
        .order("nombre", { ascending: true });
      setJugadores(jugadoresDb || []);
      // Votos
      let { data: votos } = await supabase
        .from("votos")
        .select("votante_id, votado_id, puntaje");
      // Votantes (Ajuste: ids a string para comparar bien)
      const ids = Array.from(new Set((votos || []).map(v => String(v.votante_id))));
      setVotantes(ids);
      // Promedios
      let resultado = {};
      votos.forEach(({ votado_id, puntaje }) => {
        if (!resultado[votado_id]) resultado[votado_id] = [];
        resultado[votado_id].push(puntaje);
      });
      const lista = (jugadoresDb || []).map(jug => {
        const votosJugador = resultado[jug.id] || [];
        let promedio;
        if (votosJugador.length === 0) {
          promedio = 5;
        } else {
          promedio = (votosJugador.reduce((a, b) => a + b, 0) / votosJugador.length);
        }
        return {
          ...jug,
          promedio: promedio.toFixed(2),
          foto_url: jug.foto_url,
        }
      });
      setPromedios(lista);
    }
    fetchAll();
    const interval = setInterval(fetchAll, 2000); // Más frecuente para testear!
    return () => clearInterval(interval);
  }, []);

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
  }

  async function eliminarJugador(id) {
    if (!window.confirm("¿Seguro que querés borrar este jugador?")) return;
    setLoading(true);
    await supabase.from("jugadores").delete().eq("id", id);
    setLoading(false);
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

  // Generación de equipos balanceados por promedio (no random)
  function generarEquipos() {
    setEquiposError("");
    const jugadoresTodos = [...promedios].map(j => ({
      ...j,
      promedioNum: Number(j.promedio)
    }));

    if (jugadoresTodos.length % 2 !== 0) {
      setEquipos([]);
      setEquiposError("Solamente podés generar equipos cuando haya cantidad PAR de jugadores.");
      return;
    }

    jugadoresTodos.sort((a, b) => b.promedioNum - a.promedioNum);

    let equipo1 = [], equipo2 = [];
    let sum1 = 0, sum2 = 0;

    for (const jugador of jugadoresTodos) {
      if (equipo1.length < jugadoresTodos.length / 2 && (sum1 <= sum2 || equipo2.length >= jugadoresTodos.length / 2)) {
        equipo1.push(jugador);
        sum1 += jugador.promedioNum;
      } else {
        equipo2.push(jugador);
        sum2 += jugador.promedioNum;
      }
    }
    setEquipos([equipo1, equipo2]);
  }

  // Botón para randomizar equipos (con máxima diferencia de 5 puntos)
  function randomizarEquipos() {
    setEquiposError("");
    const jugadoresTodos = [...promedios].map(j => ({
      ...j,
      promedioNum: Number(j.promedio)
    }));

    if (jugadoresTodos.length % 2 !== 0) {
      setEquipos([]);
      setEquiposError("Solamente podés generar equipos cuando haya cantidad PAR de jugadores.");
      return;
    }

    const N = jugadoresTodos.length / 2;
    let mejorDiff = Infinity;
    let mejorEquipos = null;

    for (let intento = 0; intento < 1000; intento++) {
      const shuffled = jugadoresTodos.slice().sort(() => Math.random() - 0.5);
      const equipo1 = shuffled.slice(0, N);
      const equipo2 = shuffled.slice(N);

      const sum1 = equipo1.reduce((a, j) => a + j.promedioNum, 0);
      const sum2 = equipo2.reduce((a, j) => a + j.promedioNum, 0);
      const diff = Math.abs(sum1 - sum2);

      if (diff <= 5) {
        setEquipos([equipo1, equipo2]);
        return;
      }
      if (diff < mejorDiff) {
        mejorDiff = diff;
        mejorEquipos = [equipo1, equipo2];
      }
    }
    setEquipos(mejorEquipos);
    setEquiposError("No se pudo lograr una diferencia menor o igual a 5 puntos. Diferencia mínima encontrada: " + mejorDiff.toFixed(2));
  }

  // Handler para editar los nombres de equipos
  function handleEquipoNameChange(idx, value) {
    setEquipoNames(prev => {
      const nuevo = [...prev];
      nuevo[idx] = value;
      return nuevo;
    });
  }

  // Calcular quiénes faltan votar (Ajuste: comparar siempre string)
  const jugadoresQueFaltanVotar = jugadores.filter(j => !votantes.includes(String(j.id)));

  // Handler para compartir equipos por WhatsApp
  function compartirEquiposWhatsapp() {
    if (!equipos.length) return;
    let text = "Equipos generados:\n";
    equipos.forEach((equipo, idx) => {
      text += `\n${equipoNames[idx] || `Equipo ${idx + 1}`}:`;
      equipo.forEach(j => {
        text += `\n- ${j.nombre}`;
      });
      text += `\n(Puntaje: ${equipo.reduce((a, j) => a + Number(j.promedio), 0).toFixed(2)})\n`;
    });
    const url = "https://wa.me/?text=" + encodeURIComponent(text);
    window.open(url, "_blank");
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
              <MiniAvatar foto_url={j.foto_url} nombre={j.nombre} size={32} />
              <span>
                {j.nombre}
                {votantes.includes(String(j.id)) && <span style={{ color: "#0EA9C6", fontWeight: 600, marginLeft: 8 }}>✓ Votó</span>}
              </span>
              <button
                className="admin-delete-btn"
                onClick={() => eliminarJugador(j.id)}
              >X</button>
            </li>
          ))}
        </ul>
        {/* Mostrar quiénes faltan votar */}
        {jugadores.length > 0 && (
          <div style={{ color: "#DE1C49", fontWeight: 700, marginTop: 8 }}>
            {votantes.length === jugadores.length
              ? "¡Ya votaron todos!"
              : <>
                  Faltan votar:{" "}
                  {jugadoresQueFaltanVotar.map(j => j.nombre).join(", ")}
                </>
            }
          </div>
        )}
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
      {/* El botón de cerrar ahora solo es "marcar", pero siempre ves en vivo */}
      {!votacionCerrada && (
        <button className="admin-cerrar-btn" onClick={() => setVotacionCerrada(true)}>
          Cerrar votación y ver promedios actuales
        </button>
      )}

      {votacionCerrada && (
        <>
          <button
            className="admin-mostrar-promedios-btn"
            style={{ marginTop: 28, marginBottom: 0, background: "#b2b2af", color: "#fff", fontWeight: 700, borderRadius: 10, padding: "12px 28px", border: "none", fontSize: 18, cursor: "pointer" }}
            onClick={() => setMostrarPromedios(prev => !prev)}
          >
            {mostrarPromedios ? "Ocultar promedios" : "Mostrar promedios"}
          </button>
          {mostrarPromedios && (
            <>
              <h2 style={{ marginTop: 18, color: "#DE1C49" }}>Promedios</h2>
              <ul className="admin-promedios-list">
                {promedios.map(j => (
                  <li className="admin-promedio-row" key={j.id}>
                    <MiniAvatar foto_url={j.foto_url} nombre={j.nombre} size={28} />
                    {j.nombre}: <span style={{ color: "#0EA9C6" }}>{j.promedio}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div style={{ display: "flex", gap: 18, marginTop: 30 }}>
            <button className="admin-generar-btn" onClick={generarEquipos}>
              Generar equipos balanceados
            </button>
            <button className="admin-generar-btn" style={{ background: "#DE1C49", color: "#fff" }} onClick={randomizarEquipos}>
              Randomizar equipos
            </button>
          </div>
        </>
      )}

      {equiposError && (
        <div style={{ color: "#DE1C49", fontWeight: 700, margin: "14px 0 0 0", textAlign: "center" }}>
          {equiposError}
        </div>
      )}

      {equipos.length > 0 && (
        <>
          <Canchita equipos={equipos} equipoNames={equipoNames} onEquipoNameChange={handleEquipoNameChange} />
          <div style={{ textAlign: "center", margin: "32px 0 20px 0" }}>
            <button
              className="admin-share-equipos-btn"
              style={{
                padding: "13px 34px", background: "#25D366", color: "#fff",
                border: "none", borderRadius: 18, fontWeight: 800,
                fontSize: 19, cursor: "pointer", letterSpacing: 1
              }}
              onClick={compartirEquiposWhatsapp}
            >
              Compartir equipos por WhatsApp
            </button>
          </div>
        </>
      )}

      {/* Botón volver al final */}
      <button className="admin-volver-btn" onClick={onBackToHome}>
        Volver al inicio
      </button>
    </div>
  );
}
