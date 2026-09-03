import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  createEditorialState,
  SOCIAL_PIECE_IDS,
  SOCIAL_TEAM_SIZES,
} from '../features/torneos/social/socialContracts';
import {
  describeSocialCatalogAccess,
  FREE_BASE_FAMILY_IDS,
  hasSocialStudioPremium,
  PREMIUM_SOCIAL_THEME_IDS,
  resolveSocialExportPolicy,
  resolveSocialPreviewBranding,
  SOCIAL_STUDIO_PREMIUM_CAPABILITY,
} from '../features/torneos/social/socialAccessPolicy';
import { normalizeTournamentEntitlements, TOURNAMENT_PLANS } from '../features/torneos/domain/entitlements';
import {
  drawPremiumCoverImage,
  PREMIUM_REQUIRED_FONTS,
  sponsorRailHeight,
} from '../features/torneos/social/premiumRenderer';
import { tournamentEntitlementsFixture } from '../testUtils/tournamentEntitlementsFixture';

const free = normalizeTournamentEntitlements(tournamentEntitlementsFixture());
const premium = normalizeTournamentEntitlements(tournamentEntitlementsFixture({
  plan: TOURNAMENT_PLANS.PREMIUM,
}));

describe('Social Studio midpoint access and editorial contracts', () => {
  test('uses only the explicit social_studio.premium capability', () => {
    expect(SOCIAL_STUDIO_PREMIUM_CAPABILITY).toBe('social_studio.premium');
    expect(hasSocialStudioPremium(free)).toBe(false);
    expect(hasSocialStudioPremium(premium)).toBe(true);
    expect(hasSocialStudioPremium({
      ...premium,
      capabilities: { ...premium.capabilities, 'social_studio.premium': false, 'social_studio.full': true },
    })).toBe(false);
  });

  test('FREE sees all families but can use only the three Base families', () => {
    expect(FREE_BASE_FAMILY_IDS).toEqual(['round_results', 'standings', 'next_fixture']);
    const access = SOCIAL_PIECE_IDS.map((familyId) => (
      describeSocialCatalogAccess({ familyId, themeId: 'base', entitlements: free })
    ));
    expect(access.filter(({ visible }) => visible)).toHaveLength(11);
    expect(access.filter(({ usable }) => usable)).toHaveLength(3);
    expect(access.filter(({ locked }) => locked)).toHaveLength(8);
    PREMIUM_SOCIAL_THEME_IDS.forEach((themeId) => {
      expect(describeSocialCatalogAccess({
        familyId: 'round_results', themeId, entitlements: free,
      })).toMatchObject({ visible: true, previewable: true, locked: true, exportable: false });
    });
  });

  test('Premium unlocks all 11 families in Base and all four premium themes', () => {
    ['base', ...PREMIUM_SOCIAL_THEME_IDS].forEach((themeId) => {
      SOCIAL_PIECE_IDS.forEach((familyId) => {
        expect(describeSocialCatalogAccess({ familyId, themeId, entitlements: premium }))
          .toMatchObject({ visible: true, previewable: true, usable: true, exportable: true });
      });
    });
  });

  test('normalizes the complete branding matrix before export', () => {
    expect(resolveSocialExportPolicy({
      familyId: 'round_results', themeId: 'base', entitlements: free,
      requestedArma2Branding: false,
    }).showArma2Branding).toBe(true);
    expect(resolveSocialExportPolicy({
      familyId: 'round_results', themeId: 'base', entitlements: premium,
      requestedArma2Branding: false,
    }).showArma2Branding).toBe(false);
    expect(resolveSocialExportPolicy({
      familyId: 'round_results', themeId: 'base', entitlements: premium,
      requestedArma2Branding: true,
    }).showArma2Branding).toBe(true);
    expect(resolveSocialExportPolicy({
      familyId: 'round_results', themeId: 'heritage', entitlements: premium,
      requestedArma2Branding: true,
    }).showArma2Branding).toBe(false);
    expect(resolveSocialPreviewBranding({ themeId: 'street', entitlements: free })).toBe(false);
    expect(() => resolveSocialExportPolicy({
      familyId: 'mvp', themeId: 'base', entitlements: free,
    })).toThrow(expect.objectContaining({ code: 'THEME_ENTITLEMENT_REQUIRED' }));
  });

  test('focal point defaults, clamps and accepts legacy photoOffsetY', () => {
    expect(createEditorialState(null)).toMatchObject({ figuraFocalX: 0.5, figuraFocalY: 0.5 });
    expect(createEditorialState(null, { figuraFocalX: -2, figuraFocalY: 4 }))
      .toMatchObject({ figuraFocalX: 0, figuraFocalY: 1 });
    expect(createEditorialState(null, { photoOffsetY: 0.72 })).toMatchObject({
      photoOffsetY: 0.72, figuraFocalY: 0.72,
    });
  });

  test('cover crop honors both focal axes', () => {
    const drawImage = jest.fn();
    const image = { width: 2000, height: 1000 };
    expect(drawPremiumCoverImage({ drawImage }, image, 0, 0, 500, 500, {
      x: 1, y: 0,
    })).toBe(true);
    expect(drawImage).toHaveBeenCalledWith(
      image, 1000, 0, 1000, 1000, 0, 0, 500, 500,
    );
  });

  test('fonts and sponsor rail match the approved midpoint contract', () => {
    expect(PREMIUM_REQUIRED_FONTS.heritage.join(' ')).toMatch(/Anton.*Barlow/);
    expect(PREMIUM_REQUIRED_FONTS.street.join(' ')).toMatch(/Archivo Black.*Archivo Narrow/);
    expect(sponsorRailHeight([], false)).toBe(0);
    expect(sponsorRailHeight([{}, {}, {}], false)).toBe(0);
    expect(sponsorRailHeight([{ image: {} }], false)).toBeGreaterThan(0);
    expect(sponsorRailHeight([{ image: {} }], true))
      .toBeGreaterThan(sponsorRailHeight([{ image: {} }], false));
  });

  test('Equipo Ideal supports every approved modality and the four cancha bands', () => {
    expect(SOCIAL_TEAM_SIZES).toEqual([5, 6, 7, 8, 9, 11]);
    const source = readFileSync(resolve(
      process.cwd(), 'src/features/torneos/social/premiumRenderer.js',
    ), 'utf8');
    expect(source).toContain("DEL: 'DELANTEROS'");
    expect(source).toContain("MED: 'MEDIOCAMPO'");
    expect(source).toContain("DEF: 'DEFENSA'");
    expect(source).toContain("ARQ: 'ARQUERO'");
    expect(source).toContain("['DEL', 'MED', 'DEF', 'ARQ']");
  });

  test('database export authorization independently blocks entitlement and branding bypasses', () => {
    const migration = readFileSync(resolve(
      process.cwd(),
      'supabase/migrations/20260901120000_social_studio_theme_export_contract.sql',
    ), 'utf8');
    expect(migration).toContain("'social_studio.premium'");
    expect(migration).toMatch(/not v_premium[\s\S]*p_theme <> 'base'/);
    expect(migration).toMatch(/p_piece not in \('round_results','standings','next_fixture'\)/);
    expect(migration).toMatch(/not v_premium and not p_include_arma2_branding/);
    expect(migration).toMatch(/else[\s\S]*v_effective_branding:=false/);
  });
});
