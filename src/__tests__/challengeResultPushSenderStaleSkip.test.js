const fs = require('fs');
const path = require('path');

const edgeFunctionPath = path.join(process.cwd(), 'supabase/functions/push-sender/index.ts');
const source = fs.readFileSync(edgeFunctionPath, 'utf8').replace(/\s+/g, ' ').trim();

describe('push-sender challenge result stale handling', () => {
  test('skips challenge result pushes when the team match already has a result', () => {
    expect(source).toContain('async function resolveStaleChallengeResultSkip');
    expect(source).toContain('notificationType !== "challenge_result_survey" && notificationType !== "challenge_result_pending"');
    expect(source).toContain('.from("team_matches") .select("id, result_status, result_confirmed, result_conflict") .eq("id", teamMatchId) .maybeSingle()');
    expect(source).toContain('const isStale = isConflictPrompt ? !resultConflict : (resultConflict || resultConfirmed)');
    expect(source).toContain('if (!isStale) return null');
    expect(source).toContain('stale_challenge_result_loaded');
    expect(source).toContain('stale_challenge_result_conflict');
    expect(source).toContain('const staleChallengeResultSkip = await resolveStaleChallengeResultSkip(supabase, log)');
    expect(source).toContain('p_status: "skipped"');
  });

  test('skips conflict prompts once the conflict has been resolved', () => {
    expect(source).toContain('const isConflictPrompt = notificationType === "challenge_result_conflict"');
    expect(source).toContain('stale_challenge_result_resolved');
  });

  test('resolves the internal notification before skipping a stale challenge result push', () => {
    expect(source).toContain('.from("notifications") .update({ read: true, status: "resolved" }) .eq("id", notificationId)');
    expect(source).toContain('.eq("type", notificationType)');
    expect(source).toContain('data->>team_match_id.eq.${teamMatchId},data->>teamMatchId.eq.${teamMatchId}');
  });
});
