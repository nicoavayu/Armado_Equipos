// PREMIUM SPONSORS (0020) — the LOCAL single-project composition. The same sequence as the hybrid adapter
// (stagingV1/stagingV1WorkspaceService.js), over this project's own storage and RPCs: the logo is stored first (the
// organization's own folder, the existing organization kind of the branding bucket), then the save; a refused save
// removes what it stored, and the logo a save or an archive replaced is removed afterwards (best effort: the server
// already answered, and the bucket keeps refusing to drop an object still in use). The server decides role,
// organization and entitlement. Only the four sponsors RPCs of the BRANDING-V1 contract.
import { supabase } from '../../../services/api/supabase';
import {
  BRANDING_BUCKET,
  buildBrandingPath,
  isVersionedBrandingPath,
  prepareBrandingFile,
  resolveBrandingAssetUrl,
} from '../domain/brandingAssets';
import { normalizeSponsorsAnswer, normalizeSponsorsAuthorization } from '../domain/sponsors';
import { toWorkspaceError } from './tournamentWorkspaceErrors';

function sponsorLogoUrl(path) {
  return resolveBrandingAssetUrl({ kind: 'organization', path });
}

async function removeSponsorLogo(path) {
  if (!isVersionedBrandingPath(path, 'organization')) return;
  try {
    await supabase.storage.from(BRANDING_BUCKET).remove([path]);
  } catch {
    // An orphan object is only storage; the answer the server gave stands.
  }
}

export async function loadTournamentOrganizationSponsors({ organizationId, seasonId = null }) {
  const { data, error } = await supabase.rpc('get_tournament_organization_sponsors', {
    p_organization_id: organizationId,
    p_season_id: seasonId,
  });
  if (error) throw toWorkspaceError(error, 'No pudimos cargar los sponsors.');
  return normalizeSponsorsAnswer(data, { resolveLogoUrl: sponsorLogoUrl });
}

export async function saveTournamentOrganizationSponsor({
  organizationId,
  sponsorId = null,
  name,
  file = null,
  logoPath = null,
  sortOrder = null,
}) {
  let prepared = null;
  if (file) {
    try {
      prepared = await prepareBrandingFile(file);
    } catch (error) {
      // The file itself was refused before any request (format, size, dimensions): its own copy.
      throw new Error(error?.message || 'No pudimos preparar el logo del sponsor.');
    }
  }
  let uploadedPath = null;
  try {
    if (prepared) {
      const path = buildBrandingPath({
        organizationId,
        kind: 'organization',
        entityId: organizationId,
        mime: prepared.mime,
      });
      const { error: uploadError } = await supabase.storage
        .from(BRANDING_BUCKET)
        .upload(path, prepared.source, {
          cacheControl: '31536000',
          contentType: prepared.mime,
          upsert: false,
        });
      if (uploadError) throw uploadError;
      uploadedPath = path;
    }
    const { data, error } = await supabase.rpc('upsert_tournament_organization_sponsor', {
      p_organization_id: organizationId,
      p_sponsor_id: sponsorId,
      p_name: name,
      p_logo_path: uploadedPath || logoPath,
      p_sort_order: sortOrder,
    });
    if (error) throw error;
    const previous = data?.previousLogoPath;
    if (previous && previous !== (uploadedPath || logoPath)) await removeSponsorLogo(previous);
    return data;
  } catch (error) {
    if (uploadedPath) await removeSponsorLogo(uploadedPath);
    throw toWorkspaceError(error, 'No pudimos guardar el sponsor.');
  }
}

export async function archiveTournamentOrganizationSponsor({ organizationId, sponsorId }) {
  const { data, error } = await supabase.rpc('archive_tournament_organization_sponsor', {
    p_organization_id: organizationId,
    p_sponsor_id: sponsorId,
  });
  if (error) throw toWorkspaceError(error, 'No pudimos archivar el sponsor.');
  if (data?.previousLogoPath) await removeSponsorLogo(data.previousLogoPath);
  return data;
}

export async function authorizeTournamentSocialSponsors({
  seasonId,
  tournamentId,
  theme,
  sponsorIds,
}) {
  const { data, error } = await supabase.rpc('authorize_tournament_social_sponsors', {
    p_season_id: seasonId,
    p_tournament_id: tournamentId,
    p_theme: theme,
    p_sponsor_ids: sponsorIds,
  });
  if (error) throw toWorkspaceError(error, 'No pudimos autorizar los sponsors de esta placa.');
  return normalizeSponsorsAuthorization(data, { resolveLogoUrl: sponsorLogoUrl });
}
