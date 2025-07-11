import React, { useState } from "react";
import AutocompleteSede from "./AutocompleteSede";
import { crearPartidoFrecuente } from "./supabase";
import { toast } from 'react-toastify';

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
            try {
              setLoading(true);
              setError("");
              
              console.log('Creating match with data:', { fecha, hora, sede });
              
              const partidoData = {
                fecha,
                hora,
                sede,
                sedeMaps: sedeInfo,
              };
              
              // Step 1: Create the regular match
              const partido = await onConfirmar(partidoData);
              console.log('Match created:', partido);
              
              if (!partido) {
                setError("Error: No se pudo crear el partido.");
                console.error('onConfirmar returned null/undefined');
                return;
              }
              
              // Step 2: Save as frequent match if requested
              if (guardarFrecuente && nombreFrecuente.trim()) {
                console.log('Saving as frequent match...');
                
                try {
                  // Validate required data
                  if (!fecha || !hora || !sede || !nombreFrecuente.trim()) {
                    throw new Error('Faltan datos requeridos para guardar el partido frecuente');
                  }
                  
                  const fechaObj = new Date(fecha);
                  const diaSemana = fechaObj.getDay();
                  
                  const frecuenteData = {
                    nombre: nombreFrecuente.trim(),
                    sede: sede.trim(),
                    hora: hora.trim(),
                    jugadores_frecuentes: [],
                    creado_por: null, // Set to null since we don't have a user UUID
                    dia_semana: diaSemana,
                    habilitado: true,
                    creado_en: new Date().toISOString()
                  };
                  
                  console.log('Frequent match data to save:', frecuenteData);
                  
                  const result = await crearPartidoFrecuente(frecuenteData);
                  
                  if (!result || !result.id) {
                    setError("No se pudo guardar el partido frecuente.");
                    console.error("Failed to save frequent match - no result or ID:", result);
                    toast.error('Error: No se pudo guardar el partido frecuente');
                    return;
                  }
                  
                  console.log('Frequent match saved successfully:', result);
                  toast.success('Partido y partido frecuente guardados correctamente');
                  
                } catch (freqError) {
                  console.error('Error saving frequent match:', freqError);
                  setError('Error al guardar partido frecuente: ' + freqError.message);
                  toast.error('Partido creado, pero error al guardar como frecuente: ' + freqError.message);
                }
              } else {
                console.log('Not saving as frequent match');
                toast.success('Partido creado correctamente');
              }
              
            } catch (err) {
              console.error("Error in main flow:", err);
              setError("Error al crear el partido: " + (err.message || "Intenta nuevamente"));
              toast.error('Error al crear el partido: ' + (err.message || 'Error desconocido'));
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
