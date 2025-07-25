import React, { useState } from 'react';

// Utilidad para leer los jugadores del query string
function getJugadoresFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const jugadores = params.get('jugadores');
  if (!jugadores) return [];
  return jugadores.split(',').map((j) => decodeURIComponent(j));
}

export default function IngresoVotacion({ onTerminar }) {
  const jugadores = getJugadoresFromUrl();
  const [paso, setPaso] = useState(1);
  const [jugador, setJugador] = useState('');
  const [foto, setFoto] = useState(null);
  const [puntajes, setPuntajes] = useState({});
  const [enviando, setEnviando] = useState(false);

  // Lista de jugadores a votar (excluye el propio)
  const votables = jugadores.filter((j) => j !== jugador);

  // Subir foto
  function handleFotoChange(e) {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setFoto(ev.target.result);
      reader.readAsDataURL(file);
    }
  }

  // Elegir puntaje para un jugador
  function setPuntaje(nombre, score) {
    setPuntajes((prev) => ({ ...prev, [nombre]: score }));
  }

  // Checkear si todos los jugadores han sido votados
  const puedeEnviar = votables.every((j) => puntajes[j] > 0);

  // Enviar votación
  function handleEnviar() {
    setEnviando(true);
    setTimeout(() => {
      // En local solo simulamos. Podés hacer console.log para debug
      // console.log({ jugador, foto, puntajes });
      setEnviando(false);
      setPaso(4);
      onTerminar && onTerminar();
    }, 900);
  }

  // --- PASO 1: Seleccionar jugador
  if (paso === 1) {
    return (
      <div style={estiloWrap}>
        <h2 style={{ color: '#0EA9C6' }}>¿Quién sos?</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: '35px 0' }}>
          {jugadores.map((nombre) => (
            <li key={nombre} style={{ margin: '13px 0' }}>
              <button
                onClick={() => { setJugador(nombre); setPaso(2); }}
                style={{
                  width: '100%',
                  padding: '18px 0',
                  fontSize: 20,
                  borderRadius: 20,
                  border: 'none',
                  fontWeight: 700,
                  background: jugador === nombre ? '#DE1C49' : '#0EA9C6',
                  color: '#fff',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(30,10,30,0.13)',
                }}
              >
                {nombre}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // --- PASO 2: Subir foto (opcional)
  if (paso === 2) {
    return (
      <div style={estiloWrap}>
        <h2 style={{ color: '#0EA9C6' }}>¡Hola, {jugador}!</h2>
        <p style={{ marginBottom: 24 }}>Podés cargar una foto tuya si querés (opcional):</p>
        <input
          type="file"
          accept="image/*"
          onChange={handleFotoChange}
          style={{ marginBottom: 16 }}
        />
        {foto && (
          <div style={{ margin: '12px auto' }}>
            <img src={foto} alt="Tu foto" style={{ maxWidth: 180, borderRadius: 18, margin: 'auto' }} />
          </div>
        )}
        <button
          onClick={() => setPaso(3)}
          style={estiloBtnPrimario}
        >
          {foto ? 'Continuar' : 'Saltar y continuar'}
        </button>
      </div>
    );
  }

  // --- PASO 3: Votar al resto
  if (paso === 3) {
    return (
      <div style={estiloWrap}>
        <h2 style={{ color: '#0EA9C6' }}>Calificá a tus compañeros</h2>
        <p style={{ fontSize: 16, marginBottom: 16 }}>
          No podés votarte a vos mismo. Asigná un puntaje del 1 al 10 a cada uno.
        </p>
        <ul style={{ listStyle: 'none', padding: 0, margin: '35px 0' }}>
          {votables.map((nombre) => (
            <li key={nombre} style={{ margin: '20px 0', display: 'flex', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: 18, minWidth: 90 }}>{nombre}</span>
              <input
                type="number"
                min={1}
                max={10}
                value={puntajes[nombre] || ''}
                onChange={(e) => setPuntaje(nombre, Math.max(1, Math.min(10, +e.target.value)))}
                className="input-modern"
                style={{
                  marginLeft: 16,
                  width: 56,
                  fontSize: 19,
                  borderRadius: 0,
                  border: '2px solid rgba(255,255,255,0.4)',
                  padding: '0 12px',
                  color: '#fff',
                  background: 'rgba(255,255,255,0.1)',
                  fontFamily: 'Oswald, Arial, sans-serif',
                }}
              />
            </li>
          ))}
        </ul>
        <button
          disabled={!puedeEnviar || enviando}
          onClick={handleEnviar}
          style={{
            ...estiloBtnPrimario,
            opacity: puedeEnviar ? 1 : 0.6,
            cursor: puedeEnviar ? 'pointer' : 'not-allowed',
          }}
        >
          {enviando ? 'Enviando...' : 'Enviar votos'}
        </button>
      </div>
    );
  }

  // --- PASO 4: Gracias por votar
  return (
    <div style={estiloWrap}>
      <h2 style={{ color: '#27ae60', marginBottom: 34 }}>¡Gracias por votar!</h2>
      <div style={{ fontSize: 19, margin: '30px 0 8px' }}>Tus votos fueron enviados 👏</div>
      <div style={{ fontSize: 15, color: '#b2b2af' }}>Podés cerrar la ventana.</div>
    </div>
  );
}

const estiloWrap = {
  maxWidth: 430,
  margin: '60px auto',
  textAlign: 'center',
  background: '#fff',
  borderRadius: 22,
  boxShadow: '0 4px 24px #0EA9C62c',
  padding: 40,
};
const estiloBtnPrimario = {
  width: '100%',
  padding: '18px 0',
  marginTop: 22,
  fontSize: 20,
  borderRadius: 20,
  border: 'none',
  fontWeight: 700,
  background: 'linear-gradient(90deg, #DE1C49 0%, #0EA9C6 100%)',
  color: '#fff',
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(30,10,30,0.13)',
};
