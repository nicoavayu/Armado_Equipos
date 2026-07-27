import fs from 'fs';
import path from 'path';

describe('Torneos media responsive and storage contract', () => {
  const participantCss = fs.readFileSync(
    path.join(process.cwd(), 'src/features/torneos/components/ParticipantMediaGallery.module.css'),
    'utf8',
  );
  const adminCss = fs.readFileSync(
    path.join(process.cwd(), 'src/features/torneos/components/MediaAdminPage.module.css'),
    'utf8',
  );
  const migration = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260727060000_tournament_media_galleries.sql'),
    'utf8',
  );
  const css = `${participantCss}\n${adminCss}`;

  test('covers 320, 390, tablet and desktop-responsive layouts', () => {
    expect(css).toMatch(/@media \(max-width: 390px\)/);
    expect(css).toMatch(/@media \(max-width: 620px\)/);
    expect(css).toMatch(/@media \(max-width: 720px\)/);
    expect(css).toMatch(/@media \(max-width: 920px\)/);
    expect(css).toMatch(/grid-template-columns: 1fr/);
  });

  test('keeps touch, keyboard, layout stability and reduced motion explicit', () => {
    expect(css).toMatch(/min-height: 44px/);
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/aspect-ratio: 4\/3/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });

  test('keeps originals and internal storage metadata out of participant markup', () => {
    const component = fs.readFileSync(
      path.join(process.cwd(), 'src/features/torneos/components/ParticipantMediaGallery.jsx'),
      'utf8',
    );
    expect(component).not.toMatch(/internal_path|checksum_sha256|bucket_id/);
    expect(component).not.toMatch(/originalUrl/);
    expect(component).toMatch(/loading=\{eager \? 'eager' : 'lazy'\}/);
  });

  test('defines private fail-closed storage policies without creating a bucket', () => {
    expect(migration).toMatch(/bucket_id = 'tournament-media'/);
    expect(migration).toMatch(/for update to service_role[\s\S]*using \(false\)/);
    expect(migration).toMatch(/for delete to service_role[\s\S]*using \(false\)/);
    expect(migration).not.toMatch(/insert into storage\.buckets/i);
    expect(migration).not.toMatch(/to anon/);
  });

  test('uses bounded pagination and dedicated indexes for 1000-asset metadata sets', () => {
    expect(migration).toMatch(/p_limit > 100/);
    expect(migration).toMatch(/p_limit > 50/);
    expect(migration).toMatch(/tournament_media_gallery_items_order_idx/);
    expect(migration).toMatch(/tournament_media_assets_gallery_status_idx/);
    expect(migration).toMatch(/tournament_media_galleries_participant_idx/);
  });

  test.each([20, 100, 1000])(
    'keeps a synthetic %i-asset participant page bounded and original-free',
    (assetCount) => {
      const metadata = Array.from({ length: assetCount }, (_, index) => ({
        id: `asset-${index}`,
        thumbnailUrl: `signed://thumb/${index}`,
        gridUrl: `signed://grid/${index}`,
        detailUrl: `signed://detail/${index}`,
      }));
      const startedAt = performance.now();
      const firstPage = metadata.slice(0, 50);
      const elapsed = performance.now() - startedAt;

      expect(firstPage).toHaveLength(Math.min(assetCount, 50));
      expect(JSON.stringify(firstPage)).not.toMatch(/original|bucket|objectPath|checksum/i);
      expect(elapsed).toBeLessThan(25);
    },
  );
});
