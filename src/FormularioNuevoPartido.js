import React, { useState } from "react";
import AutocompleteSede from "./AutocompleteSede";

export default function FormularioNuevoPartido({ onConfirmar }) {
  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState("");
  const [sede, setSede] = useState(""); // Solo string, para mostrar el nombre
  const [sedeInfo, setSedeInfo] = useState(null); // Objeto con datos Google Maps
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
            setSedeInfo(info); // info = { description, place_id, lat, lng }
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
                sedeMaps: sedeInfo, // PASALO para mostrar después el link exacto
              });
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
