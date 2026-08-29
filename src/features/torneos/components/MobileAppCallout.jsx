import React, { useEffect, useState } from 'react';
import { Smartphone, X } from 'lucide-react';
import { FaApple, FaGooglePlay } from 'react-icons/fa';
import { isArma2NativeRuntime } from '../../../utils/runtimePlatform';
import { TORNEOS_STORE_LINKS } from '../config/storeLinks';
import styles from './TorneosShell.module.css';

const DISMISS_KEY = 'arma2:torneos:app-callout-dismissed:v1';

export default function MobileAppCallout() {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (isArma2NativeRuntime()) return;
    try { setDismissed(window.localStorage.getItem(DISMISS_KEY) === '1'); } catch { /* no storage */ }
  }, []);
  if (isArma2NativeRuntime() || dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try { window.localStorage.setItem(DISMISS_KEY, '1'); } catch { /* no storage */ }
  };
  return (
    <aside className={styles.appCallout} aria-label="Descargar la app de Arma2">
      <div className={styles.appCalloutIcon}><Smartphone size={19} aria-hidden="true" /></div>
      <div className={styles.appCalloutCopy}>
        <strong>La web primero. La app te acompaña.</strong>
        <span>Seguí administrando tu torneo desde el celular si querés. Para empezar, no necesitás instalarla: la experiencia web es completa.</span>
      </div>
      <div className={styles.appCalloutLinks}>
        <a href={TORNEOS_STORE_LINKS.appStore} target="_blank" rel="noreferrer" aria-label="Descargar Arma2 en App Store">
          <FaApple aria-hidden="true" />
          <span><small>Disponible en</small><strong>App Store</strong></span>
        </a>
        <a href={TORNEOS_STORE_LINKS.googlePlay} target="_blank" rel="noreferrer" aria-label="Descargar Arma2 en Google Play">
          <FaGooglePlay aria-hidden="true" />
          <span><small>Disponible en</small><strong>Google Play</strong></span>
        </a>
      </div>
      <button type="button" className={styles.appCalloutDismiss} onClick={dismiss} aria-label="Cerrar aviso">
        <X size={16} aria-hidden="true" />
      </button>
    </aside>
  );
}
