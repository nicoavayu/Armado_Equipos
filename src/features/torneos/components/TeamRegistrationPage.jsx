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
import { getRoleLabel, hasCapability, TOURNAMENT_CAPABILITIES } from '../domain/capabilities';
import {
  getRosterProgress,
  ROSTER_POSITIONS,
  TEAM_ENTRY_STATUS_LABELS,
} from '../domain/teamRegistration';
import PlayerAutocomplete from './PlayerAutocomplete';
import { importantNameProps } from './importantNames';
import { getStatusLabel } from './presentationLabels';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import TorneosSelect from './TorneosSelect';
import styles from './TeamRegistration.module.css';

function PlayerRow({ player, editable, onUpdate, onRemove }) {
  return (
    <article className={styles.playerCard}>
      <span className={styles.avatar}>
        {player.avatarUrl ? <img src={player.avatarUrl} alt="" /> : player.displayName.slice(0, 2)}
      </span>
      <div className={styles.playerIdentity}>
        <strong {...importantNameProps(player.displayName, 'player')}>{player.displayName}</strong>
        <small>{player.arma2UserId ? 'Cuenta Arma2 vinculada' : 'Jugador sin cuenta'}</small>
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
        <TorneosSelect
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
        </TorneosSelect>
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
  const [teamForm, setTeamForm] = useState({ name: '', shortName: '', primaryColor: '', secondaryColor: '' });
  const [review, setReview] = useState({ decision: 'changes_requested', reason: '' });
  const [busy, setBusy] = useState('');
  const base = `/torneos/organizacion/${organization.id}/equipos/${teamEntryId}`;

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
  const canReview = hasCapability(organization, TOURNAMENT_CAPABILITIES.TEAM_ENTRIES_REVIEW);

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
      <Link className={styles.backLink} to={`/torneos/organizacion/${organization.id}/equipos`}>
        <ArrowLeft size={17} /> Equipos
      </Link>
      <header className={styles.detailHero}>
        <span
          className={styles.heroMark}
          style={{ '--team-primary': teamForm.primaryColor, '--team-secondary': teamForm.secondaryColor }}
        >
          {data.entry.name.slice(0, 2).toUpperCase()}
        </span>
        <div>
          <span className={styles.kicker}><span {...importantNameProps(data.tournament.name, 'compact')}>{data.tournament.name}</span> · <span {...importantNameProps(data.category.name, 'compact')}>{data.category.name}</span></span>
          <h1 {...importantNameProps(data.entry.name, 'hero')}>{data.entry.name}</h1>
          <p>{data.entry.linked ? 'Equipo Arma2 vinculado' : 'Equipo provisional'} · versión {data.roster.version}</p>
        </div>
        <span className={styles.statusPill} data-status={data.entry.status}>
          {TEAM_ENTRY_STATUS_LABELS[data.entry.status]}
        </span>
      </header>

      <nav
        className={styles.detailTabs}
        aria-label="Secciones de la inscripción"
        data-allow-horizontal-scroll="true"
      >
        <Link aria-current={initialTab === 'inscripcion' ? 'page' : undefined} to={`${base}/inscripcion`}>Inscripción</Link>
        <Link aria-current={initialTab === 'plantel' ? 'page' : undefined} to={`${base}/plantel`}>Plantel <span>{players.length}</span></Link>
        {canReview && <Link aria-current={initialTab === 'revision' ? 'page' : undefined} to={`${base}/revision`}>Revisión</Link>}
      </nav>

      {state.notice && <div className={styles.successBanner} role="status"><CheckCircle2 size={17} />{state.notice}</div>}
      {state.error && <div className={styles.errorBanner} role="alert"><AlertCircle size={17} />{state.error}</div>}

      {initialTab === 'inscripcion' && (
        <div className={styles.detailGrid}>
          <section className={styles.formSection}>
            <div className={styles.sectionHeading}><span>01</span><div><h2>Datos del equipo</h2><p>Identidad guardada para esta competencia.</p></div></div>
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
          <aside className={styles.sidePanel}>
            <Users size={22} />
            <h2>Responsables</h2>
            {data.managers.map((manager) => (
              <div key={manager.id}><strong {...importantNameProps(manager.displayName, 'player')}>{manager.displayName}</strong><span>{getRoleLabel(manager.role)} · {getStatusLabel(manager.status)}</span></div>
            ))}
            {!data.managers.length && <p>No hay un responsable asignado.</p>}
          </aside>
        </div>
      )}

      {initialTab === 'plantel' && (
        <div className={styles.rosterLayout}>
          <section>
            <div className={styles.progressPanel} data-complete={progress.complete}>
              <div>
                {progress.complete ? <CheckCircle2 size={24} /> : <ClipboardCheck size={24} />}
                <span><strong>{progress.count}/{progress.minimum}</strong><small>jugadores mínimos</small></span>
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
            <div className={styles.playerList}>
              {players.map((player) => (
                <PlayerRow
                  key={player.id}
                  player={player}
                  editable={editable}
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
              <div><dt>Mínimo</dt><dd>{data.settings.minimumPlayers}</dd></div>
              <div><dt>Máximo</dt><dd>{data.settings.maximumPlayers}</dd></div>
              <div><dt>Arqueros</dt><dd>{data.settings.minimumGoalkeepers}</dd></div>
              <div><dt>Dorsal</dt><dd>{data.settings.shirtNumberRequired ? 'Obligatorio' : 'Opcional'}</dd></div>
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
