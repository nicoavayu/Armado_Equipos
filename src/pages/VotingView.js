// src/VotingView.js
import React, { useState, useEffect, useRef } from 'react';
import {
  checkIfAlreadyVoted,
  uploadFoto,
  submitVotos,
  supabase,
  getGuestSessionId,
} from '../supabase';
import { subscribeToMatchUpdates } from '../services/realtimeService';
import { toast } from 'react-toastify';
import DOMPurify from 'dompurify';
import { handleError, AppError, ERROR_CODES } from '../lib/errorHandler';
import { db } from '../api/supabaseWrapper';
import { resolveMatchIdFromQueryParams } from '../utils/matchResolver';
import LoadingSpinner from '../components/LoadingSpinner';
import PageTitle from '../components/PageTitle';
import MatchInfoSection from '../components/MatchInfoSection';
import normalizePartidoForHeader from '../utils/normalizePartidoForHeader';
import StarRating from '../components/StarRating';
import { AvatarFallback } from '../components/ProfileComponents';

// Styles are now handled via Tailwind CSS
// Legacy styles: src/pages/LegacyVoting.css (for other components)

// Feature flag for XSS sanitization
const SANITIZE_ON = process.env.REACT_APP_SANITIZE_VOTING === 'true';
const clean = (value) => SANITIZE_ON ? DOMPurify.sanitize(String(value ?? '')) : String(value ?? '');



export default function VotingView({ onReset, jugadores, partidoActual }) {
  // Estados principales
  const [step, setStep] = useState(0);
  const [nombre, setNombre] = useState('');
  const [jugador, setJugador] = useState(null);
  const [animating, setAnimating] = useState(false);

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

  // Chequeo global: ¿El usuario actual ya votó?
  const [usuarioYaVoto, setUsuarioYaVoto] = useState(false);
  const [cargandoVotoUsuario, setCargandoVotoUsuario] = useState(true);

  // Permission control
  const [hasAccess, setHasAccess] = useState(null); // null = loading, true/false = resolved
  const [authzError, setAuthzError] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // -- GUARDS FOR DOUBLE-FETCH PREVENTION --
  // Prevent React Strict Mode double-init
  const didInitRef = useRef(false);
  // Cache resolved matchId to avoid re-resolution
  const resolvedMatchIdRef = useRef(null);

  // -- HOOKS, TODOS ARRIBA --

  // Chequeo global apenas entra a la vista
  useEffect(() => {
    // GUARD: Prevent double-init in React Strict Mode
    if (didInitRef.current) {
      return;
    }
    didInitRef.current = true;

    async function checkVotoUsuarioActual() {
      setCargandoVotoUsuario(true);
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const { partidoId, error } = await resolveMatchIdFromQueryParams(urlParams);

        if (error || !partidoId) {
          console.warn('[VOTING] Cannot check vote status:', error);
          return setCargandoVotoUsuario(false);
        }

        // CACHE: Store resolved matchId for reuse
        resolvedMatchIdRef.current = partidoId;

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
            setIsAdmin(isCreator);

            if (!allowed) {
              return setCargandoVotoUsuario(false);
            }

            // Auto-detect name for registered users in roster
            if (jugadorEnPartido) {
              setNombre(jugadorEnPartido.nombre);
              setStep(1);
            }
          } catch (err) {
            handleError(err, { showToast: false, onError: () => { } });
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

  // Realtime match updates
  useEffect(() => {
    if (!partidoActual?.id) return;
    const unsubscribe = subscribeToMatchUpdates(partidoActual.id, (event) => {
      console.debug('[RT] Voting update:', event);
      if (event.type === 'match_update' && event.payload.new) {
        // Example: If admin closes voting, we might want to refresh
        // For now, simpler: just refresh if status changes drastically or force reload
        if (event.payload.new.status !== partidoActual.status) {
          window.location.reload();
        }
      }
    });
    return () => unsubscribe();
  }, [partidoActual?.id]);



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

  // Common wrapper styles
  const wrapperClass = 'min-h-[100dvh] w-screen p-0 flex flex-col';
  const cardClass = 'w-[90vw] max-w-[520px] mx-auto flex flex-col items-center justify-center min-h-[calc(100vh-120px)] p-5';
  // Updated title class to match Legacy 'voting-title-modern' but with Tailwind
  const titleClass = 'font-bebas text-[46px] md:text-[64px] text-white tracking-widest font-bold mb-10 text-center leading-[1.1] uppercase drop-shadow-lg';
  const btnClass = 'font-bebas text-[27px] md:text-[28px] text-white bg-primary border-2 border-white/20 rounded-2xl tracking-wide py-4 mt-4 w-full cursor-pointer font-bold transition-all duration-300 hover:brightness-110 hover:shadow-[0_4px_20px_rgba(129,120,229,0.5)] disabled:opacity-60 disabled:cursor-not-allowed relative overflow-hidden flex items-center justify-center';
  const textClass = 'text-white text-[26px] font-oswald text-center mb-[30px] tracking-wide';

  const openVotingLink = () => {
    // GUARD: Use cached matchId if available, avoid re-resolution
    if (resolvedMatchIdRef.current) {
      window.location.href = `/?partidoId=${resolvedMatchIdRef.current}`;
      return;
    }

    // Fallback: try URL params or partidoActual
    const urlParams = new URLSearchParams(window.location.search);
    const partidoIdParam = urlParams.get('partidoId');
    const codigoParam = urlParams.get('codigo');

    // Priority: use partidoId if available
    if (partidoIdParam || partidoActual?.id) {
      const id = partidoIdParam || partidoActual.id;
      window.location.href = `/?partidoId=${id}`;
    } else if (codigoParam || partidoActual?.codigo) {
      const codigo = codigoParam || partidoActual.codigo;
      window.location.href = `/?codigo=${codigo}`;
    } else {
      console.error('[VOTING] No partidoId or codigo available');
      toast.error('No se pudo abrir la votación');
    }
  };

  // Si es admin, volver a ArmarEquiposView (via onReset al AdminPanel)
  // Si no es admin, volver al inicio
  const handleFinalAction = () => {
    if (isAdmin) {
      window.history.back();
    } else {
      onReset();
    }
  };

  // Pantalla de carga
  if (cargandoVotoUsuario) {
    return (
      <div className={wrapperClass}>
        <div className={cardClass}>
          <LoadingSpinner size="large" />
        </div>
      </div>
    );
  }

  // Block if no access
  if (hasAccess === false) {
    return (
      <div className={wrapperClass}>
        <PageTitle title="CALIFICÁ A TUS COMPAÑEROS" onBack={onReset}>CALIFICÁ A TUS COMPAÑEROS</PageTitle>
        <div className="text-white/70 text-sm md:text-base font-oswald text-center mt-1">Calificá de forma justa para armar equipos equilibrados.</div>
        <div className={cardClass}>
          <div className={titleClass}>
            ACCESO DENEGADO
          </div>
          <div className={textClass}>
            No tienes permiso para votar en este partido.
          </div>
          {authzError && (
            <div className="text-white/70 text-base mb-5 font-oswald">
              {authzError}
            </div>
          )}
          <button
            className={btnClass}
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
      <div className={wrapperClass}>
        <PageTitle title="CALIFICÁ A TUS COMPAÑEROS" onBack={onReset}>CALIFICÁ A TUS COMPAÑEROS</PageTitle>
        <div className="text-white/70 text-sm md:text-base font-oswald text-center mt-1">Calificá de forma justa para armar equipos equilibrados.</div>
        <div className={cardClass}>
          <div className={titleClass}>
            ¡YA VOTASTE!
          </div>
          <div className={textClass}>
            Ya registraste tus votos.<br />No podés votar de nuevo en este partido.
          </div>
        </div>
      </div>
    );
  }

  // Paso 0: Identificarse
  if (step === 0) {
    return (
      <div className={wrapperClass}>
        <PageTitle title="CALIFICÁ A TUS COMPAÑEROS" onBack={onReset}>CALIFICÁ A TUS COMPAÑEROS</PageTitle>
        <div className="text-white/70 text-sm md:text-base font-oswald text-center mt-1">Calificá de forma justa para armar equipos equilibrados.</div>
        <div className={cardClass}>
          <div className={titleClass}>¿QUIÉN SOS?</div>
          <div className="grid grid-cols-2 gap-4 w-full max-w-[400px] mb-[18px]">
            {jugadores.map((j) => (
              <button
                key={j.uuid}
                className={`w-full bg-white/5 border border-white/20 text-white font-bebas text-2xl md:text-[2rem] py-3 text-center cursor-pointer transition-all hover:bg-white/15 min-h-[48px] flex items-center justify-center rounded-xl ${nombre === j.nombre ? 'bg-primary/40 border-primary' : ''}`}
                onClick={() => setNombre(j.nombre)}
                type="button"
              >
                <span className="relative z-10">{clean(j.nombre)}</span>
              </button>
            ))}
          </div>
          <button
            className={btnClass}
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
      <div className={wrapperClass}>
        <PageTitle title="CALIFICÁ A TUS COMPAÑEROS" onBack={onReset}>CALIFICÁ A TUS COMPAÑEROS</PageTitle>
        <div className="text-white/70 text-sm md:text-base font-oswald text-center mt-1">Calificá de forma justa para armar equipos equilibrados.</div>
        <div className={cardClass}>
          <div className={titleClass}>¡HOLA, {clean(nombre)}!</div>
          <div className="flex flex-col items-center mb-6">
            <div
              className={'w-64 h-64 md:w-[320px] md:h-[320px] bg-white/10 border-2 border-white/25 rounded-xl flex items-center justify-center shadow-lg relative overflow-hidden mx-auto mt-4 cursor-pointer hover:border-white/40 transition-all'}
              onClick={() => document.getElementById('foto-input').click()}
              title={fotoPreview ? 'Cambiar foto' : 'Agregar foto'}
            >
              {fotoPreview ? (
                <img
                  src={fotoPreview}
                  alt="foto"
                  className="w-full h-full object-cover bg-transparent"
                />
              ) : (
                <span className="text-white text-[60px] md:text-[82px] font-normal leading-none opacity-50 select-none pointer-events-none">+</span>
              )}
              <input
                id="foto-input"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFile}
              />
            </div>
          </div>
          {!fotoPreview && (
            <div className="text-[18px] text-white/70 text-center mb-6 font-oswald">
              Mandale selfie <br />
            </div>
          )}

          <div className="w-full flex flex-col gap-3 mt-2">
            {file && (
              <button
                className={`${btnClass} !mt-0`}
                style={{ background: 'rgba(255,255,255,0.17)', borderColor: '#fff' }}
                disabled={subiendoFoto}
                onClick={handleFotoUpload}
              >
                {subiendoFoto ? 'SUBIENDO...' : 'GUARDAR FOTO'}
              </button>
            )}
            <button
              className={`${btnClass} !mt-0`}
              onClick={() => setStep(2)}
            >
              {fotoPreview ? 'CONTINUAR' : 'CONTINUAR SIN FOTO'}
            </button>
          </div>
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
      setTimeout(() => setStep(3), 500);
      return (
        <div className={wrapperClass}>
          <PageTitle title="CALIFICÁ A TUS COMPAÑEROS" onBack={onReset}>CALIFICÁ A TUS COMPAÑEROS</PageTitle>
          <div className="text-white/70 text-sm md:text-base font-oswald text-center mt-1">Calificá de forma justa para armar equipos equilibrados.</div>
          <div className="w-[90vw] max-w-[520px] mx-auto mt-12 mb-12 flex flex-col items-center justify-center min-h-[calc(100vh-120px)] p-0">
            <div className="text-white/85 font-oswald text-lg">Votación completada</div>
          </div>
        </div>
      );
    }
    const jugadorVotar = jugadoresParaVotar[index];
    const valor = votos[jugadorVotar.uuid] || 0;

    return (
      <div className={wrapperClass}>
        <PageTitle title="CALIFICÁ A TUS COMPAÑEROS" onBack={onReset}>CALIFICÁ A TUS COMPAÑEROS</PageTitle>
        <div className="text-white/70 text-sm md:text-base font-oswald text-center mt-1">Calificá de forma justa para armar equipos equilibrados.</div>
        <div className="w-[90vw] max-w-[520px] mx-auto mt-12 mb-12 flex flex-col items-center justify-center min-h-[calc(100vh-120px)] p-0">
          <div className={`w-full transition-transform duration-200 ease-out ${animating ? '-translate-x-full opacity-0' : 'translate-x-0 opacity-100'}`}>
            <div className="w-[80vw] md:w-[320px] mx-auto bg-white/15 border-2 border-white/25 rounded-t-xl text-white font-bebas font-normal text-center uppercase text-[1.3rem] md:text-[2.1rem] tracking-wider py-2 mt-3 mb-0 shadow-sm">
              {clean(jugadorVotar.nombre)}
            </div>
            <div className="w-[80vw] h-[80vw] md:w-[320px] md:h-[320px] bg-white/10 border-2 border-white/25 border-t-0 rounded-b-xl flex items-center justify-center shadow-lg relative overflow-hidden mx-auto mt-0 mb-0">
              {jugadorVotar.avatar_url ? (
                <img src={jugadorVotar.avatar_url} alt="foto" className="w-full h-full object-cover" />
              ) : (
                <AvatarFallback name={jugadorVotar.nombre} size="w-full h-full" className="rounded-none text-[80px]" />
              )}
            </div>
            <div className="flex flex-col items-center mt-7 select-none">
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
                onRate={(valor) => {
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
            </div>

            <button
              className={`${btnClass} mt-[35px] mb-0 font-normal hover:shadow-none hover:brightness-105`}
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
              style={{ background: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.30)', color: 'rgba(255,255,255,0.90)' }}
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
      <div className={wrapperClass}>
        <PageTitle title="CONFIRMÁ TUS CALIFICACIONES" onBack={onReset}>CONFIRMÁ TUS CALIFICACIONES</PageTitle>
        <div className="w-[90vw] max-w-[520px] mx-auto mt-32 flex flex-col items-center p-3 pb-20">
          <div className="w-full max-w-full mx-auto mb-4 p-0 list-none">
            {jugadoresParaVotar.map((j, idx) => (
              <div key={j.uuid} className="flex items-center gap-2.5 mb-2 bg-white/10 rounded-lg p-2.5 border border-white/10 hover:bg-white/15 hover:border-white/20 transition-all">
                <div className="w-10 h-10 rounded-full overflow-hidden shrink-0">
                  {j.avatar_url ?
                    <img src={j.avatar_url} alt="foto" className="w-full h-full object-cover" />
                    : <AvatarFallback name={j.nombre} size="w-10 h-10" />
                  }
                </div>
                <span className="flex-grow font-bold text-base md:text-lg font-oswald text-white tracking-wide truncate drop-shadow-sm">{clean(j.nombre)}</span>
                <span className={`text-white text-lg md:text-xl font-black min-w-[60px] text-right font-bebas shrink-0 drop-shadow-sm tracking-wide ${!votos[j.uuid] ? 'opacity-70 font-normal text-sm' : ''}`}>
                  {votos[j.uuid] ? votos[j.uuid] + '/10' : 'No calif.'}
                </span>
                <button
                  className="bg-primary text-white text-[0.85em] px-3 py-1 rounded-lg font-bebas ml-1.5 hover:brightness-110 transition-all shadow-md shrink-0"
                  onClick={() => setEditandoIdx(idx)}
                >
                  EDITAR
                </button>
              </div>
            ))}
          </div>
          {hasAccess === false && (
            <div role="alert" className="bg-[#ff3b3026] border border-[#ff3b304d] rounded-lg p-3 text-white text-base font-oswald text-center mb-4">
              No tienes permiso para votar en este partido.
            </div>
          )}
          <button
            className={btnClass}
            style={{ fontWeight: 700, letterSpacing: '1.2px', marginTop: 'auto', minHeight: '44px' }}
            disabled={isSubmitting || hasAccess === false || hasAccess === null}
            onClick={async () => {
              // Anti-double submit guard
              if (isSubmitting) {
                console.debug('[Vote] blocked: submitting');
                return;
              }

              if (hasAccess === false) {
                console.error('[Vote] error', { message: 'Access denied', code: ERROR_CODES.ACCESS_DENIED });
                handleError(new AppError('No tienes permiso para votar en este partido.', ERROR_CODES.ACCESS_DENIED), { showToast: true, onError: () => { } });
                return;
              }

              // Validate payload
              const voteCount = Object.keys(votos).filter((k) => votos[k]).length;
              if (voteCount === 0) {
                console.debug('[Vote] invalid payload, abort');
                toast.error('Debes calificar al menos a un jugador');
                return;
              }

              console.debug('[Vote] start', { matchId: partidoActual?.id, playerId: jugador?.uuid, voteCount });

              setIsSubmitting(true);
              setConfirmando(true);

              try {
                // GUARD: Use cached matchId if available, avoid re-resolution
                let partidoId = resolvedMatchIdRef.current;

                if (!partidoId) {
                  // Fallback: resolve from URL params
                  const urlParams = new URLSearchParams(window.location.search);
                  const { partidoId: resolvedId, error } = await resolveMatchIdFromQueryParams(urlParams);

                  if (error || !resolvedId) {
                    throw new AppError(error || 'No se pudo resolver el partido', ERROR_CODES.VALIDATION_ERROR);
                  }
                  partidoId = resolvedId;
                }

                // Build safe payload for logging
                const safePayload = {
                  partidoId,
                  jugadorUuid: jugador?.uuid,
                  voteCount,
                  hasNombre: !!jugador?.nombre,
                };
                console.debug('[Vote] build payload', safePayload);
                console.debug('[Vote] submit sending');

                await submitVotos(votos, jugador?.uuid, partidoId, jugador?.nombre, jugador?.avatar_url);

                console.debug('[Vote] submit result', { ok: true });

                // Trigger refresh for admin panel (updated_at handled by trigger)
                await supabase.from('partidos').update({ status: 'voted' }).eq('id', partidoId);

                console.debug('[Vote] step change', { from: 3, to: 'finalizado' });
                setFinalizado(true);
              } catch (error) {
                console.error('[Vote] error', { message: error?.message, code: error?.code });
                console.debug('[Vote] submit result', { ok: false });
                handleError(error, { showToast: true, onError: () => { } });
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
      <div className={wrapperClass}>
        <PageTitle title="CALIFICÁ A TUS COMPAÑEROS" onBack={onReset}>CALIFICÁ A TUS COMPAÑEROS</PageTitle>
        <div className="text-white/70 text-sm md:text-base font-oswald text-center mt-1">Calificá de forma justa para armar equipos equilibrados.</div>
        <div className={cardClass}>
          <div className={titleClass}>
            ¡GRACIAS POR VOTAR!
          </div>
          <div className={`${textClass} text-[27px] mb-[27px] tracking-[1.1px]`}>
            Tus votos fueron registrados.<br />Podés cerrar esta ventana.
          </div>
          <button
            className={btnClass}
            style={{ marginTop: 16 }}
            onClick={handleFinalAction}
          >VOLVER</button>
        </div>
      </div>
    );
  }

  return null;
}
