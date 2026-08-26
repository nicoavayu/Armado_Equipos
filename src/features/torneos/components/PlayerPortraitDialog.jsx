import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ImagePlus, Loader2, Lock } from 'lucide-react';
import {
  PLAYER_PORTRAIT_DEFAULT_CROP,
  normalizeCrop,
  validatePlayerPortraitFile,
} from '../domain/playerPortraits';
import PlayerPortraitCropEditor from './PlayerPortraitCropEditor';
import { usePlayerPortraitUrl } from './usePlayerPortraitUrl';
import styles from './PlayerPortraitEditor.module.css';

/**
 * Elegir archivo no es guardar.
 *
 * La foto se previsualiza localmente y recién sube cuando el usuario confirma,
 * porque entre elegir y guardar está justamente lo que hace falta decidir: si
 * es la foto correcta y dónde está la cara. Cancelar en ese punto no deja nada
 * en el servidor.
 */
export default function PlayerPortraitDialog({
  playerName,
  portrait = null,
  busy = false,
  error = '',
  onSave,
  onClose,
}) {
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [crop, setCrop] = useState(
    () => normalizeCrop(portrait?.crop || PLAYER_PORTRAIT_DEFAULT_CROP),
  );
  const [localError, setLocalError] = useState('');
  const current = usePlayerPortraitUrl(portrait?.ref || null);
  const titleId = 'player-portrait-dialog-title';

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const close = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [close]);

  const select = (selected) => {
    setLocalError('');
    if (!selected) return;
    const validation = validatePlayerPortraitFile(selected);
    if (!validation.valid) {
      setLocalError(validation.message);
      setFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl('');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
    // Una foto nueva estrena encuadre: heredar el del retrato anterior
    // encuadraría una cara que ya no está ahí.
    setCrop(normalizeCrop(PLAYER_PORTRAIT_DEFAULT_CROP));
  };

  const editableUrl = previewUrl || (current.status === 'ready' ? current.url : '');
  const hasPortrait = Boolean(portrait?.ref);
  const canSave = Boolean(file) || (hasPortrait && Boolean(editableUrl));
  const message = localError || error;

  /*
   * Las dimensiones naturales del retrato vigente ya vinieron con la fila, así
   * que su encuadre es manipulable desde el primer frame sin esperar la
   * decodificación. Un archivo recién elegido todavía no tiene medidas
   * confiables: las trae su propio `load`.
   */
  const naturalSeed = useMemo(
    () => (file || !portrait?.width || !portrait?.height
      ? null
      : { width: portrait.width, height: portrait.height }),
    [file, portrait?.width, portrait?.height],
  );

  const heading = useMemo(
    () => (hasPortrait ? `Cambiar la foto de ${playerName}` : `Subir la foto de ${playerName}`),
    [hasPortrait, playerName],
  );

  // El diálogo se monta en `body` y no dentro de la fila del jugador: si viviera
  // ahí, los selectores descendientes de Plantel (`.playerCard label`,
  // `.playerCard input`) le reordenarían y repintarían los controles.
  return createPortal(
    <div className={styles.overlay} onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className={styles.dialogHeader}>
          <h2 id={titleId}>{heading}</h2>
          <p className={styles.privacyNote}>
            <Lock size={14} aria-hidden="true" />
            Foto privada del plantel. Tenerla no la publica en ningún lado.
          </p>
        </header>

        <div className={styles.dialogBody}>
          {editableUrl ? (
            <PlayerPortraitCropEditor
              /* Otra imagen es otra geometría: el editor se remonta con ella en
                 vez de arrastrar las dimensiones de la foto anterior. */
              key={editableUrl}
              imageUrl={editableUrl}
              name={playerName}
              crop={crop}
              natural={naturalSeed}
              onChange={setCrop}
              disabled={busy}
            />
          ) : (
            <p className={styles.emptyPreview}>
              {current.status === 'loading'
                ? 'Cargando la foto actual…'
                : 'Elegí una imagen para verla acá antes de guardarla.'}
            </p>
          )}

          {/*
            El input es el de siempre y sigue siendo el que abre el selector:
            sólo deja de mostrarse para que no quede a la vista el
            `Choose File / No file chosen` del navegador. La etiqueta asociada
            hace de botón, así que sigue alcanzándose con Tab y activándose con
            Enter o Espacio, y el nombre del archivo elegido —lo único que el
            control nativo comunicaba— se dice acá, en castellano.
          */}
          <div className={styles.fileField}>
            <input
              id="player-portrait-file"
              className={styles.fileInput}
              ref={inputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(event) => select(event.target.files?.[0])}
            />
            <label className={styles.fileButton} htmlFor="player-portrait-file">
              <ImagePlus size={15} aria-hidden="true" />
              {hasPortrait ? 'Elegir otra foto' : 'Elegir foto'}
            </label>
            {file && (
              <span className={styles.fileName} title={file.name}>{file.name}</span>
            )}
            <p className={styles.fileHint}>JPEG, PNG o WebP · hasta 8 MB.</p>
          </div>

          {message && (
            <p className={styles.dialogError} role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              {message}
            </p>
          )}
        </div>

        <footer className={styles.dialogActions}>
          <button type="button" className={styles.ghostButton} disabled={busy} onClick={close}>
            Cancelar
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={busy || !canSave}
            onClick={() => onSave({ file, crop })}
          >
            {busy
              ? <Loader2 className={styles.spin} size={17} aria-hidden="true" />
              : <ImagePlus size={17} aria-hidden="true" />}
            Guardar foto
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
