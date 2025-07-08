import React, { useState, useEffect, useRef } from "react";
import {
  addJugador,
  deleteJugador,
  getJugadores,
  closeVotingAndCalculateScores,
    updateJugadoresPartido,
  getVotantesIds,
  
} from "./supabase";
import { toast } from 'react-toastify';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import "./HomeStyleKit.css";
import "./AdminPanel.css";
import WhatsappIcon from "./components/WhatsappIcon";
import TeamDisplay from "./components/TeamDisplay";
import PartidoInfoBox from "./PartidoInfoBox";

function MiniAvatar({ foto_url, nombre, size = 34 }) {
  if (foto_url) {
    return (
      <LazyLoadImage
        alt={nombre}
        src={foto_url}
        effect="blur"
        width={size}
        height={size}
        className="mini-avatar"
      />
    );
  }
  return <div className="mini-avatar-placeholder" style={{ width: size, height: size }} />;
}

export default function AdminPanel({ onBackToHome, jugadores, onJugadoresChange, partidoActual }) {
  const [votantes, setVotantes] = useState([]);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [addFrecuente, setAddFrecuente] = useState(false);
  const [jugadoresFrecuentes, setJugadoresFrecuentes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [copyMsg, setCopyMsg] = useState("");
  const [showTeamView, setShowTeamView] = useState(false);

  const [teams, setTeams] = useState([
    { id: "equipoA", name: "Equipo A", players: [], score: 0 },
    { id: "equipoB", name: "Equipo B", players: [], score: 0 },
  ]);
  const inputRef = useRef();

  // 🟢 Si jugadores viene undefined o null, usá array vacío
  jugadores = jugadores || [];
  if (!Array.isArray(jugadores)) jugadores = [];

  useEffect(() => {
    async function fetchVotantes() {
      try {
        const votantesIds = await getVotantesIds();
        setVotantes(votantesIds || []);
      } catch (error) {
        toast.error("Error cargando votantes: " + error.message);
      }
    }
    fetchVotantes();
  }, []);

  async function agregarJugador(e) {
    e.preventDefault();
    const nombre = nuevoNombre.trim();
    if (!nombre) return;
    if (jugadores.some(j => j.nombre.toLowerCase() === nombre.toLowerCase())) {
      toast.warn("Este jugador ya existe.");
      return;
    }
    setLoading(true);
    try {
      // 🔥 1. Crear el jugador en la tabla jugadores de Supabase
      const nuevoJugador = await addJugador(nombre);

      // 🔥 2. Agregarlo al array de jugadores del partido (usando el que vuelve de Supabase)
      const nuevosJugadores = [...jugadores, nuevoJugador];
      await updateJugadoresPartido(partidoActual.id, nuevosJugadores);
      onJugadoresChange(nuevosJugadores);

      // Si está tildado "Agregar a jugadores frecuentes", agregalo al panel
      if (addFrecuente && !jugadoresFrecuentes.some(j => j.uuid === nuevoJugador.uuid)) {
        setJugadoresFrecuentes(prev => [...prev, nuevoJugador]);
      }

      setNuevoNombre("");
      setAddFrecuente(false);
      setTimeout(() => inputRef.current?.focus(), 10);
    } catch (error) {
      toast.error("Error agregando jugador: " + error.message);
    } finally {
      setLoading(false);
    }
  }

  async function eliminarJugador(uuid) {
    setLoading(true);
    try {
      await deleteJugador(uuid);
      const nuevosJugadores = jugadores.filter(j => j.uuid !== uuid);
      await updateJugadoresPartido(partidoActual.id, nuevosJugadores);
      onJugadoresChange(nuevosJugadores);

      // Si estaba en jugadores frecuentes, quitálo del panel también
      setJugadoresFrecuentes(prev => prev.filter(j => j.uuid !== uuid));
    } catch (error) {
      toast.error("Error eliminando jugador: " + error.message);
    } finally {
      setLoading(false);
    }
  }

  // Quitar jugador del panel de frecuentes (solo del panel, no del partido)
  function quitarDeFrecuentes(uuid) {
    setJugadoresFrecuentes(prev => prev.filter(j => j.uuid !== uuid));
  }

  // Equipos, igual que tu lógica actual
  function armarEquipos(jugadores) {
    const jugadoresOrdenados = [...jugadores].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const equipoA = [];
    const equipoB = [];
    let puntajeA = 0;
    let puntajeB = 0;

    jugadoresOrdenados.forEach(jugador => {
      if (equipoA.length < equipoB.length) {
        equipoA.push(jugador.uuid);
        puntajeA += jugador.score ?? 0;
      } else if (equipoB.length < equipoA.length) {
        equipoB.push(jugador.uuid);
        puntajeB += jugador.score ?? 0;
      } else {
        if (puntajeA <= puntajeB) {
          equipoA.push(jugador.uuid);
          puntajeA += jugador.score ?? 0;
        } else {
          equipoB.push(jugador.uuid);
          puntajeB += jugador.score ?? 0;
        }
      }
    });

    return [
      { id: "equipoA", name: "Equipo A", players: equipoA, score: puntajeA },
      { id: "equipoB", name: "Equipo B", players: equipoB, score: puntajeB },
    ];
  }

  const safeSetTeams = (newTeams) => {
    if (!Array.isArray(newTeams)) return;
    let equipoA = newTeams.find(t => t && t.id === 'equipoA');
    let equipoB = newTeams.find(t => t && t.id === 'equipoB');
    if (!equipoA) equipoA = { id: "equipoA", name: "Equipo A", players: [], score: 0 };
    if (!equipoB) equipoB = { id: "equipoB", name: "Equipo B", players: [], score: 0 };
    setTeams([equipoA, equipoB]);
  };

  const handleTeamsChange = (newTeams) => {
    safeSetTeams(newTeams);
  };

  async function handleCerrarVotacion() {
    if (jugadores.length % 2 !== 0) {
      toast.error("¡La cantidad de jugadores debe ser PAR para armar equipos!");
      return;
    }
    if (!window.confirm("¿Estás seguro de que querés cerrar la votación y armar los equipos?")) {
      return;
    }
    setIsClosing(true);
    try {
      const result = await closeVotingAndCalculateScores();
      const jugadoresConPromedio = await getJugadores();
      const equiposArmados = armarEquipos(
        jugadoresConPromedio.filter(j => partidoActual.jugadores.some(pj => pj.uuid === j.uuid))
      );
      safeSetTeams(equiposArmados);
      setShowTeamView(true);
      toast.success(result.message);
      onJugadoresChange(
        jugadoresConPromedio.filter(j => partidoActual.jugadores.some(pj => pj.uuid === j.uuid))
      );
    } catch (error) {
      toast.error("Error al cerrar la votación: " + error.message);
    } finally {
      setIsClosing(false);
    }
  }

  function handleCopyLink() {
    const url = `${window.location.origin}/?codigo=${partidoActual.codigo}`;
    navigator.clipboard.writeText(url);
    setCopyMsg("¡Link copiado!");
    setTimeout(() => setCopyMsg(""), 1700);
  }

  function handleWhatsApp() {
    const url = `${window.location.origin}/?codigo=${partidoActual.codigo}`;
    window.open(`https://wa.me/?text=${encodeURIComponent("Entrá a votar para armar los equipos: " + url)}`, "_blank");
  }

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 700);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 700);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const jugadoresPorColumna = isMobile
    ? [jugadores]
    : [
        jugadores.slice(0, Math.ceil(jugadores.length / 2)),
        jugadores.slice(Math.ceil(jugadores.length / 2)),
      ];

  const ActionButtons = () => (
    <>
      <div style={{ height: 5 }} />
      <div className="admin-actions-row" style={{marginTop: 0, marginBottom: 0}}>
        <button className="voting-confirm-btn wipe-btn btn-link" onClick={handleCopyLink}>
          LINK PARA JUGADORES
        </button>
        <button className="voting-confirm-btn wipe-btn btn-whatsapp" onClick={handleWhatsApp}>
          <WhatsappIcon />
          WHATSAPP
        </button>
      </div>
      <div className="admin-actions-row" style={{marginTop: 18, marginBottom: 0}}>
        <button className="voting-confirm-btn wipe-btn btn-cerrar" onClick={handleCerrarVotacion} disabled={isClosing}>
          {isClosing ? "CERRANDO..." : "CERRAR VOTACIÓN Y ARMAR EQUIPOS"}
        </button>
        <button className="voting-confirm-btn wipe-btn btn-volver" onClick={onBackToHome}>
          VOLVER AL INICIO
        </button>
      </div>
      {copyMsg && (
        <div className="admin-copy-msg-toast">{copyMsg}</div>
      )}
    </>
  );

  const showTeams =
    showTeamView &&
    Array.isArray(teams) &&
    teams.length === 2 &&
    teams.find(t => t.id === "equipoA") &&
    teams.find(t => t.id === "equipoB");

  if (!partidoActual) return <div style={{color:"red"}}>Sin partido cargado</div>;

  return (
    <div className="voting-bg">
      <div className="admin-panel-content">
        {showTeams ? (
          <TeamDisplay
            teams={teams}
            players={jugadores}
            onTeamsChange={handleTeamsChange}
            onBackToHome={onBackToHome}
          />
        ) : (
          <>
            <div className="voting-title-modern">MODO PARTICIPATIVO</div>

            {/* BLOQUE CÓDIGO DEL PARTIDO */}
            {partidoActual.codigo && (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                background: "rgba(30,28,54,0.87)", color: "#fff", fontWeight: 600,
                borderRadius: 16, padding: "14px 22px", marginBottom: 24, fontSize: 19
              }}>
                <div>
                  <span style={{ fontWeight: 700, letterSpacing: 1.5 }}>CÓDIGO DEL PARTIDO:</span>
                  <span style={{ fontSize: 22, marginLeft: 13, fontFamily: "monospace" }}>{partidoActual.codigo}</span>
                </div>
                <button
                  style={{
                    background: "#0ea9c6", color: "#fff", border: "none",
                    borderRadius: 8, padding: "8px 16px", fontWeight: 700,
                    marginLeft: 16, cursor: "pointer"
                  }}
                  onClick={() => {
                    navigator.clipboard.writeText(partidoActual.codigo);
                    toast.success("¡Código copiado!");
                  }}
                >
                  COPIAR
                </button>
              </div>
            )}

            {/* PartidoInfoBox SOLO UNA VEZ, justo acá */}
            {partidoActual && <PartidoInfoBox partido={partidoActual} />}

            {/* resto del contenido */}
            <div className="admin-add-player-container dark-container" style={{ margin: "0 auto", maxWidth: 620, display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 32 }}>
              {/* FORMULARIO DE AGREGAR JUGADOR */}
              <form className="admin-add-form" onSubmit={agregarJugador} autoComplete="off" style={{ flex: 1 }}>
                <input
                  className="input-modern"
                  type="text"
                  value={nuevoNombre}
                  onChange={e => setNuevoNombre(e.target.value)}
                  placeholder="nombre jugador"
                  disabled={loading}
                  ref={inputRef}
                  maxLength={40}
                  required
                />
                <label style={{ marginTop: 10, display: "flex", alignItems: "center", fontSize: 15 }}>
                  <input
                    type="checkbox"
                    checked={addFrecuente}
                    onChange={e => setAddFrecuente(e.target.checked)}
                    style={{ marginRight: 7 }}
                  />
                  Agregar a jugadores frecuentes
                </label>
                <button
                  className="voting-confirm-btn wipe-btn"
                  type="submit"
                  disabled={loading || isClosing}
                  style={{ marginTop: 8 }}
                >
                  AGREGAR
                </button>
              </form>
              {/* PANEL LATERAL DE JUGADORES FRECUENTES */}
              <div className="panel-frecuentes" style={{
                borderLeft: "2px solid #eee",
                paddingLeft: 16,
                minWidth: 180,
                maxWidth: 230,
                background: "#fcfcfc",
                borderRadius: 16,
                boxShadow: "0 0 6px rgba(0,0,0,0.06)",
                minHeight: 130
              }}>
                <h4 style={{ margin: "8px 0 8px 0", fontSize: 18 }}>Frecuentes</h4>
                {jugadoresFrecuentes.length === 0 ? (
                  <div style={{ color: "#aaa", fontSize: 14 }}>Ninguno aún</div>
                ) : (
                  <ul style={{ paddingLeft: 12, margin: 0 }}>
                    {jugadoresFrecuentes.map(j => (
                      <li key={j.uuid} style={{ display: "flex", alignItems: "center", marginBottom: 7 }}>
                        <span style={{ marginRight: 8 }}>
                          <MiniAvatar foto_url={j.foto_url} nombre={j.nombre} size={22} />
                        </span>
                        <span style={{ flex: 1, fontSize: 15 }}>{j.nombre}</span>
                        <button
                          onClick={() => quitarDeFrecuentes(j.uuid)}
                          style={{
                            border: "none",
                            background: "transparent",
                            color: "#e85042",
                            fontSize: 18,
                            cursor: "pointer",
                            marginLeft: 6,
                            fontWeight: 700,
                            lineHeight: 1,
                          }}
                          title="Quitar de frecuentes"
                        >×</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="admin-list-container" style={{ margin: "24px auto 0 auto", maxWidth: 600 }}>
              <div className="admin-list-title">
                JUGADORES ({jugadores.length})
              </div>
              <div className="admin-jugadores-grid">
                {jugadoresPorColumna.map((col, idx) => (
                  <div key={idx} className="admin-jugadores-col">
                    {col.map(j => (
                      <div
                        key={j.uuid}
                        className={`admin-jugador-box${votantes.includes(j.uuid) ? " votado" : ""}`}
                      >
                        <MiniAvatar foto_url={j.foto_url} nombre={j.nombre} size={29} />
                        <span className="admin-jugador-nombre">{j.nombre}</span>
                        <button
                          className="remove-btn"
                          onClick={() => eliminarJugador(j.uuid)}
                          type="button"
                          aria-label="Eliminar jugador"
                          disabled={isClosing}
                        >
                          X
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ margin: "32px auto 0 auto", maxWidth: 600 }}>
              <ActionButtons />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
