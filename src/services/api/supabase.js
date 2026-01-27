/**
 * Supabase API Client (Unified)
 *
 * Este módulo reexporta la única instancia de Supabase usada en la app
 * y expone utilidades relacionadas. Evita crear múltiples clientes para
 * prevenir estados de auth inconsistentes o bugs sutiles.
 */

import { supabase } from '../../lib/supabaseClient';

// Reexport oficial
export { supabase };
export default supabase;

/**
 * Genera un ID de sesión invitado único por partido
 * @param {number|string} partidoId - Match ID
 * @returns {string} ID de sesión de invitado
 */
export const getGuestSessionId = (partidoId) => {
  const storageKey = `guest_session_${partidoId}`;
  let guestId = localStorage.getItem(storageKey);
  if (!guestId) {
    guestId = `guest_${partidoId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem(storageKey, guestId);
  }
  return guestId;
};

/**
 * Obtiene el ID del usuario actual (auth o invitado)
 * @param {number|string|null} partidoId - ID del partido (opcional)
 * @returns {Promise<string>} ID de usuario o ID de sesión invitado
 */
export const getCurrentUserId = async (partidoId = null) => {
  const { data: { user } = {} } = await supabase.auth.getUser();
  if (user?.id) return user.id;
  if (partidoId != null) return getGuestSessionId(partidoId);
  let guestId = localStorage.getItem('guest_session_id');
  if (!guestId) {
    guestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('guest_session_id', guestId);
  }
  return guestId;
};

/**
 * Limpia la sesión invitado (por partido o todas)
 * @param {number|string|null} partidoId - ID del partido (opcional)
 */
export const clearGuestSession = (partidoId) => {
  if (partidoId != null) {
    localStorage.removeItem(`guest_session_${partidoId}`);
    return;
  }
  const keys = Object.keys(localStorage).filter((k) => k.startsWith('guest_session'));
  keys.forEach((k) => localStorage.removeItem(k));
};

/**
 * Suscripción a cambios en tiempo real
 * @param {Function} callback - handler de eventos
 * @returns {import('@supabase/supabase-js').RealtimeChannel}
 */
export const subscribeToChanges = (callback) => {
  const channel = supabase
    .channel('public-changes')
    .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
      try {
        // eslint-disable-next-line no-console
        console.log('[SUPABASE_CHANGE]', payload);
      } catch {
        // Log failed, continue anyway
      }
      callback?.(payload);
    })
    .subscribe();
  return channel;
};

/**
 * Elimina una suscripción realtime
 * @param {import('@supabase/supabase-js').RealtimeChannel} subscription
 */
export const removeSubscription = (subscription) => {
  if (!subscription) return;
  try {
    supabase.removeChannel(subscription);
  } catch {
    // Removal failed, continue anyway
  }
};

/**
 * Genera un código aleatorio para partido
 * @param {number} length - longitud del código (default: 6)
 * @returns {string}
 */
export const generarCodigoPartido = (length = 6) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};
