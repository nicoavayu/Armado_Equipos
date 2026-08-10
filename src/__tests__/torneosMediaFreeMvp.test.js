import fs from 'fs';
import path from 'path';

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const migration = read('supabase/migrations/20260809232508_tournament_media_free_mvp.sql');
const processor = read('supabase/functions/tournament-media-processor/index.ts');
const signer = read('supabase/functions/tournament-media-signer/index.ts');
const image = read('supabase/functions/_shared/tournamentMediaImage.ts');

describe('free tournament gallery MVP contract', () => {
  test('is code-only, defaults to the robust tier and fails closed', () => {
    expect(migration).toMatch(/DEFAULT 'PROCESSOR_EXTERNAL'/);
    expect(migration).toMatch(/'DISABLED','MVP_SIMPLE','PROCESSOR_EXTERNAL'/);
    expect(migration).toMatch(/ELSE 'DISABLED'/);
    expect(migration).toContain('tournament_media_pipeline_readiness()');
    expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION "public"\."tournament_media_pipeline_readiness"/);
    expect(migration).not.toContain('attest_tournament_media_service');
  });

  test('persists the tier without weakening external processing', () => {
    expect(migration).toMatch(/processing_tier IN \('processor_external','mvp_simple'\)/);
    expect(migration).toMatch(/processingTier','processor_external'/);
    expect(migration).toMatch(/processingTier','mvp_simple'/);
    expect(migration).toMatch(/v_asset\.processing_tier = 'processor_external'/);
    expect(migration).toMatch(/<> 'processor_external'[\s\S]+TORNEOS_MEDIA_FORBIDDEN/);
  });

  test('pins every initial simple-tier limit', () => {
    for (const literal of [
      '8388608', '4194304', '2560000', '1600',
      '52428800', '209715200', '419430400',
    ]) expect(migration).toContain(literal);
    expect(migration).toMatch(/v_open_sessions >= v_max_open/);
    expect(migration).toMatch(/v_recent_emissions >= 30/);
    expect(migration).toMatch(/interval '15 minutes'/);
    expect(migration).toMatch(/v_org_photos >= 100/);
    expect(migration).toMatch(/v_tournament_photos >= 60/);
    expect(migration).toMatch(/v_gallery_photos >= 20/);
    expect(migration).toMatch(/interval '5 minutes'/);
  });

  test('allows only active owner/admin for simple uploads', () => {
    const helper = migration.match(
      /tournament_media_mvp_user_can_upload[\s\S]+?\$\$;/,
    )?.[0] || '';
    expect(helper).toMatch(/membership\.role IN \('owner','admin'\)/);
    expect(helper).not.toMatch(/photographer|assignment/);
    // The existing backend assignment model is not dropped or rewritten.
    expect(migration).not.toMatch(/DROP (TABLE|FUNCTION).*tournament_media_assignments/i);
  });

  test('projects each persisted asset tier without exposing the config table', () => {
    const projection = migration.match(
      /get_tournament_media_asset_processing_tiers[\s\S]+?\$\$;/,
    )?.[0] || '';
    expect(projection).toMatch(/has_tournament_media_capability\(p_organization_id,'media\.read'\)/);
    expect(projection).toMatch(/asset\.organization_id = p_organization_id/);
    expect(projection).toMatch(/asset\.processing_tier/);
    expect(migration).toMatch(
      /get_tournament_media_asset_processing_tiers"\(uuid\)[\s\S]+TO "authenticated"/,
    );
  });

  test('keeps sessions actor-bound and paths server-generated', () => {
    expect(migration).toMatch(/p_actor_user_id <> v_session\.requested_by/);
    expect(migration).toMatch(/digest\(coalesce\(p_token,''\),'sha256'\)/);
    expect(migration).toMatch(/v_file_id uuid := gen_random_uuid\(\)/);
    expect(migration).toMatch(/v_gallery\.organization_id::text \|\| '\/'/);
    expect(migration).not.toMatch(/v_path\s*:=.*p_file_name/);
    expect(signer).toMatch(/upsert: false/);
  });

  test('does not add client-write storage policy or make the bucket public', () => {
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]+storage\.objects/i);
    expect(migration).not.toMatch(/UPDATE storage\.buckets|INSERT INTO storage\.buckets/i);
    expect(migration).toMatch(/'bucket','tournament-media','private',true/);
    expect(signer).toMatch(/\.upload\(String\(target\.objectName\), bytes/);
    expect(signer).toMatch(/upsert: false/);
  });

  test('simple finalize performs structural verification and an honest checksum', () => {
    expect(processor).toContain('action === "finalize-simple"');
    expect(processor).toContain('verifyNormalizedImage');
    expect(processor).toContain('sha256Hex');
    expect(processor).toContain('complete_tournament_media_simple_upload');
    expect(processor).toContain('fail_tournament_media_upload_session');
    expect(processor).toMatch(/\.remove\(\[objectName\]\)/);
    expect(image).toMatch(/bad CRC on/);
    expect(image).toMatch(/MEDIA_TRAILING_BYTES/);
    expect(image).toMatch(/MEDIA_ANIMATION_UNSUPPORTED/);
    const simpleHandler = processor.match(
      /async function handleSimpleFinalize[\s\S]+?\n}\n\n\/\*\*/,
    )?.[0] || '';
    expect(simpleHandler).not.toMatch(/antivirusScanning|pixelTranscode|attest_tournament/i);
  });

  test('all display variants resolve to the one private MVP object', () => {
    expect(migration).toMatch(/p_kind NOT IN \('thumbnail','grid','detail','original'\)/);
    expect(migration).toMatch(/v_asset\.processing_tier = 'mvp_simple'[\s\S]+v_asset\.internal_path/);
    expect(migration).not.toMatch(/mvp_simple[\s\S]+INSERT INTO public\.tournament_media_variants/);
  });
});
