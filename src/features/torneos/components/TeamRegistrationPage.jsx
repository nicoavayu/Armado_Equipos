import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  History,
  Loader2,
  Lock,
  MessageSquareWarning,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { hasCapability, TOURNAMENT_CAPABILITIES } from '../domain/capabilities';
import { getRoleLabel } from '../domain/rolePresentation';
import {
  getRosterProgress,
  ROSTER_POSITIONS,
  TEAM_ENTRY_STATUS_LABELS,
} from '../domain/teamRegistration';
import { canonicalRoutes } from '../routing/canonicalRoutes';
import PlayerAutocomplete from './PlayerAutocomplete';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import styles from './TeamRegistration.module.css';
import BrandingAssetField from './BrandingAssetField';
import BrandingImage from './BrandingImage';
import PlayerPortraitActions from './PlayerPortraitActions';
import RosterPlayerPortrait from './RosterPlayerPortrait';
import TeamPhotoPanel, { TeamPhotoBanner } from './TeamPhotoPanel';
import { loadRosterPortraits } from '../api/tournamentPlayerPortraitService';
import { loadTeamPhotoState } from '../api/tournamentTeamPhotoService';

const requirementValue = (value) => (
  value === null || value === undefined ? 'Sin definir' : value
);

// Los tres valores de `tournament_team_managers.status`. `invited` no existe en
// la base: el estado real de una invitación sin aceptar es `pending`, y sin
// etiqueta el panel de Responsables imprimía la clave tal cual.
const MANAGER_STATUS_LABELS = Object.freeze({
  pending: 'Invitación pendiente',
  active: 'Activo',
  revoked: 'Revocado',
});

function PlayerRow({
  player, editable, portrait, onUpdate, onRemove, organizationId, onPortraitChanged,
}) {
  return (
    <article className={styles.playerCard}>
      <RosterPlayerPortrait name={player.displayName} portrait={portrait?.portrait || null} />
      <div className={styles.playerIdentity}>
        <strong>{player.displayName}</strong>
        <small>{player.arma2UserId ? 'Cuenta Arma2 vinculada' : 'Jugador sin cuenta'}</small>
        <PlayerPortraitActions
          organizationId={organizationId}
          rosterPlayerId={player.id}
          playerName={player.displayName}
          portrait={portrait?.portrait || null}
          canManage={portrait?.canManage === true}
          onChanged={onPortraitChanged}
        />
      </div>
      <label>
        <span>Dorsal</span>
        <input
          type="number"
          min="0"
          max="99"
          value={player.shirtNumber ?? ''}
          disabled={!editable}
          onChange={(event) => onUpdate(player, { shirtNumber: event.target.value })}
          aria-label={`Dorsal de ${player.displayName}`}
        />
      </label>
      <label>
        <span>Posición</span>
        <select
          value={player.primaryPosition || ''}
          disabled={!editable}
          onChange={(event) => onUpdate(player, {
            primaryPosition: event.target.value,
            isGoalkeeper: event.target.value === 'ARQ',
          })}
          aria-label={`Posición de ${player.displayName}`}
        >
          <option value="">Sin definir</option>
          {ROSTER_POSITIONS.map((position) => (
            <option key={position.value} value={position.value}>{position.label}</option>
          ))}
        </select>
      </label>
      <span className={styles.eligibility} data-status={player.eligibilityStatus}>
        {player.eligibilityStatus === 'eligible' ? 'Habilitado' : 'Pendiente'}
      </span>
      {editable && (
        <button type="button" className={styles.iconButton} onClick={() => onRemove(player)}>
          <Trash2 size={17} />
          <span className={styles.srOnly}>Quitar {player.displayName}</span>
        </button>
      )}
    </article>
  );
}

export default function TeamRegistrationPage({ initialTab = 'inscripcion' }) {
  const { organization } = useOutletContext();
  const { teamEntryId } = useParams();
  const { service } = useTorneosWorkspace();
  const requestRef = useRef(0);
  const [state, setState] = useState({ status: 'loading', data: null, error: '', notice: '' });
  const [teamForm, setTeamForm] = useState({ name: '', shortName: '', primaryColor: '', secondaryColor: '', shieldPath: null });
  const [review, setReview] = useState({ decision: 'changes_requested', reason: '' });
  const [busy, setBusy] = useState('');
  const [portraits, setPortraits] = useState(
    () => ({ status: 'loading', byRosterPlayerId: new Map() }),
  );
  const portraitsRequestRef = useRef(0);
  const [teamPhoto, setTeamPhoto] = useState(() => ({ status: 'loading', state: null }));
  const teamPhotoRequestRef = useRef(0);
  const entryTab = {
    inscripcion: canonicalRoutes.organizationTeamEntryRegistration(organization.id, teamEntryId),
    visualIdentity: canonicalRoutes.organizationTeamEntryVisualIdentity(
      organization.id,
      teamEntryId,
    ),
    plantel: canonicalRoutes.organizationTeamEntryRoster(organization.id, teamEntryId),
    revision: canonicalRoutes.organizationTeamEntryReview(organization.id, teamEntryId),
  };

  const load = useCallback(async (notice = '') => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState((current) => ({ ...current, status: 'loading', data: null, error: '' }));
    try {
      const data = await service.loadTeamRegistration(organization.id, teamEntryId);
      if (requestRef.current !== requestId) return;
      setTeamForm({
        name: data.entry.name,
        shortName: data.entry.shortName || '',
        primaryColor: data.entry.primaryColor || '#4F7CFF',
        secondaryColor: data.entry.secondaryColor || '#111827',
        shieldPath: data.entry.shieldPath || null,
      });
      setState({ status: 'ready', data, error: '', notice });
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setState({ status: 'error', data: null, error: error.message, notice: '' });
    }
  }, [organization.id, service, teamEntryId]);

  useEffect(() => {
    load();
    return () => { requestRef.current += 1; };
  }, [load]);

  // Los retratos viven fuera del contexto deportivo de la inscripción: una
  // lectura aparte, que puede fallar sin llevarse puesto el plantel.
  //
  // Fallar no es lo mismo que no tener fotos. Vaciar el mapa ante un error
  // convertía un backend caído en «ningún jugador tiene retrato», que es una
  // afirmación falsa y silenciosa. La colección declara su estado —loading,
  // ready, error— y ante el error conserva lo último que sí se leyó.
  const loadPortraits = useCallback(async () => {
    const requestId = portraitsRequestRef.current + 1;
    portraitsRequestRef.current = requestId;
    setPortraits((current) => ({ ...current, status: 'loading' }));
    try {
      const byRosterPlayerId = await loadRosterPortraits({
        organizationId: organization.id, teamEntryId,
      });
      if (portraitsRequestRef.current !== requestId) return;
      setPortraits({ status: 'ready', byRosterPlayerId });
    } catch {
      // La causa técnica queda fuera de la vista: al usuario le alcanza con
      // saber que las fotos no cargaron y poder reintentar.
      if (portraitsRequestRef.current !== requestId) return;
      setPortraits((current) => ({ ...current, status: 'error' }));
    }
  }, [organization.id, teamEntryId]);

  useEffect(() => {
    loadPortraits();
  }, [loadPortraits]);

  // La foto del equipo se lee aparte por el mismo motivo que los retratos: es
  // material multimedia que puede fallar sin llevarse puesta la inscripción, y
  // fallar no es lo mismo que no tener foto. Ante el error conserva lo último
  // que sí se leyó y ofrece reintentar.
  const loadTeamPhoto = useCallback(async () => {
    const requestId = teamPhotoRequestRef.current + 1;
    teamPhotoRequestRef.current = requestId;
    setTeamPhoto((current) => ({ ...current, status: 'loading' }));
    try {
      const photoState = await loadTeamPhotoState({
        organizationId: organization.id, teamEntryId,
      });
      if (teamPhotoRequestRef.current !== requestId) return;
      setTeamPhoto({ status: 'ready', state: photoState });
    } catch {
      if (teamPhotoRequestRef.current !== requestId) return;
      setTeamPhoto((current) => ({ ...current, status: 'error' }));
    }
  }, [organization.id, teamEntryId]);

  useEffect(() => {
    loadTeamPhoto();
  }, [loadTeamPhoto]);

  const data = state.data;
  const players = data?.roster?.players || [];
  const progress = useMemo(
    () => getRosterProgress(players, data?.settings || {}),
    [data?.settings, players],
  );
  const relationalEditor = data?.managers?.some((manager) => (
    manager.isCurrentUser && ['captain', 'delegate'].includes(manager.role)
  ));
  const organizationalEditor = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.TEAM_ENTRIES_UPDATE,
  );
  const editable = Boolean(
    (relationalEditor || organizationalEditor)
    && ['draft', 'invited', 'in_progress', 'changes_requested'].includes(data?.entry?.status)
    && ['draft', 'changes_requested'].includes(data?.roster?.status),
  );
  // El permiso visual no se recalcula acá. Viene del mismo predicado que
  // después autoriza la escritura, así que la política de autogestión del
  // torneo no puede desincronizarse de lo que muestran los controles.
  const canEditBranding = data?.visualAssets?.canManageShield === true;
  const canReview = hasCapability(organization, TOURNAMENT_CAPABILITIES.TEAM_ENTRIES_REVIEW);
  // El alcance también lo decide el servidor. Con `visual` la inscripción llega
  // sin responsables, sin revisiones y sin auditoría: no son datos del jugador.
  // La pantalla tiene que dejar de mostrar esos bloques, no pintarlos vacíos —
  // un panel de Responsables en blanco no dice «no te lo muestro», dice «no hay».
  const visualOnlyViewer = data?.viewer?.scope === 'visual';

  const run = async (key, action, notice) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
      await load(notice);
    } catch (error) {
      setState((current) => ({ ...current, error: error.message }));
    } finally {
      setBusy('');
    }
  };

  if (state.status === 'loading') return <WorkspaceLoading label="Cargando inscripción…" />;
  if (state.status === 'error' && !data) {
    return <WorkspaceError message={state.error} onRetry={() => load()} />;
  }

  const addPlayer = (player) => run('add-player', () => service.addRosterPlayer({
    organizationId: organization.id,
    teamEntryId,
    rosterId: data.roster.id,
    arma2UserId: player.userId,
    displayName: player.displayName,
    avatarUrl: player.avatarUrl,
    primaryPosition: player.positions?.[0] || null,
    isGoalkeeper: player.positions?.[0] === 'ARQ',
  }), 'Jugador agregado.');
  const createProvisional = (displayName) => run('add-player', async () => {
    const provisional = await service.createProvisionalPlayer({
      organizationId: organization.id,
      teamEntryId,
      displayName,
    });
    await service.addRosterPlayer({
      organizationId: organization.id,
      teamEntryId,
      rosterId: data.roster.id,
      provisionalPlayerId: provisional.id,
      displayName: provisional.displayName,
    });
  }, 'Jugador sin cuenta agregado.');
  const updatePlayer = (player, patch) => run(`player-${player.id}`, () => (
    service.updateRosterPlayer({
      organizationId: organization.id,
      teamEntryId,
      rosterPlayerId: player.id,
      shirtNumber: patch.shirtNumber ?? player.shirtNumber,
      primaryPosition: patch.primaryPosition ?? player.primaryPosition,
      secondaryPosition: player.secondaryPosition,
      isGoalkeeper: patch.isGoalkeeper ?? player.isGoalkeeper,
    })
  ), 'Plantel actualizado.');

  return (
    <div className={styles.detailPage}>
      {/*
        * El listado de equipos es del torneo y vive detrás del guard del
        * torneo. Quien llegó por acceso relacional —capitán o delegado que no
        * es miembro de la organización— no lo puede abrir, así que su vuelta
        * es a sus propios torneos y no a una pantalla que lo rebotaría.
        */}
      <Link
        className={styles.backLink}
        to={organization.relationalAccess
          ? '/torneos/mis-torneos'
          : canonicalRoutes.tournamentTeams(organization.id, data.entry.tournamentId, {
            categoryId: data.category?.id,
          })}
      >
        <ArrowLeft size={17} /> {organization.relationalAccess ? 'Mis torneos' : 'Equipos'}
      </Link>
      <header className={styles.detailHero}>
        <BrandingImage
          kind="team"
          path={teamForm.shieldPath}
          name={data.entry.name}
          className={styles.heroMark}
          imageClassName={styles.brandingContain}
        />
        <div>
          <span className={styles.kicker}>{data.tournament.name} · {data.category.name}</span>
          <h1>{data.entry.name}</h1>
          <p>{data.entry.linked ? 'Equipo Arma2 vinculado' : 'Equipo provisional'} · versión {data.roster.version}</p>
        </div>
        <span className={styles.statusPill} data-status={data.entry.status}>
          {TEAM_ENTRY_STATUS_LABELS[data.entry.status]}
        </span>
      </header>

      <nav className={styles.detailTabs} aria-label="Secciones de la inscripción">
        <Link aria-current={initialTab === 'inscripcion' ? 'page' : undefined} to={entryTab.inscripcion}>Información</Link>
        <Link
          aria-current={initialTab === 'identidad-visual' ? 'page' : undefined}
          to={entryTab.visualIdentity}
        >
          Identidad visual
        </Link>
        <Link aria-current={initialTab === 'plantel' ? 'page' : undefined} to={entryTab.plantel}>Plantel <span>{players.length}</span></Link>
        {canReview && <Link aria-current={initialTab === 'revision' ? 'page' : undefined} to={entryTab.revision}>Revisión</Link>}
      </nav>

      {state.notice && <div className={styles.successBanner} role="status"><CheckCircle2 size={17} />{state.notice}</div>}
      {state.error && <div className={styles.errorBanner} role="alert"><AlertCircle size={17} />{state.error}</div>}

      {initialTab === 'inscripcion' && (
        <div className={`${styles.detailGrid}${visualOnlyViewer ? ` ${styles.detailGridSolo}` : ''}`}>
          <section className={styles.formSection}>
            <div className={styles.sectionHeading}><span>01</span><div><h2>Datos del equipo</h2><p>Snapshot de esta competencia.</p></div></div>
            <BrandingAssetField
              organizationId={organization.id}
              kind="team"
              entityId={teamEntryId}
              path={teamForm.shieldPath}
              name={teamForm.name || data.entry.name}
              canEdit={canEditBranding}
              onChanged={(result) => {
                setTeamForm((current) => ({ ...current, shieldPath: result.path || null }));
                return load('Escudo actualizado.');
              }}
            />
            {canEditBranding && !editable && (
              <p className={styles.brandingEditNotice}>
                La inscripción deportiva está aprobada. Sólo estás editando la identidad visual.
              </p>
            )}
            {/*
              * Escudo y foto, uno al lado del otro: son los dos recursos
              * visuales del equipo y son cosas distintas. El escudo es la marca
              * —pública, chiquita, sin moderación—; la foto es una fotografía
              * del plantel —privada, grande, y la publica la organización—.
              */}
            <TeamPhotoPanel
              organizationId={organization.id}
              teamEntryId={teamEntryId}
              state={teamPhoto.state}
              status={teamPhoto.status}
              teamName={teamForm.name || data.entry.name}
              shieldPath={teamForm.shieldPath}
              onChanged={loadTeamPhoto}
              onRetry={loadTeamPhoto}
            />
            <div className={styles.twoColumns}>
              <label>Nombre<input value={teamForm.name} disabled={!editable} onChange={(event) => setTeamForm({ ...teamForm, name: event.target.value })} /></label>
              <label>Nombre corto<input value={teamForm.shortName} disabled={!editable} onChange={(event) => setTeamForm({ ...teamForm, shortName: event.target.value })} /></label>
            </div>
            <div className={styles.colorFields}>
              <label>Principal<input type="color" value={teamForm.primaryColor} disabled={!editable} onChange={(event) => setTeamForm({ ...teamForm, primaryColor: event.target.value })} /></label>
              <label>Secundario<input type="color" value={teamForm.secondaryColor} disabled={!editable} onChange={(event) => setTeamForm({ ...teamForm, secondaryColor: event.target.value })} /></label>
            </div>
            {editable && (
              <button className={styles.secondaryButton} type="button" onClick={() => run(
                'save-team',
                () => service.updateTeamEntry({
                  organizationId: organization.id,
                  teamEntryId,
                  patch: teamForm,
                }),
                'Datos del equipo guardados.',
              )}>
                <Save size={17} /> Guardar datos
              </button>
            )}
          </section>
          {!visualOnlyViewer && (
          <aside className={styles.sidePanel}>
            <Users size={22} />
            <h2>Responsables</h2>
            {data.managers.map((manager) => (
              <div key={manager.id}>
                <strong>{manager.displayName}</strong>
                <span>
                  {getRoleLabel(manager.role, 'Responsable')}
                  {' · '}
                  {MANAGER_STATUS_LABELS[manager.status] || 'Sin estado'}
                </span>
              </div>
            ))}
            {!data.managers.length && <p>No hay un responsable asignado.</p>}
          </aside>
          )}
        </div>
      )}

      {initialTab === 'identidad-visual' && (
        <section className={styles.formSection} aria-labelledby="team-visual-identity-title">
          <div className={styles.sectionHeading}>
            <span>02</span>
            <div>
              <h2 id="team-visual-identity-title">Identidad visual</h2>
              <p>Escudo e imagen del equipo para esta competencia.</p>
            </div>
          </div>
          <BrandingAssetField
            organizationId={organization.id}
            kind="team"
            entityId={teamEntryId}
            path={teamForm.shieldPath}
            name={teamForm.name || data.entry.name}
            canEdit={canEditBranding}
            onChanged={(result) => {
              setTeamForm((current) => ({ ...current, shieldPath: result.path || null }));
              return load('Escudo actualizado.');
            }}
          />
          {canEditBranding && !editable && (
            <p className={styles.brandingEditNotice}>
              La inscripción deportiva está aprobada. Sólo estás editando la identidad visual.
            </p>
          )}
          <TeamPhotoPanel
            organizationId={organization.id}
            teamEntryId={teamEntryId}
            state={teamPhoto.state}
            status={teamPhoto.status}
            teamName={teamForm.name || data.entry.name}
            shieldPath={teamForm.shieldPath}
            onChanged={loadTeamPhoto}
            onRetry={loadTeamPhoto}
          />
        </section>
      )}

      {initialTab === 'plantel' && (
        <div className={styles.rosterLayout}>
          <section>
            {/* Consumo puro: si el equipo tiene foto aprobada, encabeza a su
                plantel. Sin foto no deja hueco ni pide nada. */}
            <TeamPhotoBanner
              state={teamPhoto.state}
              teamName={teamForm.name || data.entry.name}
            />
            <div className={styles.progressPanel} data-complete={progress.complete}>
              <div>
                {progress.complete ? <CheckCircle2 size={24} /> : <ClipboardCheck size={24} />}
                <span>
                  <strong>
                    {progress.configured
                      ? `${progress.count}/${progress.minimum}`
                      : progress.count}
                  </strong>
                  <small>
                    {progress.configured
                      ? 'jugadores mínimos'
                      : 'jugadores · mínimo sin definir'}
                  </small>
                </span>
              </div>
              <div className={styles.progressTrack}><span style={{ width: `${progress.percent}%` }} /></div>
              <ul>{progress.errors.map((error) => <li key={error}>{error}</li>)}</ul>
            </div>
            {editable && (
              <PlayerAutocomplete
                disabled={Boolean(busy)}
                onSearch={(query) => service.searchPlayers({
                  organizationId: organization.id,
                  tournamentId: data.entry.tournamentId,
                  teamEntryId,
                  query,
                })}
                onSelect={addPlayer}
                onCreateProvisional={createProvisional}
              />
            )}
            {portraits.status === 'error' && (
              <p className={styles.portraitNotice} role="status">
                <AlertCircle size={15} aria-hidden="true" />
                <span>No pudimos cargar las fotos</span>
                <button type="button" onClick={() => loadPortraits()}>Reintentar</button>
              </p>
            )}
            <div className={styles.playerList}>
              {players.map((player) => (
                <PlayerRow
                  key={player.id}
                  player={player}
                  editable={editable}
                  organizationId={organization.id}
                  portrait={portraits.byRosterPlayerId.get(player.id)}
                  onPortraitChanged={async (notice) => {
                    await loadPortraits();
                    setState((current) => ({ ...current, notice, error: '' }));
                  }}
                  onUpdate={updatePlayer}
                  onRemove={(target) => run(
                    `remove-${target.id}`,
                    () => service.removeRosterPlayer({
                      organizationId: organization.id,
                      teamEntryId,
                      rosterPlayerId: target.id,
                    }),
                    'Jugador quitado del plantel.',
                  )}
                />
              ))}
              {!players.length && <div className={styles.inlineEmpty}><UserPlus size={24} /><span><strong>Plantel vacío</strong><small>Buscá un jugador o crealo sin cuenta.</small></span></div>}
            </div>
          </section>
          <aside className={styles.requirementsPanel}>
            <Lock size={20} />
            <h2>Requisitos</h2>
            <dl>
              <div><dt>Mínimo</dt><dd>{requirementValue(data.settings?.minimumPlayers)}</dd></div>
              <div><dt>Máximo</dt><dd>{requirementValue(data.settings?.maximumPlayers)}</dd></div>
              <div><dt>Arqueros</dt><dd>{requirementValue(data.settings?.minimumGoalkeepers)}</dd></div>
              <div>
                <dt>Dorsal</dt>
                <dd>
                  {data.settings?.shirtNumberRequired == null
                    ? 'Sin definir'
                    : data.settings.shirtNumberRequired ? 'Obligatorio' : 'Opcional'}
                </dd>
              </div>
            </dl>
            {editable && (
              <button
                className={styles.primaryButton}
                type="button"
                disabled={!progress.complete || Boolean(busy)}
                onClick={() => run(
                  'submit',
                  () => service.submitTeamEntry({ organizationId: organization.id, teamEntryId }),
                  'Inscripción presentada para revisión.',
                )}
              >
                {busy === 'submit' ? <Loader2 className={styles.spin} size={18} /> : <Send size={18} />}
                Presentar plantel
              </button>
            )}
          </aside>
        </div>
      )}

      {initialTab === 'revision' && canReview && (
        <div className={styles.reviewLayout}>
          <section className={styles.reviewPanel}>
            <div className={styles.sectionHeading}><span>03</span><div><h2>Decisión del organizador</h2><p>El backend vuelve a validar el plantel antes de aprobar.</p></div></div>
            <div className={styles.decisionPicker}>
              <button type="button" aria-pressed={review.decision === 'changes_requested'} onClick={() => setReview({ ...review, decision: 'changes_requested' })}><MessageSquareWarning size={19} /> Solicitar cambios</button>
              <button type="button" aria-pressed={review.decision === 'approved'} onClick={() => setReview({ ...review, decision: 'approved' })}><ShieldCheck size={19} /> Aprobar</button>
              <button type="button" aria-pressed={review.decision === 'rejected'} onClick={() => setReview({ ...review, decision: 'rejected' })}><XCircle size={19} /> Rechazar</button>
            </div>
            <label>Motivo y observaciones<textarea value={review.reason} onChange={(event) => setReview({ ...review, reason: event.target.value })} rows="6" placeholder="Explicá qué se revisó y qué debe corregirse." /></label>
            <button
              className={styles.primaryButton}
              type="button"
              disabled={data.entry.status !== 'submitted' || review.reason.trim().length < 3 || Boolean(busy)}
              onClick={() => run(
                'review',
                () => service.reviewTeamEntry({
                  organizationId: organization.id,
                  teamEntryId,
                  decision: review.decision,
                  reason: review.reason,
                }),
                'Revisión registrada.',
              )}
            >
              <ClipboardCheck size={18} /> Confirmar decisión
            </button>
          </section>
          <aside className={styles.historyPanel}>
            <History size={20} />
            <h2>Historial</h2>
            {data.reviews.map((item) => (
              <article key={item.id}><strong>{TEAM_ENTRY_STATUS_LABELS[item.decision] || item.decision}</strong><p>{item.reason}</p><time>{new Date(item.createdAt).toLocaleString('es-AR')}</time></article>
            ))}
            {!data.reviews.length && <p>Sin revisiones anteriores.</p>}
          </aside>
        </div>
      )}
    </div>
  );
}
