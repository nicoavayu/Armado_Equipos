import React, { useState } from "react";
import AutocompleteSede from "./AutocompleteSede";
import { crearPartidoFrecuente, crearPartidoDesdeFrec } from "./supabase";
import { handleError, handleSuccess, safeAsync } from "./utils/errorHandler";

export default function FormularioNuevoPartido({ onConfirmar, onVolver }) {
  const [nombrePartido, setNombrePartido] = useState("");
  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState("");
  const [sede, setSede] = useState("");
  const [sedeInfo, setSedeInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  return (
    <div className="voting-bg">
      <div className="voting-modern-card" style={{ padding: 42, maxWidth: 420 }}>
        <div className="voting-title-modern" style={{ fontSize: '32px', marginBottom: 24 }}>NUEVO PARTIDO</div>
        
        <input
          className="input-modern"
          type="text"
          placeholder="Nombre del partido"
          value={nombrePartido}
          onChange={e => setNombrePartido(e.target.value)}
          style={{ marginBottom: 22, width: "100%" }}
          required
        />

        <input
          className="input-modern"
          type="date"
          value={fecha}
          onChange={e => setFecha(e.target.value)}
          style={{ marginBottom: 22, width: "100%" }}
        />

        <input
          className="input-modern"
          type="time"
          value={hora}
          onChange={e => setHora(e.target.value)}
          style={{ marginBottom: 22, width: "100%", height: 55 }}
        />

        <AutocompleteSede
          value={sede}
          onSelect={(info) => {
            setSede(info.description);
            setSedeInfo(info);
          }}
        />

        {error && (
          <div style={{
            color: "#ff5555",
            padding: "10px",
            marginBottom: "15px",
            fontSize: "16px",
            textAlign: "center",
            background: "rgba(255,0,0,0.1)",
            borderRadius: "8px"
          }}>
            {error}
          </div>
        )}
        
        <button
          className="voting-confirm-btn"
          style={{ width: "100%", marginBottom: 12 }}
          disabled={!nombrePartido.trim() || !fecha || !hora || !sede || loading}
          onClick={async () => {
            setLoading(true);
            setError("");
            
            try {
              // Always create as frequent match
              const partidoFrecuente = await safeAsync(
                () => crearPartidoFrecuente({
                  nombre: nombrePartido.trim(),
                  sede: sede.trim(),
                  hora: hora.trim(),
                  jugadores_frecuentes: [],
                  creado_por: null,
                  dia_semana: new Date(fecha).getDay(),
                  habilitado: true,
                  creado_en: new Date().toISOString()
                }),
                'Error al crear el partido frecuente'
              );
              
              if (!partidoFrecuente) {
                setError("No se pudo crear el partido");
                return;
              }
              
              // Create regular match from frequent match
              const partido = await safeAsync(
                () => crearPartidoDesdeFrec(partidoFrecuente, fecha),
                'Error al crear el partido'
              );
              
              if (!partido) {
                setError("No se pudo crear el partido");
                return;
              }
              
              // Mark this match as created from a frequent match
              partido.from_frequent_match_id = partidoFrecuente.id;
              
              await onConfirmar(partido);
              handleSuccess('Partido creado correctamente');
              
            } catch (err) {
              setError(err.message || "Error al procesar la solicitud");
            } finally {
              setLoading(false);
            }
          }}
        >
          {loading ? "CREANDO..." : "CREAR PARTIDO"}
        </button>
        
        <button
          className="voting-confirm-btn wipe-btn"
          style={{ width: "100%", background: '#DE1C49' }}
          onClick={onVolver}
          disabled={loading}
        >
          VOLVER AL INICIO
        </button>
      </div>
    </div>
  );
}