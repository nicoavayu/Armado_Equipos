import React from 'react';
import {
  PLAYER_PORTRAIT_FRAMES,
  cropImageStyle,
  playerMonogram,
} from '../domain/playerPortraits';
import { usePlayerPortraitUrl } from './usePlayerPortraitUrl';
import styles from './RosterPlayerPortrait.module.css';

/**
 * La representación visual de un jugador del plantel: retrato privado si hay y
 * si la firma resuelve, monograma digno en cualquier otro caso.
 *
 * El marco reserva su espacio siempre, así que resolver, fallar o volver al
 * fallback no mueve la fila. Nunca se pinta una imagen rota ni un placeholder
 * técnico: si no hay foto, hay iniciales.
 *
 * El encuadre es el mismo dato que se acomodó en el editor —punto focal y
 * zoom—, aplicado al marco de esta card: por eso el cuadrado de la fila coincide
 * con el que la previsualización mostró, sin recortar nada.
 */
const FRAME_RATIOS = Object.freeze(Object.fromEntries(
  PLAYER_PORTRAIT_FRAMES.map((entry) => [entry.key, entry.ratio]),
));
export default function RosterPlayerPortrait({
  name,
  portrait = null,
  frame = 'square',
  className = '',
  decorative = true,
}) {
  const { status, url, focal, reportImageError } = usePlayerPortraitUrl(portrait?.ref || null);
  const monogram = playerMonogram(name);
  // La fila es la autoridad del encuadre; la firma sólo trae el punto focal que
  // 1C.2A ya publicaba, que sirve de red cuando la fila no está a mano.
  const crop = portrait?.crop || (focal ? { ...focal, zoom: 1 } : null);
  const natural = portrait?.width && portrait?.height
    ? { width: portrait.width, height: portrait.height }
    : null;

  return (
    <span
      className={`${styles.portrait} ${className}`.trim()}
      data-frame={frame}
      data-status={status}
      aria-hidden={decorative ? 'true' : undefined}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : `Foto de ${name}`}
    >
      {status === 'ready' && url ? (
        <img
          className={styles.image}
          src={url}
          alt={decorative ? '' : `Foto de ${name}`}
          style={cropImageStyle({
            natural, frameRatio: FRAME_RATIOS[frame] || 1, crop,
          })}
          onError={reportImageError}
        />
      ) : (
        <span className={styles.monogram}>{monogram}</span>
      )}
      {status === 'loading' && <span className={styles.skeleton} />}
    </span>
  );
}
