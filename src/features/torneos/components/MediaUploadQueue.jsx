import React from 'react';
import {
  AlertTriangle,
  Ban,
  Check,
  FileImage,
  Loader2,
  RefreshCw,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import {
  MEDIA_UPLOAD_STATE_LABELS,
  formatMediaBytes,
} from '../domain/mediaPipeline';
import styles from './MediaAdminPage.module.css';

const ACTIVE = new Set(['preparing', 'uploading', 'processing']);
const RETRYABLE = new Set(['error', 'cancelled']);

function QueueStatus({ item }) {
  const label = MEDIA_UPLOAD_STATE_LABELS[item.status] || item.status;
  if (item.status === 'uploading') {
    const percent = Math.round((item.progress || 0) * 100);
    return (
      <div className={styles.queueProgress}>
        <div
          role="progressbar"
          aria-label={`Progreso de ${item.displayName}`}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <small>{label} · {percent}%</small>
      </div>
    );
  }
  if (ACTIVE.has(item.status)) {
    return (
      <span className={styles.queueBusy}>
        <Loader2 size={14} aria-hidden="true" /> {label}
      </span>
    );
  }
  if (item.status === 'pending_review') {
    return (
      <span className={styles.queueDone}>
        <Check size={14} aria-hidden="true" /> {label}
      </span>
    );
  }
  return null;
}

/**
 * The upload queue. Every item shows the same four facts — what it is, how big
 * it is, where it is in the pipeline and what went wrong — and never invents
 * progress: the bar only moves on real `upload.onprogress` events, and the
 * processing phase is shown as indeterminate because it genuinely is.
 */
export default function MediaUploadQueue({
  items,
  canUpload,
  onUpload,
  onCancel,
  onRetry,
  onRemove,
}) {
  if (items.length === 0) return null;
  return (
    <div className={styles.queue} aria-live="polite">
      {items.map((item) => (
        <article key={item.id} data-status={item.status}>
          <div className={styles.queueThumb}>
            {item.previewUrl
              ? <img src={item.previewUrl} alt="" />
              : <FileImage size={20} aria-hidden="true" />}
          </div>
          <span>
            <strong>{item.displayName}</strong>
            <small>
              {formatMediaBytes(item.file.size)}
              {item.localName ? ` · ${item.localName}` : ''}
            </small>
            <QueueStatus item={item} />
            {item.error && (
              <em>
                <AlertTriangle size={12} aria-hidden="true" /> {item.error}
              </em>
            )}
          </span>
          {canUpload && item.status === 'ready' && (
            <button type="button" onClick={() => onUpload(item)}>
              <UploadCloud size={15} aria-hidden="true" /> Subir
            </button>
          )}
          {canUpload && RETRYABLE.has(item.status) && item.retryable !== false && (
            <button type="button" onClick={() => onRetry(item)}>
              <RefreshCw size={15} aria-hidden="true" /> Reintentar
            </button>
          )}
          {ACTIVE.has(item.status) && (
            <button
              type="button"
              aria-label={`Cancelar la carga de ${item.displayName}`}
              onClick={() => onCancel(item)}
            >
              <Ban size={15} aria-hidden="true" /> Cancelar
            </button>
          )}
          {!ACTIVE.has(item.status) && (
            <button
              type="button"
              aria-label={`Quitar ${item.displayName}`}
              onClick={() => onRemove(item)}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
