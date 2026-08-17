import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { supabase } from '../services/api/supabase';
import BrandingImage from '../features/torneos/components/BrandingImage';
import {
  BRANDING_LIMITS,
  buildBrandingPath,
  isVersionedBrandingPath,
  resolveBrandingAssetCandidates,
  resolveBrandingAssetUrl,
  validateBrandingFile,
} from '../features/torneos/domain/brandingAssets';

const mockGetPublicUrl = jest.fn((path) => ({
  data: { publicUrl: `https://assets.local/${path}` },
}));

jest.mock('../services/api/supabase', () => ({
  supabase: {
    storage: {
      from: jest.fn(() => ({ getPublicUrl: mockGetPublicUrl })),
    },
  },
}));

const organizationId = '11111111-1111-4111-8111-111111111111';
const tournamentId = '22222222-2222-4222-8222-222222222222';
const organizationPath = `${organizationId}/organizations/${organizationId}/33333333-3333-4333-8333-333333333333.png`;
const tournamentPath = `${organizationId}/tournaments/${tournamentId}/44444444-4444-4444-8444-444444444444.webp`;

describe('Torneos branding assets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.storage.from.mockReturnValue({ getPublicUrl: mockGetPublicUrl });
    mockGetPublicUrl.mockImplementation((path) => ({
      data: { publicUrl: `https://assets.local/${path}` },
    }));
  });

  test('accepts only supported image MIME/extension pairs within the selection limit', () => {
    expect(validateBrandingFile({ name: 'logo.png', type: 'image/png', size: 1024 }).valid).toBe(true);
    expect(validateBrandingFile({ name: 'logo.svg', type: 'image/svg+xml', size: 1024 })).toEqual(
      expect.objectContaining({ valid: false, code: 'mime' }),
    );
    expect(validateBrandingFile({ name: 'logo.png', type: 'text/html', size: 1024 })).toEqual(
      expect.objectContaining({ valid: false, code: 'mime' }),
    );
    expect(validateBrandingFile({ name: 'logo.jpg', type: 'image/png', size: 1024 })).toEqual(
      expect.objectContaining({ valid: false, code: 'extension' }),
    );
    expect(validateBrandingFile({
      name: 'logo.webp',
      type: 'image/webp',
      size: BRANDING_LIMITS.maxSelectedFileBytes + 1,
    })).toEqual(expect.objectContaining({ valid: false, code: 'size' }));
  });

  test('builds a new immutable version for every replacement', () => {
    const first = buildBrandingPath({
      organizationId,
      kind: 'tournament',
      entityId: tournamentId,
      mime: 'image/png',
    });
    const second = buildBrandingPath({
      organizationId,
      kind: 'tournament',
      entityId: tournamentId,
      mime: 'image/png',
    });
    expect(first).not.toBe(second);
    expect(isVersionedBrandingPath(first, 'tournament')).toBe(true);
    expect(first).toMatch(new RegExp(`^${organizationId}/tournaments/${tournamentId}/`));
  });

  test('resolves only durable known-bucket paths and rejects arbitrary URLs or traversal', () => {
    expect(resolveBrandingAssetUrl({ kind: 'tournament', path: tournamentPath }))
      .toBe(`https://assets.local/${tournamentPath}`);
    expect(supabase.storage.from).toHaveBeenCalledWith('tournament-branding');
    expect(resolveBrandingAssetUrl({ kind: 'tournament', path: 'https://tracker.example/logo.png' }))
      .toBeNull();
    expect(resolveBrandingAssetUrl({ kind: 'team', path: '../private/key.png' })).toBeNull();
  });

  test('orders tournament then organization fallback without duplicate URLs', () => {
    expect(resolveBrandingAssetCandidates({
      kind: 'tournament',
      path: tournamentPath,
      fallbackPath: organizationPath,
    })).toEqual([
      `https://assets.local/${tournamentPath}`,
      `https://assets.local/${organizationPath}`,
    ]);
  });

  test('falls back from a broken tournament logo to organization and then initials', () => {
    render(
      <BrandingImage
        kind="tournament"
        path={tournamentPath}
        fallbackPath={organizationPath}
        name="Torneo Apertura"
        decorative={false}
      />,
    );
    const tournamentLogo = screen.getByAltText('Torneo Apertura');
    expect(tournamentLogo).toHaveAttribute('src', `https://assets.local/${tournamentPath}`);
    fireEvent.error(tournamentLogo);
    const organizationLogo = screen.getByAltText('Torneo Apertura');
    expect(organizationLogo).toHaveAttribute('src', `https://assets.local/${organizationPath}`);
    fireEvent.error(organizationLogo);
    expect(screen.getByText('TA')).toBeInTheDocument();
  });

  test('derives the organization monogram from the authoritative visible name', () => {
    const { rerender } = render(
      <BrandingImage
        kind="organization"
        name="Asociación Metropolitana de Fútbol Amateur del Río de la Plata"
        decorative={false}
      />,
    );
    expect(screen.getByText('AM')).toBeInTheDocument();

    rerender(
      <BrandingImage
        kind="organization"
        name="Liga Metropolitana"
        decorative={false}
      />,
    );
    expect(screen.getByText('LM')).toBeInTheDocument();
  });
});
