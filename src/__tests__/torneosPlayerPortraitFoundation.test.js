import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260817220554_tournament_player_portraits_foundation.sql',
  'utf8',
);
const edge = fs.readFileSync(
  'supabase/functions/tournament-player-portraits/index.ts',
  'utf8',
);

test('portrait persistence is roster-owned, raster-only and stores no signed URL', () => {
  expect(migration).toMatch(/CREATE TABLE public\.tournament_player_portraits/);
  expect(migration).toMatch(/roster_player_id uuid NOT NULL/);
  expect(migration).toMatch(/REFERENCES public\.tournament_roster_players/);
  expect(migration).toMatch(/mime_type IN \('image\/jpeg', 'image\/png', 'image\/webp'\)/);
  expect(migration).not.toMatch(/signed_url|base64|\bblob\b/i);
  expect(migration).toMatch(/publication_consent IN \('unknown', 'granted', 'revoked'\)/);
  expect(migration).toMatch(/editorial_status IN \('pending_review', 'approved', 'rejected'\)/);
});

test('bucket and Edge resolver remain private and fail closed for future audiences', () => {
  expect(migration).toMatch(/'tournament-player-portraits', 'tournament-player-portraits', false/);
  expect(migration).toMatch(/8388608, ARRAY\['image\/jpeg', 'image\/png', 'image\/webp'\]/);
  expect(migration).not.toMatch(/CREATE POLICY tournament_player_portraits_\w+\s+ON storage\.objects/i);
  expect(edge).toMatch(/p_audience: audience/);
  expect(migration).toMatch(/p_audience <> 'authenticated_roster'/);
  expect(migration).not.toMatch(/p_audience = '(?:public_page|social_export)'/);
  expect(edge).toMatch(/PORTRAIT_SIGNED_URL_TTL_SECONDS/);
});

test('actor-param helpers are service-only and client writes are RPC-only', () => {
  expect(migration).toMatch(
    /GRANT EXECUTE ON FUNCTION public\.can_manage_tournament_player_portrait_as\(uuid, uuid, uuid\)\s+TO service_role/,
  );
  expect(migration).toMatch(/REVOKE ALL ON TABLE public\.tournament_player_portraits FROM PUBLIC, anon, authenticated/);
  expect(migration).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE).*tournament_player_portraits TO authenticated/i);
});
