import { supabase } from '../supabase';

export const normalizeIdentityRef = (value) => String(value || '').trim().toLowerCase();

export const resolvePlayerKey = (player) => {
  if (!player) return null;
  return String(player.uuid || player.usuario_id || player.id || '').trim() || null;
};

export const resolvePersistRef = (player) => (
  String(player?.uuid || player?.usuario_id || player?.id || '').trim() || null
);

export const buildPlayerRefToKeyMap = (players = []) => {
  const map = new Map();

  (players || []).forEach((player) => {
    const key = resolvePlayerKey(player);
    if (!key) return;

    [player.uuid, player.usuario_id, player.id, key]
      .map((ref) => normalizeIdentityRef(ref))
      .filter(Boolean)
      .forEach((ref) => map.set(ref, key));
  });

  return map;
};

export const toPlayerKeysFromRefs = ({ refs = [], refToKeyMap }) => {
  const keys = [];

  (Array.isArray(refs) ? refs : []).forEach((ref) => {
    const key = refToKeyMap.get(normalizeIdentityRef(ref));
    if (key) keys.push(key);
  });

  return keys;
};

export const sanitizeTeamRefs = (refs = []) => (
  (Array.isArray(refs) ? refs : [])
    .map((ref) => String(ref || '').trim())
    .filter(Boolean)
);

export const buildSeededInitialTeams = ({ playerKeys = [], seed = 0 }) => {
  const keys = Array.from(new Set((playerKeys || []).filter(Boolean)));
  const seedBase = Number(seed) || 0;

  const scoreFor = (key) => {
    const source = `${seedBase}:${String(key)}`;
    let hash = 2166136261;
    for (let i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };

  const shuffled = keys
    .map((key) => ({ key, score: scoreFor(key) }))
    .sort((a, b) => a.score - b.score || String(a.key).localeCompare(String(b.key)))
    .map((entry) => entry.key);

  const teamA = [];
  const teamB = [];

  shuffled.forEach((key, index) => {
    if (index % 2 === 0) teamA.push(key);
    else teamB.push(key);
  });

  if (teamB.length === 0 && teamA.length > 1) {
    teamB.push(teamA.pop());
  }

  return { teamA, teamB };
};

export const parseSaveMatchFinalTeamsResponse = (rpcData) => {
  const payload = rpcData && typeof rpcData === 'object' ? rpcData : {};
  const success = payload.success === true;
  const reason = String(payload.reason || '').trim().toLowerCase();
  const alreadyLocked = reason === 'already_locked' || reason === 'locked_by_other';
  const lockedByOther = payload.locked_by_other === true || reason === 'locked_by_other';

  return {
    ok: success || alreadyLocked,
    success,
    alreadyLocked,
    reason: String(payload.reason || ''),
    lockedByOther,
    teamsSource: payload.teams_source ? String(payload.teams_source) : null,
    teamARefs: sanitizeTeamRefs(payload.team_a),
    teamBRefs: sanitizeTeamRefs(payload.team_b),
    teamsLocked: payload.teams_locked === true,
    teamsLockedByUserId: payload.teams_locked_by_user_id || null,
    teamsLockedAt: payload.teams_locked_at || null,
  };
};

export async function lockSurveyTeamsOnce({ matchId, teamARefs, teamBRefs }) {
  const matchIdNum = Number(matchId);
  if (!Number.isFinite(matchIdNum) || matchIdNum <= 0) {
    throw new Error('invalid_match_id');
  }

  const { data, error } = await supabase.rpc('save_match_final_teams', {
    p_partido_id: matchIdNum,
    p_final_team_a: sanitizeTeamRefs(teamARefs),
    p_final_team_b: sanitizeTeamRefs(teamBRefs),
  });

  if (error) {
    throw error;
  }

  return parseSaveMatchFinalTeamsResponse(data);
}
