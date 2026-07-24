import { supabase } from '../lib/supabaseClient';
import { prepareImageForUpload } from '../utils/imageUpload';
import { isMissingEdgeFunctionError } from '../utils/backendFallback';

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('image_read_failed'));
  reader.readAsDataURL(file);
});

/**
 * Guest voting-photo upload via the capability-token Edge Functions.
 *
 * 1) issue-voting-photo-token: binds (match_id, player_id, guest_session_id).
 * 2) upload-voting-photo: consumes the token atomically and uploads server-side.
 *
 * Returns the public URL. Throws on real errors. `onMissing` is called (and its
 * result returned) ONLY when an Edge Function returns 404 (not deployed yet),
 * so the caller can fall back to the legacy uploadFoto path during rollout.
 */
export const uploadGuestVotingPhoto = async ({
  file,
  codigo,
  matchId,
  playerId,
  guestSessionId,
  onMissing,
}) => {
  const { file: normalized } = await prepareImageForUpload(file);
  const dataUrl = await fileToDataUrl(normalized);

  const tokenRes = await supabase.functions.invoke('issue-voting-photo-token', {
    body: { codigo, matchId, playerId, guestSessionId },
  });
  if (tokenRes.error) {
    if (isMissingEdgeFunctionError(tokenRes.error) && typeof onMissing === 'function') {
      return onMissing();
    }
    throw tokenRes.error;
  }
  const token = tokenRes.data?.token;
  if (!token) throw new Error('token_issue_failed');

  const uploadRes = await supabase.functions.invoke('upload-voting-photo', {
    body: { token, imageBase64: dataUrl },
  });
  if (uploadRes.error) {
    if (isMissingEdgeFunctionError(uploadRes.error) && typeof onMissing === 'function') {
      // Token already consumed; the legacy fallback uploads a fresh object.
      return onMissing();
    }
    throw uploadRes.error;
  }
  const url = uploadRes.data?.url;
  if (!url) throw new Error('voting_photo_upload_failed');
  return url;
};
