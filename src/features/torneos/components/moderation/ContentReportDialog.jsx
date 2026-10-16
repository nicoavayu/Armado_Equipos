import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Flag, Loader2, LogIn, Mail } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import {
  REPORT_DETAIL_MAX,
  REPORT_KIND_LABELS,
  REPORT_REASONS,
  reportMailto,
  reportReceivedMessage,
} from '../../domain/contentModeration';
import { LEGAL_IDENTITY } from '../../../../legal/legalIdentity';
import styles from './ContentModeration.module.css';

const LEGAL_CONTACT = LEGAL_IDENTITY.contactEmail;

// MODERATION (0022): one dialog for every «Reportar». `targets` is what this place can report:
//   [{ kind, title, publicSlug?, targetId?, choices?: string[] }]
// With several targets the person picks one; a target with `choices` (teams or players of a public page) asks which
// one, by the name shown on the page (the server finds it again in that tournament). `submit(input)` is the composed
// service (hybrid gateway or LOCAL); without a session (`signedIn === false`) the dialog never submits: it offers to
// sign in or to write an email, because reporting is never anonymous. The copy after sending says who reviews it.
export default function ContentReportDialog({
  open, onClose, targets = [], submit = null, signedIn = true, loginHref = '/login', origin = '',
}) {
  const [targetKey, setTargetKey] = useState(0);
  const [choice, setChoice] = useState('');
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [state, setState] = useState({ status: 'idle', message: '' });
  const idempotencyKey = useRef(uuidv4());
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setTargetKey(0);
    setChoice('');
    setReason('');
    setDetail('');
    setState({ status: 'idle', message: '' });
    idempotencyKey.current = uuidv4();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus?.();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const target = targets[targetKey] || null;
  const choices = useMemo(() => (Array.isArray(target?.choices) ? target.choices : []), [target]);
  const needsChoice = choices.length > 0;
  const trimmed = detail.trim();
  const valid = Boolean(target) && Boolean(reason) && (!needsChoice || choices.includes(choice))
    && (trimmed.length === 0 || (trimmed.length >= 3 && trimmed.length <= REPORT_DETAIL_MAX));

  if (!open) return null;

  const send = async (event) => {
    event.preventDefault();
    if (!valid || state.status === 'saving' || !submit) return;
    setState({ status: 'saving', message: '' });
    try {
      const result = await submit({
        kind: target.kind,
        publicSlug: target.publicSlug || null,
        targetId: target.targetId || null,
        targetLabel: needsChoice ? choice : (target.label || null),
        reason,
        detail: trimmed || null,
        idempotencyKey: idempotencyKey.current,
      });
      setState({ status: 'sent', message: reportReceivedMessage(result) });
    } catch (error) {
      setState({ status: 'error', message: error?.message || 'No pudimos enviar el reporte. Probá de nuevo.' });
    }
  };

  const mailto = reportMailto({ kind: target?.kind, publicSlug: target?.publicSlug || null, origin });
  return createPortal(
    <div className={styles.dialogBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <form className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="content-report-title" onSubmit={send}>
        <h2 id="content-report-title"><Flag size={18} aria-hidden="true" /> Reportar contenido</h2>
        {state.status === 'sent' ? (
          <>
            <p className={styles.successText} role="status"><CheckCircle2 size={18} aria-hidden="true" /> {state.message}</p>
            <div className={styles.formActions}>
              <button type="button" ref={closeRef} className={styles.primaryAction} onClick={onClose}>Listo</button>
            </div>
          </>
        ) : !signedIn || !submit ? (
          <>
            <p className={styles.lead}>
              Para reportar necesitás iniciar sesión con tu cuenta de Arma2: así evitamos reportes falsos y podemos
              revisar cada caso. También podés escribirnos.
            </p>
            <div className={styles.formActions}>
              <a className={styles.secondaryAction} href={mailto}><Mail size={16} aria-hidden="true" /> Escribir un email</a>
              <a className={styles.primaryAction} href={loginHref}><LogIn size={16} aria-hidden="true" /> Iniciar sesión</a>
            </div>
            <div className={styles.formActions}>
              <button type="button" ref={closeRef} className={styles.secondaryAction} onClick={onClose}>Cerrar</button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.lead}>
              Contanos qué está mal. No publicamos tu reporte ni le mostramos a nadie quién lo envió.
            </p>
            {targets.length > 1 && (
              <label className={styles.field}>
                <span>¿Qué querés reportar?</span>
                <select value={targetKey} onChange={(event) => { setTargetKey(Number(event.target.value)); setChoice(''); }}>
                  {targets.map((item, index) => (
                    <option key={`${item.kind}-${index}`} value={index}>{item.title || REPORT_KIND_LABELS[item.kind]}</option>
                  ))}
                </select>
              </label>
            )}
            {targets.length === 1 && target?.title && <p className={styles.help}>{target.title}</p>}
            {needsChoice && (
              <label className={styles.field}>
                <span>{target.kind === 'player' ? '¿Qué jugador?' : '¿Qué equipo?'}</span>
                <select value={choice} onChange={(event) => setChoice(event.target.value)}>
                  <option value="">Elegí uno</option>
                  {choices.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
            )}
            <fieldset className={styles.reasons}>
              <legend>Motivo</legend>
              {REPORT_REASONS.map(([value, label]) => (
                <label key={value}>
                  <input type="radio" name="content-report-reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
                  {label}
                </label>
              ))}
            </fieldset>
            <label className={styles.field}>
              <span>Detalle (opcional)</span>
              <textarea
                rows={3}
                maxLength={REPORT_DETAIL_MAX}
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
                placeholder="Qué viste y dónde. No hace falta incluir datos personales."
              />
              <small>{trimmed.length}/{REPORT_DETAIL_MAX}</small>
            </label>
            {state.status === 'error' && (
              <p className={styles.errorText} role="alert">
                <AlertCircle size={16} aria-hidden="true" /> {state.message} También podés escribirnos a{' '}
                <a href={mailto}>{LEGAL_CONTACT}</a>.
              </p>
            )}
            <div className={styles.formActions}>
              <button type="button" ref={closeRef} className={styles.secondaryAction} onClick={onClose}>Cancelar</button>
              <button type="submit" className={styles.primaryAction} disabled={!valid || state.status === 'saving'}>
                {state.status === 'saving' ? <Loader2 className={styles.spin} size={16} aria-hidden="true" /> : <Flag size={16} aria-hidden="true" />}
                Enviar reporte
              </button>
            </div>
          </>
        )}
      </form>
    </div>,
    document.body,
  );
}

/** The discreet «Reportar» button that opens the dialog. */
export function ReportTrigger({ onClick, label = 'Reportar', className = '' }) {
  return (
    <button type="button" className={`${styles.reportTrigger} ${className}`.trim()} onClick={onClick}>
      <Flag size={14} aria-hidden="true" /> {label}
    </button>
  );
}
