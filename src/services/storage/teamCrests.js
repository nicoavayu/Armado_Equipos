import { supabase } from '../../lib/supabaseClient';

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

  const safeName = sanitizeFileName(file.name || 'crest.png');
  const path = `${userId}/${teamId || 'draft'}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from('team-crests')
    .upload(path, file, {
      upsert: true,
      cacheControl: '3600',
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
