// src/VotingView.js
import React, { useState, useEffect } from 'react';
import {
  checkIfAlreadyVoted,
  uploadFoto,
  submitVotos,
  supabase,
  getGuestSessionId, // si no usás guest, podés eliminar esta línea
} from './supabase';
import { toast } from 'react-toastify';
import DOMPurify from 'dompurify';
import { handleError, AppError, ERROR_CODES } from './lib/errorHandler';
import { db } from './api/supabaseWrapper';
import LoadingSpinner from './components/LoadingSpinner';
import StarRating from './StarRating';
import PageTitle from './components/PageTitle';
import MatchInfoSection from './components/MatchInfoSection';
import './HomeStyleKit.css';

// Feature flag for XSS sanitization
const SANITIZE_ON = process.env.REACT_APP_SANITIZE_VOTING === 'true';
const clean = (value) => SANITIZE_ON ? DOMPurify.sanitize(String(value ?? '')) : String(value ?? '');

const DefaultAvatar = (
  <div className="voting-photo-placeholder">
    <svg width="80" height="80" viewBox="0 0 38 38" fill="none">
      <rect width="38" height="38" rx="6" fill="#eceaf1" />
      <circle cx="19" cy="14" r="7" fill="#bbb" />
      <ellipse cx="19" cy="29" rx="11" ry="7" fill="#bbb" />
    </svg>
  </div>
);

export default function VotingView({ onReset, jugadores, partidoActual }) {
  // Estados principales
  const [step, setStep] = useState(0);
  const [nombre, setNombre] = useState('');
  const [jugador, setJugador] = useState(null);

  // Foto
  const [file, setFile] = useState(null);
  const [fotoPreview, setFotoPreview] = useState(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);

  // Votación
  const [current, setCurrent] = useState(0);
  const [votos, setVotos] = useState({});
  const [hovered, setHovered] = useState(null);

  // Edición y confirmación
  const [editandoIdx, setEditandoIdx] = useState(null);
  const [confirmando, setConfirmando] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [finalizado, setFinalizado] = useState(false);
  const [animating, setAnimating] = useState(false);

  // Chequeo global: ¿El usuario actual ya votó?
  const [usuarioYaVoto, setUsuarioYaVoto] = useState(false);
  const [cargandoVotoUsuario, setCargandoVotoUsuario] = useState(true);
  
  // Permission control
  const [hasAccess, setHasAccess] = useState(null); // null = loading, true/false = resolved
  const [authzError, setAuthzError] = useState(null);

  // -- HOOKS, TODOS ARRIBA --
  
  // Chequeo global apenas entra a la vista
  useEffect(() => {
    async function checkVotoUsuarioActual() {
      setCargandoVotoUsuario(true);
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const codigo = urlParams.get('codigo');
        if (!codigo) return setCargandoVotoUsuario(false);

        let partido;
        try {
          partido = await db.fetchOne('partidos', { codigo });
        } catch (error) {
          return setCargandoVotoUsuario(false);
        }
        if (!partido?.id) return setCargandoVotoUsuario(false);

        const partidoId = Math.abs(parseInt(partido.id, 10));

        let userId = null;
        const { data: { user } } = await supabase.auth.getUser();
        
        // Check permissions
        if (user?.id) {
          userId = user.id;
          
          try {
            // Check if user is match creator
            const { data: partidoData, error: partidoError } = await supabase
              .from('partidos')
              .select('creado_por')
              .eq('id', partidoId)
              .single();
            
            if (partidoError) throw partidoError;
            
            const isCreator = partidoData?.creado_por === user.id;
            
            // Check if user is in match roster
            const { data: jugadoresPartido, error: jugadoresError } = await supabase
              .from('jugadores')
              .select('usuario_id, nombre')
              .eq('partido_id', partidoId);
            
            if (jugadoresError) throw jugadoresError;
            
            const jugadorEnPartido = jugadoresPartido?.find((j) => j.usuario_id === user.id);
            
            const allowed = isCreator || !!jugadorEnPartido;
            setHasAccess(allowed);
            
            if (!allowed) {
              return setCargandoVotoUsuario(false);
            }
            
            // Auto-detect name for registered users in roster
            if (jugadorEnPartido) {
              setNombre(jugadorEnPartido.nombre);
              setStep(1);
            }
          } catch (err) {
            handleError(err, { showToast: false });
            setAuthzError('No se pudo validar permisos');
            setHasAccess(false);
            return setCargandoVotoUsuario(false);
          }
        } else {
          // Guest users allowed
          setHasAccess(true);
          if (typeof getGuestSessionId === 'function') {
            userId = getGuestSessionId(partidoId);
          } else {
            userId = `guest_${partidoId}_${Date.now()}`;
          }
        }

        if (!userId) return setCargandoVotoUsuario(false);

        const hasVoted = await checkIfAlreadyVoted(userId, partidoId);
        setUsuarioYaVoto(hasVoted);
      } catch (e) {
        setUsuarioYaVoto(false);
      } finally {
        setCargandoVotoUsuario(false);
      }
    }
    checkVotoUsuarioActual();
    // eslint-disable-next-line
  }, []);



  // Setear jugador cuando cambia nombre
  useEffect(() => {
    if (!nombre) {
      setJugador(null);
      setFotoPreview(null);
      return;
    }
    const j = jugadores.find((j) => j.nombre === nombre);
    setJugador(j || null);
    setFotoPreview(j?.avatar_url || null);
  }, [nombre, jugadores]);

  // -- FIN HOOKS --

  // Pantalla de carga
  if (cargandoVotoUsuario) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <LoadingSpinner size="large" />
        </div>
      </div>
    );
  }


  
  // Block if no access
  if (hasAccess === false) {
    return (
      <div className="voting-bg">
        <PageTitle onBack={onReset}>CALIFICÁ A TUS COMPAÑEROS</PageTitle>
        <div className="voting-modern-card">
          <div className="voting-title-modern">
            ACCESO DENEGADO
          </div>
          <div style={{ color: '#fff', fontSize: 26, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30 }}>
            No tienes permiso para votar en este partido.
          </div>
          {authzError && (
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16, marginBottom: 20 }}>
              {authzError}
            </div>
          )}
          <button
            className="voting-confirm-btn"
            onClick={onReset}
            style={{ marginTop: 16 }}
          >VOLVER AL INICIO</button>
        </div>
      </div>
    );
  }
  
  // Si ya votó, bloquear el flujo entero
  if (usuarioYaVoto) {
    return (
      <div className="voting-bg">
        <PageTitle onBack={onReset}>CALIFICÁ A TUS COMPAÑEROS</PageTitle>
        <div className="voting-modern-card">
          <div className="voting-title-modern">
            ¡YA VOTASTE!
          </div>
          <div style={{ color: '#fff', fontSize: 26, fontFamily: "'Oswald', Arial, sans-serif", marginBottom: 30 }}>
            Ya registraste tus votos.<br />No podés votar de nuevo en este partido.
          </div>
          <button
            className="voting-confirm-btn"
            onClick={onReset}
            style={{ marginTop: 16 }}
          >VOLVER AL INICIO</button>
        </div>
      </div>
    );
  }

  // Paso 0: Identificarse
  if (step === 0) {
    return (
      <div className="voting-bg">
        <PageTitle onBack={onReset}>CALIFICÁ A TUS COMPAÑEROS</PageTitle>
        <div className="voting-modern-card">
          <div className="voting-title-modern">¿QUIÉN SOS?</div>
          <div className="player-select-grid">
            {jugadores.map((j) => (
              <button
                key={j.uuid}
                className={`player-select-btn${nombre === j.nombre ? ' selected' : ''}`}
                onClick={() => setNombre(j.nombre)}
                type="button"
              >
                <span className="player-select-txt">{clean(j.nombre)}</span>
              </button>
            ))}
          </div>
          <button
            className="voting-confirm-btn"
            disabled={!nombre}
            style={{ opacity: nombre ? 1 : 0.4, pointerEvents: nombre ? 'auto' : 'none' }}
            onClick={() => setStep(1)}
          >
            CONFIRMAR
          </button>
        </div>
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
      try {
        const fotoUrl = await uploadFoto(file, jugador);
        setFotoPreview(fotoUrl);
        setFile(null);
        toast.success('¡Foto cargada!');
      } catch (error) {
        toast.error('Error al subir la foto: ' + error.message);
      } finally {
        setSubiendoFoto(false);
      }
    };

    return (
      <div className="voting-bg">
        <PageTitle onBack={onReset}>CALIFICÁ A TUS COMPAÑEROS</PageTitle>
        <div className="voting-modern-card">
          <div className="voting-title-modern">¡HOLA, {clean(nombre)}!</div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 18 }}>
            <div
              className="voting-photo-box"
              onClick={() => document.getElementById('foto-input').click()}
              style={{ cursor: 'pointer' }}
              title={fotoPreview ? 'Cambiar foto' : 'Agregar foto'}
            >
              {fotoPreview ? (
                <img
                  src={fotoPreview}
                  alt="foto"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <span className="photo-plus">+</span>
              )}
              <input
                id="foto-input"
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleFile}
              />
            </div>
          </div>
          {!fotoPreview && (
            <div style={{
              fontSize: 18, color: 'rgba(255,255,255,0.7)',
              textAlign: 'center', marginBottom: 18, fontFamily: "'Oswald', Arial, sans-serif",
            }}>
              Mandale selfie <br />
            </div>
          )}
          {file && (
            <button
              className="voting-confirm-btn"
              style={{ background: 'rgba(255,255,255,0.17)', borderColor: '#fff', color: '#fff' }}
              disabled={subiendoFoto}
              onClick={handleFotoUpload}
            >
              {subiendoFoto ? 'SUBIENDO...' : 'GUARDAR FOTO'}
            </button>
          )}
          <button
            className="voting-confirm-btn"
            style={{ marginTop: 8 }}
            onClick={() => setStep(2)}
          >
            {fotoPreview ? 'CONTINUAR' : 'CONTINUAR SIN FOTO'}
          </button>
        </div>
      </div>
    );
  }

  // Jugadores a votar: todos menos yo
  const jugadoresParaVotar = jugadores.filter((j) => j.nombre !== nombre);

  // Paso 2: Votar a los demás jugadores
  if (step === 2 || editandoIdx !== null) {
    const index = editandoIdx !== null ? editandoIdx : current;
    if (index >= jugadoresParaVotar.length) {
      setTimeout(() => setStep(3), 300);
      return null;
    }
    const jugadorVotar = jugadoresParaVotar[index];
    const valor = votos[jugadorVotar.uuid] || 0;

    return (
      <div className="voting-bg">
        <PageTitle>CALIFICÁ A TUS COMPAÑEROS</PageTitle>
        <div className="voting-modern-card" style={{ background: 'transparent', boxShadow: 'none', padding: 0 }}>
          <div className={`player-vote-card ${animating ? 'slide-out' : 'slide-in'}`}>
            <div className="voting-player-name">{clean(jugadorVotar.nombre)}</div>
            <div className="voting-photo-box">
              {jugadorVotar.avatar_url ? (
                <img src={jugadorVotar.avatar_url} alt="foto" />
              ) : (
                DefaultAvatar
              )}
            </div>
            <StarRating
              value={valor}
              onChange={(valor) => {
                if (animating) return;
                setAnimating(true);
                setVotos((prev) => ({ ...prev, [jugadorVotar.uuid]: valor }));
                
                setTimeout(() => {
                  if (editandoIdx !== null) {
                    setEditandoIdx(null);
                    setStep(3);
                  } else {
                    setCurrent((cur) => cur + 1);
                  }
                  setHovered(null);
                  setAnimating(false);
                }, 200);
              }}
              hovered={hovered}
              setHovered={setHovered}
            />
            <button
              className="voting-confirm-btn"
              style={{ marginTop: 35, marginBottom: 0, fontWeight: 400 }}
              onClick={() => {
                if (animating) return;
                setAnimating(true);
                setVotos((prev) => ({ ...prev, [jugadorVotar.uuid]: undefined }));
                
                setTimeout(() => {
                  if (editandoIdx !== null) {
                    setEditandoIdx(null);
                    setStep(3);
                  } else {
                    setCurrent((cur) => cur + 1);
                  }
                  setHovered(null);
                  setAnimating(false);
                }, 200);
              }}
            >
              NO LO CONOZCO
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Paso 3: Resumen y edición antes de confirmar
  if (step === 3 && !finalizado) {
    return (
      <div className="voting-bg">
        <PageTitle>CONFIRMÁ TUS CALIFICACIONES</PageTitle>
        <MatchInfoSection
          fecha={partidoActual?.fecha}
          hora={partidoActual?.hora}
          sede={partidoActual?.sede}
          modalidad={partidoActual?.modalidad}
          tipo={partidoActual?.tipo_partido}
        />
        <div className="voting-modern-card" style={{ marginTop: '20px' }}>
          <div className="confirmation-list">
            {jugadoresParaVotar.map((j, idx) => (
              <div key={j.uuid} className="confirmation-item">
                <div className="confirmation-item-photo">
                  {j.avatar_url ?
                    <img src={j.avatar_url} alt="foto" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : DefaultAvatar
                  }
                </div>
                <span className="confirmation-item-name">{clean(j.nombre)}</span>
                <span className={`confirmation-item-score ${!votos[j.uuid] ? 'not-graded' : ''}`}>
                  {votos[j.uuid] ? votos[j.uuid] + '/10' : 'No calificado'}
                </span>
                <button
                  className="confirmation-item-edit-btn"
                  onClick={() => setEditandoIdx(idx)}
                >
                  EDITAR
                </button>
              </div>
            ))}
          </div>
          {hasAccess === false && (
            <div role="alert" className="voting-alert" style={{
              background: 'rgba(255,59,48,0.15)',
              border: '1px solid rgba(255,59,48,0.3)',
              borderRadius: '8px',
              padding: '12px 16px',
              color: '#fff',
              fontSize: '16px',
              fontFamily: "'Oswald', Arial, sans-serif",
              textAlign: 'center',
              marginBottom: '16px'
            }}>
              No tienes permiso para votar en este partido.
            </div>
          )}
          <button
            className="voting-confirm-btn"
            style={{ marginTop: 8, fontWeight: 700, letterSpacing: 1.2 }}
            disabled={isSubmitting || hasAccess === false || hasAccess === null}
            onClick={async () => {
              if (isSubmitting) return; // Anti-double submit guard
              if (hasAccess === false) {
                handleError(new AppError('No tienes permiso para votar en este partido.', ERROR_CODES.ACCESS_DENIED), { showToast: true });
                return;
              }
              
              setIsSubmitting(true);
              setConfirmando(true);
              try {
                console.log('[VOTING] Submitting votes...');
                const urlParams = new URLSearchParams(window.location.search);
                const codigo = urlParams.get('codigo');
                if (!codigo) {
                  throw new AppError('Código del partido no encontrado en la URL', ERROR_CODES.VALIDATION_ERROR);
                }
                const { data: partido, error: partidoError } = await supabase
                  .from('partidos')
                  .select('id')
                  .eq('codigo', codigo)
                  .single();
                if (partidoError || !partido || !partido.id) {
                  throw new AppError('No se pudo encontrar el partido', ERROR_CODES.NOT_FOUND);
                }
                const partidoId = Math.abs(parseInt(partido.id, 10));
                await submitVotos(votos, jugador?.uuid, partidoId, jugador?.nombre, jugador?.avatar_url);
                
                // Trigger refresh for admin panel
                await supabase
                  .from('partidos')
                  .update({ updated_at: new Date().toISOString() })
                  .eq('id', partidoId);
                
                console.log('[VOTING] Votes submitted successfully');
                setFinalizado(true);
              } catch (error) {
                handleError(error, { showToast: true });
              } finally {
                setConfirmando(false);
                setIsSubmitting(false);
              }
            }}
          >
            {isSubmitting ? 'GUARDANDO...' : 'CONFIRMAR MIS VOTOS'}
          </button>
        </div>
      </div>
    );
  }

  // Paso 4: Mensaje final
  if (finalizado) {
    return (
      <div className="voting-bg">
        <PageTitle onBack={onReset}>CALIFICÁ A TUS COMPAÑEROS</PageTitle>
        <div className="voting-modern-card">
          <div className="voting-title-modern">
            ¡GRACIAS POR VOTAR!
          </div>
          <div style={{
            color: '#fff', fontFamily: "'Oswald', Arial, sans-serif",
            fontSize: 27, marginBottom: 27, letterSpacing: 1.1,
          }}>
            Tus votos fueron registrados.<br />Podés cerrar esta ventana.
          </div>
          <button
            className="voting-confirm-btn"
            style={{ marginTop: 16 }}
            onClick={onReset}
          >VOLVER AL INICIO</button>
        </div>
      </div>
    );
  }

  return null;
}
