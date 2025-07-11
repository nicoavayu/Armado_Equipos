import React, { useEffect, useState } from "react";
import { getPartidosFrecuentes, eliminarPartidoFrecuente } from "./supabase";
import './FrecuentesStyle.css';

const DIAS = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export default function ElegirPartidoFrecuente({ onElegir, onCancelar }) {
  const [partidos, setPartidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [eliminando, setEliminando] = useState(null);

  useEffect(() => {
    fetchFrecuentes();
    // eslint-disable-next-line
  }, []);

  async function fetchFrecuentes() {
    setLoading(true);
    try {
      const data = await getPartidosFrecuentes();
      setPartidos(data || []);
    } catch (e) {
      setPartidos([]);
    }
    setLoading(false);
  }

  const handleEliminar = async (id) => {
    if (!window.confirm("¿Seguro que querés eliminar este partido frecuente?")) return;
    setEliminando(id);
    try {
      await eliminarPartidoFrecuente(id);
      await fetchFrecuentes();
    } catch (err) {
      alert("No se pudo eliminar. " + (err.message || ""));
    }
    setEliminando(null);
  };

  // Saca sólo el nombre corto del lugar (antes de la coma)
  function cortaLugar(str) {
    if (!str) return '';
    return str.split(",")[0];
  }

  if (loading) return (
    <div className="voting-modern-card" style={{ maxWidth: 700, minHeight: 200 }}>
      Cargando partidos frecuentes...
    </div>
  );

  if (!partidos.length) return (
    <div className="voting-modern-card" style={{ maxWidth: 700 }}>
      <div style={{ marginBottom: 18 }}>No hay partidos frecuentes guardados.</div>
      <button className="voting-confirm-btn" onClick={onCancelar}>Volver</button>
    </div>
  );

  return (
    <div className="voting-modern-card" style={{ maxWidth: 800, padding: "28px 18px 20px 18px" }}>
      <div style={{
        fontWeight: 700, fontSize: 28, marginBottom: 26, letterSpacing: 1, color: "#fff",
        fontFamily: "'Bebas Neue', Arial, sans-serif", textAlign: "center"
      }}>
        Elegí un partido frecuente
      </div>
      <div className="frecuentes-grid">
        {partidos.map(p => (
          <div className="frecuente-card" key={p.id}>
            <div className="frecuente-main-row">
              {/* Imagen del partido frecuente (predeterminada si no hay) */}
              <div className="frecuente-img-wrap">
                <img
                  src={p.imagen || "/img/partido-default.png"}
                  alt=""
                  className="frecuente-img"
                />
              </div>
              <div className="frecuente-data-col">
                <div className="frecuente-meta">
                  {`${DIAS[p.dia_semana] || ""}${p.hora ? `, ${p.hora}` : ""}${p.sede ? `, ${cortaLugar(p.sede)}` : ""}`}
                </div>
                <div className="frecuente-header-row">
                  <span className="frecuente-title">{p.nombre}</span>
                  <div className="frecuente-btns-inline">
                    <button
                      className="frecuente-edit-btn"
                      onClick={() => onElegir(p)}
                    >
                      Editar
                    </button>
                    <button
                      className="frecuente-del-btn"
                      disabled={eliminando === p.id}
                      onClick={() => handleEliminar(p.id)}
                      title="Eliminar partido frecuente"
                      tabIndex={-1}
                      aria-label="Eliminar"
                      style={{ marginLeft: 4 }}
                    >
                      {eliminando === p.id ? (
                        <span style={{ fontSize: 14, fontWeight: 600 }}>...</span>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <path d="M3.6 3.6L12.4 12.4M12.4 3.6L3.6 12.4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <button
        className="voting-confirm-btn"
        style={{ marginTop: 22, background: "#aaa", color: "#fff", fontSize: 22, minWidth: 180 }}
        onClick={onCancelar}
      >
        Cancelar
      </button>
    </div>
  );
}
