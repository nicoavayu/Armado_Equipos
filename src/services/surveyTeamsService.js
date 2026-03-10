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
  const seen = new Set();

  (Array.isArray(refs) ? refs : []).forEach((ref) => {
    const key = refToKeyMap.get(normalizeIdentityRef(ref));
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
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
  const payload = Array.isArray(rpcData)
    ? (rpcData[0] && typeof rpcData[0] === 'object' ? rpcData[0] : {})
    : (rpcData && typeof rpcData === 'object' ? rpcData : {});
  const reason = String(payload.reason || '').trim().toLowerCase();
  const successByFlag = payload.success === true || payload.ok === true;
  const successByReason = ['locked', 'saved', 'ok', 'success'].includes(reason);
  const success = successByFlag || successByReason;
  const alreadyLocked = reason === 'already_locked' || reason === 'locked_by_other';
  const lockedByOther = payload.locked_by_other === true || reason === 'locked_by_other';
  const teamARefs = sanitizeTeamRefs(payload.team_a ?? payload.final_team_a ?? payload.survey_team_a);
  const teamBRefs = sanitizeTeamRefs(payload.team_b ?? payload.final_team_b ?? payload.survey_team_b);
  const teamsLocked = payload.teams_locked === true || payload.locked === true || success || alreadyLocked;
  const hasPersistedTeams = teamARefs.length > 0 && teamBRefs.length > 0;

  return {
    ok: success || alreadyLocked || (teamsLocked && hasPersistedTeams),
    success,
    alreadyLocked,
    reason: String(payload.reason || ''),
    lockedByOther,
    teamsSource: payload.teams_source ? String(payload.teams_source) : null,
    teamARefs,
    teamBRefs,
    teamsLocked,
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
