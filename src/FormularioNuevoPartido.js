import React, { useState } from "react";
import AutocompleteSede from "./AutocompleteSede";
import { crearPartidoFrecuente } from "./supabase";
import { handleError, handleSuccess, safeAsync } from "./utils/errorHandler";

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export default function FormularioNuevoPartido({ onConfirmar }) {
  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState("");
  const [sede, setSede] = useState("");
  const [sedeInfo, setSedeInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [guardarFrecuente, setGuardarFrecuente] = useState(false);
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

        <div style={{ margin: '20px 0', padding: '16px', background: 'rgba(255,255,255,0.1)', borderRadius: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', color: '#fff', fontSize: '16px', marginBottom: '12px' }}>
            <input
              type="checkbox"
              checked={guardarFrecuente}
              onChange={(e) => setGuardarFrecuente(e.target.checked)}
              style={{ marginRight: '8px', transform: 'scale(1.2)' }}
            />
            Guardar como partido frecuente
          </label>
          {guardarFrecuente && (
            <input
              className="input-modern"
              placeholder="Nombre del partido frecuente"
              value={nombreFrecuente}
              onChange={(e) => setNombreFrecuente(e.target.value)}
              style={{ marginTop: '8px', height: '45px', fontSize: '16px' }}
            />
          )}
        </div>

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
          disabled={!fecha || !hora || !sede || loading || (guardarFrecuente && !nombreFrecuente.trim())}
          onClick={async () => {
            setLoading(true);
            setError("");
            
            try {
              const partidoData = { fecha, hora, sede, sedeMaps: sedeInfo };
              
              const partido = await safeAsync(
                () => onConfirmar(partidoData),
                'Error al crear el partido'
              );
              
              if (!partido) {
                setError("No se pudo crear el partido");
                return;
              }
              
              if (guardarFrecuente && nombreFrecuente.trim()) {
                await safeAsync(
                  () => crearPartidoFrecuente({
                    nombre: nombreFrecuente.trim(),
                    sede: sede.trim(),
                    hora: hora.trim(),
                    jugadores_frecuentes: [],
                    creado_por: null,
                    dia_semana: new Date(fecha).getDay(),
                    habilitado: true,
                    creado_en: new Date().toISOString()
                  }),
                  'Error al guardar partido frecuente'
                );
                handleSuccess('Partido y partido frecuente guardados');
              } else {
                handleSuccess('Partido creado correctamente');
              }
              
            } catch (err) {
              setError(err.message || "Error al procesar la solicitud");
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
