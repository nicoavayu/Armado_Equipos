// MODERATION (migration 00000000000022): the pure rules and copy every surface shares — what can be reported, why, the
// exact p_* payloads of the RPCs (the LOCAL service and the hybrid adapter send the same ones), the organization's
// actions per kind and the honest messages after a report. The database decides everything again; this only keeps the
// client from sending what it would refuse. Spec: docs/superpowers/specs/2026-10-15-torneos-moderation-design.md.
import { LEGAL_IDENTITY } from '../../../legal/legalIdentity';

export const REPORT_REASONS = Object.freeze([
  Object.freeze(['offensive', 'Contenido ofensivo']),
  Object.freeze(['impersonation', 'Suplantación de identidad']),
  Object.freeze(['personal_data', 'Datos personales expuestos']),
  Object.freeze(['spam', 'Spam o engaño']),
  Object.freeze(['other', 'Otro']),
]);
export const REPORT_REASON_LABELS = Object.freeze(Object.fromEntries(REPORT_REASONS));

export const REPORT_KIND_LABELS = Object.freeze({
  organization: 'Organización (nombre o logo)',
  tournament: 'Torneo (nombre, descripción o logo)',
  catalog_listing: 'Convocatoria del catálogo',
  announcement: 'Comunicado',
  team: 'Equipo (nombre o escudo)',
  player: 'Jugador (nombre)',
  application: 'Solicitud de inscripción',
});
export const REPORT_KINDS = Object.freeze(Object.keys(REPORT_KIND_LABELS));
/** Content of a team or a player is reviewed by the organization of the tournament; everything else by Arma2. */
export const ORGANIZATION_REVIEWED_KINDS = Object.freeze(['team', 'player']);
export const REPORT_DETAIL_MAX = 500;
export const REPORT_STATUS_LABELS = Object.freeze({
  open: 'Nuevo',
  under_review: 'En revisión',
  resolved: 'Resuelto',
  dismissed: 'Descartado',
});
/** What an owner or administrator can do with a report of its organization, by kind (the database checks it again). */
export const ORGANIZATION_ACTIONS = Object.freeze({
  team: Object.freeze([
    Object.freeze(['neutralize_team_name', 'Ocultar el nombre del equipo (queda «Equipo» y un código)']),
    Object.freeze(['remove_team_shield', 'Quitar el escudo']),
  ]),
  player: Object.freeze([
    Object.freeze(['neutralize_player_name', 'Ocultar el nombre del jugador (queda «Jugador» y un código)']),
  ]),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,94}[a-z0-9])$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export class ContentModerationInputError extends Error {
  constructor(field) {
    super('La solicitud no es válida. Revisá los datos y volvé a intentar.');
    this.name = 'ContentModerationInputError';
    this.code = 'TORNEOS_REPORT_INVALID';
    this.field = field;
  }
}
const invalid = (field) => { throw new ContentModerationInputError(field); };
const clean = (value) => (typeof value === 'string' ? value.trim() : '');

/** The exact body of report_tournament_content. Public content by slug (+ the text shown), private content by id. */
export function reportContentParams({
  kind, publicSlug = null, targetId = null, targetLabel = null, reason, detail = null, idempotencyKey,
} = {}) {
  if (!REPORT_KINDS.includes(kind)) invalid('kind');
  if (!REPORT_REASON_LABELS[reason]) invalid('reason');
  const byId = kind === 'announcement' || kind === 'application';
  if (byId ? !UUID.test(String(targetId || '')) : !SLUG.test(String(publicSlug || ''))) invalid('target');
  const label = clean(targetLabel);
  if ((kind === 'team' || kind === 'player') && !label) invalid('target_label');
  if (label.length > 200 || CONTROL.test(label)) invalid('target_label');
  const text = clean(detail);
  if (text && (text.length < 3 || text.length > REPORT_DETAIL_MAX || CONTROL.test(text))) invalid('detail');
  if (!UUID.test(String(idempotencyKey || ''))) invalid('idempotency_key');
  return {
    p_target_kind: kind,
    p_public_slug: byId ? null : publicSlug,
    p_target_id: byId ? targetId : null,
    p_target_label: label || null,
    p_reason: reason,
    p_detail: text || null,
    p_idempotency_key: idempotencyKey,
  };
}

export function handleReportParams({ reportId, status, action = null, note = null } = {}) {
  if (!UUID.test(String(reportId || ''))) invalid('report_id');
  if (!['under_review', 'resolved', 'dismissed', 'escalated'].includes(status)) invalid('status');
  const text = clean(note);
  if (text && (text.length < 3 || text.length > 500 || CONTROL.test(text))) invalid('note');
  if ((status === 'resolved' || status === 'dismissed') && !text) invalid('note');
  return { p_report_id: reportId, p_status: status, p_action: action || null, p_note: text || null };
}

export function blockApplicantParams({ organizationId, teamEntryId, reason } = {}) {
  if (!UUID.test(String(organizationId || '')) || !UUID.test(String(teamEntryId || ''))) invalid('target');
  const text = clean(reason);
  if (text.length < 3 || text.length > 300 || CONTROL.test(text)) invalid('reason');
  return { p_organization_id: organizationId, p_team_entry_id: teamEntryId, p_reason: text };
}

export function mutedParams({ organizationId = null, announcementId = null, muted } = {}) {
  if (typeof muted !== 'boolean') invalid('muted');
  const byAnnouncement = UUID.test(String(announcementId || ''));
  const byOrganization = UUID.test(String(organizationId || ''));
  if (byAnnouncement === byOrganization) invalid('target');
  return {
    p_organization_id: byOrganization ? organizationId : null,
    p_announcement_id: byAnnouncement ? announcementId : null,
    p_muted: muted,
  };
}

/** The honest message after a report: who reviews it, and that nobody sees who sent it. */
export function reportReceivedMessage(result = {}) {
  if (result?.alreadyReported) return 'Ya habías reportado esto y sigue en revisión. No hace falta que lo envíes de nuevo.';
  const reviewer = result?.reviewScope === 'organization' ? 'la organización del torneo' : 'el equipo de Arma2';
  return `Recibimos tu reporte. Lo revisa ${reviewer}, en general dentro de las 24 a 48 horas. No le mostramos a nadie quién lo envió.`;
}

/**
 * The email alternative for someone without a session (web only). It carries the kind and the public address of the
 * page — never a name of a person.
 */
export function reportMailto({ kind = 'tournament', publicSlug = null, origin = '' } = {}) {
  const address = LEGAL_IDENTITY.contactEmail;
  const page = publicSlug && SLUG.test(publicSlug) ? `${origin || ''}/torneos/publico/${publicSlug}` : '';
  const subject = 'Reporte de contenido en Arma2 Torneos';
  const body = [
    `Qué quiero reportar: ${REPORT_KIND_LABELS[kind] || 'Contenido'}`,
    page ? `Página: ${page}` : null,
    'Motivo:',
    '',
    '(No incluyas datos personales de terceros.)',
  ].filter((line) => line !== null).join('\n');
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
