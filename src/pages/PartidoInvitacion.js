import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../components/AuthProvider';
import { isUserMemberOfMatch, clearGuestMembership } from '../utils/membershipCheck';
import { formatLocalDateShort } from '../utils/dateLocal';
import LoadingSpinner from '../components/LoadingSpinner';
import { toast } from 'react-toastify';
import PageTitle from '../components/PageTitle';
import MatchInfoSection from '../components/MatchInfoSection';
import normalizePartidoForHeader from '../utils/normalizePartidoForHeader';
import { PlayerCardTrigger } from '../components/ProfileComponents';

/**
 * Pantalla pública de invitación a un partido
 */

// Helper function to get initials from name
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function PlayersReadOnly({ jugadores, partido, mode }) {
  const cupoMaximo = partido.cupo_jugadores || partido.cupo || 'Sin límite';
  const displayCount = jugadores?.length ?? 0;

  return (
    <div className="w-full bg-white/10 border-2 border-white/20 rounded-xl p-3 box-border min-h-[120px]">
      <div className="flex items-start justify-between gap-3 mb-3 mt-1 px-1">
        <div className="font-bebas text-xl text-white tracking-wide uppercase">
          JUGADORES ({displayCount}/{cupoMaximo})
        </div>
      </div>

      {displayCount === 0 ? (
        <div className="text-center text-white/40 font-oswald text-base p-5 italic">
          Aún no hay jugadores anotados.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 w-full max-w-[720px] mx-auto justify-items-center box-border">
          {jugadores.map((j) => (
            <PlayerCardTrigger key={j.uuid || j.id} profile={j} partidoActual={partido}>
              <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg p-2 transition-all min-h-[36px] w-full hover:bg-slate-800 cursor-pointer">
                {j.foto_url || j.avatar_url ? (
                  <img
                    src={j.foto_url || j.avatar_url}
                    alt={j.nombre}
                    className="w-8 h-8 rounded-full object-cover border border-slate-700 bg-slate-800 shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 border border-slate-700 flex items-center justify-center text-xs font-bold shrink-0 text-white">
                    {getInitials(j.nombre)}
                  </div>
                )}
                <span className="flex-1 font-oswald text-sm font-semibold text-white tracking-wide min-w-0 break-words leading-tight">
                  {j.nombre || 'Jugador'}
                </span>
                {partido?.creado_por === j.usuario_id && (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="16" height="16" fill="#FFD700" style={{ flexShrink: 0 }}>
                    <path d="M345 151.2C354.2 143.9 360 132.6 360 120C360 97.9 342.1 80 320 80C297.9 80 280 97.9 280 120C280 132.6 285.9 143.9 295 151.2L226.6 258.8C216.6 274.5 195.3 278.4 180.4 267.2L120.9 222.7C125.4 216.3 128 208.4 128 200C128 177.9 110.1 160 88 160C65.9 160 48 177.9 48 200C48 221.8 65.5 239.6 87.2 240L119.8 457.5C124.5 488.8 151.4 512 183.1 512L456.9 512C488.6 512 515.5 488.8 520.2 457.5L552.8 240C574.5 239.6 592 221.8 592 200C592 177.9 574.1 160 552 160C529.9 160 512 177.9 512 200C512 208.4 514.6 216.3 519.1 222.7L459.7 267.3C444.8 278.5 423.5 274.6 413.5 258.9L345 151.2z" />
                  </svg>
                )}
              </div>
            </PlayerCardTrigger>
          ))}
        </div>
      )}
    </div>
  );
}

function SharedInviteLayout({
  partido,
  jugadores,
  title,
  showChatIcon,
  ctaVariant,
  submitting,
  onSumarse,
  onNavigateHome,
  onNavigateBack,
  codigoValido,
  mode,
  joinStatus
}) {
  const isSent = joinStatus === 'pending';
  const isApproved = joinStatus === 'approved';
  const isPendingSync = joinStatus === 'approved_pending_sync';
  const isSending = submitting && joinStatus === 'none';

  return (
    <div className="min-h-[100dvh] w-screen max-w-[100vw] pb-24 overflow-x-hidden bg-fifa-gradient">
      <div className="mx-auto w-[90vw] max-w-[650px] pt-5 shadow-none">
        <PageTitle
          title={title}
          onBack={onNavigateBack}
          showChatButton={showChatIcon}
          onChatClick={() => toast.info('Iniciá sesión para chatear')}
        />

        <MatchInfoSection
          partido={normalizePartidoForHeader(partido)}
          fecha={partido?.fecha}
          hora={partido?.hora}
          sede={partido?.sede}
          modalidad={partido?.modalidad}
          tipo={partido?.tipo_partido}
          precio={partido?.precio || partido?.valor_cancha || partido?.valor}
        />

        <main className="pb-20 pt-0">
          <div className="main-content">
            <div className="w-full flex flex-col gap-3 overflow-x-hidden pt-10 pb-[70px]">
              <PlayersReadOnly jugadores={jugadores} partido={partido} mode={mode} />

              {/* Texto de estado si faltan jugadores */}
              {(!partido.cupo_jugadores || jugadores.length < partido.cupo_jugadores) && (
                <div className="mt-4 text-center text-white/60 font-oswald text-sm">
                  {partido.cupo_jugadores
                    ? `Falta${partido.cupo_jugadores - jugadores.length > 1 ? 'n' : ''} ${partido.cupo_jugadores - jugadores.length} jugador${partido.cupo_jugadores - jugadores.length > 1 ? 'es' : ''}`
                    : 'Cupos disponibles'}
                </div>
              )}

              {/* CTA */}
              <div className="w-full max-w-[500px] mx-auto mt-6 px-0 text-center">
                {ctaVariant === 'public' ? (
                  <div className="flex flex-col gap-3 w-full">
                    <button
                      onClick={onSumarse}
                      disabled={submitting || isSent || isApproved || isPendingSync || joinStatus === 'checking'}
                      className={`w-full py-3 rounded-xl font-bebas text-lg tracking-widest transition-all uppercase font-bold border-2 border-white/10 ${joinStatus === 'checking'
                        ? 'bg-white/10 text-white/60 cursor-wait shadow-none'
                        : isPendingSync
                          ? 'bg-emerald-500/70 text-white cursor-wait shadow-none'
                          : isSent || isApproved
                            ? 'bg-[#128BE9] opacity-60 text-white/80 cursor-not-allowed shadow-none'
                            : 'bg-[#128BE9] text-white hover:brightness-110 active:scale-[0.98]'
                        }`}
                    >
                      {joinStatus === 'checking' ? (
                        <span className="flex items-center justify-center gap-2">
                          <LoadingSpinner size="small" />
                          VERIFICANDO...
                        </span>
                      ) : isPendingSync ? (
                        <span className="flex items-center justify-center gap-2">
                          <LoadingSpinner size="small" />
                          APROBADO — SINCRONIZANDO...
                        </span>
                      ) : isSending ? 'ENVIANDO...' :
                        isSent ? 'SOLICITUD ENVIADA' :
                          isApproved ? 'YA FORMÁS PARTE' :
                            'SOLICITAR UNIRME'}
                    </button>

                    {isSent && (
                      <p className="text-white/70 font-oswald text-sm mt-1">
                        Esperando aprobación del admin.
                      </p>
                    )}
                    {isApproved && (
                      <p className="text-emerald-400 font-oswald text-sm mt-1">
                        Ya sos parte del partido. Entrás desde Mis partidos.
                      </p>
                    )}
                    {isPendingSync && (
                      <p className="text-emerald-300 font-oswald text-sm mt-1">
                        Tu solicitud fue aprobada. Sincronizando acceso...
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 w-full">
                    <button
                      onClick={onSumarse}
                      disabled={!codigoValido || submitting}
                      className="w-full bg-primary text-white py-4 rounded-xl font-bebas text-xl tracking-widest hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 uppercase font-bold border-2 border-white/10"
                    >
                      {submitting ? 'Sumándote...' : 'ACEPTAR INVITACIÓN'}
                    </button>
                    <button
                      onClick={onNavigateHome}
                      className="w-full bg-slate-800/80 text-white/70 py-3 rounded-xl font-bebas text-lg tracking-widest hover:bg-slate-700 hover:text-white transition-all border border-white/10 active:scale-95 uppercase font-bold"
                    >
                      NO PUEDO
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function PartidoInvitacion({ mode = 'invite' }) {
  const [jugadores, setJugadores] = useState([]);
  const { partidoId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const [partido, setPartido] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [step, setStep] = useState('invitation'); // 'invitation', 'choose-method', 'guest-form', 'success', 'already-joined'
  const [guestName, setGuestName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [codigoValido, setCodigoValido] = useState(true); // Flag de validación de código
  const [alreadyJoined, setAlreadyJoined] = useState(false);
  const [joinStatus, setJoinStatus] = useState('checking'); // 'checking', 'none', 'pending', 'approved', 'approved_pending_sync'
  const [joinSubmitting, setJoinSubmitting] = useState(false);

  // Anti-race condition: track request ID
  const reqIdRef = useRef(0);

  // Obtener código del query param
  const codigoParam = searchParams.get('codigo');

  // Clear guest localStorage when authenticated user accesses match
  useEffect(() => {
    if (user && partidoId) {
      clearGuestMembership(partidoId);
    }
  }, [user, partidoId]);

  // Verificar idempotencia: si ya se sumó como guest
  useEffect(() => {
    if (!partidoId) return;
    const storageKey = `guest_joined_${partidoId}`;
    const existingGuestUuid = localStorage.getItem(storageKey);
    if (existingGuestUuid) {
      setAlreadyJoined(true);
      setStep('already-joined');
    }
  }, [partidoId]);

  // Cargar datos del partido según modo
  useEffect(() => {
    async function loadPartido() {
      // 1. HARD RESET: Clear all states at start
      const reqId = ++reqIdRef.current;

      // Reset states based on user auth
      if (user) {
        setJoinStatus('checking');
      } else {
        setJoinStatus('none');
      }
      setSubmitting(false);
      setJoinSubmitting(false);

      console.log('[LOAD_PARTIDO] Starting load', { partidoId, mode, user: !!user, reqId });

      if (!partidoId) {
        setError('Partido no encontrado');
        setLoading(false);
        return;
      }

      if (mode === 'public') {
        try {
          const { data, error: fetchError } = await supabase
            .from('partidos')
            .select('*')
            .eq('id', partidoId)
            .maybeSingle();

          // Check if this request is stale
          if (reqId !== reqIdRef.current) {
            console.log('[LOAD_PARTIDO] Aborting stale request (after partido fetch)', { reqId, current: reqIdRef.current });
            return;
          }

          if (fetchError || !data) {
            setError('Partido no encontrado');
            setLoading(false);
            return;
          }

          const { data: jugadoresData, count } = await supabase
            .from('jugadores')
            .select('*', { count: 'exact' })
            .eq('partido_id', partidoId);

          // Check if this request is stale
          if (reqId !== reqIdRef.current) {
            console.log('[LOAD_PARTIDO] Aborting stale request (after jugadores fetch)', { reqId, current: reqIdRef.current });
            return;
          }

          setPartido({ ...data, jugadoresCount: count || 0 });
          setJugadores(jugadoresData || []);

          // If no user, set to 'none' and skip membership check
          if (!user) {
            console.log('[LOAD_PARTIDO] No user, setting status: none', { reqId });
            setJoinStatus('none');
            setLoading(false);
            return;
          }

          // User is authenticated - check membership
          console.log('[PUBLIC_MATCH] membership_check_start', {
            partidoId: Number(partidoId),
            currentUserUuid: user.id,
            jugadoresCount: jugadoresData?.length || 0,
            reqId
          });

          // 1. Use centralized membership check (single source of truth)
          const { isMember, jugadorRow } = await isUserMemberOfMatch(user.id, Number(partidoId));

          // Check if this request is stale
          if (reqId !== reqIdRef.current) {
            console.log('[LOAD_PARTIDO] Aborting stale request (after membership check)', { reqId, current: reqIdRef.current });
            return;
          }

          console.log('[PUBLIC_MATCH] membership_result', {
            source: 'centralized_db_check',
            isMember,
            jugadorRow,
            reqId
          });

          if (isMember) {
            console.log('[PUBLIC_MATCH] setJoinStatus: approved', { partidoId, userId: user.id, source: 'db_member', reqId });
            setJoinStatus('approved');
          } else {
            // 2. Verificar si hay solicitud (más reciente)
            const { data: request, error: reqErr } = await supabase
              .from('match_join_requests')
              .select('id, status, created_at')
              .eq('match_id', Number(partidoId))
              .eq('user_id', user.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            // Check if this request is stale
            if (reqId !== reqIdRef.current) {
              console.log('[LOAD_PARTIDO] Aborting stale request (after request check)', { reqId, current: reqIdRef.current });
              return;
            }

            if (reqErr) console.error('[INVITE_PUBLIC] request check error', reqErr);

            if (request?.status === 'pending') {
              console.log('[PUBLIC_MATCH] setJoinStatus: pending', { partidoId, userId: user.id, source: 'request_pending', reqId });
              setJoinStatus('pending');
            } else if (request?.status === 'approved') {
              // CRITICAL: Request is approved but user NOT in jugadores yet
              // This means admin approved but DB sync hasn't happened
              console.warn('[PUBLIC_MATCH] Request approved but NOT in jugadores - starting recheck', {
                partidoId,
                userId: user.id,
                requestId: request.id,
                reqId
              });

              console.log('[PUBLIC_MATCH] setJoinStatus: approved_pending_sync', { partidoId, userId: user.id, source: 'request_approved_no_member', reqId });
              setJoinStatus('approved_pending_sync');

              // Start recheck loop (5 attempts, 2s interval, 10s total)
              recheckMembership(user.id, Number(partidoId), reqId);
            } else {
              console.log('[PUBLIC_MATCH] setJoinStatus: none', { partidoId, userId: user.id, source: 'no_request', reqId });
              setJoinStatus('none');
            }
          }

          // Only set loading false if this request is still current
          if (reqId === reqIdRef.current) {
            setLoading(false);
          }
        } catch (err) {
          if (reqId === reqIdRef.current) {
            setError('Partido no encontrado');
            setLoading(false);
          }
        }
        return;
      }

      // INVITE MODE (default)
      if (!codigoParam || codigoParam.trim() === '') {
        setError('Partido no encontrado');
        setLoading(false);
        return;
      }

      try {
        const { data, error: fetchError } = await supabase.rpc('get_partido_by_invite', {
          p_partido_id: Number(partidoId),
          p_codigo: codigoParam
        });

        if (reqId !== reqIdRef.current) {
          console.log('[LOAD_PARTIDO] Aborting stale request (invite mode)', { reqId, current: reqIdRef.current });
          return;
        }

        if (fetchError) {
          setError('Partido no encontrado.');
          setLoading(false);
          return;
        }
        if (!data || data.length === 0) {
          setCodigoValido(false);
          setError('Partido no encontrado');
          setLoading(false);
          return;
        }
        const partidoData = data[0];
        const { data: jugadoresData, count } = await supabase
          .from('jugadores')
          .select('*', { count: 'exact' })
          .eq('partido_id', partidoId);

        if (reqId === reqIdRef.current) {
          setPartido({ ...partidoData, jugadoresCount: count || 0 });
          setJugadores(jugadoresData || []);
          setLoading(false);
        }
      } catch (err) {
        if (reqId === reqIdRef.current) {
          setError('Partido no encontrado');
          setLoading(false);
        }
      }
    }
    loadPartido();
  }, [partidoId, codigoParam, mode, user]);

  // Recheck membership for approved_pending_sync state
  async function recheckMembership(userUuid, matchId, originalReqId, attempt = 1) {
    const maxAttempts = 5;
    const intervalMs = 2000;

    if (attempt > maxAttempts) {
      console.warn('[RECHECK] Max attempts reached, falling back to none', { matchId, userUuid, originalReqId });

      // Only update if this is still the current request
      if (originalReqId === reqIdRef.current) {
        console.log('[PUBLIC_MATCH] setJoinStatus: none', {
          partidoId: matchId,
          userId: userUuid,
          source: 'recheck_timeout',
          reqId: originalReqId
        });
        setJoinStatus('none');
        toast.error('Tu aprobación aún no se reflejó, reintentá más tarde');
      }
      return;
    }

    console.log('[RECHECK] Attempt', { attempt, maxAttempts, matchId, userUuid, originalReqId });

    setTimeout(async () => {
      // Check if request is still current
      if (originalReqId !== reqIdRef.current) {
        console.log('[RECHECK] Aborting - request is stale', { originalReqId, current: reqIdRef.current });
        return;
      }

      const { isMember, jugadorRow } = await isUserMemberOfMatch(userUuid, matchId);

      // Check again after async operation
      if (originalReqId !== reqIdRef.current) {
        console.log('[RECHECK] Aborting - request became stale during check', { originalReqId, current: reqIdRef.current });
        return;
      }

      if (isMember) {
        console.log('[RECHECK] Success! User now in jugadores', { matchId, userUuid, jugadorRow, attempt, originalReqId });
        console.log('[PUBLIC_MATCH] setJoinStatus: approved', {
          partidoId: matchId,
          userId: userUuid,
          source: 'recheck_success',
          reqId: originalReqId
        });
        setJoinStatus('approved');
        toast.success('¡Listo! Ya formás parte del partido');
      } else {
        console.log('[RECHECK] Not yet synced, retrying...', { attempt, matchId, userUuid, originalReqId });
        recheckMembership(userUuid, matchId, originalReqId, attempt + 1);
      }
    }, intervalMs);
  }

  // Si el usuario ya está logueado, ofrecerle sumar directamente
  useEffect(() => {
    if (user && partido && step === 'invitation') {
      // Usuario logueado puede sumarse directamente
    }
  }, [user, partido, step]);

  const handleSumarse = () => {
    if (mode === 'public') {
      handleSolicitarUnirme();
      return;
    }

    // Validar código antes de permitir suma
    if (!codigoValido) {
      toast.error('Link inválido o vencido');
      return;
    }

    if (user) {
      // Usuario logueado: sumar directamente
      handleSumarseConCuenta();
    } else {
      // Usuario sin login: mostrar opciones
      setStep('choose-method');
    }
  };

  const handleSolicitarUnirme = async () => {
    if (!user) {
      const currentUrl = window.location.pathname + window.location.search;
      navigate(`/auth?redirect=${encodeURIComponent(currentUrl)}`);
      return;
    }

    if (joinStatus !== 'none' || joinSubmitting) return;

    setJoinSubmitting(true);
    try {
      console.log('[SOLICITAR_UNIRME] Creating join request for match:', partidoId, 'user:', user.id);

      // First, create the pending request
      const { data: newRequest, error: insertError } = await supabase
        .from('match_join_requests')
        .insert({
          match_id: Number(partidoId),
          user_id: user.id,
          status: 'pending'
        })
        .select('id')
        .single();

      if (insertError) {
        if (String(insertError.code) === '23505') {
          // Duplicate request - check existing status
          console.log('[SOLICITAR_UNIRME] Duplicate request detected, checking existing status');
          const { data: existingRequest } = await supabase
            .from('match_join_requests')
            .select('id, status')
            .eq('match_id', Number(partidoId))
            .eq('user_id', user.id)
            .single();

          if (existingRequest) {
            setJoinStatus(existingRequest.status);
            if (existingRequest.status === 'pending') {
              toast.info('Ya enviaste una solicitud para este partido');
            } else if (existingRequest.status === 'approved') {
              toast.info('Tu solicitud ya fue aprobada');
            }
          }
          return;
        }
        throw insertError;
      }

      console.log('[SOLICITAR_UNIRME] Request created successfully:', newRequest.id);
      setJoinStatus('pending');
      toast.success('Solicitud enviada. Esperando aprobación del admin.');
    } catch (err) {
      console.error('[SOLICITAR_UNIRME] Error creating request:', {
        code: err.code,
        message: err.message,
        details: err.details,
        hint: err.hint
      });
      toast.error('No se pudo enviar la solicitud');
    } finally {
      setJoinSubmitting(false);
    }
  };

  const handleSumarseConCuenta = async () => {
    if (!user) {
      // Redirigir a login y volver a esta URL después
      const currentUrl = window.location.pathname + window.location.search;
      navigate(`/auth?redirect=${encodeURIComponent(currentUrl)}`);
      return;
    }

    // Validar código
    if (partido?.codigo && (!codigoParam || codigoParam !== partido.codigo)) {
      toast.error('Código inválido');
      return;
    }

    setSubmitting(true);
    try {
      // Verificar si ya está en el partido
      const { data: existing } = await supabase
        .from('jugadores')
        .select('id')
        .eq('partido_id', partidoId)
        .eq('usuario_id', user.id)
        .maybeSingle();

      if (existing) {
        toast.info('Ya estás en este partido');
        if (mode === 'invite') {
          navigate(`/partido/${partidoId}?codigo=${codigoParam}`);
        } else {
          setJoinStatus('approved');
        }
        return;
      }

      // Obtener datos del usuario
      const { data: userData } = await supabase
        .from('usuarios')
        .select('nombre, avatar_url')
        .eq('id', user.id)
        .maybeSingle();

      // Insertar jugador
      const { error: insertError } = await supabase
        .from('jugadores')
        .insert([{
          partido_id: Number(partidoId),
          usuario_id: user.id,
          nombre: userData?.nombre || user.email?.split('@')[0] || 'Jugador',
          avatar_url: userData?.avatar_url || null,
          is_goalkeeper: false,
        }]);

      if (insertError) {
        throw insertError;
      }

      toast.success('¡Te sumaste al partido!');
      if (mode === 'invite') {
        navigate(`/partido/${partidoId}?codigo=${codigoParam}`);
      } else {
        setJoinStatus('approved');
      }
    } catch (err) {
      console.error('[PartidoInvitacion] Error sumando con cuenta:', err);
      toast.error('No se pudo sumar al partido');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSumarseComoInvitado = async () => {
    if (!guestName.trim()) {
      toast.error('Ingresá tu nombre');
      return;
    }

    // Protección double-click
    if (submitting) return;

    const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
    const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[INVITE] Missing env', { supabaseUrl: !!supabaseUrl, anonKey: !!anonKey });
      }
      toast.error('Faltan variables de entorno de Supabase');
      return;
    }


    setSubmitting(true);
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/join-match-guest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': anonKey,
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          partido_id: Number(partidoId),
          codigo: codigoParam,
          nombre: guestName.trim(),
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        // Log completo para debug
        console.error('[INVITE] join-match-guest error', { status: response.status, result });
        if (result.code === 'INVALID_CODE') {
          toast.error('Código inválido o vencido');
          setCodigoValido(false);
          return;
        }
        if (result.code === 'FULL') {
          toast.error('Cupos completos');
          return;
        }
        throw new Error(result.error || 'Error al sumarse');
      }

      // Guardar en localStorage para idempotencia
      const storageKey = `guest_joined_${partidoId}`;
      localStorage.setItem(storageKey, result.guest_uuid);

      setStep('success');
      toast.success(`¡Listo, ${guestName}! Te sumaste al partido`);

      // Redirigir después de 2 segundos a vista read-only (guest sin auth)
      setTimeout(() => {
        setStep('already-joined');
      }, 2000);
    } catch (err) {
      console.error('[PartidoInvitacion] Error sumando como invitado:', err);
      toast.error(err.message || 'No se pudo sumar al partido');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center p-4">
        <LoadingSpinner size="large" />
      </div>
    );
  }

  if (error || !partido) {
    return (
      <div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 max-w-md w-full text-center">
          <div className="text-6xl mb-4">⚽</div>
          <h2 className="text-white text-xl font-bold mb-2">Partido no encontrado</h2>
          <p className="text-white/70 mb-4">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="bg-primary text-white px-6 py-3 rounded-xl font-bold hover:brightness-110 transition-all"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  const cuposDisponibles = partido.cupo - partido.jugadoresCount;

  // Pantalla 1: Invitación inicial o público
  if (step === 'invitation') {
    const isPublic = mode === 'public';
    return (
      <SharedInviteLayout
        partido={partido}
        jugadores={jugadores}
        title={isPublic ? 'PARTIDO ABIERTO' : 'TE INVITARON A JUGAR'}
        showChatIcon={isPublic ? joinStatus === 'approved' : true}
        ctaVariant={isPublic ? 'public' : 'invite'}
        submitting={submitting || joinSubmitting}
        onSumarse={handleSumarse}
        onNavigateHome={() => navigate('/')}
        onNavigateBack={() => navigate(-1)}
        codigoValido={codigoValido}
        mode={mode}
        joinStatus={joinStatus}
      />
    );
  }

  // Pantalla 2: Elegir método (rápido o con cuenta)
  if (step === 'choose-method') {
    return (
      <div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 max-w-md w-full">
          <div className="text-center mb-6">
            <h2 className="text-white text-2xl font-bold mb-2">¿Cómo querés sumarte?</h2>
            <p className="text-white/70 text-sm">Elegí la opción que prefieras</p>
          </div>

          {/* Opción A: Rápido (sin cuenta) */}
          <button
            onClick={() => setStep('guest-form')}
            className="w-full bg-white/15 border-2 border-white/30 hover:bg-white/20 hover:border-white/40 rounded-xl p-5 mb-4 text-left transition-all group"
          >
            <div className="flex items-start gap-4">
              <div className="text-4xl">⚡</div>
              <div className="flex-1">
                <h3 className="text-white font-bold text-lg mb-1 group-hover:text-primary transition-colors">
                  Sumarte rápido
                </h3>
                <p className="text-white/70 text-sm">
                  Solo tu nombre. Sin cuenta. Entrás directo al partido.
                </p>
              </div>
            </div>
          </button>

          {/* Opción B: Con cuenta */}
          <button
            onClick={handleSumarseConCuenta}
            disabled={submitting}
            className="w-full bg-white/15 border-2 border-white/30 hover:bg-white/20 hover:border-white/40 rounded-xl p-5 mb-4 text-left transition-all group disabled:opacity-50"
          >
            <div className="flex items-start gap-4">
              <div className="text-4xl">🔐</div>
              <div className="flex-1">
                <h3 className="text-white font-bold text-lg mb-1 group-hover:text-primary transition-colors">
                  Entrar con mi cuenta
                </h3>
                <p className="text-white/70 text-sm">
                  Iniciar sesión o crear cuenta. Guardá tus partidos y stats.
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => setStep('invitation')}
            className="w-full text-white/70 text-sm hover:text-white transition-all py-2"
          >
            ← Volver
          </button>
        </div>
      </div>
    );
  }

  // Pantalla 3: Formulario invitado (solo nombre)
  if (step === 'guest-form') {
    return (
      <div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 max-w-md w-full">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">⚡</div>
            <h2 className="text-white text-2xl font-bold mb-2">Sumarte rápido</h2>
            <p className="text-white/70 text-sm">Solo necesitamos tu nombre</p>
          </div>

          <div className="mb-6">
            <label className="block text-white font-semibold mb-2">Tu nombre</label>
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Ej: Juan Pérez"
              className="w-full bg-white/10 border border-white/20 text-white font-sans text-lg px-4 py-3 rounded-xl focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 placeholder:text-white/40"
              autoFocus
              maxLength={50}
            />
            <p className="text-white/50 text-xs mt-2">
              Así te van a ver en la lista de jugadores
            </p>
          </div>

          <button
            onClick={handleSumarseComoInvitado}
            disabled={!guestName.trim() || submitting}
            className="w-full bg-primary text-white px-6 py-4 rounded-xl font-bold text-lg hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed mb-3"
          >
            {submitting ? 'Sumándote...' : 'Entrar al partido'}
          </button>

          <button
            onClick={() => setStep('choose-method')}
            disabled={submitting}
            className="w-full text-white/70 text-sm hover:text-white transition-all py-2"
          >
            ← Volver
          </button>
        </div>
      </div>
    );
  }

  // Pantalla 4: Éxito
  if (step === 'success') {
    return (
      <div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 max-w-md w-full text-center">
          <div className="text-6xl mb-4">✅</div>
          <h2 className="text-white text-2xl font-bold mb-2">¡Listo!</h2>
          <p className="text-white/70 mb-4">
            Te sumaste al partido como <span className="font-bold text-white">{guestName}</span>
          </p>
          <p className="text-white/50 text-sm">
            Preparando vista...
          </p>
        </div>
      </div>
    );
  }

  // Pantalla 5: Ya estás anotado (idempotencia)
  if (step === 'already-joined') {
    return (
      <div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 max-w-md w-full">
          <div className="text-center mb-6">
            <div className="text-6xl mb-4">✅</div>
            <h2 className="text-white text-2xl font-bold mb-2">Ya estás anotado</h2>
            <p className="text-white/70 text-sm">
              Ya te sumaste a este partido anteriormente
            </p>
          </div>

          {/* Detalles del partido */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6 space-y-3">
            <div className="text-center mb-3">
              <h3 className="text-white text-lg font-bold">{partido?.nombre}</h3>
            </div>
            <div className="flex items-center gap-3 text-white">
              <span className="text-2xl">📅</span>
              <div>
                <div className="text-sm text-white/60">Fecha</div>
                <div className="font-semibold">{partido?.fecha ? formatLocalDateShort(partido.fecha) : '-'}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 text-white">
              <span className="text-2xl">⏰</span>
              <div>
                <div className="text-sm text-white/60">Hora</div>
                <div className="font-semibold">{partido?.hora || '-'}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 text-white">
              <span className="text-2xl">📍</span>
              <div>
                <div className="text-sm text-white/60">Sede</div>
                <div className="font-semibold text-sm">{partido?.sede || '-'}</div>
              </div>
            </div>
          </div>

          <div className="text-center">
            <p className="text-white/60 text-sm mb-4">
              Te avisaremos novedades del partido
            </p>
            <button
              onClick={() => navigate('/')}
              className="text-white/70 text-sm hover:text-white transition-all"
            >
              Volver al inicio
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

