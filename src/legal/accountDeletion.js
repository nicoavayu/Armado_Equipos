// Borrado de cuenta: lo que se dice en la app, en la web y en la Privacidad sale de acá, para que todos digan lo mismo y
// lo mismo que hace el código (supabase/functions/delete-account + Torneos 0021; diseño en
// docs/superpowers/specs/2026-10-15-torneos-account-deletion-design.md). Un solo flujo para una sola cuenta.

export const ACCOUNT_DELETION_SUMMARY = Object.freeze({
  deleted: Object.freeze([
    'Tu cuenta de acceso (email y forma de inicio de sesión) y tu perfil de Arma2 y de Torneos.',
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
    'El archivo de tu foto de perfil de Arma2 deja de estar asociado a tu cuenta, pero hoy no se borra automáticamente: si querés que lo borremos, pedilo por email con el formulario de esta página.',
  ]),
  organizations: 'Si sos titular de una organización de Torneos, pasa al administrador más antiguo. Si no tiene administradores, se cierra: deja de verse (incluida su página pública) y no se reembolsa ni se modifica ninguna compra. Si querés que siga, sumá un administrador antes de eliminar la cuenta.',
  timing: 'Desde la app o la web, con la sesión iniciada, el borrado es inmediato. Si Torneos no responde, no se borra nada y podés volver a intentarlo.',
});

/** Short text for confirmation dialogs (ProfileEditor modal, the web button). */
export const ACCOUNT_DELETION_SHORT = 'Se borran tu cuenta y tu perfil en Arma2 y en Torneos, y se cierra tu sesión. '
  + 'En partidos, planteles y estadísticas tu nombre se reemplaza por uno anónimo; los resultados y las compras se conservan sin vínculo con vos.';

export const TORNEOS_ERASURE_FAILED_MESSAGE = 'No pudimos borrar tus datos de Torneos, así que no borramos nada: tu cuenta sigue activa. '
  + 'Probá de nuevo en unos minutos. Si sigue fallando, pedí el borrado por email desde la página «Eliminar cuenta».';

/** The server answer of delete-account → a message for the person (null when it is a success). */
export function accountDeletionErrorMessage(body) {
  const message = String(body?.message || '');
  if (message === 'torneos_erasure_failed') return TORNEOS_ERASURE_FAILED_MESSAGE;
  if (message === 'not_authenticated') return 'Tu sesión venció. Iniciá sesión de nuevo y volvé a intentarlo.';
  if (message === 'profile_delete_failed' || message === 'auth_delete_failed') {
    return 'No pudimos terminar de eliminar la cuenta. Volvé a intentarlo: lo que ya se borró no se repite.';
  }
  return null;
}

/**
 * Invokes the Core delete-account function with the person's own session. Resolves { ok: true } or throws an Error whose
 * message can be shown as is.
 */
export async function requestCoreAccountDeletion(client) {
  const { data, error } = await client.functions.invoke('delete-account', { body: { confirm: true } });
  if (error) {
    let body = null;
    try { body = await error.context?.json?.(); } catch (_) { body = null; }
    throw new Error(accountDeletionErrorMessage(body) || 'No se pudo eliminar la cuenta. Intentá de nuevo más tarde.');
  }
  if (!data?.ok) throw new Error(accountDeletionErrorMessage(data) || 'No se pudo eliminar la cuenta. Intentá de nuevo más tarde.');
  return { ok: true, torneos: data.torneos ?? null };
}
