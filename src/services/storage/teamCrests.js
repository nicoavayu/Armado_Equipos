import { supabase } from '../../lib/supabaseClient';
import { isSvgFile, SVG_REJECTED_MESSAGE, UPLOAD_RASTER_TYPES } from '../../utils/imageUpload';

// `team-crests` is a PUBLIC bucket: anything stored there is served from the
// storage origin. Only re-encoded raster images may be uploaded — never SVG,
// which can carry scripts that run when its public URL is opened directly.
// Callers normalize with prepareImageForUpload first; this is the last guard
// before the network.
export const assertRasterTeamImage = (file) => {
  if (isSvgFile(file)) {
    const error = new Error(SVG_REJECTED_MESSAGE);
    error.code = 'SVG_NOT_ALLOWED';
    throw error;
  }
  const type = String(file?.type || '').toLowerCase();
  if (!UPLOAD_RASTER_TYPES.includes(type)) {
    const error = new Error('Formato de imagen no permitido. Elegí una foto JPG, PNG o WEBP.');
    error.code = 'UNSUPPORTED_TYPE';
    throw error;
  }
  return type;
};

const sanitizeFileName = (fileName) => {
  if (typeof fileName !== 'string') return 'crest';
  return fileName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '') || 'crest';
};

export const uploadTeamCrest = async ({ file, userId, teamId }) => {
  if (!file) throw new Error('No hay archivo para subir');
  if (!userId) throw new Error('Usuario no autenticado');
  const contentType = assertRasterTeamImage(file);

  const safeName = sanitizeFileName(file.name || 'crest.png');
  const path = `${userId}/${teamId || 'draft'}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from('team-crests')
    .upload(path, file, {
      upsert: true,
      cacheControl: '3600',
      contentType,
    });

  if (uploadError) {
    throw new Error(uploadError.message || 'No se pudo subir el escudo');
  }

  const { data } = supabase.storage
    .from('team-crests')
    .getPublicUrl(path);

  if (!data?.publicUrl) {
    throw new Error('No se pudo obtener la URL publica del escudo');
  }

  return data.publicUrl;
};

export const uploadTeamMemberPhoto = async ({ file, userId, teamId, memberId = 'draft' }) => {
  if (!file) throw new Error('No hay archivo para subir');
  if (!userId) throw new Error('Usuario no autenticado');
  const contentType = assertRasterTeamImage(file);

  const safeName = sanitizeFileName(file.name || 'member-photo.png');
  const path = `${userId}/${teamId || 'team'}/members/${memberId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from('team-crests')
    .upload(path, file, {
      upsert: true,
      cacheControl: '3600',
      contentType,
    });

  if (uploadError) {
    throw new Error(uploadError.message || 'No se pudo subir la foto del jugador');
  }

  const { data } = supabase.storage
    .from('team-crests')
    .getPublicUrl(path);

  if (!data?.publicUrl) {
    throw new Error('No se pudo obtener la URL publica de la foto del jugador');
  }

  return data.publicUrl;
};
