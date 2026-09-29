import { PUBLIC_APP_ORIGIN } from './publicAppUrl';
import { isArma2NativeRuntime } from './runtimePlatform';

// El WebView de Capacitor sirve la app desde localhost sin puerto (esquema https
// en Android, capacitor en iOS): ese origin sólo existe dentro del teléfono y un
// enlace armado con él no lo puede abrir nadie más. Todo lo que se copia, se
// muestra o se comparte hacia afuera sale de acá.
// - Nativo: siempre el origin público de Producción.
// - Web: el origin actual (Prod, Staging o local), igual que antes.
// No toca el routing interno: la navegación dentro del WebView sigue siendo relativa.
const isWebViewOrigin = (origin) => {
  try {
    const { protocol, hostname, port } = new URL(origin);
    return hostname === 'localhost' && !port && (protocol === 'https:' || protocol === 'capacitor:');
  } catch {
    return false;
  }
};

export function getShareableAppOrigin({
  isNative = isArma2NativeRuntime(),
  currentOrigin = typeof window !== 'undefined' ? window.location?.origin : '',
} = {}) {
  if (isNative) return PUBLIC_APP_ORIGIN;
  const origin = String(currentOrigin || '').replace(/\/+$/, '');
  // Cubre el WebView aunque el bridge de Capacitor todavía no haya respondido;
  // un dev server web lleva puerto o http.
  if (!/^https?:\/\//i.test(origin) || isWebViewOrigin(origin)) {
    return PUBLIC_APP_ORIGIN;
  }
  return origin;
}

export function toShareableAppUrl(path, options) {
  const cleanPath = String(path || '');
  const suffix = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;
  return `${getShareableAppOrigin(options)}${suffix}`;
}
