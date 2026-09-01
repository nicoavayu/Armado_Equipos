/**
 * Browser-side mirror of the Multimedia *lifecycle* contract.
 *
 * Multimedia has three separate questions and they were being answered by one
 * boolean. What the gallery's lifecycle allows, what the photo's own state
 * allows, and what this member is entitled to do are independent, and the
 * database enforces all three separately:
 *
 *   - curation — cover, order, visibility, tags, uploads — is refused outside
 *     `draft` / `under_review` with `TORNEOS_MEDIA_GALLERY_IMMUTABLE`;
 *   - moderation — hide, restore, revoke — carries no gallery gate at all and
 *     `transition_tournament_media_asset` has an explicit `published` branch;
 *   - erasure — the two-phase hard delete — is deliberately lifecycle-agnostic,
 *     because a privacy request does not stop being one once we published.
 *
 * Reading a capability the RPC does not actually ask for is how a control ends
 * up offered and then refused, so each flag below names the same capability its
 * RPC checks. Anything this module returns false for is not rendered: an
 * action the product forbids is not a disabled button, it is not an action.
 */

/** Gallery states where composition can still change. */
export const MEDIA_GALLERY_CURATION_STATES = Object.freeze(['draft', 'under_review']);

/** Gallery states with no way back: no un-archive and no re-publish RPC exists. */
export const MEDIA_GALLERY_CLOSED_STATES = Object.freeze(['archived', 'revoked']);

export const MEDIA_GALLERY_STATE_LABELS = Object.freeze({
  draft: 'Borrador',
  under_review: 'En revisión',
  published: 'Publicada',
  archived: 'Archivada',
  revoked: 'Revocada',
});

/**
 * What each lifecycle state means, said about the gallery and not about the
 * person reading it. The published copy used to promise immutability while five
 * editing controls sat underneath it; the fix is not to swap one promise for
 * another that a read-only member would also be unable to keep. What *this*
 * member may do is answered by the controls that render and by the read-only
 * banner — this text answers what the gallery itself still admits.
 */
export const MEDIA_GALLERY_LIFECYCLE_COPY = Object.freeze({
  draft: {
    title: 'Borrador en preparación',
    copy: 'La selección todavía se edita: admite carga de fotos, moderación, portada y orden.',
  },
  under_review: {
    title: 'En revisión editorial',
    copy: 'La selección sigue siendo editable mientras se revisa: portada, orden y moderación.',
  },
  published: {
    title: 'Galería publicada',
    copy: 'La selección quedó fija: no admite cambios de portada ni de orden. Sigue habilitada la moderación de una foto por privacidad y el archivado de la galería.',
  },
  archived: {
    title: 'Galería archivada',
    copy: 'Registro histórico. No admite edición, publicación ni republicación, y sus fotos ya no se muestran a los participantes.',
  },
  revoked: {
    title: 'Galería revocada',
    copy: 'El contenido se retiró por consentimiento. La galería queda como registro y no vuelve a publicarse.',
  },
});

/** The report reasons participants can pick, in product language. */
export const MEDIA_REPORT_REASON_LABELS = Object.freeze({
  do_not_want_to_appear: 'No quiere aparecer',
  incorrect_identification: 'Identificación incorrecta',
  privacy: 'Privacidad',
  inappropriate_content: 'Contenido inapropiado',
  other: 'Otro motivo',
});

/** Each flag named after the capability its RPC checks, not after a role. */
export function resolveMediaCapabilities(capabilities = []) {
  const granted = Array.isArray(capabilities) ? capabilities : [];
  const has = (name) => granted.includes(name);
  return {
    canRead: has('media.read'),
    canCreateGallery: has('media.create_gallery'),
    canCurate: has('media.update_gallery'),
    canUpload: has('media.upload'),
    canSetCover: has('media.set_cover'),
    canReview: has('media.review'),
    canPublish: has('media.publish'),
    canArchive: has('media.archive'),
    canRevoke: has('media.revoke'),
    canHandleReports: has('media.handle_reports'),
  };
}

/** Lifecycle × capability for the gallery itself. */
export function resolveMediaGalleryActions(gallery, capabilities = []) {
  const permissions = resolveMediaCapabilities(capabilities);
  const status = gallery?.status || '';
  const editable = MEDIA_GALLERY_CURATION_STATES.includes(status);
  const closed = MEDIA_GALLERY_CLOSED_STATES.includes(status);
  return {
    ...permissions,
    status,
    editable,
    closed,
    lifecycle: MEDIA_GALLERY_LIFECYCLE_COPY[status] || null,
    showUpload: permissions.canUpload && editable,
    showPublish: permissions.canPublish && editable,
    // `change_tournament_media_gallery_state` also accepts a draft, but
    // archiving something never published is deletion by another name. The
    // product offers archiving as the end of a published life.
    showArchive: permissions.canArchive && status === 'published',
  };
}

/** Lifecycle × asset state × capability for one photo. */
export function resolveMediaAssetActions(
  asset, gallery, capabilities = [], { isCover = false } = {},
) {
  const gate = resolveMediaGalleryActions(gallery, capabilities);
  const status = asset?.status || '';
  const inGalleryOrder = ['pending_review', 'approved', 'published', 'hidden'].includes(status);
  return {
    approve: gate.canReview && status === 'pending_review',
    reject: gate.canReview && status === 'pending_review',
    // Curation. `set_tournament_media_cover` refuses a published gallery.
    cover: gate.canSetCover && gate.editable && !isCover
      && ['approved', 'published'].includes(status),
    // Curation. `reorder_tournament_media_item` refuses a published gallery,
    // and reordering is a decision about the gallery, not about one photo.
    reorder: gate.canCurate && gate.editable && inGalleryOrder,
    // Moderation, allowed on a published gallery on purpose — but it asks for
    // `media.revoke`, which is not the capability that approves a photo.
    hide: gate.canRevoke && ['approved', 'published'].includes(status),
    // Restoring only leads somewhere while the gallery can still show it.
    restore: gate.canReview && status === 'hidden' && !gate.closed,
    // Erasure. No lifecycle gate: the RPC only refuses a file still moving.
    remove: gate.canRevoke && !['uploading', 'processing'].includes(status),
  };
}

/** True when the card has at least one control to draw. */
export function hasMediaAssetActions(actions) {
  return Object.values(actions || {}).some(Boolean);
}
