import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { ImagePlus, Loader2, RefreshCcw, Trash2 } from 'lucide-react';
import {
  removePlayerPortrait,
  setPlayerPortraitCrop,
  uploadPlayerPortrait,
} from '../api/tournamentPlayerPortraitService';
import { invalidatePlayerPortraitUrl } from './usePlayerPortraitUrl';
import PlayerPortraitDialog from './PlayerPortraitDialog';
import styles from './PlayerPortraitEditor.module.css';

function RemoveDialog({ playerName, busy, error, onConfirm, onCancel }) {
  const titleId = 'player-portrait-remove-title';
  return createPortal(
    <div className={styles.overlay} onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <div
        className={`${styles.dialog} ${styles.confirmDialog}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId}>¿Quitar la foto de {playerName}?</h2>
        <p>
          El jugador sigue en el plantel. Sólo se elimina la foto y la ficha
          vuelve a mostrar las iniciales.
        </p>
        {error && <p className={styles.dialogError} role="alert">{error}</p>}
        <div className={styles.dialogActions}>
          <button type="button" className={styles.ghostButton} disabled={busy} onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className={styles.dangerButton}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy
              ? <Loader2 className={styles.spin} size={17} aria-hidden="true" />
              : <Trash2 size={17} aria-hidden="true" />}
            Quitar foto
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Las tres únicas acciones de 1C.2B, y sólo para quien el servidor ya dijo que
 * puede ejecutarlas: `canManage` viene del mismo predicado que después autoriza
 * la escritura, así que no hay forma de pintar un botón que vaya a fallar por
 * permisos.
 */
export default function PlayerPortraitActions({
  organizationId,
  rosterPlayerId,
  playerName,
  portrait = null,
  canManage = false,
  onChanged,
}) {
  const [dialog, setDialog] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!canManage) return null;

  const close = () => {
    setDialog('');
    setError('');
  };

  const save = async ({ file, crop }) => {
    setBusy(true);
    setError('');
    try {
      if (file) {
        const result = await uploadPlayerPortrait({
          organizationId, rosterPlayerId, file, crop,
        });
        if (portrait?.ref) invalidatePlayerPortraitUrl(portrait.ref);
        invalidatePlayerPortraitUrl(result.ref);
        close();
        await onChanged?.(
          result.cropSaved
            ? 'Foto guardada.'
            : 'Foto guardada. No pudimos guardar el encuadre; probá ajustarlo de nuevo.',
        );
        return;
      }
      await setPlayerPortraitCrop({
        organizationId, portraitId: portrait.ref.id, crop,
      });
      close();
      await onChanged?.('Encuadre actualizado.');
    } catch (failure) {
      // La carga nueva falló: el retrato anterior sigue siendo el vigente.
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await removePlayerPortrait({ portraitId: portrait.ref.id });
      invalidatePlayerPortraitUrl(portrait.ref);
      close();
      await onChanged?.('Foto eliminada.');
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.rowActions}>
      {portrait?.ref ? (
        <>
          <button type="button" onClick={() => setDialog('edit')}>
            <RefreshCcw size={14} aria-hidden="true" />
            Cambiar
            <span className={styles.srOnly}>{` la foto de ${playerName}`}</span>
          </button>
          <button type="button" className={styles.remove} onClick={() => setDialog('remove')}>
            <Trash2 size={14} aria-hidden="true" />
            Quitar
            <span className={styles.srOnly}>{` la foto de ${playerName}`}</span>
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setDialog('edit')}>
          <ImagePlus size={14} aria-hidden="true" />
          Subir foto
          <span className={styles.srOnly}>{` de ${playerName}`}</span>
        </button>
      )}

      {dialog === 'edit' && (
        <PlayerPortraitDialog
          playerName={playerName}
          portrait={portrait}
          busy={busy}
          error={error}
          onSave={save}
          onClose={close}
        />
      )}
      {dialog === 'remove' && (
        <RemoveDialog
          playerName={playerName}
          busy={busy}
          error={error}
          onConfirm={remove}
          onCancel={close}
        />
      )}
    </div>
  );
}
