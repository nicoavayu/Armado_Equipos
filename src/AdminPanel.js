// src/AdminPanel.js

import React, { useState, useEffect, useRef } from "react";
import {
  getJugadores,
  addJugador,
  deleteJugador,
  getVotantesIds,
  closeVotingAndCalculateScores,
} from "./supabase";
import { toast } from 'react-toastify';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import "./HomeStyleKit.css";
import "./AdminPanel.css";
import WhatsappIcon from "./components/WhatsappIcon";
import TeamDisplay from "./components/TeamDisplay";

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

export default function AdminPanel({ onBackToHome, jugadores, onJugadoresChange }) {
  const [votantes, setVotantes] = useState([]);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [loading, setLoading] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [copyMsg, setCopyMsg] = useState("");
  const [showTeamView, setShowTeamView] = useState(false);

  // SIEMPRE inicializá con ambos equipos (ids fijos)
  const [teams, setTeams] = useState([
    { id: "equipoA", name: "Equipo A", players: [], score: 0 },
    { id: "equipoB", name: "Equipo B", players: [], score: 0 },
  ]);
  const inputRef = useRef();

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
      const nuevoJugador = await addJugador(nombre);
      onJugadoresChange([...jugadores, nuevoJugador]);
      setNuevoNombre("");
      inputRef.current?.blur();
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
      onJugadoresChange(jugadores.filter(j => j.uuid !== uuid));
    } catch (error) {
      toast.error("Error eliminando jugador: " + error.message);
    } finally {
      setLoading(false);
    }
  }

  function armarEquipos(jugadores) {
    const jugadoresOrdenados = [...jugadores].sort((a, b) => b.score - a.score);
    const equipoA = [];
    const equipoB = [];
    let puntajeA = 0;
    let puntajeB = 0;
    jugadoresOrdenados.forEach(jugador => {
      if (puntajeA <= puntajeB) {
        equipoA.push(jugador.uuid);
        puntajeA += jugador.score;
      } else {
        equipoB.push(jugador.uuid);
        puntajeB += jugador.score;
      }
    });
    return [
      { id: "equipoA", name: "Equipo A", players: equipoA, score: puntajeA },
      { id: "equipoB", name: "Equipo B", players: equipoB, score: puntajeB },
    ];
  }

  // Wrapper seguro para setTeams
  const safeSetTeams = (newTeams) => {
    if (!Array.isArray(newTeams)) return;
    let equipoA = newTeams.find(t => t && t.id === 'equipoA');
    let equipoB = newTeams.find(t => t && t.id === 'equipoB');
    if (!equipoA) equipoA = { id: "equipoA", name: "Equipo A", players: [], score: 0 };
    if (!equipoB) equipoB = { id: "equipoB", name: "Equipo B", players: [], score: 0 };
    setTeams([equipoA, equipoB]);
  };

  // Reemplaza todos los setTeams y onTeamsChange por safeSetTeams
  // En handleTeamsChange:
  const handleTeamsChange = (newTeams) => {
    safeSetTeams(newTeams);
  };

  // En handleCerrarVotacion:
  async function handleCerrarVotacion() {
    if (!window.confirm("¿Estás seguro de que querés cerrar la votación y armar los equipos?")) {
      return;
    }
    setIsClosing(true);
    try {
      const result = await closeVotingAndCalculateScores();
      const jugadoresConPromedio = await getJugadores();
      const equiposArmados = armarEquipos(jugadoresConPromedio);
      safeSetTeams(equiposArmados);
      setShowTeamView(true);
      toast.success(result.message);
    } catch (error) {
      toast.error("Error al cerrar la votación: " + error.message);
    } finally {
      setIsClosing(false);
    }
  }

  function handleCopyLink() {
    const url = `${window.location.origin}/?modo=jugador`;
    navigator.clipboard.writeText(url);
    setCopyMsg("¡Link copiado!");
    setTimeout(() => setCopyMsg(""), 1700);
  }

  function handleWhatsApp() {
    const url = `${window.location.origin}/?modo=jugador`;
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
      <div className="admin-actions-row">
        <button className="voting-confirm-btn wipe-btn btn-link" onClick={handleCopyLink}>
          LINK PARA JUGADORES
        </button>
        <button className="voting-confirm-btn wipe-btn btn-whatsapp" onClick={handleWhatsApp}>
          <WhatsappIcon />
          WHATSAPP
        </button>
        <button className="voting-confirm-btn wipe-btn btn-cerrar" onClick={handleCerrarVotacion} disabled={isClosing}>
          {isClosing ? "CERRANDO..." : "CERRAR VOTACIÓN Y ARMAR EQUIPOS"}
        </button>
        <button className="voting-confirm-btn wipe-btn btn-volver" onClick={onBackToHome}>
          VOLVER AL INICIO
        </button>
      </div>
      {copyMsg && <div className="admin-copy-msg">{copyMsg}</div>}
    </>
  );

  // 👇 FIX DEFINITIVO: Solo muestra TeamDisplay si hay dos equipos bien formados
  const showTeams =
    showTeamView &&
    Array.isArray(teams) &&
    teams.length === 2 &&
    teams.find(t => t.id === "equipoA") &&
    teams.find(t => t.id === "equipoB");

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
            <div className="admin-main-grid">
              <div>
                <div className="admin-subtitle">Ingresa tus jugadores</div>
                <div className="admin-add-player-container dark-container">
                  <form className="admin-add-form" onSubmit={agregarJugador} autoComplete="off">
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
                    <button
                      className="voting-confirm-btn wipe-btn"
                      type="submit"
                      disabled={loading || isClosing}
                    >
                      AGREGAR
                    </button>
                  </form>
                </div>
                {!isMobile && <ActionButtons />}
              </div>

              <div className="admin-list-container">
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
              {isMobile && <ActionButtons />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
