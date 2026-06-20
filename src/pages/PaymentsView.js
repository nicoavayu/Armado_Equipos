import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Browser } from '@capacitor/browser';
import { Wallet, Copy, Check, ExternalLink, Bell, Lock } from 'lucide-react';
import { useAuth } from '../components/AuthProvider';
import PageTitle from '../components/PageTitle';
import LoadingSpinner from '../components/LoadingSpinner';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';
import EmptyStateCard from '../components/EmptyStateCard';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import {
  getMatchPaymentsState,
  reportMyPayment,
  adminSetPaymentStatus,
  adminUpdatePaymentSettings,
  adminClosePayments,
  adminRemindPending,
} from '../services/db/payments';
import {
  getPaymentStatusMeta,
  resolvePaymentAmount,
  formatPaymentAmount,
  summarizePayments,
} from '../utils/paymentStatus';

const CARD_TONE = 'bg-[radial-gradient(360px_180px_at_12%_-30%,rgba(139,92,255,0.18),transparent_70%),linear-gradient(165deg,rgba(48,38,98,0.72),rgba(20,16,41,0.94))]';
const CARD_BASE = `relative ${CARD_TONE} rounded-card p-4 border border-[rgba(148,134,255,0.16)] overflow-hidden shadow-elev-2`;
const PRIMARY_BTN = 'font-bebas font-semibold text-[15px] px-4 py-2 border rounded-2xl cursor-pointer transition-all text-white min-h-[42px] flex items-center justify-center gap-2 text-center bg-[#6a43ff] border-[#7d5aff] hover:bg-[#7550ff] shadow-[0_0_14px_rgba(106,67,255,0.3)]';
const SECONDARY_BTN = 'font-bebas font-semibold text-[15px] px-4 py-2 border rounded-2xl cursor-pointer transition-all text-white min-h-[42px] flex items-center justify-center gap-2 text-center bg-white/[0.06] border-[rgba(148,134,255,0.28)] hover:bg-white/[0.12]';
const DISABLED_BTN = 'font-bebas font-semibold text-[15px] px-4 py-2 border rounded-2xl min-h-[42px] flex items-center justify-center gap-2 text-center bg-[#1d1740] text-white/40 cursor-not-allowed border-white/10';
const INPUT_CLASS = 'w-full bg-[#0c0a1d]/80 border border-[rgba(148,134,255,0.22)] rounded-xl px-3.5 py-2.5 text-white text-[15px] placeholder:text-white/30 focus:outline-none focus:border-[rgba(148,134,255,0.5)]';

const SectionLabel = ({ children }) => (
  <div className="font-bebas tracking-[0.06em] text-[13px] text-[#b0a0ff]/85 uppercase mb-2">{children}</div>
);

const StatusPill = ({ status }) => {
  const meta = getPaymentStatusMeta(status);
  return (
    <span className={`font-sans text-[11px] font-bold px-2.5 py-[3px] rounded-full border shrink-0 whitespace-nowrap ${meta.pillClass}`}>
      {meta.label}
    </span>
  );
};

// Admin per-row status buttons. reported_paid => Confirmar/Debe ; otherwise Pagó/Debe/Exento.
const getRowActions = (status) => {
  if (status === 'reported_paid') {
    return [
      { label: 'Confirmar', to: 'paid' },
      { label: 'Debe', to: 'pending' },
    ];
  }
  return [
    { label: 'Pagó', to: 'paid' },
    { label: 'Debe', to: 'pending' },
    { label: 'Exento', to: 'exempt' },
  ];
};

const isActiveAction = (status, to) => (
  (to === 'paid' && status === 'paid')
  || (to === 'pending' && status === 'pending')
  || (to === 'exempt' && status === 'exempt')
);

const activeActionClass = (to) => {
  if (to === 'paid') return 'border-[#22c55e]/55 bg-[#22c55e]/15 text-[#86efac]';
  if (to === 'exempt') return 'border-[#38bdf8]/55 bg-[#38bdf8]/15 text-[#bae6fd]';
  return 'border-white/25 bg-white/[0.12] text-white';
};

const PaymentsView = () => {
  const { partidoId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [state, setState] = useState(null);
  const [accessError, setAccessError] = useState(false);
  const [busyRow, setBusyRow] = useState(null); // jugador_id being mutated
  const [actionBusy, setActionBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({ amount: '', name: '', alias: '', link: '', collectorUserId: '' });
  const [savingEdit, setSavingEdit] = useState(false);

  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const handleBack = () => {
    const backTo = location.state?.backTo;
    if (backTo) navigate(backTo, { state: location.state?.backToState });
    else navigate('/');
  };

  const load = useCallback(async () => {
    if (!user || !partidoId) return;
    try {
      const next = await getMatchPaymentsState(partidoId);
      if (!next?.partido) {
        setAccessError(true);
        setState(null);
      } else {
        setState(next);
        setAccessError(false);
      }
    } catch (error) {
      console.warn('[PaymentsView] load failed', { message: error?.message || String(error) });
      setAccessError(true);
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [user, partidoId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="fixed left-0 w-screen text-white flex flex-col z-[1000]" style={{ top: 'var(--safe-top, 0px)', height: 'calc(100dvh - var(--safe-top, 0px))' }}>
        <PageTitle onBack={handleBack} title="PAGOS DEL PARTIDO">PAGOS DEL PARTIDO</PageTitle>
        <div className="flex-1 pt-[96px] flex items-center justify-center">
          <LoadingSpinner size="medium" />
        </div>
      </div>
    );
  }

  if (accessError || !state) {
    return (
      <div className="fixed left-0 w-screen text-white flex flex-col z-[1000]" style={{ top: 'var(--safe-top, 0px)', height: 'calc(100dvh - var(--safe-top, 0px))' }}>
        <PageTitle onBack={handleBack} title="PAGOS DEL PARTIDO">PAGOS DEL PARTIDO</PageTitle>
        <div className="flex-1 pt-[96px] px-4 overflow-y-auto">
          <div className="w-full max-w-[500px] mx-auto mt-[60px]">
            <EmptyStateCard
              icon={Wallet}
              title="No pudimos abrir los pagos"
              description="No tenés acceso a los pagos de este partido o todavía no está disponible."
              className="my-0 p-5"
            />
          </div>
        </div>
      </div>
    );
  }

  const { partido, settings, rows, isAdmin, myRow } = state;
  const amount = resolvePaymentAmount(settings, partido);
  const amountLabel = formatPaymentAmount(amount);
  const summary = summarizePayments(rows);
  const isClosed = Boolean(settings?.is_closed);
  const collectorName = (settings?.collector_name || '').trim();
  const collectorAlias = (settings?.collector_alias || '').trim();
  const collectorLink = (settings?.collector_payment_link || '').trim();
  const hasCollector = Boolean(collectorAlias || collectorLink);
  const matchName = (partido?.nombre || '').trim() || 'el partido';
  const pendingCount = summary.pending + summary.reported;

  const subtitle = `${amountLabel} c/u · ${summary.paid}/${summary.total} pagaron${summary.reported ? ` · ${summary.reported} a confirmar` : ''}`;

  const reloadAfter = async (fn) => {
    setActionBusy(true);
    try {
      await fn();
      await load();
    } catch (error) {
      notifyBlockingError(error?.message ? `No se pudo completar la acción (${error.message})` : 'No se pudo completar la acción');
    } finally {
      setActionBusy(false);
      setBusyRow(null);
    }
  };

  const handleSetStatus = (row, to) => {
    if (!row?.jugador_id) return;
    setBusyRow(row.jugador_id);
    reloadAfter(() => adminSetPaymentStatus(partido.id, row.jugador_id, to));
  };

  const handleReportMine = () => {
    reloadAfter(() => reportMyPayment(partido.id, {
      matchName,
      reporterName: myRow?.player_name || user?.user_metadata?.full_name || '',
      adminUserId: partido?.creado_por || null,
    }));
  };

  const handleRemind = async () => {
    setActionBusy(true);
    try {
      const res = await adminRemindPending(partido.id, { matchName });
      await load();
      if (res?.notified > 0) console.info(`Recordatorio enviado a ${res.notified} jugador(es)`);
    } catch (error) {
      notifyBlockingError('No se pudo enviar el recordatorio');
    } finally {
      setActionBusy(false);
    }
  };

  const doClose = (force) => reloadAfter(() => adminClosePayments(partido.id, { force }));

  const handleCloseClick = () => {
    if (pendingCount > 0) setShowCloseConfirm(true);
    else doClose(false);
  };

  const openEdit = () => {
    setEditForm({
      amount: amount != null ? String(amount) : '',
      name: collectorName,
      alias: collectorAlias,
      link: collectorLink,
      collectorUserId: settings?.collector_user_id || '',
    });
    setShowEdit(true);
  };

  const handleSaveEdit = async () => {
    setSavingEdit(true);
    try {
      const picked = rows.find((r) => String(r.user_id || '') === String(editForm.collectorUserId || ''));
      await adminUpdatePaymentSettings(partido.id, {
        amount: editForm.amount === '' ? null : editForm.amount,
        collectorUserId: editForm.collectorUserId || null,
        // si eligieron un jugador como cobrador y no escribieron nombre, usar el del jugador
        collectorName: (editForm.name || '').trim() || (picked?.player_name || null),
        collectorAlias: (editForm.alias || '').trim() || null,
        collectorLink: (editForm.link || '').trim() || null,
      });
      setShowEdit(false);
      await load();
    } catch (error) {
      notifyBlockingError('No se pudo guardar la configuración de cobro');
    } finally {
      setSavingEdit(false);
    }
  };

  const handlePayLink = async () => {
    if (!collectorLink) return;
    try {
      await Browser.open({ url: collectorLink });
    } catch (error) {
      window.open(collectorLink, '_blank', 'noopener');
    }
  };

  const handleCopyAlias = async () => {
    if (!collectorAlias) return;
    try {
      await navigator.clipboard.writeText(collectorAlias);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      notifyBlockingError('No se pudo copiar el alias');
    }
  };

  const collectorCandidates = rows.filter((r) => r.user_id);

  return (
    <div className="fixed left-0 w-screen text-white flex flex-col z-[1000]" style={{ top: 'var(--safe-top, 0px)', height: 'calc(100dvh - var(--safe-top, 0px))' }}>
      <PageTitle onBack={handleBack} title="PAGOS DEL PARTIDO">PAGOS DEL PARTIDO</PageTitle>

      <div className="flex-1 pt-[96px] px-4 pb-[120px] overflow-y-auto w-full box-border">
        <div className="w-full max-w-[560px] mx-auto flex flex-col gap-3">

          {/* Resumen */}
          <div className={CARD_BASE}>
            <div className="font-oswald text-[18px] font-bold text-white capitalize leading-tight">{matchName}</div>
            <div className="font-sans text-[12.5px] font-medium text-white/70 mt-1">{subtitle}</div>
            {isClosed ? (
              <div className="inline-flex items-center gap-1.5 mt-3 border border-[#38bdf8]/45 bg-[#38bdf8]/10 text-[#bae6fd] px-2.5 py-1 rounded-full text-[11px] font-bold">
                <Lock size={11} /> Pagos cerrados
              </div>
            ) : null}
          </div>

          {/* Cobro */}
          <div className={CARD_BASE}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <SectionLabel>Cobro del partido</SectionLabel>
                {hasCollector || collectorName ? (
                  <div className="flex flex-col gap-0.5">
                    {collectorName ? <div className="text-[14px] text-white font-semibold">Cobra: {collectorName}</div> : null}
                    {collectorAlias ? <div className="text-[13px] text-white/75">Alias: <span className="font-semibold text-white">{collectorAlias}</span></div> : null}
                    {collectorLink ? <div className="text-[13px] text-white/75 truncate">Link de Mercado Pago disponible</div> : null}
                  </div>
                ) : (
                  <div className="text-[13px] text-white/60">El admin todavía no configuró a quién pagarle.</div>
                )}
              </div>
              {isAdmin ? (
                <button type="button" className={`${SECONDARY_BTN} !text-[13px] !min-h-[36px] !px-3 shrink-0`} onClick={openEdit}>
                  Editar
                </button>
              ) : null}
            </div>
          </div>

          {/* Tu pago (jugador no admin con fila propia) */}
          {!isAdmin && myRow ? (
            <div className={CARD_BASE}>
              <SectionLabel>Tu pago</SectionLabel>
              <div className="flex items-center gap-2 mb-3">
                <StatusPill status={myRow.status} />
                <span className="text-[13px] text-white/70">{amountLabel}</span>
              </div>

              {myRow.status === 'reported_paid' ? (
                <button type="button" className={`${DISABLED_BTN} w-full`} disabled>
                  Esperando confirmación
                </button>
              ) : myRow.status === 'paid' ? (
                <div className="text-[13px] text-[#86efac] font-semibold flex items-center gap-1.5"><Check size={14} /> Pago confirmado</div>
              ) : myRow.status === 'exempt' ? (
                <div className="text-[13px] text-[#bae6fd] font-semibold">Estás exento de este pago</div>
              ) : hasCollector ? (
                <div className="flex flex-col gap-2.5">
                  {collectorLink ? (
                    <button type="button" className={`${PRIMARY_BTN} w-full`} onClick={handlePayLink}>
                      <ExternalLink size={16} /> Pagar con Mercado Pago
                    </button>
                  ) : null}
                  {collectorAlias ? (
                    <button type="button" className={`${SECONDARY_BTN} w-full`} onClick={handleCopyAlias}>
                      {copied ? <><Check size={16} /> ¡Copiado!</> : <><Copy size={16} /> Copiar alias</>}
                    </button>
                  ) : null}
                  <button type="button" className={`${SECONDARY_BTN} w-full`} disabled={actionBusy} onClick={handleReportMine}>
                    Ya pagué
                  </button>
                </div>
              ) : (
                <div className="text-[13px] text-white/60">El admin todavía no configuró a quién pagarle.</div>
              )}
            </div>
          ) : null}

          {/* Lista de jugadores */}
          <div className={CARD_BASE}>
            <SectionLabel>Jugadores ({summary.total})</SectionLabel>
            <div className="flex flex-col divide-y divide-white/[0.06]">
              {rows.length === 0 ? (
                <div className="text-[13px] text-white/55 py-2">Todavía no hay jugadores cargados para este partido.</div>
              ) : rows.map((row) => {
                const meta = getPaymentStatusMeta(row.status);
                const name = (row.player_name || '').trim() || 'Jugador';
                return (
                  <div key={row.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dotClass}`} />
                      <span className="text-[14px] text-white/90 truncate">{name}</span>
                    </div>
                    {isAdmin && !isClosed ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        {getRowActions(row.status).map((action) => {
                          const active = isActiveAction(row.status, action.to);
                          return (
                            <button
                              key={action.to}
                              type="button"
                              disabled={busyRow === row.jugador_id || actionBusy}
                              onClick={() => handleSetStatus(row, action.to)}
                              className={`text-[12px] font-semibold px-2.5 min-h-[32px] rounded-full border transition-all disabled:opacity-50 ${active ? activeActionClass(action.to) : 'border-white/15 bg-white/[0.04] text-white/65 hover:bg-white/[0.1]'}`}
                            >
                              {action.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <StatusPill status={row.status} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Acciones admin */}
          {isAdmin ? (
            <div className="flex flex-col gap-2.5">
              {!isClosed ? (
                <>
                  <button
                    type="button"
                    className={summary.pending > 0 ? `${SECONDARY_BTN} w-full` : `${DISABLED_BTN} w-full`}
                    disabled={summary.pending === 0 || actionBusy}
                    onClick={handleRemind}
                  >
                    <Bell size={16} /> Recordar pendientes
                  </button>
                  <button type="button" className={`${PRIMARY_BTN} w-full`} disabled={actionBusy} onClick={handleCloseClick}>
                    <Lock size={16} /> Cerrar pagos
                  </button>
                </>
              ) : (
                <div className="text-center text-[13px] text-white/55 py-1">Los pagos de este partido están cerrados.</div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Modal editar cobro */}
      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Editar cobro" closeOnBackdrop={!savingEdit}
        footer={(
          <div className="flex gap-3">
            <button type="button" className={`${SECONDARY_BTN} flex-1`} onClick={() => setShowEdit(false)} disabled={savingEdit}>Cancelar</button>
            <button type="button" className={`${PRIMARY_BTN} flex-1`} onClick={handleSaveEdit} disabled={savingEdit}>{savingEdit ? 'Guardando…' : 'Guardar'}</button>
          </div>
        )}
      >
        <div className="flex flex-col gap-3.5 min-w-[280px]">
          <div>
            <SectionLabel>Monto por jugador</SectionLabel>
            <input className={INPUT_CLASS} inputMode="numeric" placeholder="Ej: 6000" value={editForm.amount}
              onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))} />
          </div>
          {collectorCandidates.length > 0 ? (
            <div>
              <SectionLabel>Quién cobra (jugador)</SectionLabel>
              <select
                className={INPUT_CLASS}
                value={editForm.collectorUserId || ''}
                onChange={(e) => {
                  const uid = e.target.value;
                  const picked = collectorCandidates.find((r) => String(r.user_id) === String(uid));
                  setEditForm((f) => ({ ...f, collectorUserId: uid, name: uid ? (picked?.player_name || f.name) : f.name }));
                }}
              >
                <option value="">— Otro / manual —</option>
                {collectorCandidates.map((r) => (
                  <option key={r.id} value={r.user_id}>{(r.player_name || 'Jugador')}</option>
                ))}
              </select>
            </div>
          ) : null}
          <div>
            <SectionLabel>Nombre de quien cobra</SectionLabel>
            <input className={INPUT_CLASS} placeholder="Ej: Nico" value={editForm.name}
              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <SectionLabel>Alias de Mercado Pago</SectionLabel>
            <input className={INPUT_CLASS} placeholder="Ej: nico.mp" value={editForm.alias}
              onChange={(e) => setEditForm((f) => ({ ...f, alias: e.target.value }))} />
          </div>
          <div>
            <SectionLabel>Link de Mercado Pago (opcional)</SectionLabel>
            <input className={INPUT_CLASS} placeholder="https://..." value={editForm.link}
              onChange={(e) => setEditForm((f) => ({ ...f, link: e.target.value }))} />
          </div>
        </div>
      </Modal>

      {/* Confirmar cierre con pendientes */}
      <ConfirmModal
        isOpen={showCloseConfirm}
        title="Cerrar pagos"
        message="Todavía hay jugadores pendientes. ¿Querés cerrar pagos igual?"
        onConfirm={() => { setShowCloseConfirm(false); doClose(true); }}
        onCancel={() => setShowCloseConfirm(false)}
        confirmText="Cerrar igual"
        cancelText="Volver"
        danger
      />
    </div>
  );
};

export default PaymentsView;
