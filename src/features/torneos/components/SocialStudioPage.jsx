import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  Image as ImageIcon,
  LayoutTemplate,
  Loader2,
  LockKeyhole,
  Palette,
  RefreshCw,
  RotateCcw,
  Share2,
  Sparkles,
  Upload,
  Users,
  ZoomIn,
} from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useTorneosCompetition } from '../context/TorneosCompetitionContext';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import {
  SOCIAL_ACCENTS,
  SOCIAL_FORMATS,
  SOCIAL_PLAYER_LINE_LABELS,
  SOCIAL_PLAYER_LINES,
  SOCIAL_PIECES,
  SOCIAL_TEXT_LIMITS,
  createEditorialState,
  describeCurationGap,
  fallbackSocialPlayerLine,
  findSocialPiece,
  resolveFiguraDragFocal,
  selectionSizeForSnapshot,
} from '../social/socialContracts';
import {
  exportSocialPiece,
  prepareSocialRender,
  releasePreparedSocialRender,
  replacePreparedSocialRender,
  shareSocialPiece,
} from '../social/socialStudio';
import { resolveSocialTheme } from '../social/socialThemes';
import { resolveEditorialStandingsPagination } from '../social/premium/premiumPagination';
import {
  describeSocialCatalogAccess,
  hasSocialStudioPremium,
  resolveSocialExportPolicy,
  resolveSocialPreviewBranding,
} from '../social/socialAccessPolicy';
import { BASE_LOCKUP_DATA_URL } from '../social/base/brandAsset';
import SocialResultsThemePicker from './SocialResultsThemePicker';
import styles from './SocialStudioPage.module.css';

const PREVIEW_WIDTH = 300;
// Lossless renderer asset derived from the approved Social Studio lockup. Its
// meaningful transparent space is preserved instead of cropping or rebuilding
// the identity from separate marks.
const OFFICIAL_BRAND_ASSETS = Object.freeze({
  lockup: BASE_LOCKUP_DATA_URL,
});

function StudioState({ icon: Icon = Sparkles, title, copy, action = null }) {
  return (
    <section className={styles.stateCard}>
      <Icon size={30} aria-hidden="true" />
      <h2>{title}</h2>
      <p>{copy}</p>
      {action}
    </section>
  );
}

export function hasSocialStudioRoleCapability(capabilities, capability) {
  return Array.isArray(capabilities) && capabilities.includes(capability);
}

export function resolveSocialStudioSeasonId(studioTournament, competitionTournaments = []) {
  if (studioTournament?.seasonId) return studioTournament.seasonId;
  return competitionTournaments.find((entry) => entry.id === studioTournament?.id)?.seasonId
    || null;
}

export function claimFiguraDragPointer(event) {
  event.preventDefault?.();
  event.stopPropagation?.();
}

export function applyFiguraDragToEditorial(current, drag, {
  clientX,
  clientY,
  frameWidth,
  frameHeight,
}) {
  return {
    ...current,
    ...resolveFiguraDragFocal({
      focalX: drag.focalX,
      focalY: drag.focalY,
      deltaX: clientX - drag.x,
      deltaY: clientY - drag.y,
      frameWidth,
      frameHeight,
      zoom: current.figuraZoom,
    }),
  };
}

/**
 * Estudio Social.
 *
 * The preview is the renderer, scaled down with CSS — never a second layout.
 * What you see is the file, at a third of the size, so a piece cannot look
 * right on screen and wrong on export.
 */
export default function SocialStudioPage() {
  const { organizationId } = useParams();
  const { service } = useTorneosWorkspace();
  const competition = useTorneosCompetition();
  const canvasHostRef = useRef(null);
  const preparedRenderRef = useRef(null);
  const photoFileInputRef = useRef(null);
  const localPhotoUrlRef = useRef(null);
  const photoDragRef = useRef(null);
  const requestRef = useRef(0);
  const [context, setContext] = useState({ status: 'loading', data: null, error: '' });
  const [scope, setScope] = useState({
    tournamentId: '', categoryId: '', phaseId: '', roundId: '',
  });
  const [pieceId, setPieceId] = useState('standings');
  const [snapshot, setSnapshot] = useState(null);
  const [snapshotError, setSnapshotError] = useState('');
  const [editorial, setEditorial] = useState(() => createEditorialState(null));
  const [themeId, setThemeId] = useState('base');
  const [includeArma2Branding, setIncludeArma2Branding] = useState(true);
  const [renderState, setRenderState] = useState({ status: 'idle', error: '' });
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [localPhoto, setLocalPhoto] = useState(null);

  const capabilities = context.data?.capabilities || [];
  const canCreate = hasSocialStudioRoleCapability(capabilities, 'social.create');
  const canExport = hasSocialStudioRoleCapability(capabilities, 'social.export');
  const canSelect = hasSocialStudioRoleCapability(capabilities, 'social.manual_selection')
    || canCreate;
  const canEditText = hasSocialStudioRoleCapability(capabilities, 'social.editorial_text')
    || canCreate;

  useEffect(() => {
    let active = true;
    setContext({ status: 'loading', data: null, error: '' });
    service.loadSocialStudioContext(organizationId)
      .then((data) => {
        if (!active) return;
        setContext({ status: 'ready', data, error: '' });
      })
      .catch((error) => {
        if (!active) return;
        setContext({
          status: 'error', data: null,
          error: error?.message || 'No pudimos abrir el Estudio Social.',
        });
      });
    return () => { active = false; };
  }, [organizationId, service]);

  const tournaments = context.data?.tournaments || [];
  const tournament = tournaments.find((entry) => entry.id === scope.tournamentId) || null;
  const seasonId = resolveSocialStudioSeasonId(tournament, competition.tournaments);
  const category = tournament?.categories?.find((entry) => entry.id === scope.categoryId) || null;
  const phase = category?.phases?.find((entry) => entry.id === scope.phaseId) || null;
  const rounds = phase?.rounds || [];
  const piece = findSocialPiece(pieceId);
  const effectiveThemeId = resolveSocialTheme(themeId).id;
  const trustedSeasonPlan = competition.planState?.status === 'ready'
    && competition.planState.data?.isTrusted === true
    && competition.planState.data?.scope?.seasonId === seasonId;
  const effectiveEntitlements = trustedSeasonPlan ? competition.planState.data : null;
  const isPremiumSeason = hasSocialStudioPremium(effectiveEntitlements);
  const canRemoveArma2Branding = isPremiumSeason;
  const catalogAccess = describeSocialCatalogAccess({
    familyId: pieceId,
    themeId: effectiveThemeId,
    entitlements: effectiveEntitlements,
  });
  const availablePieces = SOCIAL_PIECES;

  useEffect(() => {
    if (effectiveThemeId !== 'base') setIncludeArma2Branding(false);
    else if (!canRemoveArma2Branding) setIncludeArma2Branding(true);
  }, [canRemoveArma2Branding, effectiveThemeId]);

  const scopeForTournament = useCallback((entry) => {
    const nextCategory = entry?.categories?.[0];
    const nextPhase = nextCategory?.phases?.[0];
    return {
      tournamentId: entry?.id || '',
      categoryId: nextCategory?.id || '',
      phaseId: nextPhase?.id || '',
      roundId: nextPhase?.rounds?.[nextPhase.rounds.length - 1]?.id || '',
    };
  }, []);

  useEffect(() => {
    if (context.status !== 'ready' || competition.status !== 'ready') return;
    const active = tournaments.find((entry) => entry.id === competition.activeTournament?.id)
      || tournaments[0]
      || null;
    if (!active || scope.tournamentId === active.id) return;
    setScope(scopeForTournament(active));
    const activeSeasonId = resolveSocialStudioSeasonId(active, competition.tournaments);
    if (!competition.activeTournament && activeSeasonId) {
      competition.selectContext(activeSeasonId, active.id).catch(() => {});
    }
  }, [
    competition.activeTournament,
    competition.selectContext,
    competition.status,
    context.status,
    scope.tournamentId,
    scopeForTournament,
    tournaments,
  ]);

  const loadSnapshot = useCallback(async () => {
    if (!scope.tournamentId || !scope.categoryId || !scope.phaseId) return;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setSnapshotError('');
    try {
      const data = await service.loadSocialSnapshot({
        organizationId,
        tournamentId: scope.tournamentId,
        categoryId: scope.categoryId,
        phaseId: scope.phaseId,
        piece: pieceId,
        roundId: piece?.requiresRound ? (scope.roundId || null) : null,
      });
      if (requestRef.current !== requestId) return;
      setSnapshot(data);
      setEditorial((current) => createEditorialState(data, {
        ...current,
        format: data.piece === 'round_results' ? 'portrait' : current.format,
        title: undefined,
        subtitle: undefined,
        selection: [],
        selectedLines: {},
        page: 1,
      }));
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setSnapshot(null);
      setSnapshotError(error?.message || 'No pudimos preparar esta pieza.');
    }
    // `piece` is derived from pieceId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, pieceId, scope, service]);

  useEffect(() => { loadSnapshot(); }, [loadSnapshot]);

  const curationGap = useMemo(
    () => (snapshot ? describeCurationGap(snapshot, editorial) : null),
    [snapshot, editorial],
  );
  const selectedTheme = useMemo(
    () => resolveSocialTheme(effectiveThemeId),
    [effectiveThemeId],
  );
  const standingsPagination = useMemo(
    () => resolveEditorialStandingsPagination(snapshot, editorial, selectedTheme),
    [editorial, selectedTheme, snapshot],
  );
  const branding = useMemo(() => {
    const competitionTournament = competition.tournaments?.find(
      (entry) => entry.id === scope.tournamentId,
    );
    return {
      tournamentName: snapshot?.competition?.tournamentName || tournament?.name || '',
      tournamentLogo: service.resolveTournamentLogoUrl?.(competitionTournament?.logoPath) || null,
      primaryColor: null,
      secondaryColor: null,
      showArma2Branding: effectiveThemeId === 'base'
        ? (canRemoveArma2Branding ? includeArma2Branding : true)
        : resolveSocialPreviewBranding({
          themeId: effectiveThemeId,
          entitlements: effectiveEntitlements,
        }),
    };
  }, [canRemoveArma2Branding, competition.tournaments, effectiveEntitlements, effectiveThemeId, includeArma2Branding, scope.tournamentId, service, snapshot, tournament]);

  // Re-render the preview whenever anything it depends on changes. The canvas
  // is replaced wholesale rather than mutated so a failed render never leaves
  // half of the previous piece on screen.
  useEffect(() => {
    if (!snapshot) {
      canvasHostRef.current?.replaceChildren();
      releasePreparedSocialRender(preparedRenderRef.current);
      preparedRenderRef.current = null;
      setRenderState({ status: 'idle', error: '', renderKey: '' });
      return undefined;
    }
    if (!canvasHostRef.current) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    setRenderState({ status: 'loading', error: '', renderKey: '' });
    prepareSocialRender({
      snapshot,
      editorial,
      organizationId,
      signMediaReadUrls: service.signMediaReadUrls,
      resolveShieldUrl: service.resolveTeamShieldUrl,
      theme: selectedTheme,
      branding,
      brandAssetUrls: branding.showArma2Branding ? OFFICIAL_BRAND_ASSETS : null,
      photoSourceUrl: localPhoto?.url || null,
      signal: controller.signal,
      onStatus: (status) => {
        if (!cancelled) setRenderState({ status, error: '', renderKey: '' });
      },
    }).then((prepared) => {
      if (cancelled) {
        releasePreparedSocialRender(prepared);
        return;
      }
      const surface = prepared.canvas || prepared.node;
      const host = canvasHostRef.current;
      if (!host) {
        releasePreparedSocialRender(prepared);
        return;
      }
      surface.setAttribute('role', 'img');
      surface.setAttribute(
        'aria-label',
        `Vista previa de ${piece?.label || 'la pieza'} en ${SOCIAL_FORMATS[editorial.format].label}, theme ${selectedTheme.label}`,
      );
      surface.className = styles.previewCanvas;
      if (prepared.node) {
        surface.style.setProperty(
          '--social-preview-scale', String(PREVIEW_WIDTH / prepared.format.width),
        );
      }
      host.replaceChildren(surface);
      replacePreparedSocialRender(preparedRenderRef, prepared);
      setRenderState({ status: 'ready', error: '', renderKey: prepared.renderKey });
    }).catch((error) => {
      if (cancelled) return;
      canvasHostRef.current?.replaceChildren();
      releasePreparedSocialRender(preparedRenderRef.current);
      preparedRenderRef.current = null;
      setRenderState({
        status: error?.code === 'CURATION_REQUIRED' ? 'curation' : 'error',
        error: error?.code === 'CURATION_REQUIRED'
          ? error.message.replace('CURATION_REQUIRED: ', '')
          : 'No pudimos generar la vista previa con estos datos.',
      });
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [snapshot, editorial, organizationId, service, piece, selectedTheme, branding, localPhoto]);

  useEffect(() => () => {
    releasePreparedSocialRender(preparedRenderRef.current);
    preparedRenderRef.current = null;
  }, []);

  useEffect(() => () => {
    if (localPhotoUrlRef.current) URL.revokeObjectURL(localPhotoUrlRef.current);
  }, []);

  const updateEditorial = (patch) => setEditorial((current) => ({ ...current, ...patch }));

  const toggleSelection = (id) => {
    if (!canSelect) return;
    setEditorial((current) => {
      const alreadySelected = current.selection.includes(id);
      const selection = alreadySelected
        ? current.selection.filter((entry) => entry !== id)
        : [...current.selection, id].slice(0, selectionSizeForSnapshot(snapshot));
      const selectedLines = { ...current.selectedLines };
      if (alreadySelected) delete selectedLines[id];
      else if (selection.includes(id)) {
        const candidate = (snapshot?.official?.candidates || []).find((entry) => (
          (entry.rosterPlayerId || entry.participantId) === id
        ));
        selectedLines[id] = fallbackSocialPlayerLine(candidate, selection.length - 1);
      }
      return { ...current, selection, selectedLines };
    });
  };

  const chooseLocalPhoto = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (localPhotoUrlRef.current) URL.revokeObjectURL(localPhotoUrlRef.current);
    const url = URL.createObjectURL(file);
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    localPhotoUrlRef.current = url;
    setLocalPhoto({ url, key, name: file.name });
    updateEditorial({
      photoAssetId: null,
      photoLocalKey: key,
      figuraFocalX: 0.5,
      figuraFocalY: 0.5,
      figuraZoom: 1,
    });
    event.target.value = '';
  };

  const resetPhotoCrop = () => updateEditorial({
    figuraFocalX: 0.5,
    figuraFocalY: 0.5,
    figuraZoom: 1,
  });

  const hasFigurePhoto = pieceId === 'mvp'
    && Boolean(localPhoto || editorial.photoAssetId);

  const startPhotoDrag = (event) => {
    if (!hasFigurePhoto) return;
    claimFiguraDragPointer(event);
    if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
    photoDragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      focalX: editorial.figuraFocalX,
      focalY: editorial.figuraFocalY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const movePhotoDrag = (event) => {
    const drag = photoDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    claimFiguraDragPointer(event);
    const rect = event.currentTarget.getBoundingClientRect();
    setEditorial((current) => applyFiguraDragToEditorial(current, drag, {
      clientX: event.clientX,
      clientY: event.clientY,
      frameWidth: rect.width,
      frameHeight: rect.height,
    }));
  };

  const stopPhotoDrag = (event) => {
    const drag = photoDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    claimFiguraDragPointer(event);
    photoDragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const runExport = async (mode) => {
    if (
      !canExport
      || !snapshot
      || busy
      || renderState.status !== 'ready'
      || !preparedRenderRef.current
      || !catalogAccess.exportable
    ) return;
    setBusy(mode);
    setNotice('');
    try {
      const exportPolicy = resolveSocialExportPolicy({
        familyId: pieceId,
        themeId: effectiveThemeId,
        entitlements: effectiveEntitlements,
        requestedArma2Branding: includeArma2Branding,
      });
      await service.authorizeSocialExport({
        organizationId,
        tournamentId: scope.tournamentId,
        piece: pieceId,
        theme: effectiveThemeId,
        includeArma2Branding: exportPolicy.showArma2Branding,
      });
      const result = await exportSocialPiece({
        prepared: preparedRenderRef.current,
        snapshot,
        editorial,
        expectedRenderKey: renderState.renderKey,
      });
      if (mode === 'share') {
        const outcome = await shareSocialPiece({
          blob: result.blob, fileName: result.fileName, title: result.pieceLabel,
        });
        setNotice(outcome.shared
          ? 'Pieza compartida.'
          : outcome.downloaded ? 'Descargamos el PNG.' : 'Compartir cancelado.');
      } else {
        const { downloadSocialPiece } = await import('../social/socialStudio');
        if (!standingsPagination.enabled) {
          downloadSocialPiece({ blob: result.blob, fileName: result.fileName });
          setNotice(`Descargamos ${result.fileName}.`);
        } else {
          const downloads = [];
          for (let page = 1; page <= standingsPagination.pageCount; page += 1) {
            if (page === standingsPagination.page) {
              downloads.push(result);
              continue;
            }
            let prepared = null;
            try {
              prepared = await prepareSocialRender({
                snapshot,
                editorial: { ...editorial, page },
                organizationId,
                signMediaReadUrls: service.signMediaReadUrls,
                resolveShieldUrl: service.resolveTeamShieldUrl,
                theme: selectedTheme,
                branding,
                brandAssetUrls: branding.showArma2Branding ? OFFICIAL_BRAND_ASSETS : null,
                photoSourceUrl: localPhoto?.url || null,
              });
              downloads.push(await exportSocialPiece({
                prepared,
                snapshot,
                editorial: { ...editorial, page },
              }));
            } finally {
              releasePreparedSocialRender(prepared);
            }
          }
          downloads.forEach(({ blob, fileName }) => downloadSocialPiece({ blob, fileName }));
          setNotice(`Descargamos ${downloads.length} páginas de la tabla.`);
        }
      }
    } catch (error) {
      setNotice('');
      setRenderState({
        status: 'error',
        error: error?.code === 'CURATION_REQUIRED'
          ? error.message.replace('CURATION_REQUIRED: ', '')
          : 'No pudimos exportar la pieza. Revisá los datos y reintentá.',
      });
    } finally {
      setBusy('');
    }
  };

  if (context.status === 'loading') {
    return <div className={styles.skeleton}><span /><span /><span /></div>;
  }
  if (context.status === 'error') {
    return (
      <StudioState
        icon={AlertTriangle}
        title="No pudimos abrir el Estudio Social"
        copy={context.error}
      />
    );
  }

  const candidates = snapshot?.official?.candidates || [];
  const format = SOCIAL_FORMATS[editorial.format];
  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p>Piezas listas para publicar · Datos oficiales</p>
          <h1>Estudio Social</h1>
          <span>Generá placas con la identidad de Arma2 a partir de lo que ya está publicado.</span>
        </div>
        <div className={styles.heroMetrics}>
          <article><LayoutTemplate size={19} aria-hidden="true" /><span><strong>{availablePieces.length}</strong><small>familias visibles</small></span></article>
          <article><ImageIcon size={19} aria-hidden="true" /><span><strong>2</strong><small>formatos</small></span></article>
        </div>
      </header>

      {!canCreate && (
        <div className={styles.readOnlyBanner}>
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            <strong>Modo lectura</strong>
            <small>Tu rol puede ver el Estudio, sin generar ni exportar piezas.</small>
          </span>
        </div>
      )}
      {notice && (
        <div className={styles.noticeBanner} role="status">
          <Check size={17} aria-hidden="true" /> {notice}
        </div>
      )}

      <div className={styles.workspace}>
        <section className={styles.controls} aria-label="Configuración de la pieza">
          <fieldset>
            <legend>Alcance</legend>
            <label>
              <span>Torneo</span>
              <select
                value={scope.tournamentId}
                onChange={(event) => {
                  const next = tournaments.find((entry) => entry.id === event.target.value);
                  setScope(scopeForTournament(next));
                  setNotice('');
                  const nextSeasonId = resolveSocialStudioSeasonId(
                    next,
                    competition.tournaments,
                  );
                  if (nextSeasonId) {
                    competition.selectContext(nextSeasonId, next.id).catch(() => {});
                  }
                }}
              >
                {tournaments.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Categoría</span>
              <select
                value={scope.categoryId}
                onChange={(event) => setScope((current) => ({
                  ...current, categoryId: event.target.value, phaseId: '', roundId: '',
                }))}
              >
                <option value="">Elegí una categoría</option>
                {(tournament?.categories || []).map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Fase</span>
              <select
                value={scope.phaseId}
                onChange={(event) => setScope((current) => ({
                  ...current, phaseId: event.target.value, roundId: '',
                }))}
              >
                <option value="">Elegí una fase</option>
                {(category?.phases || []).map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                ))}
              </select>
            </label>
            {piece?.requiresRound && (
              <label>
                <span>Fecha</span>
                <select
                  value={scope.roundId}
                  onChange={(event) => setScope((current) => ({
                    ...current, roundId: event.target.value,
                  }))}
                >
                  <option value="">Todas</option>
                  {rounds.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.name}</option>
                  ))}
                </select>
              </label>
            )}
          </fieldset>

          <fieldset className={styles.pieceFieldset}>
            <legend>Pieza</legend>
            <div className={styles.pieceGrid} role="radiogroup" aria-label="Plantilla">
              {availablePieces.map((entry) => {
                const access = describeSocialCatalogAccess({
                  familyId: entry.id,
                  themeId: 'base',
                  entitlements: effectiveEntitlements,
                });
                return (
                <button
                  key={entry.id}
                  type="button"
                  role="radio"
                  aria-checked={pieceId === entry.id}
                  className={`${pieceId === entry.id ? styles.pieceActive : ''} ${access.locked ? styles.pieceLocked : ''}`}
                  onClick={() => setPieceId(entry.id)}
                >
                  {access.locked && <LockKeyhole size={13} aria-hidden="true" />}
                  {entry.label}
                  <small>{access.locked ? 'Premium' : 'Disponible'}</small>
                </button>
                );
              })}
            </div>
            {!isPremiumSeason && (
              <p className={styles.previewHint}><LockKeyhole size={14} /> Premium habilita las 11 familias Base.</p>
            )}
          </fieldset>

          <fieldset>
            <legend>Formato y estilo</legend>
            <div className={styles.chipRow} role="radiogroup" aria-label="Formato">
              {Object.values(SOCIAL_FORMATS).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="radio"
                  aria-checked={editorial.format === entry.id}
                  className={editorial.format === entry.id ? styles.chipActive : ''}
                  onClick={() => updateEditorial({ format: entry.id })}
                >
                  {entry.label}
                </button>
                ))}
            </div>
            <SocialResultsThemePicker
                organizationId={organizationId}
                seasonId={seasonId}
                planState={competition.planState}
                themeId={themeId}
                displayThemeId={effectiveThemeId}
                onSelect={setThemeId}
                onLockedPreview={() => setNotice('Estás viendo el diseño Premium real. La exportación permanece bloqueada.')}
              />
            {selectedTheme.id !== 'base' && (
              <div className={styles.chipRow} role="radiogroup" aria-label="Acento">
                {SOCIAL_ACCENTS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="radio"
                    aria-checked={editorial.accent === entry.id}
                    aria-label={`Acento ${entry.label}`}
                    className={editorial.accent === entry.id ? styles.chipActive : ''}
                    onClick={() => updateEditorial({ accent: entry.id })}
                  >
                    <Palette size={15} aria-hidden="true" /> {entry.label}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          {selectedTheme.id === 'base' ? <fieldset>
            <legend>Branding Arma2</legend>
            <label>
              <input
                type="checkbox"
                checked={includeArma2Branding}
                disabled={!canRemoveArma2Branding}
                onChange={(event) => setIncludeArma2Branding(event.target.checked)}
              />
              <span>Mostrar firma, logo y URL de Arma2</span>
            </label>
            {!canRemoveArma2Branding && (
              <p className={styles.previewHint}>En FREE el branding Arma2 permanece visible.</p>
            )}
          </fieldset> : (
            <p className={styles.whiteLabelNotice}>Heritage, Street, Scoreboard y Editorial son siempre white-label. El arte no incluye branding Arma2.</p>
          )}

          {selectedTheme.id !== 'base' && (
            <fieldset disabled={!canEditText}>
              <legend>Texto</legend>
              <label>
                <span>Título</span>
                <input
                  value={editorial.title}
                  maxLength={SOCIAL_TEXT_LIMITS.title}
                  onChange={(event) => updateEditorial({ title: event.target.value })}
                />
              </label>
              <label>
                <span>Subtítulo</span>
                <input
                  value={editorial.subtitle}
                  maxLength={SOCIAL_TEXT_LIMITS.subtitle}
                  onChange={(event) => updateEditorial({ subtitle: event.target.value })}
                />
              </label>
              <label>
                <span>Texto editorial</span>
                <textarea
                  value={editorial.note}
                  maxLength={SOCIAL_TEXT_LIMITS.note}
                  onChange={(event) => updateEditorial({ note: event.target.value })}
                  placeholder="Una línea breve, opcional."
                />
              </label>
              <label>
                <span>Sitio o CTA</span>
                <input
                  value={editorial.cta}
                  maxLength={SOCIAL_TEXT_LIMITS.cta}
                  onChange={(event) => updateEditorial({ cta: event.target.value })}
                />
              </label>
            </fieldset>
          )}

          {piece?.requiresHumanSelection && (
            <fieldset disabled={!canSelect}>
              <legend>
                <Users size={15} aria-hidden="true" /> Selección manual
              </legend>
              <p className={styles.curationCopy}>
                Estas piezas las decide una persona. Arma2 no elige jugadores ni
                redacta textos automáticamente.
              </p>
              <div className={styles.candidateList}>
                {candidates.slice(0, 60).map((candidate) => {
                  const id = candidate.rosterPlayerId || candidate.participantId;
                  const checked = editorial.selection.includes(id);
                  return (
                    <div key={id} className={`${styles.candidateCard} ${checked ? styles.candidateChecked : ''}`}>
                      <label>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelection(id)}
                        />
                        <span>
                          <strong>{candidate.name || candidate.teamName}</strong>
                          <small>
                            {candidate.goals !== undefined
                              ? `${candidate.goals} G · ${candidate.assists ?? 0} A`
                              : `${candidate.points ?? 0} pts`}
                          </small>
                        </span>
                      </label>
                      {pieceId === 'best_eleven' && checked && (
                        <select
                          aria-label={`Línea de ${candidate.name || candidate.teamName}`}
                          value={editorial.selectedLines?.[id] || fallbackSocialPlayerLine(candidate)}
                          onChange={(event) => updateEditorial({
                            selectedLines: { ...editorial.selectedLines, [id]: event.target.value },
                          })}
                        >
                          {SOCIAL_PLAYER_LINES.map((line) => (
                            <option key={line} value={line}>{SOCIAL_PLAYER_LINE_LABELS[line]}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}

          {pieceId === 'mvp' && (
            <fieldset className={styles.photoEditor} disabled={!canSelect}>
              <legend><ImageIcon size={15} aria-hidden="true" /> Foto de la figura</legend>
              <input
                ref={photoFileInputRef}
                className={styles.srOnly}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Elegir foto de la figura"
                onChange={chooseLocalPhoto}
              />
              <button type="button" onClick={() => photoFileInputRef.current?.click()}>
                <Upload size={16} aria-hidden="true" />
                {hasFigurePhoto ? 'Cambiar foto' : 'Elegir o subir foto'}
              </button>
              {localPhoto?.name && <small className={styles.photoName}>{localPhoto.name}</small>}
              {hasFigurePhoto && (
                <>
                  <label className={styles.zoomControl}>
                    <span><ZoomIn size={15} aria-hidden="true" /> Zoom</span>
                    <input
                      type="range"
                      min="1"
                      max="3"
                      step="0.05"
                      value={editorial.figuraZoom}
                      onChange={(event) => updateEditorial({ figuraZoom: Number(event.target.value) })}
                    />
                    <output>{editorial.figuraZoom.toFixed(2)}×</output>
                  </label>
                  <button type="button" className={styles.resetCrop} onClick={resetPhotoCrop}>
                    <RotateCcw size={15} aria-hidden="true" /> Restablecer encuadre
                  </button>
                  <p className={styles.curationCopy}>Arrastrá directamente sobre la vista previa para recentrar.</p>
                </>
              )}
            </fieldset>
          )}
        </section>

        <section className={styles.previewPanel} aria-label="Vista previa">
          <header>
            <span>
              <strong>{piece?.label}</strong>
              <small>{format.width} × {format.height}</small>
            </span>
            <button type="button" onClick={loadSnapshot} aria-label="Actualizar datos oficiales">
              <RefreshCw size={16} aria-hidden="true" /> Actualizar
            </button>
          </header>

          <div
            className={`${styles.previewStage} ${hasFigurePhoto ? styles.previewStageDraggable : ''}`}
            style={{
              width: PREVIEW_WIDTH,
              maxWidth: '100%',
              aspectRatio: `${format.width} / ${format.height}`,
            }}
            onPointerDown={startPhotoDrag}
            onPointerMove={movePhotoDrag}
            onPointerUp={stopPhotoDrag}
            onPointerCancel={stopPhotoDrag}
            onClick={hasFigurePhoto ? claimFiguraDragPointer : undefined}
          >
            <div ref={canvasHostRef} className={styles.previewHost} />
            {['loading', 'rendering'].includes(renderState.status) && (
              <span className={styles.previewOverlay} role="status">
                <Loader2 size={22} aria-hidden="true" /> Generando…
              </span>
            )}
            {!['loading', 'rendering'].includes(renderState.status) && renderState.error && (
              <span className={styles.previewOverlay} role="status">
                <AlertTriangle size={22} aria-hidden="true" /> {renderState.error}
              </span>
            )}
          </div>

          {snapshotError && (
            <p className={styles.previewError} role="status">{snapshotError}</p>
          )}
          {curationGap && !snapshotError && (
            <p className={styles.previewHint} role="status">{curationGap}</p>
          )}
          {snapshot?.source?.standingsRevisionNumber && (
            <p className={styles.provenance}>
              Datos oficiales · revisión {snapshot.source.standingsRevisionNumber}
            </p>
          )}
          {standingsPagination.enabled && (
            <nav className={styles.pagination} aria-label="Páginas de la tabla de posiciones">
              <button
                type="button"
                disabled={standingsPagination.page === 1 || busy !== ''}
                onClick={() => updateEditorial({ page: standingsPagination.page - 1 })}
              >
                Anterior
              </button>
              <span>Página {standingsPagination.page} de {standingsPagination.pageCount}</span>
              <button
                type="button"
                disabled={standingsPagination.page === standingsPagination.pageCount || busy !== ''}
                onClick={() => updateEditorial({ page: standingsPagination.page + 1 })}
              >
                Siguiente
              </button>
            </nav>
          )}

          <footer className={styles.exportActions}>
            <button
              type="button"
              disabled={!canExport || !catalogAccess.exportable || busy !== '' || renderState.status !== 'ready'}
              onClick={() => runExport('download')}
            >
              <Download size={17} aria-hidden="true" /> Descargar PNG
            </button>
            <button
              type="button"
              className={styles.secondaryAction}
              disabled={!canExport || !catalogAccess.exportable || busy !== '' || renderState.status !== 'ready'}
              onClick={() => runExport('share')}
            >
              <Share2 size={17} aria-hidden="true" /> Compartir
            </button>
          </footer>
          {!canExport && (
            <p className={styles.previewHint}>
              Tu rol no puede exportar piezas. Pedí el permiso a un administrador.
            </p>
          )}
          {canExport && !catalogAccess.exportable && (
            <p className={styles.previewHint}>Preview disponible · exportación Premium bloqueada.</p>
          )}
        </section>
      </div>
    </div>
  );
}
