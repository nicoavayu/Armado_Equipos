import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Medal,
  RefreshCw,
  Scale,
  ShieldAlert,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { Link, useOutletContext } from 'react-router-dom';
import { useTorneosCompetition } from '../context/TorneosCompetitionContext';
import { useTorneosFixture } from '../context/TorneosFixtureContext';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { hasCapability, TOURNAMENT_CAPABILITIES } from '../domain/capabilities';
import CompetitionSelector from './CompetitionSelector';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import styles from './CompetitionCenter.module.css';

const MODES = {
  table: ['Tabla', Trophy],
  statistics: ['Estadísticas', BarChart3],
  qualification: ['Clasificación', Medal],
  discipline: ['Disciplina', Scale],
};

function ContextFilters({
  fixture, phaseId, setPhaseId, groupId, setGroupId,
}) {
  const phases = fixture.phases.filter((phase) => (
    !fixture.versions.length
    || fixture.versions.some((version) => (
      version.id === phase.fixtureVersionId && version.status === 'published'
    ))
  ));
  const groups = fixture.groups.filter((group) => group.phaseId === phaseId);
  return (
    <section className={styles.contextBar} aria-label="Contexto competitivo">
      <CompetitionSelector compact />
      <label>
        <span>Categoría</span>
        <select
          value={fixture.categoryId || ''}
          onChange={(event) => fixture.setCategoryId(event.target.value)}
        >
          {fixture.categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Fase</span>
        <select value={phaseId || ''} onChange={(event) => setPhaseId(event.target.value)}>
          {phases.map((phase) => (
            <option key={phase.id} value={phase.id}>{phase.name}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Grupo</span>
        <select
          value={groupId || ''}
          onChange={(event) => setGroupId(event.target.value || null)}
        >
          <option value="">Tabla general</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>{group.name}</option>
          ))}
        </select>
      </label>
    </section>
  );
}

function CompetitionSubnav({ organizationId, mode }) {
  const base = `/torneos/organizacion/${organizationId}/competencia`;
  return (
    <nav className={styles.subnav} aria-label="Centro de competencia">
      {Object.entries(MODES).map(([key, [label, Icon]]) => (
        <Link
          key={key}
          to={`${base}/${key === 'table' ? 'tabla' : key === 'statistics' ? 'estadisticas' : key === 'qualification' ? 'clasificacion' : 'disciplina'}`}
          className={mode === key ? styles.activeTab : ''}
          aria-current={mode === key ? 'page' : undefined}
        >
          <Icon size={16} />
          {label}
        </Link>
      ))}
    </nav>
  );
}

function RevisionBadge({ revision }) {
  if (!revision) return <span className={styles.statusMuted}>Sin cálculo</span>;
  return (
    <span className={revision.status === 'published' ? styles.statusLive : styles.statusDraft}>
      {revision.status === 'published' ? 'Publicada' : 'Borrador'} · v{revision.number}
    </span>
  );
}

function StandingsTable({ rows }) {
  if (!rows.length) {
    return (
      <div className={styles.empty}>
        <Trophy size={28} />
        <h2>Todavía no hay tabla</h2>
        <p>Los partidos con acta oficial aparecerán después de un recálculo autorizado.</p>
      </div>
    );
  }
  return (
    <div className={styles.tableScroller}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Pos.</th><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th>
            <th>GF</th><th>GC</th><th>DG</th><th>Pts.</th><th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.participantId}>
              <td><strong className={styles.position}>{row.position}</strong></td>
              <td>
                <span className={styles.team}>
                  <span className={styles.teamMark}>{(row.shortName || row.teamName || '—').slice(0, 2)}</span>
                  <span>
                    <strong>{row.teamName}</strong>
                    <small>{row.pointsAdjustment ? `${row.pointsAdjustment > 0 ? '+' : ''}${row.pointsAdjustment} ajuste` : 'Sin ajustes'}</small>
                    <details className={styles.teamDetail}>
                      <summary>Ver detalle</summary>
                      <span>{row.won}G · {row.drawn}E · {row.lost}P · {row.goalsFor}:{row.goalsAgainst}</span>
                      <span>{row.classificationStatus === 'manual_review' ? 'Desempate manual pendiente' : 'Criterios aplicados y trazables'}</span>
                    </details>
                  </span>
                </span>
              </td>
              <td>{row.played}</td><td>{row.won}</td><td>{row.drawn}</td><td>{row.lost}</td>
              <td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td>{row.goalDifference}</td>
              <td><strong>{row.points}</strong></td>
              <td>
                {row.classificationStatus === 'manual_review'
                  ? <span className={styles.reviewFlag}><AlertTriangle size={14} /> Revisar empate</span>
                  : <span className={styles.resolvedFlag}><CheckCircle2 size={14} /> Resuelto</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatisticsPanel({ data }) {
  const leaders = data.players.slice(0, 8);
  if (!leaders.length) return <div className={styles.empty}><BarChart3 size={28} /><h2>Sin estadísticas oficiales</h2><p>No inferimos minutos ni apariciones cuando el acta no los acredita.</p></div>;
  return (
    <div className={styles.statsGrid}>
      <section className={styles.card}>
        <div className={styles.cardHeading}><span>Ranking individual</span><h2>Goleadores y asistencias</h2></div>
        <ol className={styles.leaderboard}>
          {leaders.map((player, index) => (
            <li key={player.rosterPlayerId} className={index < 3 ? styles.podium : ''}>
              <span className={styles.rank}>{String(index + 1).padStart(2, '0')}</span>
              <span><strong>{player.name}</strong><small>{player.appearances} presencias acreditadas</small></span>
              <span className={styles.statPair}><strong>{player.goals}</strong><small>goles</small></span>
              <span className={styles.statPair}><strong>{player.assists}</strong><small>asis.</small></span>
            </li>
          ))}
        </ol>
      </section>
      <section className={styles.card}>
        <div className={styles.cardHeading}><span>Producción colectiva</span><h2>Equipos</h2></div>
        <div className={styles.teamStats}>
          {data.teams.slice(0, 8).map((team) => (
            <article key={team.participantId}>
              <span className={styles.teamMark}>{(team.name || '—').slice(0, 2)}</span>
              <span><strong>{team.name}</strong><small>{team.homePlayed} local · {team.awayPlayed} visitante</small></span>
              <strong>{team.goals} GF</strong>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function QualificationPanel({ standings, revision, onResolve, busy }) {
  const pending = standings.filter((row) => row.classificationStatus === 'manual_review');
  return (
    <section className={styles.card}>
      <div className={styles.cardHeading}>
        <span>Fuentes estructuradas</span>
        <h2>Resolución de clasificados</h2>
        <p>Los puestos publicados alimentan cruces futuros sin perder el origen. Si un cruce posterior ya tiene acta, la corrección queda bloqueada para revisión.</p>
      </div>
      {pending.length > 0 && (
        <div className={styles.warning}>
          <AlertTriangle size={19} />
          <span><strong>{pending.length} puesto(s) requieren desempate manual.</strong> No resuelvas cruces hasta completar ese criterio.</span>
        </div>
      )}
      <div className={styles.qualifyList}>
        {standings.slice(0, 6).map((row) => (
          <article key={row.participantId}>
            <span className={styles.position}>{row.position}</span>
            <span><strong>{row.teamName}</strong><small>{row.points} pts. · DG {row.goalDifference}</small></span>
            <ChevronRight size={18} />
          </article>
        ))}
      </div>
      <button
        type="button"
        className={styles.primaryButton}
        disabled={busy || !onResolve || !revision || revision.status !== 'published' || pending.length > 0}
        onClick={onResolve}
      >
        <ClipboardCheck size={17} /> Resolver fuentes de clasificación
      </button>
    </section>
  );
}

function DisciplinePanel({ rows }) {
  if (!rows.length) return <div className={styles.empty}><Scale size={28} /><h2>Sin novedades disciplinarias</h2><p>Las tarjetas y sanciones nacen exclusivamente de actas oficiales vigentes.</p></div>;
  return (
    <div className={styles.disciplineGrid}>
      {rows.map((row) => (
        <article className={styles.card} key={row.rosterPlayerId}>
          <div className={styles.disciplineHeader}>
            <span className={styles.playerMark}>{row.name?.slice(0, 2)}</span>
            <span><strong>{row.name}</strong><small>{row.fairPlayPoints} puntos disciplinarios</small></span>
            <span className={styles.cards}>{row.yellowCards}A · {row.directReds + row.secondYellows}R</span>
          </div>
          {(row.suspensions || []).length ? row.suspensions.map((suspension) => (
            <div className={styles.suspension} key={suspension.id}>
              <ShieldAlert size={17} />
              <span><strong>{suspension.reason}</strong><small>{suspension.servedMatches}/{suspension.totalMatches} fechas · {suspension.status}</small></span>
            </div>
          )) : <p className={styles.noSuspension}>Sin suspensión activa.</p>}
        </article>
      ))}
    </div>
  );
}

function ReasonDialog({
  action, setAction, reason, setReason, onConfirm, busy,
}) {
  if (!action) return null;
  const copy = {
    rebuild: ['Recalcular competencia', 'Se creará una revisión borrador reproducible desde actas oficiales.'],
    publish: ['Publicar revisión', 'La tabla visible actual será reemplazada de forma atómica.'],
    qualify: ['Resolver clasificados', 'Los puestos publicados se aplicarán a las fuentes de cruces futuros.'],
  }[action];
  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={() => !busy && setAction(null)}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="competition-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <span className={styles.dialogIcon}><Sparkles size={21} /></span>
        <h2 id="competition-dialog-title">{copy[0]}</h2>
        <p>{copy[1]}</p>
        <label><span>Motivo auditable</span><textarea autoFocus minLength={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explicá por qué se realiza esta acción…" /></label>
        <div className={styles.dialogActions}>
          <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => setAction(null)}>Cancelar</button>
          <button type="button" className={styles.primaryButton} disabled={busy || reason.trim().length < 3} onClick={onConfirm}>{busy ? 'Procesando…' : 'Confirmar'}</button>
        </div>
      </section>
    </div>
  );
}

export default function CompetitionCenterPage({ mode = 'table' }) {
  const { organization } = useOutletContext();
  const { service } = useTorneosWorkspace();
  const { activeTournament } = useTorneosCompetition();
  const fixture = useTorneosFixture();
  const requestRef = useRef(0);
  const publishedVersion = fixture.versions.find((version) => version.status === 'published');
  const phases = useMemo(
    () => fixture.phases.filter((phase) => !publishedVersion || phase.fixtureVersionId === publishedVersion.id),
    [fixture.phases, publishedVersion],
  );
  const [phaseId, setPhaseId] = useState(null);
  const [groupId, setGroupId] = useState(null);
  const [state, setState] = useState({ status: 'idle', standings: [], statistics: { players: [], teams: [], discipline: [] }, revision: null, error: '', notice: '' });
  const [action, setAction] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const canRebuild = hasCapability(organization, TOURNAMENT_CAPABILITIES.STANDINGS_REBUILD);
  const canPublish = hasCapability(organization, TOURNAMENT_CAPABILITIES.STANDINGS_PUBLISH);
  const canResolve = hasCapability(organization, TOURNAMENT_CAPABILITIES.QUALIFICATION_RESOLVE);

  useEffect(() => {
    setPhaseId((current) => phases.some((phase) => phase.id === current) ? current : phases[0]?.id || null);
  }, [phases]);
  useEffect(() => {
    if (groupId && !fixture.groups.some((group) => group.id === groupId && group.phaseId === phaseId)) setGroupId(null);
  }, [fixture.groups, groupId, phaseId]);

  const scope = useMemo(() => ({
    organizationId: organization.id,
    tournamentId: activeTournament?.id,
    categoryId: fixture.categoryId,
    phaseId,
    groupId,
  }), [activeTournament?.id, fixture.categoryId, groupId, organization.id, phaseId]);

  const refresh = useCallback(async (notice = '') => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (!scope.tournamentId || !scope.categoryId || !scope.phaseId) {
      setState({ status: 'ready', standings: [], statistics: { players: [], teams: [], discipline: [] }, revision: null, error: '', notice });
      return;
    }
    setState((current) => ({ ...current, status: 'loading', error: '', notice }));
    try {
      const [standings, statistics] = await Promise.all([
        service.loadStandings(scope),
        service.loadStatistics(scope),
      ]);
      if (requestRef.current !== requestId) return;
      setState({
        status: 'ready',
        standings: standings?.standings || [],
        revision: standings?.revision || null,
        statistics: {
          players: statistics?.players || [],
          teams: statistics?.teams || [],
          discipline: statistics?.discipline || [],
        },
        error: '',
        notice,
      });
    } catch (error) {
      if (requestRef.current === requestId) setState((current) => ({ ...current, status: 'error', error: error?.message || 'No pudimos cargar la competencia.', notice: '' }));
    }
  }, [scope, service]);

  useEffect(() => {
    refresh();
    return () => { requestRef.current += 1; };
  }, [refresh]);

  const confirmAction = async () => {
    setBusy(true);
    try {
      if (action === 'rebuild') await service.rebuildStandings({ ...scope, reason });
      if (action === 'publish') await service.publishStandings({ revisionId: state.revision.id, reason });
      if (action === 'qualify') await service.resolveQualification({ revisionId: state.revision.id, reason });
      const notices = { rebuild: 'Revisión borrador calculada.', publish: 'Tabla publicada.', qualify: 'Clasificados resueltos.' };
      const notice = notices[action];
      setAction(null);
      setReason('');
      await refresh(notice);
    } catch (error) {
      setState((current) => ({ ...current, error: error?.message || 'No pudimos completar la acción.', notice: '' }));
      setAction(null);
    } finally {
      setBusy(false);
    }
  };

  if (fixture.status === 'loading' || fixture.status === 'idle') return <WorkspaceLoading label="Cargando centro de competencia…" />;
  if (fixture.status === 'error') return <WorkspaceError message={fixture.error} onRetry={() => fixture.refresh().catch(() => {})} />;

  return (
    <div className={styles.page}>
      <ContextFilters fixture={fixture} phaseId={phaseId} setPhaseId={setPhaseId} groupId={groupId} setGroupId={setGroupId} />
      <CompetitionSubnav organizationId={organization.id} mode={mode} />
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Centro de competencia · datos oficiales</span>
          <h1>{MODES[mode]?.[0] || 'Competencia'}</h1>
          <p>{activeTournament?.name || 'Seleccioná un torneo'} · {fixture.activeCategory?.name || 'Sin categoría'} · {phases.find((phase) => phase.id === phaseId)?.name || 'Sin fase'}</p>
        </div>
        <div className={styles.heroActions}>
          <RevisionBadge revision={state.revision} />
          {canRebuild && <button type="button" className={styles.secondaryButton} disabled={busy || !phaseId} onClick={() => { setReason(''); setAction('rebuild'); }}><RefreshCw size={16} /> Recalcular</button>}
          {canPublish && state.revision?.status === 'draft' && <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => { setReason(''); setAction('publish'); }}><CheckCircle2 size={16} /> Publicar</button>}
        </div>
      </header>
      {!canRebuild && <div className={styles.readOnly}><ShieldAlert size={17} /><span><strong>Vista de sólo lectura.</strong> Sólo se muestran revisiones publicadas.</span></div>}
      {state.notice && <div className={styles.notice} role="status"><CheckCircle2 size={17} />{state.notice}</div>}
      {state.error && <div className={styles.error} role="alert"><AlertTriangle size={17} />{state.error}<button type="button" onClick={() => refresh()}>Reintentar</button></div>}
      {state.status === 'loading' ? <WorkspaceLoading label="Actualizando datos oficiales…" /> : (
        <>
          {mode === 'table' && <StandingsTable rows={state.standings} />}
          {mode === 'statistics' && <StatisticsPanel data={state.statistics} />}
          {mode === 'qualification' && (
            <QualificationPanel
              standings={state.standings}
              revision={state.revision}
              busy={busy}
              onResolve={canResolve ? () => { setReason(''); setAction('qualify'); } : undefined}
            />
          )}
          {mode === 'discipline' && <DisciplinePanel rows={state.statistics.discipline} />}
        </>
      )}
      <ReasonDialog action={action} setAction={setAction} reason={reason} setReason={setReason} onConfirm={confirmAction} busy={busy} />
    </div>
  );
}
