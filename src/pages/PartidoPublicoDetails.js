// ARCHIVO ELIMINADO: Todo el flujo está unificado en PartidoInvitacion.js
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../components/AuthProvider';
import { isUserMemberOfMatch } from '../utils/membershipCheck';
import LoadingSpinner from '../components/LoadingSpinner';
import { toast } from 'react-toastify';
import ConfirmModal from '../components/ConfirmModal';
import { findUserScheduleConflicts } from '../services/db/matchScheduling';

export default function PartidoPublicoDetails() {
  const { partidoId } = useParams();
  const matchId = Number(partidoId);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [partido, setPartido] = useState(null);
  const [jugadores, setJugadores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joinStatus, setJoinStatus] = useState('checking'); // 'checking', 'none', 'pending', 'joined', 'full', 'closed'
  const [scheduleWarningOpen, setScheduleWarningOpen] = useState(false);
  const [scheduleWarningMessage, setScheduleWarningMessage] = useState('');

  useEffect(() => {
    fetchPartido();
    fetchJugadores();
    if (user) checkJoinStatus();
  }, [partidoId, user]);

  async function fetchPartido() {
    setLoading(true);
    const { data, error } = await supabase
      .from('partidos')
      .select('*')
      .eq('id', matchId)
      .maybeSingle();

    if (error) {
      console.error('[PartidoPublicoDetails] Error fetching partido:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      setLoading(false);
      return;
    }

    setPartido(data);
    setLoading(false);
  }

  async function fetchJugadores() {
    const { data, error } = await supabase.from('jugadores').select('*').eq('partido_id', matchId);
    if (!error) setJugadores(data);
  }

  async function checkJoinStatus() {
    console.log('[PUBLIC_MATCH] checkJoinStatus start', {
      partidoId: matchId,
      currentUserUuid: user?.id
    });

    // 1. Use centralized membership check (single source of truth)
    const { isMember, jugadorRow, error } = await isUserMemberOfMatch(user.id, matchId);

    if (error) {
      console.error('[PUBLIC_MATCH] Membership check failed', error);
    }

    if (isMember) {
      console.log('[PUBLIC_MATCH] setting status: joined', { jugadorRow });
      setJoinStatus('joined');
      return;
    }

    // 2. Check latest join request status (handle potential duplicates)
    const { data: requestData, error: requestError } = await supabase
      .from('match_join_requests')
      .select('id, status, created_at')
      .eq('match_id', matchId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (requestError) {
      console.error('[PartidoPublicoDetails] Error checking join requests:', {
        code: requestError.code,
        message: requestError.message,
        details: requestError.details,
        hint: requestError.hint,
      });
    } else if (requestData) {
      console.log('[PUBLIC_MATCH] join_request found', {
        requestId: requestData.id,
        status: requestData.status,
        settingStatus: requestData.status
      });

      if (requestData.status === 'pending' || requestData.status === 'approved') {
        setJoinStatus(requestData.status);
        return;
      }
    }

    // 3. ¿Partido lleno?
    const { data: partidoData, error: partidoError } = await supabase
      .from('partidos')
      .select('cupo_jugadores')
      .eq('id', matchId)
      .maybeSingle();

    if (partidoError) {
      console.error('[PartidoPublicoDetails] Error fetching partido data:', {
        code: partidoError.code,
        message: partidoError.message,
        details: partidoError.details,
        hint: partidoError.hint,
      });
    }

    const { count } = await supabase.from('jugadores').select('*', { count: 'exact', head: true }).eq('partido_id', matchId);
    if (partidoData && count >= partidoData.cupo_jugadores) {
      console.log('[PUBLIC_MATCH] setting status: full');
      setJoinStatus('full');
      return;
    }

    // 4. ¿Cerrado?
    if (partido && !['active', 'activo'].includes(String(partido.estado || '').toLowerCase())) {
      console.log('[PUBLIC_MATCH] setting status: closed');
      setJoinStatus('closed');
      return;
    }

    console.log('[PUBLIC_MATCH] setting status: none');
    setJoinStatus('none');
  }

  async function handleSolicitarUnirme(skipScheduleWarning = false) {
    if (!user) { toast.error('Inicia sesión para solicitar unirte'); return; }

    if (!skipScheduleWarning && partido?.fecha && partido?.hora) {
      try {
        const conflicts = await findUserScheduleConflicts({
          userId: user.id,
          excludeMatchId: matchId,
          targetMatch: {
            fecha: partido.fecha,
            hora: partido.hora,
            sede: partido.sede,
            nombre: partido.nombre,
          },
        });
        if (conflicts.length > 0) {
          const c = conflicts[0];
          setScheduleWarningMessage(`Ya tenés un partido en ese horario (${c.nombre || 'Partido'} · ${c.fecha} ${c.hora}).`);
          setScheduleWarningOpen(true);
          return;
        }
      } catch (err) {
        console.error('[PartidoPublicoDetails] schedule conflict check failed:', err);
      }
    }

    setLoading(true);

    // Evitar duplicados: buscar la última request activa
    const { data: existing, error: existingError } = await supabase
      .from('match_join_requests')
      .select('id, status, created_at')
      .eq('match_id', matchId)
      .eq('user_id', user.id)
      .in('status', ['pending', 'approved'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      console.error('[PartidoPublicoDetails] Error checking existing request:', {
        code: existingError.code,
        message: existingError.message,
        details: existingError.details,
        hint: existingError.hint,
      });
    }

    if (existing) {
      if (existing.status === 'pending') {
        toast.info('Solicitud enviada');
        setJoinStatus('pending');
      } else if (existing.status === 'approved') {
        setJoinStatus('approved');
      }
      setLoading(false);
      return;
    }

    const { error } = await supabase
      .from('match_join_requests')
      .insert({ match_id: matchId, user_id: user.id, status: 'pending' });

    if (error) {
      console.error('[PartidoPublicoDetails] Error creating join request:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      toast.error('Error al solicitar');
    } else {
      setJoinStatus('pending');
      toast.info('Solicitud enviada');
    }

    setLoading(false);
  }

  if (loading || !partido) return <LoadingSpinner size="large" fullScreen />;

  return (
    <div className="w-full flex justify-center pt-8 pb-12 px-4 bg-transparent">
      <div className="w-full max-w-[500px] bg-[#1e293b]/80 backdrop-blur-md rounded-2xl p-0 border border-white/10 shadow-xl flex flex-col overflow-hidden">
        {/* Bloque info partido */}
        <div className="px-6 pt-6 pb-3 border-b border-white/10 flex flex-col gap-1">
          <span className="text-[20px] font-bebas text-white leading-none tracking-wide truncate w-full mb-1">{partido.sede}</span>
          <div className="flex gap-2 mb-1">
            <span className="bg-white/10 px-2 py-0.5 rounded text-xs text-white/80 font-oswald tracking-wide">{partido.fecha} {partido.hora} hs</span>
            <span className="bg-white/10 px-2 py-0.5 rounded text-xs text-white/80 font-oswald tracking-wide">{partido.modalidad} | {partido.tipo_partido}</span>
          </div>
        </div>

        {/* Bloque jugadores */}
        <div className="px-6 py-4 border-b border-white/10 flex flex-col gap-2">
          <span className="text-xs text-white/60 font-oswald tracking-wider mb-2">JUGADORES ({jugadores.length} / {partido.cupo_jugadores})</span>
          <div className="flex flex-col gap-1">
            {jugadores.length === 0 ? (
              <div className="text-white/40 text-xs italic">Aún no hay jugadores</div>
            ) : (
              <ul className="flex flex-col gap-1">
                {jugadores.map(j => (
                  <li key={j.id} className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2 border border-white/5 text-white/90 text-sm font-oswald">
                    <span className="truncate">{j.nombre || j.usuario_id}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Bloque CTA */}
        <div className="px-6 py-5 flex flex-col items-center">
          {joinStatus === 'checking' && (
            <div className="w-full max-w-[260px] py-3 rounded-xl text-xs font-bold bg-white/10 text-white/60 tracking-wider shadow-lg text-center flex items-center justify-center gap-2">
              <LoadingSpinner size="small" />
              <span>Verificando...</span>
            </div>
          )}
          {joinStatus === 'none' && (
            <button
              className="w-full max-w-[260px] py-3 rounded-xl text-xs font-bold bg-[#128BE9] hover:brightness-110 text-white tracking-wider shadow-lg active:scale-[0.98] transition-all"
              onClick={handleSolicitarUnirme}
            >
              Solicitar unirme
            </button>
          )}
          {(joinStatus === 'pending' || joinStatus === 'approved') && (
            <button
              className="w-full max-w-[260px] py-3 rounded-xl text-xs font-bold bg-gray-400/80 text-white tracking-wider shadow-lg cursor-not-allowed"
              disabled={joinStatus === 'pending' || joinStatus === 'approved'}
            >
              {joinStatus === 'approved' ? 'Ya formás parte' : 'Solicitud enviada'}
            </button>
          )}
          {joinStatus === 'joined' && (
            <div className="w-full max-w-[260px] py-3 rounded-xl text-xs font-bold bg-green-600/90 text-white tracking-wider shadow-lg text-center">
              Ya formás parte del partido
            </div>
          )}
          {joinStatus === 'full' && (
            <div className="w-full max-w-[260px] py-3 rounded-xl text-xs font-bold bg-yellow-600/90 text-white tracking-wider shadow-lg text-center">
              Partido completo
            </div>
          )}
          {joinStatus === 'closed' && (
            <div className="w-full max-w-[260px] py-3 rounded-xl text-xs font-bold bg-red-600/90 text-white tracking-wider shadow-lg text-center">
              Partido cerrado
            </div>
          )}
        </div>
      </div>
      <ConfirmModal
        isOpen={scheduleWarningOpen}
        title="Conflicto de horario"
        message={scheduleWarningMessage}
        confirmText="Continuar igual"
        cancelText="Cancelar"
        onCancel={() => setScheduleWarningOpen(false)}
        onConfirm={async () => {
          setScheduleWarningOpen(false);
          await handleSolicitarUnirme(true);
        }}
      />
    </div>
  );
}
