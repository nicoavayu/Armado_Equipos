import React, { useState } from "react";
import AutocompleteSede from "./AutocompleteSede";
<<<<<<< HEAD
import { crearPartidoFrecuente } from "./supabase"; // Importá la función

export default function FormularioNuevoPartido({ onConfirmar, jugadoresFrecuentes }) {
=======
import { crearPartidoFrecuente, crearPartidoDesdeFrec, crearPartido, supabase } from "./supabase";
import { handleError, handleSuccess, safeAsync } from "./utils/errorHandler";

export default function FormularioNuevoPartido({ onConfirmar, onVolver }) {
  const [nombrePartido, setNombrePartido] = useState("");
>>>>>>> feature/nueva-funcionalidad
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
        <div className="match-name" style={{ marginBottom: 24 }}>NUEVO PARTIDO</div>
        
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
          style={{ width: "100%", marginBottom: 12 }}
          disabled={!nombrePartido.trim() || !fecha || !hora || !sede || loading}
          onClick={async () => {
            setLoading(true);
            setError("");
            
            try {
<<<<<<< HEAD
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
=======
              // Check if user is authenticated
              const { data: { user } } = await supabase.auth.getUser();
              
              let partido;
              
              if (user) {
                // User is authenticated - create frequent match + regular match
                const partidoFrecuente = await safeAsync(
                  () => crearPartidoFrecuente({
                    nombre: nombrePartido.trim(),
                    sede: sede.trim(),
                    hora: hora.trim(),
                    jugadores_frecuentes: [],
                    dia_semana: new Date(fecha).getDay(),
                    habilitado: true
                  }),
                  'Error al crear el partido frecuente'
                );
                
                partido = await safeAsync(
                  () => crearPartidoDesdeFrec(partidoFrecuente, fecha),
                  'Error al crear el partido'
                );
                
                partido.from_frequent_match_id = partidoFrecuente.id;
              } else {
                // User is not authenticated - create regular match only
                partido = await safeAsync(
                  () => crearPartido({
                    fecha,
                    hora: hora.trim(),
                    sede: sede.trim(),
                    sedeMaps: sedeInfo?.place_id || ""
                  }),
                  'Error al crear el partido'
                );
                
                // Add match name for display
                partido.nombre = nombrePartido.trim();
              }
              
              if (!partido) {
                setError("No se pudo crear el partido");
                return;
              }
              
              await onConfirmar(partido);
              handleSuccess('Partido creado correctamente');
              
>>>>>>> feature/nueva-funcionalidad
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
          style={{ width: "100%", background: '#DE1C49', fontSize: '1.5rem', height: '64px', borderRadius: '9px', marginBottom: '0' }}
          onClick={onVolver}
          disabled={loading}
        >
          VOLVER AL INICIO
        </button>
      </div>
    </div>
  );
}