import { supabase } from '../supabase';
import { getPublicBaseUrl } from './publicBaseUrl';

// Self-contained helpers to share the public voting link for a match.
//
// These mirror the logic that lives inside ArmarEquiposView (the intermediate
// "ARMAR EQUIPOS" screen) so the same action can be triggered from the final
// "EQUIPOS ARMADOS" view (TeamDisplay) without forcing the admin back through the
// intermediate screen. Kept here as a small util so both call sites stay aligned.

export const normalizeMatchCode = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw || raw.toLowerCase() === 'null' || raw.toLowerCase() === 'undefined') return null;
  return raw;
};

export const resolveMatchCode = async (partido) => {
  const inMemoryCode = normalizeMatchCode(partido?.codigo);
  if (inMemoryCode) return inMemoryCode;
  const matchId = Number(partido?.id);
  if (!Number.isFinite(matchId) || matchId <= 0) return null;

  try {
    const { data, error } = await supabase
      .from('partidos')
      .select('codigo')
      .eq('id', matchId)
      .maybeSingle();
    if (error) {
      console.error('[shareVotingLink] Could not fetch match code from DB:', error);
      return null;
    }
    return normalizeMatchCode(data?.codigo);
  } catch (error) {
    console.error('[shareVotingLink] Unexpected error resolving match code:', error);
    return null;
  }
};

export const ensurePublicVotingMarker = async ({ matchId, adminUserId, matchCode }) => {
  const id = Number(matchId);
  if (!Number.isFinite(id) || id <= 0 || !adminUserId || !matchCode) return;

  try {
    const matchIdText = String(id);
    const { data: existingRows, error: lookupError } = await supabase
      .from('notifications')
      .select('id')
      .eq('user_id', adminUserId)
      .in('type', ['call_to_vote', 'pre_match_vote'])
      .or(`partido_id.eq.${id},data->>match_id.eq.${matchIdText},data->>matchId.eq.${matchIdText}`)
      .limit(1);

    if (lookupError) {
      console.warn('[shareVotingLink] Could not check public voting marker:', lookupError);
    }

    if (existingRows && existingRows.length > 0) {
      return;
    }

    const { error: insertError } = await supabase
      .from('notifications')
      .insert([{
        user_id: adminUserId,
        title: 'Votación abierta',
        message: 'Link público de votación habilitado.',
        type: 'pre_match_vote',
        partido_id: id,
        data: {
          match_id: matchIdText,
          matchId: id,
          matchCode,
        },
        read: true,
        created_at: new Date().toISOString(),
      }]);

    if (insertError) {
      console.warn('[shareVotingLink] Could not create public voting marker:', insertError);
    }
  } catch (error) {
    console.warn('[shareVotingLink] Unexpected error creating public voting marker:', error);
  }
};

/**
 * Resolves the match code, makes sure the public voting link is enabled and opens
 * the WhatsApp share sheet with the voting link.
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export const shareVotingLink = async ({ partido, user, isNative = false }) => {
  const matchCode = await resolveMatchCode(partido);
  if (!matchCode) return { ok: false, reason: 'no-code' };

  await ensurePublicVotingMarker({
    matchId: Number(partido?.id),
    adminUserId: user?.id,
    matchCode,
  });

  const baseUrl = getPublicBaseUrl() || window.location.origin;
  const publicLink = `${baseUrl}/votar-equipos?codigo=${encodeURIComponent(matchCode)}`;
  const text = 'Votá para armar los equipos ⚽️';
  const safeText = String(text || '').trim();
  const safeUrl = String(publicLink || '').trim();
  const payloadText = safeText
    ? (safeUrl && !safeText.includes(safeUrl) ? `${safeText}\n${safeUrl}` : safeText)
    : safeUrl;
  const encodedText = encodeURIComponent(payloadText);
  const whatsappWebUrl = `https://api.whatsapp.com/send?text=${encodedText}`;
  const whatsappAppUrl = `whatsapp://send?text=${encodedText}`;
  const isMobileWeb = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');

  if (isNative || isMobileWeb) {
    window.location.href = whatsappAppUrl;
    return { ok: true };
  }

  const opened = window.open(whatsappWebUrl, '_blank', 'noopener,noreferrer');
  if (!opened) {
    window.location.href = whatsappWebUrl;
  }
  return { ok: true };
};
