import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260821180000_tournament_team_photo_moderated_lifecycle.sql',
  'utf8',
);
const edge = fs.readFileSync(
  'supabase/functions/tournament-team-photos/index.ts',
  'utf8',
);
const contract = fs.readFileSync(
  'supabase/functions/_shared/tournamentTeamPhotoContract.ts',
  'utf8',
);
const config = fs.readFileSync('supabase/config.toml', 'utf8');
/**
 * Las afirmaciones de AUSENCIA se hacen contra el SQL sin comentarios: esta
 * migración explica largamente de qué se diferencia —del escudo, del bucket
 * público, del trigger de auditoría— y nombrar algo para decir que no se toca
 * no es tocarlo.
 */
const code = migration.replace(/^\s*--.*$/gm, '');
const teamEntries = fs.readFileSync(
  'supabase/migrations/20260727090000_arma2_canonical_baseline.sql',
  'utf8',
);

test('the photo belongs to the team entry, not to a name or a mutable URL', () => {
  expect(migration).toMatch(/CREATE TABLE public\.tournament_team_photos/);
  expect(migration).toMatch(/team_entry_id uuid NOT NULL/);
  expect(migration).toMatch(
    /REFERENCES public\.tournament_team_entries\(organization_id, tournament_id, id\)/,
  );
  // Ni el nombre ni el slug del equipo son la identidad: los dos son mutables.
  expect(code).not.toMatch(/\bteam_name\b|\bteam_slug\b/);
  expect(code).not.toMatch(/signed_url|base64|\bblob\b/i);
});

test('the shield stays the shield: no photograph is ever stored in it', () => {
  // El escudo sigue siendo una columna del equipo con su propio CHECK de path,
  // y esta migración no lo toca ni lo reutiliza.
  expect(teamEntries).toMatch(/tournament_team_entries_shield_path_check/);
  expect(code).not.toMatch(/shield_path/);
  expect(code).toMatch(/'tournament-team-photos'/);
  expect(code).not.toMatch(/tournament-branding/);
});

test('persistence reuses the approved editorial and lifecycle vocabularies', () => {
  expect(migration).toMatch(
    /editorial_status IN \('pending_review', 'approved', 'rejected'\)/,
  );
  expect(migration).toMatch(
    /lifecycle_status IN \(\s*'upload_pending', 'active', 'delete_pending', 'replaced', 'removed',\s*'upload_failed'\s*\)/,
  );
  expect(migration).toMatch(/mime_type IN \('image\/jpeg', 'image\/png', 'image\/webp'\)/);
  expect(migration).toMatch(/byte_size BETWEEN 1 AND 8388608/);
  expect(migration).toMatch(/width::bigint \* height::bigint <= 36000000/);
});

test('a candidate never displaces the current photo: two slots, two unique indexes', () => {
  expect(migration).toMatch(
    /CREATE UNIQUE INDEX tournament_team_photos_one_current_idx[\s\S]*?WHERE lifecycle_status = 'active' AND editorial_status = 'approved';/,
  );
  expect(migration).toMatch(
    /CREATE UNIQUE INDEX tournament_team_photos_one_candidate_idx[\s\S]*?editorial_status IN \('pending_review', 'rejected'\);/,
  );
  // Finalizar una carga jubila la candidata anterior y nunca la vigente.
  const finalize = migration.slice(
    migration.indexOf('FUNCTION public.finalize_tournament_team_photo_upload'),
    migration.indexOf('-- 4. Moderar'),
  );
  expect(finalize).toMatch(/editorial_status IN \('pending_review', 'rejected'\)\s*\n\s*FOR UPDATE/);
  // La vigente se LEE para poder informarla y nunca se ESCRIBE: los únicos dos
  // destinos de un UPDATE acá son la candidata anterior y la fila recién subida.
  const finalizeUpdateTargets = [...finalize.matchAll(
    /UPDATE public\.tournament_team_photos[\s\S]*?WHERE id = ([\w.]+);/g,
  )].map(([, target]) => target);
  expect(finalizeUpdateTargets).toEqual(['v_previous_candidate_id', 'v_photo.id']);
  expect(finalize).toMatch(/SELECT photo\.id INTO v_current_id/);
});

test('only moderation moves the current photo, and it moves it atomically', () => {
  const moderate = migration.slice(
    migration.indexOf('FUNCTION public.set_tournament_team_photo_editorial_status'),
    migration.indexOf('FUNCTION public.revoke_tournament_team_photo'),
  );
  expect(moderate).toMatch(/can_moderate_tournament_team_visual_assets_as/);
  expect(moderate).not.toMatch(/can_manage_tournament_team_visual_assets_as/);
  // La vigente anterior se jubila dentro de la misma función que aprueba.
  expect(moderate).toMatch(/v_previous_current_id/);
  expect(moderate).toMatch(/FOR UPDATE/);
  // Rechazar no toca ninguna otra fila.
  expect(moderate).toMatch(/ELSE\s*\n\s*UPDATE public\.tournament_team_photos\s*\n\s*SET editorial_status = 'rejected'/);
});

test('revocation falls back and never resurrects an older photo', () => {
  const revoke = migration.slice(
    migration.indexOf('FUNCTION public.revoke_tournament_team_photo'),
    migration.indexOf('-- 5. Dar de baja el objeto'),
  );
  expect(revoke).toMatch(/can_moderate_tournament_team_visual_assets_as/);
  expect(revoke).toMatch(/replaced_by_id = NULL/);
  // Nada promueve una fila `replaced` de vuelta a `active`.
  expect(code).not.toMatch(/SET lifecycle_status = 'active'[\s\S]{0,120}'replaced'/);
});

test('a row without a server-computed checksum can never become visible', () => {
  expect(migration).toMatch(
    /\(lifecycle_status IN \('upload_pending', 'upload_failed'\) AND checksum_sha256 IS NULL\)/,
  );
  expect(migration).toMatch(/checksum_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/);
  // El hash lo calcula el Edge function sobre los bytes que subió, no el cliente.
  expect(edge).toMatch(/crypto\.subtle\.digest\("SHA-256", bytes\)/);
  expect(edge).toMatch(/p_checksum_sha256: await sha256Hex\(bytes\)/);
  expect(edge).not.toMatch(/x-checksum|body\.checksum|headers\.get\("x-sha/i);
});

test('a failed upload stays invisible and is never signed', () => {
  expect(edge).toMatch(/fail_tournament_team_photo_upload/);
  const authorize = migration.slice(
    migration.indexOf('FUNCTION public.authorize_tournament_team_photo_read'),
    migration.indexOf('FUNCTION public.get_tournament_team_photo_state'),
  );
  expect(authorize).toMatch(/photo\.lifecycle_status = 'active'/);
  expect(authorize).toMatch(/v_allowed IS NOT TRUE/);
});

test('bucket and resolver are private and fail closed for future audiences', () => {
  expect(migration).toMatch(
    /'tournament-team-photos', 'tournament-team-photos', false/,
  );
  expect(migration).toMatch(/8388608, ARRAY\['image\/jpeg', 'image\/png', 'image\/webp'\]/);
  expect(code).not.toMatch(/CREATE POLICY tournament_team_photos_\w+\s+ON storage\.objects/i);
  expect(migration).toMatch(/p_audience <> 'authenticated_team'/);
  expect(code).not.toMatch(/p_audience = '(?:public_page|social_export)'/);
  expect(contract).toMatch(/TEAM_PHOTO_SIGNED_URL_TTL_SECONDS = 300/);
  expect(edge).toMatch(/relativeSignedUrl/);
  expect(config).toMatch(/\[functions\.tournament-team-photos\]\s*\nverify_jwt = true/);
});

test('pending and rejected material is only ever signed for manage or moderate', () => {
  const authorize = migration.slice(
    migration.indexOf('FUNCTION public.authorize_tournament_team_photo_read'),
    migration.indexOf('FUNCTION public.get_tournament_team_photo_state'),
  );
  expect(authorize).toMatch(
    /WHEN 'approved' THEN public\.can_read_tournament_team_photo_as/,
  );
  expect(authorize).toMatch(
    /ELSE public\.can_manage_tournament_team_visual_assets_as[\s\S]*?OR public\.can_moderate_tournament_team_visual_assets_as/,
  );
  // La policy de RLS sólo deja ver la vigente.
  expect(migration).toMatch(
    /CREATE POLICY tournament_team_photos_read_current[\s\S]*?lifecycle_status = 'active'\s*\n\s*AND editorial_status = 'approved'/,
  );
});

test('actor-param helpers are service-only and client writes are RPC-only', () => {
  expect(migration).toMatch(
    /REVOKE ALL ON FUNCTION public\.can_read_tournament_team_photo_as\(uuid, uuid, uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated/,
  );
  expect(migration).toMatch(
    /GRANT EXECUTE ON FUNCTION public\.can_read_tournament_team_photo_as\(uuid, uuid, uuid\)\s*\n\s*TO service_role;/,
  );
  for (const fn of [
    'request_tournament_team_photo_upload',
    'finalize_tournament_team_photo_upload',
    'authorize_tournament_team_photo_read',
    'begin_tournament_team_photo_delete',
  ]) {
    expect(migration).toMatch(
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*\\n\\s*TO service_role;`),
    );
  }
  expect(migration).toMatch(
    /REVOKE ALL ON TABLE public\.tournament_team_photos FROM PUBLIC, anon, authenticated/,
  );
  expect(code).not.toMatch(
    /GRANT (?:INSERT|UPDATE|DELETE)[^\n]*tournament_team_photos TO authenticated/i,
  );
  // El path del objeto nunca se le da al navegador.
  expect(code).not.toMatch(/GRANT SELECT \([^)]*object_path/);
});

test('the audit trail uses the existing append-only mechanism', () => {
  expect(migration).toMatch(/append_tournament_audit\(\s*\n?\s*p_organization_id,\s*\n?\s*CASE WHEN p_editorial_status/);
  for (const action of [
    'team_photo.uploaded', 'team_photo.approved', 'team_photo.rejected',
    'team_photo.revoked', 'team_photo.removed',
  ]) {
    expect(migration).toContain(`'${action}'`);
  }
  // Ni se toca el trigger append-only ni se borra nada del log.
  expect(code).not.toMatch(/tournament_audit_append_only|DELETE FROM public\.tournament_audit_log|DROP TRIGGER/);
});
