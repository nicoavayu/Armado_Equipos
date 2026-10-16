// Borrado de cuenta: lo que se dice en la app, en la web y en la Privacidad sale de acá, para que todos digan lo mismo y
// lo mismo que hace el código (supabase/functions/delete-account + Torneos 0021 + los pasos de Storage y de Sign in with
// Apple; diseño en docs/superpowers/specs/2026-10-15-torneos-account-deletion-design.md y PLAN-FOTOS-CORE-Y-APPLE.md).
// Un solo flujo para una sola cuenta.

export const ACCOUNT_DELETION_SUMMARY = Object.freeze({
  deleted: Object.freeze([
    'Tu cuenta de acceso (email y forma de inicio de sesión) y tu perfil de Arma2 y de Torneos.',
    // Exactly what supabase/functions/_shared/coreAccountStorageErasure.ts removes (CORE_STORAGE_BUCKETS): jugadores-fotos
    // and avatars by the account id; team-crests only what no team uses. Nothing else is promised.
    'Tus fotos de Arma2: tu foto de perfil y sus versiones anteriores (también las del formato de avatar anterior), tus '
      + 'fotos de jugador, y los escudos y fotos de plantel que subiste y que no usa ningún equipo.',
    'Tus amistades, notificaciones, preferencias, votos y encuestas, y tus pedidos para sumarte a partidos.',
    'Tu acceso a organizaciones, temporadas y equipos de Torneos (membresías, roles de capitán o delegado).',
  ]),
  anonymised: Object.freeze([
    'En partidos, planteles, actas y estadísticas tu nombre y tu foto se reemplazan por «Usuario eliminado» (Arma2) o «Jugador eliminado» con un código (Torneos).',
    'Se borran tus mensajes y comentarios personales en Torneos (por ejemplo, el de una inscripción o el de tu disponibilidad) y los emails y teléfonos que se cargaron de vos.',
  ]),
  kept: Object.freeze([
    'Los resultados, goles, tarjetas y tablas de los torneos y partidos en los que participaste, sin tu nombre: son la historia de los demás equipos y de las organizaciones.',
    'Las compras y pagos (montos, fechas, estado y número de operación), sin vínculo con tu cuenta: lo exigen las normas contables y de defensa del consumidor (arrepentimiento, devoluciones y contracargos).',
    'Los comunicados y documentos que publicaste en nombre de una organización: son de la organización.',
    'Los mensajes que mandaste en chats de equipo de Arma2, sin tu nombre.',
    'Los escudos y fotos de plantel que siguen usando equipos con otros integrantes: quedan como parte del equipo, sin vínculo con vos.',
    'Las fotos que se subieron sin cuenta (por ejemplo, la de un invitado en una votación) y las imágenes de partidos: no están asociadas a tu cuenta.',
  ]),
  organizations: 'Si sos titular de una organización de Torneos, pasa al administrador más antiguo. Si no tiene administradores, se cierra: deja de verse (incluida su página pública) y no se reembolsa ni se modifica ninguna compra. Si querés que siga, sumá un administrador antes de eliminar la cuenta.',
  timing: 'Desde la app o la web, con la sesión iniciada, el borrado se hace en el momento: primero en Torneos y después en Arma2. '
    + 'Si Torneos no responde, no se borra nada y tu cuenta sigue activa. Si falla una parte, podés reintentar con el mismo botón para '
    + 'terminar; lo ya anonimizado en Torneos no se puede revertir.',
  apple: 'Si entraste con Apple: al eliminar la cuenta desde la app en el iPhone te pedimos que confirmes con Apple y '
    + 'desvinculamos Arma2 de tu Apple ID. Si la eliminás desde la web o desde Android, o si no se pudo desvincular, '
    + 'hacelo vos en el iPhone (los pasos están abajo).',
});

/** Short text for confirmation dialogs (ProfileEditor modal, the web button). */
export const ACCOUNT_DELETION_SHORT = 'Se borran tu cuenta y tu perfil en Arma2 y en Torneos y tu foto de perfil de Arma2, y se cierra tu sesión. '
  + 'En partidos, planteles y estadísticas tu nombre se reemplaza por uno anónimo; los resultados y las compras se conservan sin vínculo con vos. '
  + 'Si falla una parte, podés reintentar; lo ya anonimizado en Torneos no se puede revertir.';

// ── Sign in with Apple (supabase/functions/_shared/appleSignInRevocation.ts) ────────────────────────────────────────────
/** Apple Support 102571 «Stop using Sign in with Apple with an app». */
export const APPLE_UNLINK_HELP_URL = 'https://support.apple.com/102571';
/** The iPhone steps (the labels move between iOS versions; Apple's page has the current ones). */
export const APPLE_UNLINK_STEPS = 'En el iPhone: Ajustes → tu nombre → Iniciar sesión con Apple (en algunas versiones está dentro de '
  + '«Inicio de sesión y seguridad») → Arma2 → Dejar de usar.';
/** In the modal, before deleting, on the iPhone app. */
export const APPLE_REAUTH_NOTICE = 'Como entraste con Apple, te vamos a pedir que confirmes con Apple para desvincular Arma2 de tu Apple ID.';
/** In the modal / the web, before deleting, where there is no Apple sheet (web, Android). */
export const APPLE_NO_REAUTH_NOTICE = 'Entraste con Apple: desde acá no podemos desvincular Arma2 de tu Apple ID. La cuenta se elimina igual; '
  + 'después desvinculala vos en el iPhone, o eliminala desde la app en el iPhone para que lo hagamos automáticamente.';
/** The person closed the Apple sheet (Apple TN3194: the deletion must still be possible). */
export const APPLE_REAUTH_DECLINED = 'No se confirmó con Apple. Podés eliminar la cuenta igual: se borra todo lo mismo, pero Arma2 va a '
  + 'seguir figurando en tu Apple ID hasta que lo desvincules vos en el iPhone.';
/** After the deletion, when the Apple tokens could not be revoked (anything but `revoked`). */
export const APPLE_UNLINK_MANUAL = 'Tu cuenta se eliminó. No pudimos desvincular Arma2 de tu Apple ID automáticamente: hacelo vos.';

export const TORNEOS_ERASURE_FAILED_MESSAGE = 'No pudimos borrar tus datos de Torneos, así que no borramos nada: tu cuenta sigue activa. '
  + 'Probá de nuevo en unos minutos.';

/** Core failed AFTER Torneos was anonymised (two databases: no transaction across them). Honest and retryable. */
export const CORE_DELETION_PARTIAL_MESSAGE = 'Ya se anonimizó lo tuyo en Torneos (eso no se puede revertir), pero no pudimos terminar de '
  + 'eliminar tu cuenta de Arma2: sigue existiendo. Volvé a intentarlo con el mismo botón para terminar.';

/** The photos step failed (after Torneos, before any Arma2 row): nothing deleted in Arma2 yet. Honest and retryable. */
export const STORAGE_ERASURE_FAILED_MESSAGE = 'Ya se anonimizó lo tuyo en Torneos (eso no se puede revertir), pero no pudimos borrar tus '
  + 'fotos, así que no borramos nada en Arma2: tu cuenta sigue activa. Volvé a intentarlo con el mismo botón en unos minutos para terminar.';

/** The server answer of delete-account → a message for the person (null when it is a success). */
export function accountDeletionErrorMessage(body) {
  const message = String(body?.message || '');
  if (message === 'torneos_erasure_failed') return TORNEOS_ERASURE_FAILED_MESSAGE;
  if (message === 'storage_erasure_failed') return STORAGE_ERASURE_FAILED_MESSAGE;
  if (message === 'not_authenticated') return 'Tu sesión venció. Iniciá sesión de nuevo y volvé a intentarlo.';
  if (message === 'profile_delete_failed' || message === 'auth_delete_failed') return CORE_DELETION_PARTIAL_MESSAGE;
  return null;
}

/** true when the session user signed in with Apple (Supabase auth identities or app_metadata). */
export function hasAppleIdentity(user) {
  if (!user) return false;
  if (Array.isArray(user.identities) && user.identities.some((identity) => identity?.provider === 'apple')) return true;
  const meta = user.app_metadata || {};
  return meta.provider === 'apple' || (Array.isArray(meta.providers) && meta.providers.includes('apple'));
}

/**
 * Invokes the Core delete-account function with the person's own session. Resolves { ok: true, torneos, apple } or
 * throws an Error whose message can be shown as is. `appleAuthorizationCode` (iOS only, fresh from the Apple sheet) is
 * sent once and never kept.
 */
export async function requestCoreAccountDeletion(client, { appleAuthorizationCode = null } = {}) {
  const body = { confirm: true };
  if (appleAuthorizationCode) body.apple_authorization_code = appleAuthorizationCode;
  const { data, error } = await client.functions.invoke('delete-account', { body });
  if (error) {
    let errorBody = null;
    try { errorBody = await error.context?.json?.(); } catch (_) { errorBody = null; }
    throw new Error(accountDeletionErrorMessage(errorBody) || 'No se pudo eliminar la cuenta. Intentá de nuevo más tarde.');
  }
  if (!data?.ok) throw new Error(accountDeletionErrorMessage(data) || 'No se pudo eliminar la cuenta. Intentá de nuevo más tarde.');
  return { ok: true, torneos: data.torneos ?? null, apple: data.apple ?? null };
}

/**
 * The whole deletion as the app and the web run it:
 *   - an Apple account on the iPhone app first confirms with Apple (fresh authorizationCode for the revocation);
 *     if the person closes the Apple sheet (or it fails) → { status: 'apple_declined' } and NOTHING is deleted yet:
 *     the UI explains and offers «Eliminar igual» (withoutApple: true), as Apple TN3194 asks (the deletion must still be
 *     possible without a token);
 *   - anywhere else (web, Android) or without Apple, no sheet;
 *   - after the deletion, `appleUnlinkNeeded` says whether to show how to unlink Arma2 by hand (any Apple account whose
 *     tokens were not revoked).
 * Throws the Error of requestCoreAccountDeletion (the account is not deleted, or only partially: the message says so).
 */
export async function runAccountDeletion({ client, user, isIosNative = () => false, getAppleAuthorizationCode, withoutApple = false }) {
  const isApple = hasAppleIdentity(user);
  let appleAuthorizationCode = null;
  if (isApple && !withoutApple && isIosNative() && typeof getAppleAuthorizationCode === 'function') {
    try {
      appleAuthorizationCode = await getAppleAuthorizationCode();
    } catch (error) {
      return { status: 'apple_declined', cancelled: error?.name === 'AppleReauthCancelledError' };
    }
  }
  const result = await requestCoreAccountDeletion(client, { appleAuthorizationCode });
  return { status: 'deleted', torneos: result.torneos, apple: result.apple, appleUnlinkNeeded: isApple && result.apple !== 'revoked' };
}
