// src/VotingView.js
import React, { useState, useEffect } from "react";
import { supabase } from "./supabase";

// Avatar por defecto
const DefaultAvatar = (
  <div style={{
    width: 84, height: 84, borderRadius: "50%",
    background: "#eceaf1", display: "flex",
    alignItems: "center", justifyContent: "center"
  }}>
    <svg width="44" height="44" viewBox="0 0 38 38" fill="none">
      <circle cx="19" cy="19" r="19" fill="#eceaf1" />
      <circle cx="19" cy="14" r="7" fill="#bbb" />
      <ellipse cx="19" cy="29" rx="11" ry="7" fill="#bbb" />
    </svg>
  </div>
);

// Componente de estrellas
function StarRating({ value, onChange, max = 10, hovered, setHovered }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 10 }}>
      {[...Array(max)].map((_, i) => (
        <svg
          key={i}
          width="34"
          height="34"
          viewBox="0 0 24 24"
          style={{
            cursor: "pointer",
            transform: hovered !== null
              ? (i < hovered ? "scale(1.22)" : "scale(1)")
              : (i < value ? "scale(1.15)" : "scale(1)"),
            transition: "transform .12s"
          }}
          onMouseEnter={() => setHovered(i + 1)}
          onMouseLeave={() => setHovered(null)}
          onClick={() => onChange(i + 1)}
        >
          <polygon
            points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"
            fill={
              hovered !== null
                ? (i < hovered ? "#DE1C49" : "#eceaf1")
                : (i < value ? "#DE1C49" : "#eceaf1")
            }
            stroke="#DE1C49"
            strokeWidth="1"
          />
        </svg>
      ))}
    </div>
  );
}

export default function VotingView({ onReset }) {
  // Estados principales
  const [step, setStep] = useState(0);
  const [jugadores, setJugadores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [nombre, setNombre] = useState("");
  const [jugador, setJugador] = useState(null);

  // Foto
  const [file, setFile] = useState(null);
  const [fotoPreview, setFotoPreview] = useState(null);
  const [fotoUrl, setFotoUrl] = useState(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);

  // Votación
  const [current, setCurrent] = useState(0);
  const [votos, setVotos] = useState({});
  const [hovered, setHovered] = useState(null);

  // Edición y confirmación
  const [editandoIdx, setEditandoIdx] = useState(null);
  const [confirmando, setConfirmando] = useState(false);
  const [finalizado, setFinalizado] = useState(false);

  // Cargar jugadores de Supabase al montar
  useEffect(() => {
    async function fetchJugadores() {
      setLoading(true);
      let { data, error } = await supabase
        .from("jugadores")
        .select("id, nombre, foto_url")
        .order("nombre", { ascending: true });
      setLoading(false);
      if (error) {
        alert("Error cargando jugadores: " + error.message);
        setJugadores([]);
        return;
      }
      setJugadores(data || []);
    }
    fetchJugadores();
  }, []);

  // Al seleccionar nombre, setea jugador y foto
  useEffect(() => {
    if (!nombre) return;
    const j = jugadores.find(j => j.nombre === nombre);
    setJugador(j || null);
    setFotoUrl(j?.foto_url || null);
    setFotoPreview(j?.foto_url || null);
  }, [nombre, jugadores]);

  // Paso 0: Identificarse
  if (step === 0) {
    return (
      <div style={{
        maxWidth: 420,
        margin: "44px auto 0 auto",
        padding: "28px 28px 34px 28px",
        background: "#fff",
        borderRadius: 32,
        boxShadow: "0 2px 18px 0 rgba(34, 40, 80, 0.10)",
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif"
      }}>
        <h2 style={{ color: "#DE1C49", textAlign: "center", marginBottom: 18 }}>¿Quién sos?</h2>
        {loading && <div style={{ textAlign: "center" }}>Cargando...</div>}
        <ul style={{ listStyle: "none", padding: 0, margin: "18px 0 28px 0" }}>
          {jugadores.map(j => (
            <li key={j.id} style={{
              margin: "11px 0", fontWeight: 700, fontSize: 21, display: "flex", alignItems: "center"
            }}>
              <button
                style={{
                  flex: 1,
                  background: nombre === j.nombre ? "#0EA9C6" : "#f4f4f4",
                  color: nombre === j.nombre ? "#fff" : "#232a32",
                  border: "none",
                  borderRadius: 13,
                  fontSize: 22,
                  padding: "15px 0",
                  fontWeight: 800,
                  cursor: "pointer",
                  transition: "background .18s"
                }}
                onClick={() => setNombre(j.nombre)}
              >
                {j.nombre}
              </button>
            </li>
          ))}
        </ul>
        <button
          style={{
            width: "100%", marginTop: 10, padding: "14px 0",
            background: "#DE1C49", color: "#fff", border: "none",
            borderRadius: 18, fontSize: 19, fontWeight: 700, cursor: "pointer"
          }}
          disabled={!nombre}
          onClick={() => setStep(1)}
        >
          Confirmar y continuar
        </button>
      </div>
    );
  }

  // Paso 1: Subir foto (opcional)
  if (step === 1) {
    const handleFile = (e) => {
      if (e.target.files && e.target.files[0]) {
        setFile(e.target.files[0]);
        setFotoPreview(URL.createObjectURL(e.target.files[0]));
      }
    };

    const handleFotoUpload = async () => {
      if (!file || !jugador) return;
      setSubiendoFoto(true);
      const fileExt = file.name.split('.').pop();
      const fileName = `${jugador.id}_${Date.now()}.${fileExt}`;
      const { error } = await supabase.storage
        .from("jugadores-fotos")
        .upload(fileName, file, { upsert: true });
      if (error) {
        alert("Error subiendo foto: " + error.message);
        setSubiendoFoto(false);
        return;
      }
      const { data: publicUrlData } = supabase.storage
        .from("jugadores-fotos")
        .getPublicUrl(fileName);
      await supabase
        .from("jugadores")
        .update({ foto_url: publicUrlData.publicUrl })
        .eq("id", jugador.id);
      setFotoUrl(publicUrlData.publicUrl);
      setFotoPreview(publicUrlData.publicUrl);
      setSubiendoFoto(false);
      setFile(null);
      alert("¡Foto cargada!");
    };

    return (
      <div style={{
        maxWidth: 420,
        margin: "44px auto 0 auto",
        padding: "28px 28px 34px 28px",
        background: "#fff",
        borderRadius: 32,
        boxShadow: "0 2px 18px 0 rgba(34, 40, 80, 0.10)",
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif"
      }}>
        <h2 style={{ color: "#DE1C49", textAlign: "center", marginBottom: 12 }}>
          ¡Hola, {nombre}!
        </h2>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 18 }}>
          {fotoPreview ? (
            <img src={fotoPreview} alt="foto" style={{ width: 84, height: 84, borderRadius: "50%", objectFit: "cover" }} />
          ) : DefaultAvatar}
          <label style={{ marginTop: 13, cursor: "pointer", color: "#0EA9C6" }}>
            Cambiar foto
            <input type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
          </label>
        </div>
        {!fotoPreview && (
          <div style={{ fontSize: 15, color: "#999", textAlign: "center", marginBottom: 18 }}>
            ¿Querés que tus amigos vean tu foto? Cargala ahora.<br />(Opcional)
          </div>
        )}
        {file && (
          <button
            disabled={subiendoFoto}
            onClick={handleFotoUpload}
            style={{
              width: "100%",
              padding: "12px 0",
              background: "#0EA9C6",
              color: "#fff",
              border: "none",
              borderRadius: 16,
              fontWeight: 700,
              fontSize: 17,
              marginBottom: 15,
              cursor: "pointer"
            }}>
            {subiendoFoto ? "Subiendo..." : "Guardar foto"}
          </button>
        )}
        <button
          style={{
            width: "100%", marginTop: 8, padding: "14px 0",
            background: "#DE1C49", color: "#fff", border: "none",
            borderRadius: 18, fontSize: 18, fontWeight: 700, cursor: "pointer"
          }}
          onClick={() => setStep(2)}
        >
          {fotoPreview ? "Continuar" : "Continuar sin foto"}
        </button>
      </div>
    );
  }

  // Jugadores a votar: todos menos yo
  const jugadoresParaVotar = jugadores.filter(j => j.nombre !== nombre);

  // Paso 2: Votar a los demás jugadores (incluye edición)
  if (step === 2 || editandoIdx !== null) {
    // ¿Estamos editando alguna calificación?
    const index = editandoIdx !== null ? editandoIdx : current;
    if (index >= jugadoresParaVotar.length) {
      // Ir al resumen
      setTimeout(() => setStep(3), 300);
      return null;
    }

    const jugadorVotar = jugadoresParaVotar[index];
    const valor = votos[jugadorVotar.id] || 0;

    return (
      <div style={{
        maxWidth: 390,
        margin: "44px auto 0 auto",
        padding: "26px 24px 36px 24px",
        background: "#fff",
        borderRadius: 32,
        boxShadow: "0 2px 18px 0 rgba(34, 40, 80, 0.10)",
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif"
      }}>
        <h2 style={{ color: "#DE1C49", textAlign: "center" }}>
          Calificá a tus compañeros
        </h2>
        <div style={{ textAlign: "center", fontWeight: 600, fontSize: 22, margin: "10px 0 8px 0" }}>
          {jugadorVotar.nombre}
        </div>
        <div style={{
          width: 96, height: 96, borderRadius: "50%", border: "2px solid #eceaf1",
          background: jugadorVotar.foto_url ? `url(${jugadorVotar.foto_url}) center/cover` : "#f5f5f5",
          margin: "0 auto 16px auto", display: "flex", alignItems: "center", justifyContent: "center"
        }}>
          {!jugadorVotar.foto_url && DefaultAvatar}
        </div>
        <StarRating
          value={valor}
          onChange={valor => {
            setVotos(prev => ({ ...prev, [jugadorVotar.id]: valor }));
            if (editandoIdx !== null) {
              setEditandoIdx(null);
              setStep(3); // volver al resumen después de editar
            } else {
              setCurrent(cur => cur + 1);
            }
            setHovered(null);
          }}
          hovered={hovered}
          setHovered={setHovered}
        />
        <div style={{
          marginTop: 10,
          fontSize: 24,
          color: "#DE1C49",
          fontWeight: 700,
          letterSpacing: "-1px",
          textAlign: "center"
        }}>
          {hovered !== null ? hovered : (valor || 0)}
        </div>
        <button
          style={{
            marginTop: 22,
            width: "100%",
            padding: "14px 0",
            background: "#b2b2af",
            color: "#fff",
            border: "none",
            borderRadius: 14,
            fontWeight: 700,
            fontSize: 18,
            cursor: "pointer"
          }}
          onClick={() => {
            setVotos(prev => ({ ...prev, [jugadorVotar.id]: undefined }));
            if (editandoIdx !== null) {
              setEditandoIdx(null);
              setStep(3);
            } else {
              setCurrent(cur => cur + 1);
            }
            setHovered(null);
          }}
        >
          No lo conozco
        </button>
      </div>
    );
  }

  // Paso 3: Resumen y edición antes de confirmar
  if (step === 3 && !finalizado) {
    return (
      <div style={{
        maxWidth: 420,
        margin: "44px auto 0 auto",
        padding: "28px 20px 38px 20px",
        background: "#fff",
        borderRadius: 32,
        boxShadow: "0 2px 22px 0 rgba(34, 40, 80, 0.11)",
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
        textAlign: "center"
      }}>
        <h2 style={{ color: "#0EA9C6", fontSize: 23, marginBottom: 20 }}>
          Confirmá tus calificaciones
        </h2>
        <div>
          {jugadoresParaVotar.map((j, idx) => (
            <div key={j.id} style={{
              display: "flex", alignItems: "center", gap: 15,
              background: "#f6f6f8", borderRadius: 12, padding: "12px 10px", margin: "10px 0"
            }}>
              <div>
                {j.foto_url ?
                  <img src={j.foto_url} alt="foto" style={{ width: 54, height: 54, borderRadius: "50%", objectFit: "cover" }} />
                  : DefaultAvatar
                }
              </div>
              <div style={{ flex: 1, textAlign: "left" }}>
                <div style={{ fontWeight: 700, fontSize: 19, marginBottom: 1 }}>{j.nombre}</div>
                <div style={{ color: "#DE1C49", fontSize: 19, fontWeight: 800 }}>
                  {votos[j.id] ? votos[j.id] + "/10" : "No calificado"}
                </div>
              </div>
              <button
                style={{
                  background: "#0EA9C6", color: "#fff", border: "none",
                  borderRadius: 10, padding: "7px 13px", fontWeight: 700, cursor: "pointer"
                }}
                onClick={() => setEditandoIdx(idx)}
              >Editar</button>
            </div>
          ))}
        </div>
        <button
          style={{
            marginTop: 16, width: "100%", padding: "16px 0",
            background: "#DE1C49", color: "#fff", border: "none",
            borderRadius: 18, fontSize: 20, fontWeight: 800, cursor: "pointer"
          }}
          onClick={async () => {
            setConfirmando(true);
            // Busca ID del votante (jugador actual)
            const votanteId = jugador?.id;
            // Guarda cada voto en Supabase
            for (const j of jugadoresParaVotar) {
              // Solo guarda si hay puntaje (omití "No lo conozco")
              if (votos[j.id]) {
                await supabase.from("votos").insert({
                  votado_id: j.id,
                  votante_id: votanteId,
                  puntaje: votos[j.id]
                });
              }
            }
            setConfirmando(false);
            setFinalizado(true);
          }}
          disabled={confirmando}
        >
          {confirmando ? "Guardando..." : "Confirmar mis votos"}
        </button>
      </div>
    );
  }

  // Paso 4: Mensaje final
  if (finalizado) {
    return (
      <div style={{
        maxWidth: 410,
        margin: "64px auto 0 auto",
        padding: "42px 26px 38px 26px",
        background: "#fff",
        borderRadius: 32,
        boxShadow: "0 2px 22px 0 rgba(34, 40, 80, 0.11)",
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
        textAlign: "center"
      }}>
        <h2 style={{ color: "#0EA9C6", fontSize: 27, marginBottom: 16 }}>
          ¡Gracias por votar!
        </h2>
        <p style={{ fontSize: 17, marginBottom: 27 }}>
          Tus votos fueron registrados.<br />Podés cerrar esta ventana.
        </p>
        <button
          style={{
            padding: "11px 26px", borderRadius: 14,
            background: "#0EA9C6", color: "#fff",
            fontWeight: 700, fontSize: 18, border: "none", cursor: "pointer"
          }}
          onClick={onReset}
        >Volver al inicio</button>
      </div>
    );
  }

  return null;
}
