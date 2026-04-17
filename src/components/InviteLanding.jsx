import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from './AuthProvider';
import ConfirmModal from './ConfirmModal';
import { setAuthReturnTo } from '../utils/authReturnTo';
import usePendingAuthFlow from '../hooks/usePendingAuthFlow';
import {
  consumeAuthFlowResult,
  subscribeAuthFlowState,
} from '../utils/authFlowState';
import {
  canShowAppleSignIn,
  signInWithApple,
  signInWithGoogle,
} from '../services/auth/socialAuth';

function getSubstituteModalSeenKey(partidoId, userId) {
  if (!partidoId || !userId) return null;
  return `invite-substitute-modal-seen:${partidoId}:${userId}`;
}

function hasSeenSubstituteModal(key) {
  if (!key) return false;
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function markSubstituteModalSeen(key) {
  if (!key) return;
  try {
    window.sessionStorage.setItem(key, '1');
  } catch {
    // Best effort only.
  }
}

function formatDate(fecha, hora) {
  if (!fecha) return 'Fecha a confirmar';
  try {
    const dt = new Date(`${fecha}T${hora || '00:00:00'}`);
    return dt.toLocaleString('es-AR', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return `${fecha}${hora ? ` ${hora}` : ''}`;
  }
}

export default function InviteLanding() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const pendingAuthFlow = usePendingAuthFlow();

  const [loadingInvite, setLoadingInvite] = useState(true);
  const [inviteData, setInviteData] = useState(null);
  const [inviteError, setInviteError] = useState('');

  const [accepting, setAccepting] = useState(false);
  const [acceptedLabel, setAcceptedLabel] = useState('');
  const [substituteModalOpen, setSubstituteModalOpen] = useState(false);
  const [pendingPartidoId, setPendingPartidoId] = useState(null);

  const returnTo = useMemo(() => `/i/${token}`, [token]);
  const authActionInFlight = authLoading || Boolean(pendingAuthFlow);

  useEffect(() => {
    let active = true;

    const fetchInvite = async () => {
      setLoadingInvite(true);
      setInviteError('');
      try {
        const { data, error } = await supabase.rpc('get_invite_landing', {
          p_token: token,
        });

        if (error) throw error;

        const row = Array.isArray(data) ? data[0] : data;
        if (!row || !row.valid) {
          throw new Error('Invitación inválida o expirada');
        }

        if (!active) return;
        setInviteData(row);
      } catch (err) {
        if (!active) return;
        setInviteError(err?.message || 'Invitación inválida o expirada');
      } finally {
        if (active) setLoadingInvite(false);
      }
    };

    if (token) fetchInvite();

    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    let cancelled = false;

    const acceptInvite = async () => {
      if (!user || !inviteData || accepting || acceptedLabel) return;

      setAccepting(true);
      setInviteError('');
      try {
        const { data, error } = await supabase.functions.invoke('accept-invite', {
          body: { token },
        });

        if (error) throw error;
        if (!data?.ok) throw new Error(data?.message || 'No pudimos aplicar tu invitación.');

        const status = data.status === 'already_accepted' ? 'already_accepted' : 'accepted';
        setAcceptedLabel(status === 'already_accepted' ? 'Ya estabas en el partido' : 'Listo, estás adentro');

        const targetPartidoId = data.partido_id || inviteData.partido_id;
        let joinedAsSubstitute = data.joined_as_substitute === true;
        if (!joinedAsSubstitute && targetPartidoId && user?.id) {
          const { data: joinedPlayer, error: joinedPlayerError } = await supabase
            .from('jugadores')
            .select('is_substitute')
            .eq('partido_id', Number(targetPartidoId))
            .eq('usuario_id', user.id)
            .maybeSingle();

          if (!joinedPlayerError) {
            joinedAsSubstitute = joinedPlayer?.is_substitute === true;
          }
        }

        const modalSeenKey = getSubstituteModalSeenKey(targetPartidoId, user?.id);
        if (joinedAsSubstitute && !hasSeenSubstituteModal(modalSeenKey)) {
          if (!cancelled) {
            markSubstituteModalSeen(modalSeenKey);
            setPendingPartidoId(targetPartidoId);
            setSubstituteModalOpen(true);
          }
          return;
        }

        setTimeout(() => {
          if (!cancelled) {
            navigate(`/partido-publico/${targetPartidoId}`, { replace: true });
          }
        }, 700);
      } catch (err) {
        if (cancelled) return;
        setInviteError(err?.message || 'No pudimos aplicar la invitación.');
      } finally {
        if (!cancelled) setAccepting(false);
      }
    };

    if (!authLoading && user && inviteData) {
      acceptInvite();
    }

    return () => {
      cancelled = true;
    };
  }, [user, authLoading, inviteData, token, navigate, accepting, acceptedLabel]);

  useEffect(() => {
    const syncAuthResultMessage = () => {
      const authResult = consumeAuthFlowResult();
      if (!authResult?.message) return;
      setInviteError(authResult.message);
    };

    syncAuthResultMessage();
    return subscribeAuthFlowState(() => {
      syncAuthResultMessage();
    });
  }, []);

  const goGoogle = async () => {
    try {
      setInviteError('');
      setAuthReturnTo(returnTo);
      await signInWithGoogle({ source: 'invite_google_auth' });
    } catch (err) {
      setInviteError(err?.message || 'No pudimos iniciar sesión con Google.');
    }
  };

  const goApple = async () => {
    try {
      setInviteError('');
      setAuthReturnTo(returnTo);
      await signInWithApple({ source: 'invite_apple_auth' });
    } catch (err) {
      setInviteError(err?.message || 'No pudimos iniciar sesión con Apple.');
    }
  };

  const goEmail = () => {
    setInviteError('');
    setAuthReturnTo(returnTo);
    navigate(`/login/email?returnTo=${encodeURIComponent(returnTo)}`);
  };

  return (
    <>
      <div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-white/20 bg-[#1a1f46]/90 p-6">
          <h1 className="font-oswald text-4xl text-white font-semibold tracking-[0.01em]">Invitación a partido</h1>

          {loadingInvite && <p className="mt-3 text-white/75">Validando invitación...</p>}
          {!loadingInvite && !inviteData && inviteError && <p className="mt-4 text-[#ff8b8b]">{inviteError}</p>}

          {!loadingInvite && inviteData && (
            <>
              <div className="mt-4 rounded-xl border border-white/15 bg-[#10163a]/80 p-4 text-white/90 space-y-1">
                <p className="font-oswald text-xl text-white">{inviteData.nombre || 'Partido'}</p>
                <p className="text-sm">{formatDate(inviteData.fecha, inviteData.hora)}</p>
                <p className="text-sm">{inviteData.sede || 'Sede a confirmar'}</p>
                {inviteData.admin_nombre && <p className="text-sm text-white/70">Invita: {inviteData.admin_nombre}</p>}
              </div>

              {inviteError && <p className="mt-4 text-[#ff8b8b]">{inviteError}</p>}

              {authActionInFlight && <p className="mt-4 text-white/75">Cargando sesión...</p>}

              {!authActionInFlight && !user && (
                <div className="mt-5 space-y-3">
                  {canShowAppleSignIn() && (
                    <button
                      type="button"
                      onClick={goApple}
                      disabled={authActionInFlight}
                      className="w-full h-12 rounded-xl bg-[#111111] text-white font-oswald text-xl disabled:opacity-60"
                    >
                      Ingresar con Apple
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={goGoogle}
                    disabled={authActionInFlight}
                    className="w-full h-12 rounded-xl bg-white text-[#1a1f46] font-oswald text-xl"
                  >
                    Entrar con Google
                  </button>
                  <button
                    type="button"
                    onClick={goEmail}
                    disabled={authActionInFlight}
                    className="w-full h-12 rounded-xl border border-white/25 bg-transparent text-white font-oswald text-xl"
                  >
                    Continuar con email
                  </button>
                </div>
              )}

              {!authActionInFlight && user && (
                <div className="mt-5">
                  {accepting && <p className="text-white/80">Aplicando invitación...</p>}
                  {!accepting && acceptedLabel && <p className="text-[#6fe28d]">{acceptedLabel}</p>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <ConfirmModal
        isOpen={substituteModalOpen}
        title="Entraste como suplente"
        message="El plantel titular ya está completo. Si un titular se baja, podés pasar al plantel."
        confirmText="Entendido"
        singleButton={true}
        onCancel={() => {
          setSubstituteModalOpen(false);
          if (pendingPartidoId) {
            navigate(`/partido-publico/${pendingPartidoId}`, { replace: true });
          }
        }}
        onConfirm={() => {
          setSubstituteModalOpen(false);
          if (pendingPartidoId) {
            navigate(`/partido-publico/${pendingPartidoId}`, { replace: true });
          }
        }}
      />
    </>
  );
}
