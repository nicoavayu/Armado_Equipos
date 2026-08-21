import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle, Check, EyeOff, ImagePlus, LoaderCircle, Trash2, X,
} from 'lucide-react';
import {
  TEAM_PHOTO_EDITORIAL_HINTS,
  TEAM_PHOTO_EDITORIAL_LABELS,
  resolveTeamPhotoDisplay,
  teamPhotoActions,
} from '../domain/teamPhotos';
import {
  removeTeamPhoto,
  revokeTeamPhoto,
  setTeamPhotoEditorialStatus,
  uploadTeamPhoto,
} from '../api/tournamentTeamPhotoService';
import { invalidateTeamPhotoUrl, useTeamPhotoUrl } from './useTeamPhotoUrl';
import BrandingImage from './BrandingImage';
import styles from './TeamPhotoPanel.module.css';

const REVIEW_REASON_MAX = 500;

/**
 * Un marco que nunca queda roto ni vacío. Sin firma —porque todavía no llegó,
 * porque falló, o porque no hay foto— se dibuja el fallback, que es el escudo
 * del equipo: es la presentación coherente que ya usa el resto de la pantalla.
 */
function TeamPhotoFrame({ photoRef, alt, fallback, className = '' }) {
  const { status, url, reportImageError } = useTeamPhotoUrl(photoRef || null);
  return (
    <span className={`${styles.frame} ${className}`} data-status={status}>
      {status === 'ready' && url ? (
        <img src={url} alt={alt} className={styles.image} onError={reportImageError} />
      ) : fallback}
      {status === 'loading' && <span className={styles.frameLoading} aria-hidden="true" />}
    </span>
  );
}

/**
 * El consumo puro: la foto vigente y nada más. No dibuja nada cuando no hay una
 * aprobada —ni un hueco, ni el escudo estirado a lo ancho— porque acá la foto
 * es un agregado, no la identidad del equipo. Y nunca ve la candidata: quien
 * mira el plantel no está moderando.
 */
export function TeamPhotoBanner({ state, teamName = '' }) {
  const display = resolveTeamPhotoDisplay(state);
  if (display.source !== 'current') return null;
  return (
    <TeamPhotoFrame
      photoRef={display.ref}
      alt={`Foto del equipo ${teamName}`}
      fallback={<span className={styles.frameEmpty} aria-hidden="true" />}
      className={styles.banner}
    />
  );
}

/**
 * Foto del equipo: la vigente, la candidata que espera revisión, y las acciones
 * que cada actor tiene realmente disponibles.
 *
 * Nada de lo que se muestra acá se recalcula del rol del usuario: `canManage` y
 * `canModerate` los responde el servidor con los mismos predicados que después
 * autorizan la escritura. Poder abrir la pantalla no es poder ejecutar todo lo
 * que hay en ella, así que un actor que sólo puede mirar ve la foto vigente y
 * su estado, sin botones y sin la candidata.
 */
export default function TeamPhotoPanel({
  organizationId,
  teamEntryId,
  state,
  status = 'ready',
  teamName = '',
  shieldPath = null,
  onChanged,
  onRetry,
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const candidate = state?.candidate || null;
  // La identidad del formulario de rechazo no es la fila: es la fila EN ESTADO
  // pendiente. Rechazar no cambia el id de la candidata —la misma foto pasa de
  // `pending_review` a `rejected`—, así que keyear sólo por id dejaba el
  // formulario abierto sobre una decisión ya tomada, con un botón que el
  // servidor iba a rechazar.
  const pendingKey = candidate?.editorialStatus === 'pending_review'
    ? candidate.teamPhotoId : '';
  const candidateId = candidate?.teamPhotoId || '';

  useEffect(() => {
    setRejecting(false);
    setReason('');
  }, [pendingKey]);

  const run = useCallback(async (key, action, notice) => {
    if (busy) return;
    setBusy(key);
    setMessage(null);
    try {
      const result = await action();
      setMessage({ tone: 'success', text: notice });
      await onChanged?.(result);
    } catch (error) {
      setMessage({ tone: 'error', text: error?.message || 'No pudimos completar la operación.' });
    } finally {
      setBusy('');
    }
  }, [busy, onChanged]);

  if (status === 'loading' && !state) {
    return (
      <section className={styles.panel} aria-busy="true">
        <h3 className={styles.title}>Foto del equipo</h3>
        <p className={styles.hint}>Cargando…</p>
      </section>
    );
  }

  if (status === 'error' && !state) {
    return (
      <section className={styles.panel}>
        <h3 className={styles.title}>Foto del equipo</h3>
        <p className={styles.hint}>No pudimos cargar la foto del equipo.</p>
        <div className={styles.actions}>
          <button type="button" onClick={() => onRetry?.()}>Reintentar</button>
        </div>
      </section>
    );
  }

  const display = resolveTeamPhotoDisplay(state);
  const actions = teamPhotoActions(state);
  const shield = (
    <BrandingImage
      kind="team"
      path={shieldPath}
      name={teamName}
      className={styles.shieldFallback}
      imageClassName={styles.shieldImage}
    />
  );

  const upload = (file) => {
    if (!file) return;
    run('upload', () => uploadTeamPhoto({ organizationId, teamEntryId, file }), state?.current
      ? 'Foto enviada a revisión. La foto vigente no cambió.'
      : 'Foto enviada a revisión.').finally(() => {
      if (inputRef.current) inputRef.current.value = '';
    });
  };

  const approve = () => run(
    'approve',
    async () => {
      const result = await setTeamPhotoEditorialStatus({
        organizationId, teamPhotoId: candidateId, editorialStatus: 'approved',
      });
      // La candidata pasó a vigente y la anterior se jubiló: las dos firmas en
      // caché dejaron de describir lo que hay.
      invalidateTeamPhotoUrl(candidate?.ref);
      invalidateTeamPhotoUrl(state?.current?.ref);
      return result;
    },
    'Foto aprobada. Ahora es la foto del equipo.',
  );

  const reject = () => run(
    'reject',
    () => setTeamPhotoEditorialStatus({
      organizationId,
      teamPhotoId: candidateId,
      editorialStatus: 'rejected',
      reviewReason: reason.trim() || null,
    }),
    'Foto rechazada. La foto vigente no cambió.',
  );

  const revoke = () => run(
    'revoke',
    async () => {
      const result = await revokeTeamPhoto({
        organizationId, teamPhotoId: state.current.teamPhotoId,
      });
      invalidateTeamPhotoUrl(state?.current?.ref);
      return result;
    },
    'Foto retirada. El equipo vuelve a mostrar su escudo.',
  );

  const withdraw = () => run(
    'withdraw',
    async () => {
      const result = await removeTeamPhoto({ teamPhotoId: candidateId });
      invalidateTeamPhotoUrl(candidate?.ref);
      return result;
    },
    'Se dio de baja la foto enviada.',
  );

  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h3 className={styles.title}>Foto del equipo</h3>
        <span className={styles.statePill} data-state={display.source === 'current' ? 'approved' : 'none'}>
          {display.source === 'current' ? 'Publicada' : 'Sin foto'}
        </span>
      </div>

      <div className={styles.frames}>
        <figure className={styles.slot}>
          <TeamPhotoFrame
            photoRef={display.ref}
            alt={display.source === 'current' ? `Foto del equipo ${teamName}` : ''}
            fallback={shield}
            className={styles.currentFrame}
          />
          <figcaption>
            {display.source === 'current' ? 'Foto vigente' : 'Sin foto aprobada · se muestra el escudo'}
          </figcaption>
        </figure>

        {candidate && (
          <figure className={styles.slot} data-editorial={candidate.editorialStatus}>
            <TeamPhotoFrame
              photoRef={candidate.ref}
              alt={`Foto enviada por ${teamName}`}
              fallback={<span className={styles.frameEmpty} aria-hidden="true" />}
              className={styles.candidateFrame}
            />
            <figcaption>
              <span className={styles.candidatePill} data-editorial={candidate.editorialStatus}>
                {TEAM_PHOTO_EDITORIAL_LABELS[candidate.editorialStatus] || 'Enviada'}
              </span>
              {candidate.editorialStatus === 'rejected' && candidate.reviewReason && (
                <span className={styles.reason}>{candidate.reviewReason}</span>
              )}
            </figcaption>
          </figure>
        )}
      </div>

      <p className={styles.hint}>
        {candidate
          ? TEAM_PHOTO_EDITORIAL_HINTS[candidate.editorialStatus]
          : 'Una foto grupal del plantel. JPEG, PNG o WebP · hasta 8 MB. La organización la revisa antes de publicarla.'}
      </p>

      {message && (
        <p className={message.tone === 'error' ? styles.error : styles.success} role="status">
          {message.tone === 'error' ? <AlertCircle size={15} /> : <Check size={15} />}
          {message.text}
        </p>
      )}

      {rejecting && (
        <div className={styles.rejectForm}>
          <label htmlFor="team-photo-reject-reason">
            Motivo del rechazo <span>(opcional, lo ve el equipo)</span>
          </label>
          <textarea
            id="team-photo-reject-reason"
            rows={2}
            maxLength={REVIEW_REASON_MAX}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Por ejemplo: no se ve el plantel completo."
          />
        </div>
      )}

      {(actions.canUpload || actions.canApprove || actions.canReject
        || actions.canRevokeCurrent || actions.canWithdrawCandidate) && (
        <div className={styles.actions}>
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            onChange={(event) => upload(event.target.files?.[0])}
          />
          {actions.canUpload && (
            <button
              type="button"
              className={styles.primary}
              disabled={Boolean(busy)}
              onClick={() => inputRef.current?.click()}
            >
              {busy === 'upload'
                ? <LoaderCircle className={styles.spin} size={17} />
                : <ImagePlus size={17} />}
              {candidate ? 'Subir otra' : state?.current ? 'Reemplazar' : 'Subir foto'}
            </button>
          )}
          {actions.canApprove && !rejecting && (
            <button type="button" className={styles.approve} disabled={Boolean(busy)} onClick={approve}>
              {busy === 'approve'
                ? <LoaderCircle className={styles.spin} size={17} />
                : <Check size={17} />}
              Aprobar
            </button>
          )}
          {actions.canReject && !rejecting && (
            <button type="button" className={styles.reject} disabled={Boolean(busy)} onClick={() => setRejecting(true)}>
              <X size={17} /> Rechazar
            </button>
          )}
          {rejecting && (
            <>
              <button type="button" className={styles.reject} disabled={Boolean(busy)} onClick={reject}>
                {busy === 'reject'
                  ? <LoaderCircle className={styles.spin} size={17} />
                  : <X size={17} />}
                Confirmar rechazo
              </button>
              <button type="button" disabled={Boolean(busy)} onClick={() => setRejecting(false)}>
                Cancelar
              </button>
            </>
          )}
          {actions.canWithdrawCandidate && !rejecting && (
            <button type="button" className={styles.reject} disabled={Boolean(busy)} onClick={withdraw}>
              {busy === 'withdraw'
                ? <LoaderCircle className={styles.spin} size={17} />
                : <Trash2 size={17} />}
              Dar de baja
            </button>
          )}
          {actions.canRevokeCurrent && !rejecting && (
            <button type="button" className={styles.reject} disabled={Boolean(busy)} onClick={revoke}>
              {busy === 'revoke'
                ? <LoaderCircle className={styles.spin} size={17} />
                : <EyeOff size={17} />}
              Retirar la vigente
            </button>
          )}
        </div>
      )}
    </section>
  );
}
