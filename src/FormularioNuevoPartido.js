import React, { useState } from "react";
import AutocompleteSede from "./AutocompleteSede";
import { crearPartidoFrecuente } from "./supabase"; // Importá la función

export default function FormularioNuevoPartido({ onConfirmar, jugadoresFrecuentes }) {
  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState("");
  const [sede, setSede] = useState("");
  const [sedeInfo, setSedeInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Para partido frecuente
  const [guardarComoFrecuente, setGuardarComoFrecuente] = useState(false);
  const [nombreFrecuente, setNombreFrecuente] = useState("");

  return (
    <div className="voting-bg">
      <div className="voting-modern-card" style={{ padding: 42, maxWidth: 420 }}>
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

        {/* NUEVO: Guardar como partido frecuente */}
        <label style={{ display: "flex", alignItems: "center", margin: "20px 0 6px 0" }}>
          <input
            type="checkbox"
            checked={guardarComoFrecuente}
            onChange={e => setGuardarComoFrecuente(e.target.checked)}
            style={{ marginRight: 8 }}
          />
          Guardar como partido frecuente
        </label>
        {guardarComoFrecuente && (
          <input
            className="input-modern"
            type="text"
            placeholder="Nombre del partido frecuente"
            value={nombreFrecuente}
            onChange={e => setNombreFrecuente(e.target.value)}
            style={{ marginBottom: 14, width: "100%" }}
          />
        )}

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
          style={{ width: "100%" }}
          disabled={!fecha || !hora || !sede || loading}
          onClick={async () => {
            try {
              setLoading(true);
              setError("");
              await onConfirmar({
                fecha,
                hora,
                sede,
                sedeMaps: sedeInfo,
              });

              // LÓGICA NUEVA PARA FRECUENTES:
              if (
                guardarComoFrecuente &&
                nombreFrecuente &&
                jugadoresFrecuentes &&
                jugadoresFrecuentes.length > 0
              ) {
                const diaSemana = new Date(fecha).getDay();
                await crearPartidoFrecuente({
                  nombre: nombreFrecuente,
                  dia_semana: diaSemana,
                  hora,
                  sede,
                  jugadores_frecuentes: jugadoresFrecuentes,
                  creado_por: null // o el uuid del user si tenés auth
                });
                // Mensaje opcional
                // toast.success("¡Plantilla frecuente guardada!");
              }
            } catch (err) {
              setError("Error al crear el partido: " + (err.message || "Intenta nuevamente"));
              console.error("Error creating match:", err);
            } finally {
              setLoading(false);
            }
          }}
        >
          {loading ? "Creando..." : "Confirmar"}
        </button>
      </div>
    </div>
  );
}
