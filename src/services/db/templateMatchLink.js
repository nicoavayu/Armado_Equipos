import { supabase } from '../../lib/supabaseClient';
import { crearPartido } from './matches';

// A match created from a frequent template must stay linked to it (partidos.template_id,
// 20261010134000): the template history lists exactly those matches. The link travels in
// the same insert as the match, the server keeps it only for the organizer's own template
// (anything else is cleared, never an error), and the client reads it back: a link that
// did not stick is reported to the person, never treated as a full success.

export const TEMPLATE_LINK_STATUS = Object.freeze({
  LINKED: 'linked',
  // This database has no partidos.template_id yet (before the migration).
  UNSUPPORTED: 'unsupported',
  // The match exists but the link was not saved (or the server cleared it).
  NOT_SAVED: 'not_saved',
  // The link could not be read back.
  UNVERIFIED: 'unverified',
});

const isMissingTemplateColumn = (error) => {
  const code = String(error?.code || '');
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
  return /template_id/i.test(text) && (code === 'PGRST204' || code === '42703' || /does not exist|could not find/i.test(text));
};

/** Reads the match back and says whether it points to the template. */
export const verifyTemplateLink = async (matchId, templateId) => {
  const { data, error } = await supabase
    .from('partidos')
    .select('id, template_id')
    .eq('id', Number(matchId))
    .maybeSingle();
  if (error) {
    return {
      linked: false,
      status: isMissingTemplateColumn(error) ? TEMPLATE_LINK_STATUS.UNSUPPORTED : TEMPLATE_LINK_STATUS.UNVERIFIED,
      error,
    };
  }
  if (data && String(data.template_id ?? '') === String(templateId)) {
    return { linked: true, status: TEMPLATE_LINK_STATUS.LINKED };
  }
  return { linked: false, status: TEMPLATE_LINK_STATUS.NOT_SAVED };
};

const safeVerify = async (matchId, templateId) => {
  try {
    return await verifyTemplateLink(matchId, templateId);
  } catch (error) {
    return { linked: false, status: TEMPLATE_LINK_STATUS.UNVERIFIED, error };
  }
};

/**
 * The link state of one existing match, decided only by reading it back. A failed read is
 * read once more (never assumed missing); a link verified as missing is written again on
 * the SAME match and read back. Nothing here creates a match.
 */
export const confirmTemplateLink = async (matchId, templateId) => {
  let link = await safeVerify(matchId, templateId);
  if (link.status === TEMPLATE_LINK_STATUS.UNVERIFIED) {
    link = await safeVerify(matchId, templateId);
  }
  if (link.status !== TEMPLATE_LINK_STATUS.NOT_SAVED) return link;

  try {
    await supabase
      .from('partidos')
      .update({ template_id: templateId })
      .eq('id', Number(matchId));
  } catch (_error) {
    // The read below decides the state; a failed write is not proof of anything.
  }
  return safeVerify(matchId, templateId);
};

/**
 * Creates the match already linked to the template and confirms the link. The match is
 * created once: a second insert happens only when the first one created nothing because
 * this database has no template_id column yet.
 * @returns {Promise<{ partido: Object, link: { linked: boolean, status: string, error?: any } }>}
 */
export const createMatchLinkedToTemplate = async (payload, templateId) => {
  if (templateId == null || templateId === '') {
    throw new Error('createMatchLinkedToTemplate: templateId is required');
  }

  let partido;
  try {
    partido = await crearPartido({ ...payload, template_id: templateId });
  } catch (error) {
    if (!isMissingTemplateColumn(error)) throw error;
    // Database before 20261010134000: the match is still created, without history.
    partido = await crearPartido(payload);
    return { partido, link: { linked: false, status: TEMPLATE_LINK_STATUS.UNSUPPORTED, error } };
  }

  const link = await confirmTemplateLink(partido.id, templateId);
  return { partido, link };
};

/**
 * What the person reads when the match exists but its history is not confirmed; null when
 * it is linked. "Sin historial" only when the link was verified as missing.
 * @returns {{ title: string, message: string } | null}
 */
export const templateLinkNotice = (link, templateName = '') => {
  if (link?.linked) return null;
  const name = String(templateName || '').trim();
  const where = name ? `el historial de “${name}”` : 'el historial de la plantilla';
  if (link?.status === TEMPLATE_LINK_STATUS.UNVERIFIED || !link?.status) {
    return {
      title: 'Partido creado',
      message: `El partido se creó, pero no pudimos comprobar si quedó en ${where}. Revisalo más tarde ahí.`,
    };
  }
  if (link.status === TEMPLATE_LINK_STATUS.UNSUPPORTED) {
    return {
      title: 'Partido creado sin historial',
      message: `El partido se creó, pero no va a aparecer en ${where}: el historial de plantillas todavía no está disponible en este servidor.`,
    };
  }
  return {
    title: 'Partido creado sin historial',
    message: `El partido se creó, pero no quedó guardado en ${where}. El partido funciona igual.`,
  };
};
