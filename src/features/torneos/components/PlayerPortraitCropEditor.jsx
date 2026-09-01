import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import {
  PLAYER_PORTRAIT_EDITOR_FRAME,
  PLAYER_PORTRAIT_MAX_ZOOM,
  PLAYER_PORTRAIT_MIN_ZOOM,
  PLAYER_PORTRAIT_PAN_STEP,
  PLAYER_PORTRAIT_PAN_STEP_COARSE,
  PLAYER_PORTRAIT_PREVIEW_FRAMES,
  PLAYER_PORTRAIT_ZOOM_STEP,
  clampCrop,
  cropImageStyle,
  normalizeCrop,
  panCrop,
  zoomCrop,
} from '../domain/playerPortraits';
import styles from './PlayerPortraitEditor.module.css';

/**
 * Acomodar una foto, no editar coordenadas.
 *
 * El marco 4:5 se queda quieto y lo que se mueve es la fotografía: se arrastra
 * con el mouse o con el dedo, se acerca con el deslizador o con dos dedos, y lo
 * que se ve es lo que va a quedar. No hay recorte: lo único que sale de acá son
 * tres fracciones —punto focal y zoom— y la imagen original queda intacta, así
 * que el avatar cuadrado se deriva del mismo ajuste sin editarlo dos veces.
 *
 * Tampoco hay librería de crop: la geometría son dos divisiones por eje y vive
 * en el dominio, donde se puede probar sin un navegador.
 */

const FRAME_RATIO = PLAYER_PORTRAIT_EDITOR_FRAME.ratio;

const ZOOM_KEYS = Object.freeze({ '+': 1, '=': 1, '-': -1, _: -1 });
const PAN_KEYS = Object.freeze({
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
});

/** El pellizco sólo se ofrece donde existe: el resto se maneja con el deslizador. */
function touchGestures() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches === true;
}

function dimensionsOf(source) {
  const width = Number(source?.width);
  const height = Number(source?.height);
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)) return null;
  return { width, height };
}

function midpointOf(points) {
  const total = points.reduce(
    (accumulator, point) => ({ x: accumulator.x + point.x, y: accumulator.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: total.x / points.length, y: total.y / points.length };
}

function distanceBetween([first, second]) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export default function PlayerPortraitCropEditor({
  imageUrl,
  name,
  crop,
  natural: seed = null,
  onChange,
  disabled = false,
}) {
  // El montaje se ata a la imagen (`key` en el diálogo): otra foto son otras
  // dimensiones naturales, y arrastrar la nueva con la geometría de la anterior
  // encuadraría contra una foto que ya no está.
  const frameRef = useRef(null);
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const cropRef = useRef(crop);
  const [natural, setNatural] = useState(() => dimensionsOf(seed));
  const [pinch] = useState(touchGestures);
  const labelId = 'player-portrait-crop-label';
  const hintId = 'player-portrait-crop-hint';
  const keysId = 'player-portrait-crop-keys';

  useEffect(() => { cropRef.current = crop; }, [crop]);

  const ready = Boolean(natural) && !disabled;

  const apply = useCallback((next) => {
    onChange(next);
    cropRef.current = next;
  }, [onChange]);

  /*
   * En cuanto se conocen las dimensiones, el encuadre del estado pasa a ser uno
   * que cubre el marco. Sin esto el editor mostraría el recorte legal más
   * cercano pero seguiría guardando el valor de más afuera, y al acercar la foto
   * —donde ese valor vuelve a ser legal— la imagen daría un salto lateral que el
   * usuario no pidió. Lo que se ve es lo que se guarda.
   */
  useEffect(() => {
    if (!natural) return;
    const current = cropRef.current;
    const canonical = clampCrop(current, { natural, frameRatio: FRAME_RATIO });
    if (canonical.x !== current.x || canonical.y !== current.y
      || canonical.zoom !== current.zoom) {
      apply(canonical);
    }
  }, [natural, crop, apply]);

  const pointAt = (event) => {
    const bounds = frameRef.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds?.height) return null;
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    };
  };

  /** Cada gesto arranca de una foto quieta: el delta se mide contra ese estado
   * y no se acumula, así que arrastrar contra el borde y volver no descoloca. */
  const rebase = () => {
    const points = [...pointersRef.current.values()];
    if (!points.length) {
      gestureRef.current = null;
      return;
    }
    gestureRef.current = {
      crop: normalizeCrop(cropRef.current),
      midpoint: midpointOf(points),
      distance: points.length >= 2 ? distanceBetween(points) : 0,
    };
  };

  const handlePointerDown = (event) => {
    if (!ready) return;
    const point = pointAt(event);
    if (!point) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, point);
    rebase();
  };

  const handlePointerMove = (event) => {
    const gesture = gestureRef.current;
    if (!ready || !gesture || !pointersRef.current.has(event.pointerId)) return;
    const point = pointAt(event);
    if (!point) return;
    // Sin esto, arrastrar la foto en un teléfono scrollea el diálogo.
    event.preventDefault();
    pointersRef.current.set(event.pointerId, point);
    const points = [...pointersRef.current.values()];
    const midpoint = midpointOf(points);
    let next = gesture.crop;
    if (points.length >= 2 && gesture.distance > 0) {
      next = zoomCrop(next, {
        natural,
        frameRatio: FRAME_RATIO,
        zoom: gesture.crop.zoom * (distanceBetween(points) / gesture.distance),
        anchor: gesture.midpoint,
      });
    }
    apply(panCrop(next, {
      natural,
      frameRatio: FRAME_RATIO,
      dx: midpoint.x - gesture.midpoint.x,
      dy: midpoint.y - gesture.midpoint.y,
    }));
  };

  const handlePointerUp = (event) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    pointersRef.current.delete(event.pointerId);
    // Si queda un dedo apoyado, el arrastre sigue desde donde quedó la foto.
    rebase();
  };

  const handleKeyDown = (event) => {
    if (!ready) return;
    const pan = PAN_KEYS[event.key];
    if (pan) {
      event.preventDefault();
      const step = event.shiftKey ? PLAYER_PORTRAIT_PAN_STEP_COARSE : PLAYER_PORTRAIT_PAN_STEP;
      apply(panCrop(crop, {
        natural, frameRatio: FRAME_RATIO, dx: pan.dx * step, dy: pan.dy * step,
      }));
      return;
    }
    const direction = ZOOM_KEYS[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? PLAYER_PORTRAIT_PAN_STEP_COARSE : PLAYER_PORTRAIT_ZOOM_STEP;
    apply(zoomCrop(crop, {
      natural, frameRatio: FRAME_RATIO, zoom: crop.zoom + direction * step,
    }));
  };

  const handleZoom = (event) => {
    apply(zoomCrop(crop, {
      natural, frameRatio: FRAME_RATIO, zoom: Number(event.target.value),
    }));
  };

  /** Las dimensiones reales de la imagen, la única medida que la geometría usa. */
  const handleLoad = (event) => {
    const measured = dimensionsOf({
      width: event.target.naturalWidth, height: event.target.naturalHeight,
    });
    if (measured) setNatural(measured);
  };

  return (
    <div className={styles.cropEditor}>
      <p className={styles.cropLabel} id={labelId}>Ajustá la foto</p>

      <div className={styles.cropStage}>
        <div
          ref={frameRef}
          className={styles.cropFrame}
          role="group"
          tabIndex={disabled ? -1 : 0}
          aria-labelledby={labelId}
          aria-describedby={`${hintId} ${keysId}`}
          data-ready={ready ? 'true' : 'false'}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
        >
          <img
            className={styles.cropImage}
            src={imageUrl}
            alt={`Foto de ${name}`}
            draggable={false}
            onLoad={handleLoad}
            style={cropImageStyle({ natural, frameRatio: FRAME_RATIO, crop })}
          />
        </div>

        {/* Al lado del marco y no debajo: el mismo encuadre visto en cuadrado
            no necesita una fila propia, y el pie del diálogo queda alcanzable
            sin scroll en una pantalla de portátil. */}
        <div className={styles.framePreviews}>
          {PLAYER_PORTRAIT_PREVIEW_FRAMES.map((preview) => (
            <figure key={preview.key}>
              <span className={styles.framePreview} style={{ aspectRatio: preview.aspectRatio }}>
                <img
                  src={imageUrl}
                  alt=""
                  draggable={false}
                  style={cropImageStyle({ natural, frameRatio: preview.ratio, crop })}
                />
              </span>
              <figcaption>{preview.label}</figcaption>
            </figure>
          ))}
        </div>
      </div>

      <div className={styles.zoomRow}>
        <ZoomOut size={15} aria-hidden="true" />
        <input
          type="range"
          aria-label="Zoom"
          min={PLAYER_PORTRAIT_MIN_ZOOM}
          max={PLAYER_PORTRAIT_MAX_ZOOM}
          step={PLAYER_PORTRAIT_ZOOM_STEP}
          value={crop.zoom}
          disabled={!ready}
          onChange={handleZoom}
        />
        <ZoomIn size={15} aria-hidden="true" />
      </div>

      <p className={styles.cropHint} id={hintId}>
        {pinch
          ? 'Arrastrá para mover · Pellizcá para acercar'
          : 'Arrastrá para moverla y usá el zoom para acercar o alejar.'}
      </p>
      {/* Para quien navega con teclado esto no es un extra: es la interacción.
          Va en el `aria-describedby` del marco, así que se anuncia al enfocarlo
          en vez de quedar como una línea más de ruido para el resto. */}
      <p className={styles.srOnly} id={keysId}>
        Con el marco enfocado, las flechas mueven la foto y Shift con las flechas
        la mueve más rápido. Las teclas más y menos ajustan el zoom, igual que el
        deslizador.
      </p>
    </div>
  );
}
