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
  Palette,
  RefreshCw,
  Share2,
  Sparkles,
  Users,
} from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useTorneosCompetition } from '../context/TorneosCompetitionContext';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import {
  SOCIAL_ACCENTS,
  SOCIAL_FORMATS,
  SOCIAL_PIECES,
  SOCIAL_TEXT_LIMITS,
  createEditorialState,
  describeCurationGap,
  findSocialPiece,
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
import SocialResultsThemePicker, {
  isSocialResultThemeAllowed,
} from './SocialResultsThemePicker';
import styles from './SocialStudioPage.module.css';

const PREVIEW_WIDTH = 300;
// Exact, byte-preserved copy of the approved Social Studio lockup. The source
// artwork includes meaningful transparent space, so layouts contain the full
// bitmap instead of cropping or reconstructing it from separate marks.
const OFFICIAL_BRAND_ASSETS = Object.freeze({
  lockup: `${process.env.PUBLIC_URL || ''}/assets/social-studio/Logo%20Arma2_torneo.png`,
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
  const requestRef = useRef(0);
  const [context, setContext] = useState({ status: 'loading', data: null, error: '' });
  const [scope, setScope] = useState({
    tournamentId: '', categoryId: '', phaseId: '', roundId: '',
  });
  const [pieceId, setPieceId] = useState('standings');
  const [snapshot, setSnapshot] = useState(null);
  const [snapshotError, setSnapshotError] = useState('');
  const [editorial, setEditorial] = useState(() => createEditorialState(null));
  const [themeId, setThemeId] = useState('classic');
  const [renderState, setRenderState] = useState({ status: 'idle', error: '' });
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const capabilities = context.data?.capabilities || [];
  const canCreate = hasSocialStudioRoleCapability(capabilities, 'social.create');
  const canExport = hasSocialStudioRoleCapability(capabilities, 'social.export');
  const canSelect = hasSocialStudioRoleCapability(capabilities, 'social.manual_selection')
    || canCreate;
  const canEditText = hasSocialStudioRoleCapability(capabilities, 'social.editorial_text')
    || canCreate;
  const canToggleBrand = hasSocialStudioRoleCapability(capabilities, 'social.brand_toggle');

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
  const category = tournament?.categories?.find((entry) => entry.id === scope.categoryId) || null;
  const phase = category?.phases?.find((entry) => entry.id === scope.phaseId) || null;
  const rounds = phase?.rounds || [];
  const piece = findSocialPiece(pieceId);
  const effectiveThemeId = isSocialResultThemeAllowed(
    themeId,
    competition.planState,
    scope.tournamentId,
  ) ? themeId : 'classic';

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
    if (!competition.activeTournament && active.seasonId) {
      competition.selectContext(active.seasonId, active.id).catch(() => {});
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
    () => (pieceId === 'round_results'
      ? resolveSocialTheme(effectiveThemeId)
      : resolveSocialTheme('classic')),
    [effectiveThemeId, pieceId],
  );
  const branding = useMemo(() => ({
    tournamentName: snapshot?.competition?.tournamentName || tournament?.name || '',
    tournamentLogo: null,
    primaryColor: null,
    secondaryColor: null,
  }), [snapshot, tournament]);

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
      brandAssetUrls: OFFICIAL_BRAND_ASSETS,
      signal: controller.signal,
      onStatus: (status) => {
        if (!cancelled) setRenderState({ status, error: '', renderKey: '' });
      },
    }).then((prepared) => {
      if (cancelled) {
        releasePreparedSocialRender(prepared);
        return;
      }
      const { canvas } = prepared;
      const host = canvasHostRef.current;
      if (!host) {
        releasePreparedSocialRender(prepared);
        return;
      }
      canvas.setAttribute('role', 'img');
      canvas.setAttribute(
        'aria-label',
        `Vista previa de ${piece?.label || 'la pieza'} en ${SOCIAL_FORMATS[editorial.format].label}, theme ${selectedTheme.label}`,
      );
      canvas.className = styles.previewCanvas;
      host.replaceChildren(canvas);
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
  }, [snapshot, editorial, organizationId, service, piece, selectedTheme, branding]);

  useEffect(() => () => {
    releasePreparedSocialRender(preparedRenderRef.current);
    preparedRenderRef.current = null;
  }, []);

  const updateEditorial = (patch) => setEditorial((current) => ({ ...current, ...patch }));

  const toggleSelection = (id) => {
    if (!canSelect) return;
    setEditorial((current) => {
      const selection = current.selection.includes(id)
        ? current.selection.filter((entry) => entry !== id)
        : [...current.selection, id].slice(0, selectionSizeForSnapshot(snapshot));
      return { ...current, selection };
    });
  };

  const runExport = async (mode) => {
    if (
      !canExport
      || !snapshot
      || busy
      || renderState.status !== 'ready'
      || !preparedRenderRef.current
    ) return;
    setBusy(mode);
    setNotice('');
    try {
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
        downloadSocialPiece({ blob: result.blob, fileName: result.fileName });
        setNotice(`Descargamos ${result.fileName}.`);
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
  const previewHeight = Math.round((PREVIEW_WIDTH * format.height) / format.width);

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p>Piezas listas para publicar · Datos oficiales</p>
          <h1>Estudio Social</h1>
          <span>Generá placas con la identidad de Arma2 a partir de lo que ya está publicado.</span>
        </div>
        <div className={styles.heroMetrics}>
          <article><LayoutTemplate size={19} aria-hidden="true" /><span><strong>{SOCIAL_PIECES.length}</strong><small>plantillas</small></span></article>
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
                  if (next?.seasonId) {
                    competition.selectContext(next.seasonId, next.id).catch(() => {});
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
              {SOCIAL_PIECES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="radio"
                  aria-checked={pieceId === entry.id}
                  className={pieceId === entry.id ? styles.pieceActive : ''}
                  onClick={() => setPieceId(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Formato y estilo</legend>
            <div className={styles.chipRow} role="radiogroup" aria-label="Formato">
              {Object.values(SOCIAL_FORMATS)
                .filter((entry) => pieceId !== 'round_results' || entry.id === 'portrait')
                .map((entry) => (
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
            {pieceId === 'round_results' && (
              <SocialResultsThemePicker
                organizationId={organizationId}
                tournamentId={scope.tournamentId}
                planState={competition.planState}
                themeId={themeId}
                displayThemeId={effectiveThemeId}
                onSelect={setThemeId}
                onFallback={() => {
                  setNotice('Volvimos a Classic porque el torneo seleccionado es Free.');
                }}
              />
            )}
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
            {canToggleBrand && pieceId !== 'round_results' && (
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={editorial.showArma2Logo}
                  onChange={(event) => updateEditorial({ showArma2Logo: event.target.checked })}
                />
                <span>Mostrar el logo de Arma2</span>
              </label>
            )}
          </fieldset>

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
                    <label key={id} className={checked ? styles.candidateChecked : ''}>
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
                  );
                })}
              </div>
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
            className={styles.previewStage}
            style={{ width: PREVIEW_WIDTH, height: previewHeight }}
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

          <footer className={styles.exportActions}>
            <button
              type="button"
              disabled={!canExport || busy !== '' || renderState.status !== 'ready'}
              onClick={() => runExport('download')}
            >
              <Download size={17} aria-hidden="true" /> Descargar PNG
            </button>
            <button
              type="button"
              className={styles.secondaryAction}
              disabled={!canExport || busy !== '' || renderState.status !== 'ready'}
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
        </section>
      </div>
    </div>
  );
}
