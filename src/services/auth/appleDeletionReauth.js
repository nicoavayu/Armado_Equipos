import { Capacitor } from '@capacitor/core';

// Eliminar la cuenta con Sign in with Apple (App Review 5.1.1(v); Apple TN3194). Arma2 no guarda tokens de Apple, así que
// al eliminar la cuenta desde el iPhone se vuelve a abrir la hoja nativa de Apple para obtener un authorizationCode NUEVO
// (de un solo uso, vale cinco minutos), que va en el body de delete-account; el servidor lo canjea y revoca los tokens
// (supabase/functions/_shared/appleSignInRevocation.ts). Sin pedir nombre ni email (scopes vacíos). El código nunca se
// loguea ni se guarda.
//
// El plugin se carga recién cuando hace falta (import dinámico): así la pantalla de Perfil y la página web no lo cargan
// fuera de iOS, y los tests no dependen de su build ESM.

const IOS_BUNDLE_ID = 'com.teambalancer.app'; // el mismo App ID que el inicio de sesión (services/auth/socialAuth.js)
const NATIVE_REDIRECT = `${IOS_BUNDLE_ID}://auth/callback`; // iOS lo ignora (ASAuthorizationAppleIDProvider)

export class AppleReauthCancelledError extends Error {
  constructor(message = 'No se confirmó con Apple.') {
    super(message);
    this.name = 'AppleReauthCancelledError';
  }
}

export const isIosNativePlatform = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

const isCancellation = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('cancel') || message.includes('error 1001');
};

const randomState = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
};

/**
 * Abre la hoja nativa de Apple y devuelve el authorizationCode. Si la persona la cierra → AppleReauthCancelledError;
 * cualquier otro problema → Error. Sólo en iOS nativo.
 */
export async function requestAppleAuthorizationCodeForDeletion({ plugin } = {}) {
  if (!isIosNativePlatform()) throw new Error('Confirmar con Apple sólo está disponible en la app de iPhone.');
  const signInWithApple = plugin || (await import('@capacitor-community/apple-sign-in')).SignInWithApple;
  let result;
  try {
    result = await signInWithApple.authorize({
      clientId: IOS_BUNDLE_ID,
      redirectURI: NATIVE_REDIRECT,
      scopes: '',
      state: randomState(),
    });
  } catch (error) {
    if (isCancellation(error)) throw new AppleReauthCancelledError();
    throw new Error('No se pudo confirmar con Apple.');
  }
  const code = typeof result?.response?.authorizationCode === 'string' ? result.response.authorizationCode.trim() : '';
  if (!code) throw new Error('Apple no devolvió un código de autorización.');
  return code;
}
