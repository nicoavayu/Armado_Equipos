import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, Trash2 } from 'lucide-react';
import {
  removeTournamentBrandingAsset,
  uploadTournamentBrandingAsset,
} from '../api/tournamentBrandingService';
import { useOptionalTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { authorizedBrandingUrl, brandingRequiresAuthorizedUrls } from '../domain/brandingUrlRegistry';
import BrandingImage from './BrandingImage';
import styles from './BrandingAssetField.module.css';

const LABELS = Object.freeze({
  organization: 'Logo de la organización',
  tournament: 'Logo del torneo',
  team: 'Escudo del equipo',
});

export default function BrandingAssetField({
  organizationId,
  kind,
  entityId,
  path = null,
  fallbackPath = null,
  name,
  canEdit = false,
  onChanged,
}) {
  const inputRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const label = LABELS[kind] || 'Imagen';
  // The MOUNTED composition stores the asset: the hybrid one through the Torneos gateway (BRANDING-V1 aliases), the
  // LOCAL single-project one with its own storage service, as before.
  const composed = useOptionalTorneosWorkspace()?.service;
  const uploadAsset = typeof composed?.uploadBrandingAsset === 'function'
    ? composed.uploadBrandingAsset
    : uploadTournamentBrandingAsset;
  const removeAsset = typeof composed?.removeBrandingAsset === 'function'
    ? composed.removeBrandingAsset
    : removeTournamentBrandingAsset;
  const loadSignedBranding = typeof composed?.loadBrandingContext === 'function' ? composed.loadBrandingContext : null;
  const [signedVersion, setSignedVersion] = useState(0);

  // Hybrid composition: a logo path read from an unsigned answer (the workspace context) becomes an image only through
  // the gateway's signature. The organization's branding context is that signed answer for its own logo and its
  // tournaments' logos, so it is asked once when the current path has no authorized URL yet (team shields already
  // arrive signed with their registration context).
  useEffect(() => {
    if (!loadSignedBranding || kind === 'team' || !path || !brandingRequiresAuthorizedUrls() || authorizedBrandingUrl(path)) return undefined;
    let active = true;
    loadSignedBranding({ organizationId, tournamentId: kind === 'tournament' ? entityId : null })
      .then(() => { if (active) setSignedVersion((version) => version + 1); })
      .catch(() => {});
    return () => { active = false; };
  }, [entityId, kind, loadSignedBranding, organizationId, path]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const select = async (file) => {
    if (!file || busy) return;
    setMessage('');
    const selectedPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl(selectedPreviewUrl);
    setBusy('upload');
    try {
      const result = await uploadAsset({
        organizationId,
        kind,
        entityId,
        file,
      });
      setMessage(`${label} actualizado.`);
      await onChanged?.(result);
    } catch (error) {
      setMessage(error?.message || `No pudimos guardar el ${label.toLowerCase()}.`);
    } finally {
      setBusy('');
      URL.revokeObjectURL(selectedPreviewUrl);
      setPreviewUrl('');
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async () => {
    if (!path || busy) return;
    setBusy('remove');
    setMessage('');
    try {
      const result = await removeAsset({
        organizationId,
        kind,
        entityId,
      });
      setMessage(`${label} eliminado. Se restauró el fallback.`);
      await onChanged?.(result);
    } catch (error) {
      setMessage(error?.message || `No pudimos quitar el ${label.toLowerCase()}.`);
    } finally {
      setBusy('');
    }
  };

  return (
    <section className={styles.field} data-kind={kind}>
      <div className={styles.preview}>
        {previewUrl ? (
          <span><img src={previewUrl} alt={`Vista previa de ${label.toLowerCase()}`} /></span>
        ) : (
          <BrandingImage
            key={signedVersion}
            kind={kind}
            path={path}
            fallbackPath={fallbackPath}
            name={name}
            className={styles.imageFrame}
            imageClassName={styles.image}
          />
        )}
      </div>
      <div className={styles.copy}>
        <strong>{label}</strong>
        <p>PNG, JPEG o WebP · hasta 2 MB al guardar · sin recortes.</p>
        {message && (
          <span className={/no pudimos|no tenés|no es válida/i.test(message) ? styles.error : styles.success} role="status">
            {message}
          </span>
        )}
      </div>
      {canEdit && (
        <div className={styles.actions}>
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            onChange={(event) => select(event.target.files?.[0])}
          />
          <button type="button" disabled={Boolean(busy)} onClick={() => inputRef.current?.click()}>
            {busy === 'upload' ? <LoaderCircle className={styles.spin} size={17} /> : <ImagePlus size={17} />}
            {path ? 'Cambiar' : 'Subir'}
          </button>
          {path && (
            <button type="button" className={styles.remove} disabled={Boolean(busy)} onClick={remove}>
              {busy === 'remove' ? <LoaderCircle className={styles.spin} size={17} /> : <Trash2 size={17} />}
              Quitar
            </button>
          )}
        </div>
      )}
    </section>
  );
}
