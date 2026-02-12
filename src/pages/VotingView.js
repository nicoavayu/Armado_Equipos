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
import PageTitle from '../components/PageTitle';
import MatchInfoSection from '../components/MatchInfoSection';
import normalizePartidoForHeader from '../utils/normalizePartidoForHeader';
import StarRating from '../components/StarRating';
import { AvatarFallback } from '../components/ProfileComponents';
import EmptyStateCard from '../components/EmptyStateCard';
import PageLoadingState from '../components/PageLoadingState';

// Styles are now handled via Tailwind CSS
// Legacy styles: src/pages/LegacyVoting.css (for other components)

// Feature flag for XSS sanitization
const SANITIZE_ON = process.env.REACT_APP_SANITIZE_VOTING === 'true';
const clean = (value) => SANITIZE_ON ? DOMPurify.sanitize(String(value ?? '')) : String(value ?? '');

// Debug logging
const DEBUG = false;


export default function VotingView({ onReset, jugadores, partidoActual }) {
  const urlParams = new URLSearchParams(window.location.search);
  const isPublicRoute = window.location.pathname.includes('/votar-equipos') || urlParams.has('codigo');
  const isPublicVoting = isPublicRoute;
  const isGuestPlayer = (player) => {
    const userId = player?.usuario_id;
    return !userId || String(userId).startsWith('guest_');
  };
  const jugadoresIdentificacion = isPublicVoting
    ? jugadores.filter(isGuestPlayer)
    : jugadores;

  const resolvePublicStorageKey = () => {
    const pidFromRef = resolvedMatchIdRef.current;
    if (pidFromRef) return `public_voter_name_${pidFromRef}`;
    const pidParam = urlParams.get('partidoId');
    const pid = pidParam ? Number(pidParam) : (partidoActual?.id ? Number(partidoActual.id) : null);
    return pid ? `public_voter_name_${pid}` : null;
  };
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
  const [publicAlreadyVoted, setPublicAlreadyVoted] = useState(false);
  const [checkingPublicVoter, setCheckingPublicVoter] = useState(false);

  // Chequeo global: ¿El usuario actual ya votó?
  const [usuarioYaVoto, setUsuarioYaVoto] = useState(false);
  const [cargandoVotoUsuario, setCargandoVotoUsuario] = useState(true);

  // Permission control
  const [hasAccess, setHasAccess] = useState(null); // null = loading, true/false = resolved
  const [authzError, setAuthzError] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [useAuthenticatedSubmit, setUseAuthenticatedSubmit] = useState(false);

  // -- GUARDS FOR DOUBLE-FETCH PREVENTION --
  // Prevent React Strict Mode double-init
  const didInitRef = useRef(false);
  // Cache resolved matchId to avoid re-resolution
  const resolvedMatchIdRef = useRef(null);
  // Lock to prevent state changes once voter is detected as duplicate
  const lockedRef = useRef(false);

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

        // Check for authenticated user first (even on public routes)
        const { data: { user } } = await supabase.auth.getUser();

        let matchPlayer = null;
        let isCreator = false;

        if (user?.id) {
          userId = user.id;
          try {
            // Check if user is match creator
            const { data: partidoData, error: partidoError } = await supabase
              .from('partidos')
              .select('creado_por')
              .eq('id', partidoId)
              .single();

            if (!partidoError) {
              isCreator = partidoData?.creado_por === user.id;
            }

            // Check if user is in match roster
            const { data: jugadoresPartido, error: jugadoresError } = await supabase
              .from('jugadores')
              .select('usuario_id, nombre')
              .eq('partido_id', partidoId);

            if (!jugadoresError) {
              matchPlayer = jugadoresPartido?.find((j) => j.usuario_id === user.id);
            }
          } catch (err) {
            console.warn('[VOTING] Check roster failed', err);
          }
        }

        // If user is recognized as player or creator, use authenticated logic
        if (userId && (matchPlayer || isCreator)) {
          setHasAccess(true);
          setIsAdmin(isCreator);
          setUseAuthenticatedSubmit(true);

          if (matchPlayer) {
            setNombre(matchPlayer.nombre);
            setStep(1); // Skip identification step
          }
        } else if (isPublicVoting) {
          // Fallback to guest logic
          setHasAccess(true);
          setIsAdmin(false);
          setUseAuthenticatedSubmit(false);
          // If logged in but not in match, treat as guest (or should we use their auth ID for guest voting? 
          // Requirements imply guests select name from list. Let's keep guest ID logic unless they are in roster)

          if (typeof getGuestSessionId === 'function') {
            userId = getGuestSessionId(partidoId);
          } else {
            userId = `guest_${partidoId}_${Date.now()}`;
          }
        } else {
          // Not public, not in roster -> Denied
          setAuthzError('No tienes permiso para votar en este partido');
          setHasAccess(false);
          return setCargandoVotoUsuario(false);
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
        // Force reload on any significant change to catch resets or status transitions
        const newStatus = event.payload.new.estado || event.payload.new.status;
        const oldStatus = partidoActual.estado || partidoActual.status;
        const newUpdate = event.payload.new.updated_at;
        const oldUpdate = partidoActual.updated_at;

        if (newStatus !== oldStatus || (newUpdate && newUpdate !== oldUpdate)) {
          if (DEBUG) console.debug('[RT] Reloading due to match update:', { newStatus, newUpdate });
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

  // Modo público: precargar nombre desde localStorage si existe
  useEffect(() => {
    if (!isPublicRoute) return;
    if (nombre) return;
    if (!jugadores || jugadores.length === 0) return;

    const storageKey = resolvePublicStorageKey();
    if (!storageKey) return;

    const savedName = localStorage.getItem(storageKey);
    if (!savedName) return;

    const match = jugadoresIdentificacion.find((j) => j.nombre === savedName);
    if (match) {
      setNombre(savedName);
      setStep(1);
    }
  }, [isPublicRoute, nombre, jugadores, jugadoresIdentificacion]);

  // Guard: Lock voter if already voted
  useEffect(() => {
    if (publicAlreadyVoted || usuarioYaVoto || finalizado) {
      if (!lockedRef.current) {
        lockedRef.current = true;
        if (DEBUG) console.debug('[Guard] Voter locked - already voted');
      }
    }
  }, [publicAlreadyVoted, usuarioYaVoto, finalizado]);

  // -- FIN HOOKS --

  // Common wrapper styles
  const wrapperClass = 'min-h-[100dvh] w-screen p-0 flex flex-col';
  const cardClass = 'w-[90vw] max-w-[520px] mx-auto flex flex-col items-center justify-center min-h-[calc(100vh-120px)] p-5';
  // Updated title class to match Legacy 'voting-title-modern' but with Tailwind
  const titleClass = 'font-bebas text-[40px] md:text-[64px] text-white tracking-widest font-bold mb-10 text-center leading-[1.1] uppercase drop-shadow-lg';
  const btnClass = 'font-bebas text-[27px] md:text-[28px] text-white bg-primary border-2 border-white/20 rounded-2xl tracking-wide py-4 mt-4 w-full cursor-pointer font-bold transition-all duration-300 hover:brightness-110 hover:shadow-[0_4px_20px_rgba(129,120,229,0.5)] disabled:opacity-60 disabled:cursor-not-allowed relative overflow-hidden flex items-center justify-center';
  const textClass = 'text-white text-[21px] md:text-[26px] font-oswald text-center mb-[30px] tracking-wide';

  // Guard: Check if should show final screen (happy path or already voted)
  const shouldShowFinal = publicAlreadyVoted || usuarioYaVoto || finalizado;

  // Si es admin, volver a ArmarEquiposView (via onReset al AdminPanel)
  // Si no es admin, volver al inicio
  const handleFinalAction = () => {
    if (isAdmin) {
      window.history.back();
    } else {
      onReset();
    }
  };

  // ============ EARLY GUARD: Return final screen if already voted ============
  if (lockedRef.current || publicAlreadyVoted || usuarioYaVoto || finalizado) {
    if (DEBUG) console.debug('[Guard] Rendering final screen - voter locked or already voted', { publicAlreadyVoted, usuarioYaVoto, finalizado, locked: lockedRef.current });
    return (
      <div className={wrapperClass}>
        <PageTitle title="CALIFICÁ A TUS COMPAÑEROS" onBack={onReset}>CALIFICÁ A TUS COMPAÑEROS</PageTitle>
        <div className="text-white/70 text-sm md:text-base font-oswald text-center mt-1">Calificá de forma justa para armar equipos equilibrados.</div>
        <div className={cardClass}>
          <div className={titleClass}>
            {publicAlreadyVoted ? '¡YA VOTASTE!' : '¡GRACIAS POR VOTAR!'}
          </div>
          <div className={`${textClass} text-[22px] md:text-[25px] leading-[1.25] mb-[27px] tracking-[0.8px]`}>
            {publicAlreadyVoted
              ? 'Tus votos ya fueron registrados ✅'
              : <>Tus votos fueron registrados.<br />Podés cerrar esta ventana.</>}
          </div>
          <button
            className={`${btnClass} mt-4`}
            onClick={handleFinalAction}
          >VOLVER</button>
        </div>
      </div>
    );
  }

  // ============ EARLY GUARD: Return final screen if already voted or voted successfully ============
  if (shouldShowFinal) {
    if (DEBUG) console.debug('[Guard] Rendering final screen', { publicAlreadyVoted, usuarioYaVoto, finalizado });
    return (
      <div className={wrapperClass}>
        <PageTitle title="CALIFICÁ A TUS COMPAÑEROS" onBack={onReset}>CALIFICÁ A TUS COMPAÑEROS</PageTitle>
        <div className="text-white/70 text-sm md:text-base font-oswald text-center mt-1">Calificá de forma justa para armar equipos equilibrados.</div>
        <div className={cardClass}>
          <div className={titleClass}>
            {publicAlreadyVoted || usuarioYaVoto ? '¡YA VOTASTE!' : '¡GRACIAS POR VOTAR!'}
          </div>
          <div className={`${textClass} text-[22px] md:text-[25px] leading-[1.25] mb-[27px] tracking-[0.8px]`}>
            {publicAlreadyVoted || usuarioYaVoto
              ? 'Tus votos ya fueron registrados ✅'
              : <>Tus votos fueron registrados.<br />Podés cerrar esta ventana.</>}
          </div>
          <button
            className={`${btnClass} mt-4`}
            onClick={onReset}
          >VOLVER</button>
        </div>
      </div>
    );
  }

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

  const handleConfirmNombre = async () => {
    // Guard: Check if already locked/voted
    if (lockedRef.current) {
      if (DEBUG) console.debug('[Guard] handleConfirmNombre blocked - voter locked');
      return;
    }

    if (isPublicRoute) {
      const allowedNames = new Set(jugadoresIdentificacion.map((j) => j.nombre));
      if (!allowedNames.has(nombre)) {
        toast.error('Seleccioná un jugador invitado (sin cuenta)');
        return;
      }

      const storageKey = resolvePublicStorageKey();
      if (storageKey && nombre) {
        localStorage.setItem(storageKey, nombre);
      }

      const partidoIdParam = urlParams.get('partidoId');
      const codigoParam = urlParams.get('codigo');
      const partidoId = partidoIdParam ? parseInt(partidoIdParam, 10) : (resolvedMatchIdRef.current || partidoActual?.id);
      const codigo = codigoParam ? codigoParam.trim().toUpperCase() : null;

      if (!partidoId || Number.isNaN(partidoId) || !codigo || !nombre) {
        toast.error('No se pudo validar tu votación');
        return;
      }

      setCheckingPublicVoter(true);
      try {
        const { data, error } = await supabase.rpc('public_has_voter_already_voted', {
          p_partido_id: partidoId,
          p_codigo: codigo,
          p_votante_nombre: nombre,
        });

        if (error) {
          toast.error('No se pudo validar tu votación');
        } else if (data === true) {
          lockedRef.current = true;
          setPublicAlreadyVoted(true);
          if (DEBUG) console.debug('[Guard] handleConfirmNombre detected duplicate - locked');
          return;
        }
      } catch (err) {
        toast.error('No se pudo validar tu votación');
      } finally {
        setCheckingPublicVoter(false);
      }
    }

    setStep(1);
  };

  // Si es admin, volver a ArmarEquiposView (via onReset al AdminPanel)
  // Si no es admin, volver al inicio


  // Pantalla de carga
  if (cargandoVotoUsuario) {
    return (
      <div className={wrapperClass}>
        <div className={cardClass}>
          <PageLoadingState
            title="VALIDANDO VOTACIÓN"
            description="Chequeando tu acceso al partido."
          />
        </div>
      </div>
    );
  }

  // Block if no access
  if (hasAccess === false && !isPublicVoting) {
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
          {jugadoresIdentificacion.length === 0 ? (
            <EmptyStateCard
              title="SIN JUGADORES PARA IDENTIFICAR"
              description="Este link no tiene invitados válidos para votar en este partido."
              actionLabel="VOLVER AL INICIO"
              onAction={onReset}
              className="max-w-[400px] my-2"
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 w-full max-w-[400px] mb-[18px]">
                {jugadoresIdentificacion.map((j) => (
                  <button
                    key={j.uuid || j.id || j.nombre}
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
                onClick={handleConfirmNombre}
              >
                {checkingPublicVoter ? 'VERIFICANDO...' : 'CONFIRMAR'}
              </button>
            </>
          )}
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
              className={`${btnClass} !w-auto !min-w-[230px] !px-8 !py-2.5 !text-[16px] md:!text-[18px] mt-6 mb-0 mx-auto font-normal tracking-[1px] hover:shadow-none hover:brightness-105`}
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
            className="w-full font-bebas text-[20px] md:text-[22px] text-white bg-primary border border-white/20 rounded-xl tracking-wider py-3.5 mt-4 font-bold transition-all duration-300 hover:brightness-110 hover:shadow-[0_6px_20px_rgba(129,120,229,0.45)] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ marginTop: 'auto', minHeight: '44px' }}
            disabled={isSubmitting || hasAccess === false || hasAccess === null}
            onClick={async () => {
              // Anti-double submit guard
              if (isSubmitting) {
                console.debug('[Vote] blocked: submitting');
                return;
              }

              if (hasAccess === false && !isPublicVoting) {
                console.error('[Vote] error', { message: 'Access denied', code: ERROR_CODES.ACCESS_DENIED });
                handleError(new AppError('No tienes permiso para votar en este partido.', ERROR_CODES.ACCESS_DENIED), { showToast: true, onError: () => { } });
                return;
              }

              setIsSubmitting(true);
              setConfirmando(true);

              try {
                if (isPublicVoting && !useAuthenticatedSubmit) {
                  const partidoIdParam = urlParams.get('partidoId');
                  const codigoParam = urlParams.get('codigo');
                  const partidoId = partidoIdParam ? parseInt(partidoIdParam, 10) : (resolvedMatchIdRef.current || partidoActual?.id);

                  if (!partidoId || Number.isNaN(partidoId)) {
                    toast.error('No se pudo resolver el partido para votar');
                    return;
                  }

                  // Get codigo from URL or from partidoActual (already loaded in memory)
                  let codigo = codigoParam ? codigoParam.trim().toUpperCase() : null;

                  console.log('[VOTING] Codigo resolution:', {
                    codigoParam,
                    codigo,
                    partidoActualCodigo: partidoActual?.codigo,
                    partidoActual: partidoActual ? 'loaded' : 'null'
                  });

                  if (!codigo && partidoActual?.codigo) {
                    codigo = partidoActual.codigo;
                    console.log('[VOTING] Using codigo from partidoActual:', codigo);
                  }

                  // Fallback: generate codigo from partidoId if missing
                  if (!codigo && partidoId) {
                    codigo = `M${partidoId}`;
                    console.log('[VOTING] Generated fallback codigo:', codigo);
                  }

                  // codigo is still required for RPC calls
                  if (!codigo) {
                    console.error('[VOTING] No codigo available:', {
                      codigoParam,
                      partidoActualCodigo: partidoActual?.codigo,
                      partidoActualKeys: partidoActual ? Object.keys(partidoActual) : [],
                      partidoActualFull: partidoActual
                    });
                    toast.error('Código de votación inválido');
                    return;
                  }
                  if (!nombre) {
                    toast.error('Seleccioná tu nombre para votar');
                    return;
                  }

                  const mapScore = (value) => {
                    const num = Number(value);
                    if (!Number.isFinite(num)) return null;
                    if (num >= 1 && num <= 5) return num;
                    if (num >= 1 && num <= 10) return Math.min(5, Math.max(1, Math.ceil(num / 2)));
                    return null;
                  };

                  const resultados = { ok: 0, already: 0, invalid: 0 };
                  const ratedPlayerIds = Object.keys(votos).filter(k => votos[k] !== undefined && votos[k] !== null);

                  if (ratedPlayerIds.length === 0) {
                    console.debug('[VOTING] No players rated, aborting public submit');
                    toast.error('Debes calificar al menos a un jugador');
                    setIsSubmitting(false);
                    setConfirmando(false);
                    return;
                  }

                  console.debug('[VOTING] Starting public submit', { playerIds: ratedPlayerIds, voterName: nombre });

                  for (const j of jugadoresParaVotar) {
                    if (!j?.id) {
                      console.error('[VOTING] Missing numeric player id for public vote', {
                        jugadorNombre: j?.nombre,
                        jugadorUuid: j?.uuid,
                        partidoId,
                      });
                      resultados.invalid += 1;
                      continue;
                    }

                    const rawVote = votos[j.uuid];

                    if (rawVote === undefined || rawVote === null) {
                      const { data, error } = await supabase.rpc('public_submit_no_lo_conozco', {
                        p_partido_id: partidoId,
                        p_codigo: codigo,
                        p_votante_nombre: nombre,
                        p_votado_jugador_id: j.id,
                      });

                      if (error) {
                        resultados.invalid += 1;
                        toast.error('No se pudo enviar un voto');
                        continue;
                      }

                      const result = data?.result || data;
                      if (result === 'already_voted_session') {
                        lockedRef.current = true;
                        setPublicAlreadyVoted(true);
                        toast.info('Tus votos ya fueron registrados ✅');
                        return;
                      }
                      if (result === 'already_voted_for_match') {
                        lockedRef.current = true;
                        setPublicAlreadyVoted(true);
                        toast.info('Tus votos ya fueron registrados ✅');
                        if (DEBUG) console.debug('[Guard] First RPC detected duplicate - locked');
                        return;
                      }
                      if (result === 'already_voted_for_player') {
                        resultados.already += 1;
                        continue;
                      }
                      if (result === 'invalid' || result === 'invalid_player') {
                        resultados.invalid += 1;
                        toast.error('Jugador inválido');
                        continue;
                      }
                      resultados.ok += 1;
                      continue;
                    }

                    const puntaje = mapScore(rawVote);
                    if (!puntaje) {
                      resultados.invalid += 1;
                      toast.error('Puntaje inválido');
                      continue;
                    }

                    const { data, error } = await supabase.rpc('public_submit_player_rating', {
                      p_partido_id: partidoId,
                      p_codigo: codigo,
                      p_votante_nombre: nombre,
                      p_votado_jugador_id: j.id,
                      p_puntaje: puntaje,
                    });

                    if (error) {
                      console.error('[VOTING] public_submit_player_rating error:', {
                        error,
                        errorMessage: error.message,
                        errorDetails: error.details,
                        errorHint: error.hint,
                        errorCode: error.code,
                        partidoId,
                        codigo,
                        nombre,
                        jugadorId: j.id,
                        jugadorUuid: j.uuid,
                        puntaje
                      });
                      resultados.invalid += 1;
                      toast.error(`No se pudo enviar el voto para ${j.nombre}`);
                      continue;
                    }

                    const result = data?.result || data;
                    if (result === 'already_voted_session') {
                      lockedRef.current = true;
                      setPublicAlreadyVoted(true);
                      toast.info('Tus votos ya fueron registrados ✅');
                      return;
                    }
                    if (result === 'already_voted_for_match') {
                      lockedRef.current = true;
                      setPublicAlreadyVoted(true);
                      toast.info('Tus votos ya fueron registrados ✅');
                      if (DEBUG) console.debug('[Guard] Second RPC detected duplicate - locked');
                      return;
                    }
                    if (result === 'already_voted_for_player') {
                      resultados.already += 1;
                      continue;
                    }
                    if (result === 'invalid' || result === 'invalid_player') {
                      resultados.invalid += 1;
                      toast.error('Jugador inválido');
                      continue;
                    }
                    resultados.ok += 1;
                  }

                  console.debug('[Vote] public submit result (before completion mark)', resultados);

                  // Evita falso positivo: no marcar "votó" si no hubo ningún voto válido persistido.
                  if (resultados.ok <= 0) {
                    toast.error('No se registró ningún voto válido. Probá de nuevo.');
                    return;
                  }

                  // ✅ Marcar que este votante ya confirmó (bloquea re-voto por nombre)
                  const { data: doneData, error: doneError } = await supabase.rpc('public_mark_voter_completed', {
                    p_partido_id: partidoId,
                    p_codigo: codigo,
                    p_votante_nombre: nombre,
                  });

                  if (doneError) {
                    console.warn('[Vote] could not mark completed', doneError);
                  } else {
                    const r = doneData?.result || doneData;
                    if (r === 'already_completed') {
                      lockedRef.current = true;
                      setPublicAlreadyVoted(true);
                      toast.info('Tus votos ya fueron registrados ✅');
                      if (DEBUG) console.debug('[Guard] Mark completed detected duplicate - locked');
                      return;
                    }
                  }

                  if (resultados.invalid > 0) {
                    toast.warn('Se guardaron votos, pero algunos jugadores no se pudieron procesar.');
                  } else {
                    toast.success('Votos enviados');
                  }
                  console.debug('[Vote] public submit result (final)', resultados);
                  lockedRef.current = true;
                  setFinalizado(true);
                } else {
                  // Validate payload
                  const voteCount = Object.keys(votos).filter((k) => votos[k]).length;
                  if (voteCount === 0) {
                    console.debug('[Vote] invalid payload, abort');
                    toast.error('Debes calificar al menos a un jugador');
                    return;
                  }

                  console.debug('[Vote] start', { matchId: partidoActual?.id, playerId: jugador?.uuid, voteCount });

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
                  lockedRef.current = true;
                  setFinalizado(true);
                }
              } catch (error) {
                console.error('[Vote] error', { message: error?.message, code: error?.code });
                console.debug('[Vote] submit result', { ok: false });
                if (isPublicVoting) {
                  toast.error('No se pudo enviar tus votos');
                } else {
                  handleError(error, { showToast: true, onError: () => { } });
                }
              } finally {
                setConfirmando(false);
                setIsSubmitting(false);
              }
            }}
          >
            {isSubmitting ? 'GUARDANDO...' : 'CONFIRMAR'}
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
            {publicAlreadyVoted ? '¡YA VOTASTE!' : '¡GRACIAS POR VOTAR!'}
          </div>
          <div className={`${textClass} text-[22px] md:text-[25px] leading-[1.25] mb-[27px] tracking-[0.8px]`}>
            {publicAlreadyVoted
              ? 'Tus votos ya fueron registrados ✅'
              : <>Tus votos fueron registrados.<br />Podés cerrar esta ventana.</>}
          </div>
          <button
            className={`${btnClass} mt-4`}
            onClick={handleFinalAction}
          >VOLVER</button>
        </div>
      </div>
    );
  }

  return null;
}
