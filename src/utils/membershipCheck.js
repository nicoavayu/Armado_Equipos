// src/utils/membershipCheck.js
import { supabase } from '../supabase';

/**
 * Single source of truth for membership check
 * Queries DB to verify if user is actually a member of the match
 * 
 * @param {string} userUuid - Auth user UUID
 * @param {number} matchId - Match ID
 * @returns {Promise<{ isMember: boolean, jugadorRow: object|null, error: any }>}
 */
export async function isUserMemberOfMatch(userUuid, matchId) {
    if (!userUuid || !matchId) {
        console.warn('[MEMBERSHIP_CHECK] Missing parameters', { userUuid, matchId });
        return { isMember: false, jugadorRow: null, error: 'Missing parameters' };
    }

    try {
        const { data, error } = await supabase
            .from('jugadores')
            .select('id, nombre, usuario_id, partido_id')
            .eq('partido_id', matchId)
            .eq('usuario_id', userUuid)
            .maybeSingle();

        console.log('[MEMBERSHIP_CHECK] DB query result', {
            userUuid,
            matchId,
            found: !!data,
            row: data,
            error: error ? { code: error.code, message: error.message } : null
        });

        if (error) {
            console.error('[MEMBERSHIP_CHECK] DB error', {
                code: error.code,
                message: error.message,
                details: error.details,
                hint: error.hint
            });
            return { isMember: false, jugadorRow: null, error };
        }

        return { isMember: !!data, jugadorRow: data, error: null };
    } catch (err) {
        console.error('[MEMBERSHIP_CHECK] Exception', err);
        return { isMember: false, jugadorRow: null, error: err };
    }
}

/**
 * Clear guest localStorage when user authenticates
 * Prevents guest data from interfering with authenticated session
 * 
 * @param {number} partidoId - Match ID
 */
export function clearGuestMembership(partidoId) {
    if (!partidoId) return;

    const storageKey = `guest_joined_${partidoId}`;
    const existingValue = localStorage.getItem(storageKey);

    if (existingValue) {
        console.log('[MEMBERSHIP_CHECK] Clearing guest localStorage', { partidoId, storageKey });
        localStorage.removeItem(storageKey);
    }
}
