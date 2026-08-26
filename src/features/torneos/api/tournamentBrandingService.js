import { supabase } from '../../../services/api/supabase';
import {
  BRANDING_BUCKET,
  buildBrandingPath,
  isVersionedBrandingPath,
  prepareBrandingFile,
} from '../domain/brandingAssets';

const ENTITY_LABELS = Object.freeze({
  organization: 'logo de la organización',
  tournament: 'logo del torneo',
  team: 'escudo del equipo',
});

function toBrandingError(error, fallback) {
  if (String(error?.message || '').includes('TORNEOS_BRANDING_FORBIDDEN')) {
    return new Error('No tenés permiso para modificar este asset.');
  }
  if (String(error?.message || '').includes('TORNEOS_BRANDING_INVALID_REFERENCE')) {
    return new Error('La referencia del asset no es válida.');
  }
  return new Error(error?.message || fallback);
}

async function removeObject(path) {
  if (!isVersionedBrandingPath(path)) return;
  const { data, error } = await supabase.storage.from(BRANDING_BUCKET).remove([path]);
  if (error) throw error;
  if (!Array.isArray(data) || !data.some((object) => object?.name === path)) {
    throw new Error('TORNEOS_BRANDING_OBJECT_NOT_REMOVED');
  }
}

export async function loadTournamentBrandingContext({
  organizationId,
  tournamentId = null,
}) {
  const { data, error } = await supabase.rpc('get_tournament_branding_context', {
    p_organization_id: organizationId,
    p_tournament_id: tournamentId,
  });
  if (error) throw toBrandingError(error, 'No pudimos cargar la identidad visual.');
  return data || { organization: null, tournaments: [] };
}

export async function uploadTournamentBrandingAsset({
  organizationId,
  kind,
  entityId,
  file,
}) {
  const label = ENTITY_LABELS[kind] || 'asset';
  let uploadedPath = null;
  try {
    const prepared = await prepareBrandingFile(file);
    uploadedPath = buildBrandingPath({
      organizationId,
      kind,
      entityId,
      mime: prepared.mime,
    });
    const { error: uploadError } = await supabase.storage
      .from(BRANDING_BUCKET)
      .upload(uploadedPath, prepared.source, {
        cacheControl: '31536000',
        contentType: prepared.mime,
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { data, error: referenceError } = await supabase.rpc(
      'set_tournament_branding_reference',
      {
        p_organization_id: organizationId,
        p_entity_kind: kind,
        p_entity_id: entityId,
        p_path: uploadedPath,
      },
    );
    if (referenceError) throw referenceError;

    if (data?.previousPath && data.previousPath !== uploadedPath) {
      await removeObject(data.previousPath).catch(() => {});
    }
    return {
      ...data,
      path: uploadedPath,
      width: prepared.width,
      height: prepared.height,
      mime: prepared.mime,
    };
  } catch (error) {
    if (uploadedPath) await removeObject(uploadedPath).catch(() => {});
    throw toBrandingError(error, `No pudimos guardar el ${label}.`);
  }
}

export async function removeTournamentBrandingAsset({
  organizationId,
  kind,
  entityId,
}) {
  const label = ENTITY_LABELS[kind] || 'asset';
  try {
    const { data, error } = await supabase.rpc('set_tournament_branding_reference', {
      p_organization_id: organizationId,
      p_entity_kind: kind,
      p_entity_id: entityId,
      p_path: null,
    });
    if (error) throw error;
    if (data?.previousPath) await removeObject(data.previousPath);
    return data;
  } catch (error) {
    throw toBrandingError(error, `No pudimos quitar el ${label}.`);
  }
}
