const fs = require('fs');
const path = require('path');

const functionPath = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'functions',
  'delete-account',
  'index.ts',
);

const source = fs.readFileSync(functionPath, 'utf8');

describe('delete-account edge function cleanup coverage', () => {
  test('detaches the user from the teams/challenges module', () => {
    expect(source).toContain('.from("team_members").update({ user_id: null }).eq("user_id", userId)');
    expect(source).toContain('.from("team_chat_messages").update({ user_id: null }).eq("user_id", userId)');
    expect(source).toContain('.from("challenge_team_squad").update({ selected_by: null }).eq("selected_by", userId)');
    expect(source).toContain('.from("team_invitations").delete().eq("invited_user_id", userId)');
    expect(source).toContain('.from("team_invitations").delete().eq("invited_by_user_id", userId)');
  });

  test('orphans teams instead of deleting them, preserving other users history', () => {
    expect(source).toContain('.from("teams")\n          .update({ owner_user_id: null, is_active: false })');
    // Teams and team_matches rows must survive so head-to-head / per-rival
    // history of the remaining opponent is not broken.
    expect(source).not.toContain('.from("teams").delete()');
    expect(source).not.toContain('.from("team_matches").delete()');
    expect(source).not.toContain('.from("team_members").delete()');
  });

  test('anonymizes the player row rather than deleting it', () => {
    expect(source).toContain('.from("jugadores")');
    expect(source).toContain('nombre: "Usuario eliminado"');
    expect(source).toContain('usuario_id: null');
  });

  test('treats team-module FK violations as retryable dependency errors', () => {
    expect(source).toContain('text.includes("team_members")');
    expect(source).toContain('text.includes("team_matches")');
    expect(source).toContain('text.includes("team_chat")');
    expect(source).toContain('text.includes("team_invitations")');
    expect(source).toContain('text.includes("challenge_team_squad")');
  });

  test('still deletes the root usuarios row and auth user, and requires confirmation', () => {
    expect(source).toContain('.from("usuarios")');
    expect(source).toContain('auth.admin.deleteUser(user.id)');
    expect(source).toContain('confirmation_required');
  });
});
