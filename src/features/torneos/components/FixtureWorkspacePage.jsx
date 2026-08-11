import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  GitBranch,
  LockKeyhole,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Trophy,
  UsersRound,
} from 'lucide-react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { useTorneosCompetition } from '../context/TorneosCompetitionContext';
import { useTorneosFixture } from '../context/TorneosFixtureContext';
import { hasCapability, TOURNAMENT_CAPABILITIES } from '../domain/capabilities';
import {
  formatInstantInTimeZone,
  instantToZonedLocalInput,
  zonedLocalDateTimeToIso,
} from '../domain/fixtureAlgorithms';
import CompetitionSelector from './CompetitionSelector';
import { importantNameProps } from './importantNames';
import {
  getFormatLabel,
  getGenerationMethodLabel,
  getStatusLabel,
} from './presentationLabels';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import TorneosSelect from './TorneosSelect';
import styles from './FixtureWorkspace.module.css';

const MODE_COPY = {
  overview: ['Centro de competencia', 'Fixture', 'Versiones, fases, jornadas y programación real.'],
  participants: ['Paso 01', 'Participantes', 'Cerrá una fotografía competitiva antes de sortear.'],
  pots: ['Paso 02', 'Bombos y cabezas de serie', 'Ordená la entrada del sorteo sin depender del orden de la base.'],
  draw: ['Paso 03', 'Sorteo', 'La misma entrada y la misma clave producen exactamente los mismos grupos.'],
  groups: ['Estructura', 'Grupos', 'Distribución publicada y miembros congelados.'],
  generate: ['Paso 04', 'Generar fixture', 'Creá una versión borrador verificable.'],
  rounds: ['Calendario', 'Jornadas', 'Fechas, cruces y estados de planificación.'],
  bracket: ['Eliminación', 'Llave', 'Cruces futuros expresados como fuentes estructuradas.'],
  schedule: ['Operación previa', 'Programación', 'Asigná horarios y canchas con conflictos visibles.'],
  venues: ['Recursos', 'Sedes y canchas', 'Infraestructura reusable y aislada por organización.'],
};

const FIXTURE_NAVIGATION = [
  ['fixture', 'Versiones'],
  ['fixture/participantes', 'Participantes'],
  ['fixture/bombos', 'Bombos'],
  ['fixture/sorteo', 'Sorteo'],
  ['fixture/grupos', 'Grupos'],
  ['fixture/generar', 'Generar'],
  ['fixture/jornadas', 'Jornadas'],
  ['fixture/llave', 'Llave'],
  ['programacion', 'Programación'],
  ['sedes', 'Sedes'],
];

function FixtureSubnav({ organizationId }) {
  const base = `/torneos/organizacion/${organizationId}`;
  return (
    <nav
      className={styles.subnav}
      aria-label="Flujo de fixture"
      data-allow-horizontal-scroll="true"
    >
      {FIXTURE_NAVIGATION.map(([path, label]) => (
        <Link key={path} to={`${base}/${path}`}>{label}</Link>
      ))}
    </nav>
  );
}

function ParticipantMark({ participant }) {
  return (
    <span
      className={styles.participantMark}
      style={{ '--team-color': participant?.primaryColor || '#885cff' }}
      aria-hidden="true"
    >
      {(participant?.shortName || participant?.name || '—').slice(0, 2).toUpperCase()}
    </span>
  );
}

function ContextBar() {
  const { categories, categoryId, setCategoryId, activeCategory } = useTorneosFixture();
  return (
    <div className={styles.contextBar}>
      <CompetitionSelector compact />
      <label>
        <span>Categoría</span>
        <TorneosSelect
          {...importantNameProps(activeCategory?.name, 'selector')}
          aria-label="Categoría activa del fixture"
          value={categoryId || ''}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </TorneosSelect>
      </label>
      <span className={styles.contextStatus} {...importantNameProps(activeCategory?.name || 'Sin categoría', 'compact')}>
        <CircleDot size={14} />
        {activeCategory?.name || 'Sin categoría'}
      </span>
    </div>
  );
}

function Metrics() {
  const {
    participantSet, participants, versions, matches,
  } = useTorneosFixture();
  const activeVersion = versions.find((version) => version.status === 'published')
    || versions.find((version) => version.status === 'draft');
  const visibleMatches = activeVersion
    ? matches.filter((match) => match.fixtureVersionId === activeVersion.id)
    : [];
  return (
    <section className={styles.metrics} aria-label="Resumen del fixture">
      <article><span>Participantes</span><strong>{participants.length}</strong><small>{getStatusLabel(participantSet?.status, 'Abierto')}</small></article>
      <article><span>Versión</span><strong>{activeVersion ? `v${activeVersion.versionNumber}` : '—'}</strong><small>{getStatusLabel(activeVersion?.status, 'Sin generar')}</small></article>
      <article><span>Partidos</span><strong>{visibleMatches.length}</strong><small>identidades futuras</small></article>
      <article><span>Sin horario</span><strong>{visibleMatches.filter((match) => match.status === 'unscheduled').length}</strong><small>requieren programación</small></article>
    </section>
  );
}

function ParticipantsPanel({ canManage }) {
  const {
    participantSet, eligibleEntries, participants, actions,
  } = useTorneosFixture();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const run = async (operation) => {
    setBusy(true);
    try { await operation(); } finally { setBusy(false); }
  };
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeading}>
        <div>
          <span>{participantSet ? `Nómina v${participantSet.versionNumber}` : 'Cierre pendiente'}</span>
          <h2>{participantSet?.status === 'frozen' ? 'Nómina cerrada' : 'Equipos elegibles'}</h2>
        </div>
        {canManage && participantSet?.status !== 'frozen' && (
          <button type="button" disabled={busy || eligibleEntries.length < 2} onClick={() => run(() => actions.freeze())}>
            <LockKeyhole size={17} /> Cerrar participantes
          </button>
        )}
      </div>
      <div className={styles.participantList}>
        {(participants.length ? participants : eligibleEntries).map((participant) => (
          <article key={participant.id}>
            <ParticipantMark participant={participant} />
            <div><strong {...importantNameProps(participant.name, 'card')}>{participant.name}</strong><small>{getStatusLabel(participant.status)}</small></div>
            {participant.seedNumber && <em>Cabeza de serie {participant.seedNumber}</em>}
            {participant.potNumber && <em>Bombo {participant.potNumber}</em>}
          </article>
        ))}
      </div>
      {!participants.length && !eligibleEntries.length && (
        <div className={styles.empty}><UsersRound size={24} /><strong>No hay equipos aprobados</strong><span>La lista se completa sólo con inscripciones persistidas.</span></div>
      )}
      {canManage && participantSet?.status === 'frozen' && (
        <form className={styles.inlineForm} onSubmit={(event) => {
          event.preventDefault();
          run(() => actions.reopen(reason));
        }}>
          <label><span>Motivo para reabrir</span><input value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} required /></label>
          <button type="submit" disabled={busy || reason.trim().length < 3}><RefreshCw size={16} /> Reabrir</button>
        </form>
      )}
    </section>
  );
}

function PotsPanel({ canManage }) {
  const { participantSet, participants, pots, actions } = useTorneosFixture();
  const [potCount, setPotCount] = useState(Math.max(pots.length, 2));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const nextPots = Array.from({ length: Number(potCount) }, (_, index) => ({
      name: `Bombo ${index + 1}`,
      number: index + 1,
      sortOrder: index,
      members: participants
        .filter((participant, participantIndex) => (
          (participant.potNumber || ((participantIndex % Number(potCount)) + 1)) === index + 1
        ))
        .map((participant) => ({
          participantId: participant.id,
          seedNumber: participant.seedNumber
            || participants.findIndex((item) => item.id === participant.id) + 1,
        })),
    }));
    setBusy(true);
    try { await actions.savePots(nextPots); } finally { setBusy(false); }
  };
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeading}>
        <div><span>Distribución controlada</span><h2>Bombos activos</h2></div>
        {canManage && (
          <label className={styles.compactField}><span>Cantidad</span><input type="number" min="1" max="32" value={potCount} onChange={(event) => setPotCount(event.target.value)} /></label>
        )}
      </div>
      <div className={styles.potGrid}>
        {(pots.length ? pots : Array.from({ length: Number(potCount) }, (_, index) => ({
          id: `preview-${index}`, name: `Bombo ${index + 1}`, members: [],
        }))).map((pot) => (
          <article key={pot.id}>
            <span>{String(pot.number || pots.indexOf(pot) + 1).padStart(2, '0')}</span>
            <h3>{pot.name}</h3>
            <div>{pot.members?.map((member) => {
              const participant = participants.find((item) => item.id === member.participantId);
              return <small {...importantNameProps(participant?.name || 'Participante', 'compact')} key={member.participantId}>{participant?.name || 'Participante'} {member.seedNumber ? `· CS ${member.seedNumber}` : ''}</small>;
            })}</div>
          </article>
        ))}
      </div>
      {canManage && (
        <button className={styles.primaryAction} type="button" disabled={busy || !participantSet || !participants.length} onClick={save}>
          <Save size={17} /> Guardar distribución automática
        </button>
      )}
    </section>
  );
}

function DrawPanel({ canManage }) {
  const { participantSet, groups, actions } = useTorneosFixture();
  const [seed, setSeed] = useState('');
  const [groupCount, setGroupCount] = useState(2);
  const [busy, setBusy] = useState(false);
  const execute = async (publish) => {
    setBusy(true);
    try { await actions.draw({ seed, groupCount: Number(groupCount), publish }); } finally { setBusy(false); }
  };
  const drawGroups = groups.filter((group) => !group.fixtureVersionId);
  return (
    <section className={styles.panel}>
      <div className={styles.drawControls}>
        <label><span>Clave del sorteo</span><input value={seed} onChange={(event) => setSeed(event.target.value)} placeholder="ej. apertura-2026-v1" /></label>
        <label><span>Grupos</span><input type="number" min="2" max="32" value={groupCount} onChange={(event) => setGroupCount(event.target.value)} /></label>
        {canManage && <button type="button" disabled={busy || !participantSet || !seed.trim()} onClick={() => execute(false)}><Shuffle size={17} /> Sortear</button>}
        {canManage && <button type="button" disabled={busy || !drawGroups.length || !seed.trim()} onClick={() => execute(true)}><ShieldCheck size={17} /> Publicar</button>}
      </div>
      <GroupsGrid groups={drawGroups} />
    </section>
  );
}

function GroupsGrid({ groups }) {
  const { participants } = useTorneosFixture();
  if (!groups.length) return <div className={styles.empty}><Shuffle size={24} /><strong>Todavía no hay grupos</strong><span>Ejecutá un sorteo borrador o crealos de forma controlada.</span></div>;
  return (
    <div className={styles.groupGrid}>
      {groups.map((group) => (
        <article key={group.id}>
          <header><span>{group.code}</span><div><h3>{group.name}</h3><small>{getStatusLabel(group.status)} · clave {group.drawSeed || 'manual'}</small></div></header>
          <ol>{group.members?.map((member) => {
            const participant = participants.find((item) => item.id === member.participantId);
            return <li key={member.participantId}><ParticipantMark participant={participant} /><span {...importantNameProps(participant?.name || 'Participante', 'table')}>{participant?.name || 'Participante'}</span></li>;
          })}</ol>
        </article>
      ))}
    </div>
  );
}

function VersionPanel({ canManage }) {
  const { organization } = useOutletContext();
  const {
    versions, phases, rounds, matches, actions,
  } = useTorneosFixture();
  const [busy, setBusy] = useState(false);
  const publish = async (id) => {
    setBusy(true);
    try { await actions.publish(id); } finally { setBusy(false); }
  };
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeading}><div><span>Historial de versiones</span><h2>Versiones del fixture</h2></div></div>
      <div className={styles.versionList}>
        {versions.map((version) => (
          <article key={version.id}>
            <span className={styles.versionNumber}>v{version.versionNumber}</span>
            <div><small>{getGenerationMethodLabel(version.generationMethod)}</small><h3>{getStatusLabel(version.status)}</h3><p>{version.matchCount} partidos · {version.scheduledCount} programados</p></div>
            <div className={styles.versionActions}>
              <Link to={`/torneos/organizacion/${organization.id}/fixture/version/${version.id}`}>Abrir <ArrowRight size={15} /></Link>
              {canManage && version.status === 'draft' && <button type="button" disabled={busy} onClick={() => publish(version.id)}>Publicar</button>}
              {canManage && version.status === 'published' && <button type="button" disabled={busy} onClick={() => actions.supersede(version.id)}>Nueva revisión</button>}
            </div>
          </article>
        ))}
      </div>
      {!versions.length && <div className={styles.empty}><GitBranch size={24} /><strong>Sin versiones</strong><span>Generá la primera versión desde participantes congelados.</span></div>}
      {!!versions.length && <div className={styles.structureStrip}><span>{phases.length} fases</span><span>{rounds.length} jornadas</span><span>{matches.length} partidos</span></div>}
    </section>
  );
}

function GeneratePanel({ canManage }) {
  const { participantSet, versions, actions } = useTorneosFixture();
  const { activeTournament } = useTorneosCompetition();
  const [seed, setSeed] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <section className={`${styles.panel} ${styles.generatePanel}`}>
      <Sparkles size={28} />
      <div><span>Operación atómica</span><h2>{getFormatLabel(activeTournament?.competitionFormat, 'Formato competitivo')}</h2><p>Se crean versión, fases, jornadas, partidos y fuentes en una única transacción.</p></div>
      <label><span>Clave de generación</span><input value={seed} onChange={(event) => setSeed(event.target.value)} placeholder="Opcional para liga; requerida para trazabilidad" /></label>
      {canManage && (
        <div className={styles.formActions}>
          <button type="button" disabled={busy || participantSet?.status !== 'frozen'} onClick={async () => {
            setBusy(true);
            try { await actions.generate({ seed, configuration: {} }); } finally { setBusy(false); }
          }}><Sparkles size={17} /> Generar borrador</button>
          <button type="button" disabled={busy || participantSet?.status !== 'frozen'} onClick={async () => {
            setBusy(true);
            try {
              await actions.createManual(
                versions.find((version) => version.status === 'published')?.id || null,
              );
            } finally { setBusy(false); }
          }}><Plus size={17} /> {versions.some((version) => version.status === 'published') ? 'Copiar a manual' : 'Versión manual'}</button>
        </div>
      )}
    </section>
  );
}

function DraftEditor({ version }) {
  const {
    participants, phases, rounds, matches, actions,
  } = useTorneosFixture();
  const [phase, setPhase] = useState({ name: '', phaseType: 'custom_knockout' });
  const [round, setRound] = useState({ phaseId: '', name: '' });
  const [match, setMatch] = useState({
    roundId: '', homeParticipantId: '', awayParticipantId: '', durationMinutes: 60,
  });
  const [validation, setValidation] = useState(null);
  const versionPhases = phases.filter((item) => item.fixtureVersionId === version.id);
  const versionRounds = rounds.filter((item) => item.fixtureVersionId === version.id);
  const versionMatches = matches.filter((item) => item.fixtureVersionId === version.id);
  const update = (action, payload) => actions.updateDraft(version.id, action, payload);
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeading}>
        <div><span>Edición controlada</span><h2>Constructor manual · v{version.versionNumber}</h2></div>
        <button type="button" onClick={async () => setValidation(await actions.validateFixture(version.id))}>Validar versión</button>
      </div>
      {validation && (
        <div className={styles.validation} data-valid={validation.valid}>
          {validation.valid ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
          <span>{validation.blockers?.length || 0} bloqueos · {validation.warnings?.length || 0} advertencias</span>
        </div>
      )}
      <div className={styles.manualGrid}>
        <form onSubmit={async (event) => {
          event.preventDefault();
          await update('create_phase', phase);
          setPhase((current) => ({ ...current, name: '' }));
        }}>
          <h3>Nueva fase</h3>
          <label><span>Nombre</span><input required value={phase.name} onChange={(event) => setPhase({ ...phase, name: event.target.value })} /></label>
          <label><span>Tipo</span><TorneosSelect value={phase.phaseType} onChange={(event) => setPhase({ ...phase, phaseType: event.target.value })}><option value="league">Liga</option><option value="groups">Grupos</option><option value="custom_knockout">Eliminación</option></TorneosSelect></label>
          <button type="submit"><Plus size={16} /> Crear fase</button>
        </form>
        <form onSubmit={async (event) => {
          event.preventDefault();
          await update('create_round', round);
          setRound((current) => ({ ...current, name: '' }));
        }}>
          <h3>Nueva jornada</h3>
          <label><span>Fase</span><TorneosSelect required value={round.phaseId} onChange={(event) => setRound({ ...round, phaseId: event.target.value })}><option value="">Seleccionar</option>{versionPhases.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</TorneosSelect></label>
          <label><span>Nombre</span><input required value={round.name} onChange={(event) => setRound({ ...round, name: event.target.value })} /></label>
          <button type="submit"><Plus size={16} /> Crear jornada</button>
        </form>
        <form onSubmit={async (event) => {
          event.preventDefault();
          await update('create_match', {
            ...match,
            durationMinutes: Number(match.durationMinutes),
          });
          setMatch((current) => ({
            ...current, homeParticipantId: '', awayParticipantId: '',
          }));
        }}>
          <h3>Nuevo partido</h3>
          <label><span>Jornada</span><TorneosSelect required value={match.roundId} onChange={(event) => setMatch({ ...match, roundId: event.target.value })}><option value="">Seleccionar</option>{versionRounds.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</TorneosSelect></label>
          <label><span>Local</span><TorneosSelect required value={match.homeParticipantId} onChange={(event) => setMatch({ ...match, homeParticipantId: event.target.value })}><option value="">Seleccionar</option>{participants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</TorneosSelect></label>
          <label><span>Visitante</span><TorneosSelect required value={match.awayParticipantId} onChange={(event) => setMatch({ ...match, awayParticipantId: event.target.value })}><option value="">Seleccionar</option>{participants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</TorneosSelect></label>
          <label><span>Duración</span><input type="number" min="15" max="240" value={match.durationMinutes} onChange={(event) => setMatch({ ...match, durationMinutes: event.target.value })} /></label>
          <button type="submit" disabled={match.homeParticipantId === match.awayParticipantId}><Plus size={16} /> Crear partido</button>
        </form>
      </div>
      {!!versionMatches.length && (
        <div className={styles.formActions}>
          {versionRounds.filter((item) => item.status !== 'locked').map((item) => (
            <button key={item.id} type="button" onClick={() => update('lock_round', { roundId: item.id })}>Cerrar {item.name}</button>
          ))}
        </div>
      )}
    </section>
  );
}

function RoundsPanel({ bracket = false, canManage = false }) {
  const { roundId, fixtureVersionId, matchId } = useParams();
  const { organization } = useOutletContext();
  const {
    participants, versions, phases, rounds, matches,
  } = useTorneosFixture();
  const version = versions.find((item) => item.id === fixtureVersionId)
    || versions.find((item) => item.status === 'published')
    || versions[0];
  const visibleRounds = rounds.filter((round) => (
    (!version || round.fixtureVersionId === version.id)
    && (!roundId || round.id === roundId)
  ));
  const participantName = (id) => participants.find((item) => item.id === id)?.name;
  const participantSeed = (id) => participants.find((item) => item.id === id)?.seedNumber;
  const sourceLabel = (source) => {
    if (!source) return 'A definir';
    if (source.type === 'participant') return participantName(source.participantId) || 'Participante';
    if (source.type === 'winner_of_match') return `Ganador · partido ${matches.find((item) => item.id === source.matchId)?.matchNumber || '—'}`;
    if (source.type === 'loser_of_match') return `Perdedor · partido ${matches.find((item) => item.id === source.matchId)?.matchNumber || '—'}`;
    if (source.type === 'winner_of_tie') return 'Ganador de la serie';
    if (source.type === 'loser_of_tie') return 'Perdedor de la serie';
    if (source.type === 'group_position') return `${source.positionNumber}º de grupo`;
    if (source.type === 'league_position') return `Posición de liga ${source.rankNumber}`;
    if (source.type === 'bye') return 'Fecha libre';
    return 'A definir';
  };
  const shownMatches = matches.filter((match) => (
    (!version || match.fixtureVersionId === version.id)
    && (!roundId || match.roundId === roundId)
    && (!matchId || match.id === matchId)
  ));
  if (bracket) {
    const knockoutPhases = phases.filter((phase) => (
      phase.fixtureVersionId === version?.id && phase.phaseType !== 'league' && phase.phaseType !== 'groups'
    ));
    return (
      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><span>Vista vertical responsive</span><h2>Llave eliminatoria</h2></div></div>
        <div className={styles.bracketList}>
          {knockoutPhases.flatMap((phase) => visibleRounds.filter((round) => round.phaseId === phase.id)).map((round) => (
            <section key={round.id}>
              <h3>{round.name}</h3>
              {shownMatches.filter((match) => match.roundId === round.id).map((match) => (
                <article key={match.id}>
                  <small>Partido {match.matchNumber}{match.legNumber > 1 ? ` · vuelta` : ''}</small>
                  <div className={styles.bracketTeam}>
                    <span>Local</span>
                    <strong {...importantNameProps(participantName(match.homeParticipantId) || sourceLabel(match.sources?.find((source) => source.side === 'home')), 'match')}>
                      {participantSeed(match.homeParticipantId) && <small>Cabeza de serie {participantSeed(match.homeParticipantId)}</small>}
                      {participantName(match.homeParticipantId) || sourceLabel(match.sources?.find((source) => source.side === 'home'))}
                    </strong>
                  </div>
                  <span className={styles.bracketVersus} aria-hidden="true">vs</span>
                  <div className={styles.bracketTeam}>
                    <span>Visitante</span>
                    <strong {...importantNameProps(participantName(match.awayParticipantId) || sourceLabel(match.sources?.find((source) => source.side === 'away')), 'match')}>
                      {participantSeed(match.awayParticipantId) && <small>Cabeza de serie {participantSeed(match.awayParticipantId)}</small>}
                      {participantName(match.awayParticipantId) || sourceLabel(match.sources?.find((source) => source.side === 'away'))}
                    </strong>
                  </div>
                </article>
              ))}
            </section>
          ))}
        </div>
      </section>
    );
  }
  return (
    <>
      {canManage && version?.status === 'draft' && <DraftEditor version={version} />}
      <section className={styles.panel}>
        <div className={styles.roundList}>
        {visibleRounds.map((round) => (
          <article key={round.id}>
            <header><span className={styles.roundCode}>F{round.roundNumber}</span><div><h3>{round.name}</h3><small>{getStatusLabel(round.status)}</small></div></header>
            <div>{shownMatches.filter((match) => match.roundId === round.id).map((match) => (
              <Link key={match.id} to={`/torneos/organizacion/${organization.id}/fixture/partidos/${match.id}`}>
                <small>#{match.matchNumber}</small>
                <strong {...importantNameProps(participantName(match.homeParticipantId) || sourceLabel(match.sources?.find((source) => source.side === 'home')), 'match')}>{participantName(match.homeParticipantId) || sourceLabel(match.sources?.find((source) => source.side === 'home'))}</strong>
                <span>vs</span>
                <strong {...importantNameProps(participantName(match.awayParticipantId) || sourceLabel(match.sources?.find((source) => source.side === 'away')), 'match')}>{participantName(match.awayParticipantId) || sourceLabel(match.sources?.find((source) => source.side === 'away'))}</strong>
                <em data-torneos-chip>{getStatusLabel(match.status)}</em>
              </Link>
            ))}</div>
          </article>
        ))}
        </div>
        {!visibleRounds.length && <div className={styles.empty}><CalendarClock size={24} /><strong>No hay jornadas</strong><span>Primero generá una versión del fixture.</span></div>}
      </section>
    </>
  );
}

function SchedulePanel({ canManage }) {
  const {
    versions, participants, matches, venues, courts, actions,
  } = useTorneosFixture();
  const candidateMatches = matches.filter((match) => (
    !['cancelled', 'ready'].includes(match.status)
    && match.homeParticipantId
    && match.awayParticipantId
  ));
  const [form, setForm] = useState({
    matchId: '', scheduledAt: '', venueId: '', courtId: '', durationMinutes: 60, reason: '',
  });
  const [validation, setValidation] = useState(null);
  const [busy, setBusy] = useState(false);
  const selected = matches.find((match) => match.id === form.matchId);
  const availableCourts = courts.filter((court) => court.venueId === form.venueId && court.status === 'active');
  const selectedVenue = venues.find((venue) => venue.id === form.venueId);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const scheduleIso = (() => {
    try {
      return form.scheduledAt && selectedVenue?.timezone
        ? zonedLocalDateTimeToIso(form.scheduledAt, selectedVenue.timezone)
        : '';
    } catch {
      return '';
    }
  })();
  const scheduleTimeError = Boolean(
    form.scheduledAt && selectedVenue?.timezone && !scheduleIso,
  );
  const payload = {
    ...form,
    scheduledAt: scheduleIso,
    durationMinutes: Number(form.durationMinutes),
  };
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (selected?.status === 'scheduled' || selected?.status === 'postponed') {
        await actions.reschedule(payload);
      } else {
        await actions.schedule(payload);
      }
      setValidation(null);
    } finally { setBusy(false); }
  };
  const participantName = (id) => participants.find((item) => item.id === id)?.name || 'A definir';
  return (
    <div className={styles.scheduleLayout}>
      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><span>Agenda real</span><h2>Partidos</h2></div>
          {canManage && versions.length > 0 && <button type="button" onClick={() => actions.autoSchedule((versions.find((version) => version.status === 'published') || versions.find((version) => version.status === 'draft') || versions[0]).id)}><Sparkles size={16} /> Auto básico</button>}
        </div>
        <div className={styles.scheduleList}>{candidateMatches.map((match) => (
          <button key={match.id} type="button" aria-pressed={form.matchId === match.id} onClick={() => setForm((current) => ({
            ...current,
            matchId: match.id,
            scheduledAt: match.scheduledAt
              ? instantToZonedLocalInput(
                match.scheduledAt,
                venues.find((venue) => venue.id === match.venueId)?.timezone
                  || 'America/Argentina/Buenos_Aires',
              )
              : '',
            venueId: match.venueId || '',
            courtId: match.courtId || '',
            durationMinutes: match.durationMinutes || 60,
          }))}>
            <span>#{match.matchNumber}</span><strong className={styles.scheduleTeams}><span {...importantNameProps(participantName(match.homeParticipantId), 'match')}>{participantName(match.homeParticipantId)}</span><i aria-hidden="true">vs.</i><span {...importantNameProps(participantName(match.awayParticipantId), 'match')}>{participantName(match.awayParticipantId)}</span></strong><small>{match.scheduledAt ? formatInstantInTimeZone(match.scheduledAt, venues.find((venue) => venue.id === match.venueId)?.timezone || 'America/Argentina/Buenos_Aires') : 'Sin horario'}</small><em data-torneos-chip>{getStatusLabel(match.status)}</em>
          </button>
        ))}</div>
      </section>
      <form className={`${styles.panel} ${styles.scheduleForm}`} onSubmit={submit}>
        <div><span>Edición manual</span><h2>{selected?.status === 'scheduled' ? 'Reprogramar' : 'Asignar horario'}</h2></div>
        <label><span>Partido</span><TorneosSelect {...importantNameProps(selected ? `${participantName(selected.homeParticipantId)} vs ${participantName(selected.awayParticipantId)}` : 'Seleccionar', 'selector')} required value={form.matchId} onChange={set('matchId')}><option value="">Seleccionar</option>{candidateMatches.map((match) => <option key={match.id} value={match.id}>#{match.matchNumber} · {participantName(match.homeParticipantId)} vs {participantName(match.awayParticipantId)}</option>)}</TorneosSelect></label>
        <label><span>Fecha y hora</span><input required type="datetime-local" value={form.scheduledAt} onChange={set('scheduledAt')} /></label>
        <label><span>Sede</span><TorneosSelect required value={form.venueId} onChange={(event) => setForm((current) => ({ ...current, venueId: event.target.value, courtId: '' }))}><option value="">Seleccionar</option>{venues.filter((venue) => venue.status === 'active').map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}</TorneosSelect></label>
        <label><span>Cancha</span><TorneosSelect required value={form.courtId} onChange={set('courtId')}><option value="">Seleccionar</option>{availableCourts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}</TorneosSelect></label>
        <label><span>Duración</span><input required type="number" min="15" max="240" value={form.durationMinutes} onChange={set('durationMinutes')} /></label>
        {(selected?.status === 'scheduled' || selected?.status === 'postponed') && <label><span>Motivo</span><textarea required minLength={3} value={form.reason} onChange={set('reason')} /></label>}
        {scheduleTimeError && <div className={styles.validation} role="alert"><AlertTriangle size={17} /><span>Esa hora local no existe o es ambigua para la zona horaria de la sede.</span></div>}
        {validation && <div className={styles.validation} data-valid={validation.valid}><AlertTriangle size={17} /><span>{validation.blockers?.length || 0} bloqueos · {validation.warnings?.length || 0} advertencias</span></div>}
        {canManage && <div className={styles.formActions}><button type="button" disabled={busy || !form.matchId || !scheduleIso || !form.courtId} onClick={async () => setValidation(await actions.validateSchedule(payload))}>Validar</button><button type="submit" disabled={busy || !scheduleIso}>Guardar</button></div>}
      </form>
    </div>
  );
}

function VenuesPanel({ canManage }) {
  const {
    venues, courts, actions,
  } = useTorneosFixture();
  const { activeTournament } = useTorneosCompetition();
  const [venue, setVenue] = useState({ name: '', address: '', locality: '', timezone: 'America/Argentina/Buenos_Aires' });
  const [court, setCourt] = useState({ venueId: '', name: '', sportModality: activeTournament?.sportModality || 'football_5' });
  const [scheduleWindow, setScheduleWindow] = useState({
    dayOfWeek: 6,
    startsAt: '09:00',
    endsAt: '18:00',
    slotDurationMinutes: 60,
    venueId: '',
    courtId: '',
  });
  return (
    <div className={styles.venueLayout}>
      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><span>Recursos activos</span><h2>Sedes</h2></div></div>
        <div className={styles.venueList}>{venues.map((item) => (
          <article key={item.id}><MapPin size={19} /><div><h3>{item.name}</h3><p>{item.address}</p><small>{courts.filter((value) => value.venueId === item.id).length} canchas · {getStatusLabel(item.status)}</small></div></article>
        ))}</div>
      </section>
      {canManage && <section className={styles.resourceForms}>
        <form className={styles.panel} onSubmit={async (event) => { event.preventDefault(); await actions.createVenue(venue); setVenue((current) => ({ ...current, name: '', address: '' })); }}>
          <h2>Nueva sede</h2>
          <label><span>Nombre</span><input required value={venue.name} onChange={(event) => setVenue({ ...venue, name: event.target.value })} /></label>
          <label><span>Dirección</span><input required value={venue.address} onChange={(event) => setVenue({ ...venue, address: event.target.value })} /></label>
          <label><span>Localidad</span><input value={venue.locality} onChange={(event) => setVenue({ ...venue, locality: event.target.value })} /></label>
          <button type="submit"><Plus size={16} /> Crear sede</button>
        </form>
        <form className={styles.panel} onSubmit={async (event) => { event.preventDefault(); await actions.createCourt(court); setCourt((current) => ({ ...current, name: '' })); }}>
          <h2>Nueva cancha</h2>
          <label><span>Sede</span><TorneosSelect required value={court.venueId} onChange={(event) => setCourt({ ...court, venueId: event.target.value })}><option value="">Seleccionar</option>{venues.filter((item) => item.status === 'active').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</TorneosSelect></label>
          <label><span>Nombre</span><input required value={court.name} onChange={(event) => setCourt({ ...court, name: event.target.value })} /></label>
          <label><span>Modalidad</span><TorneosSelect value={court.sportModality} onChange={(event) => setCourt({ ...court, sportModality: event.target.value })}><option value="football_5">Fútbol 5</option><option value="football_6">Fútbol 6</option><option value="football_7">Fútbol 7</option><option value="football_8">Fútbol 8</option><option value="football_9">Fútbol 9</option><option value="football_11">Fútbol 11</option><option value="futsal">Futsal</option></TorneosSelect></label>
          <button type="submit"><Plus size={16} /> Crear cancha</button>
        </form>
        <form className={styles.panel} onSubmit={async (event) => {
          event.preventDefault();
          await actions.saveWindows([{
            ...scheduleWindow,
            dayOfWeek: Number(scheduleWindow.dayOfWeek),
            slotDurationMinutes: Number(scheduleWindow.slotDurationMinutes),
            venueId: scheduleWindow.venueId || null,
            courtId: scheduleWindow.courtId || null,
          }]);
        }}>
          <h2>Ventana semanal</h2>
          <label><span>Día</span><TorneosSelect value={scheduleWindow.dayOfWeek} onChange={(event) => setScheduleWindow({ ...scheduleWindow, dayOfWeek: event.target.value })}><option value="1">Lunes</option><option value="2">Martes</option><option value="3">Miércoles</option><option value="4">Jueves</option><option value="5">Viernes</option><option value="6">Sábado</option><option value="7">Domingo</option></TorneosSelect></label>
          <label><span>Desde</span><input required type="time" value={scheduleWindow.startsAt} onChange={(event) => setScheduleWindow({ ...scheduleWindow, startsAt: event.target.value })} /></label>
          <label><span>Hasta</span><input required type="time" value={scheduleWindow.endsAt} onChange={(event) => setScheduleWindow({ ...scheduleWindow, endsAt: event.target.value })} /></label>
          <label><span>Minutos por turno</span><input required type="number" min="15" max="240" value={scheduleWindow.slotDurationMinutes} onChange={(event) => setScheduleWindow({ ...scheduleWindow, slotDurationMinutes: event.target.value })} /></label>
          <label><span>Sede opcional</span><TorneosSelect value={scheduleWindow.venueId} onChange={(event) => setScheduleWindow({ ...scheduleWindow, venueId: event.target.value, courtId: '' })}><option value="">Todas</option>{venues.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</TorneosSelect></label>
          <label><span>Cancha opcional</span><TorneosSelect value={scheduleWindow.courtId} onChange={(event) => setScheduleWindow({ ...scheduleWindow, courtId: event.target.value })}><option value="">Todas</option>{courts.filter((item) => !scheduleWindow.venueId || item.venueId === scheduleWindow.venueId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</TorneosSelect></label>
          <button type="submit"><Save size={16} /> Guardar ventana</button>
        </form>
      </section>}
    </div>
  );
}

export default function FixtureWorkspacePage({ mode = 'overview' }) {
  const { organization } = useOutletContext();
  const { activeTournament } = useTorneosCompetition();
  const fixture = useTorneosFixture();
  const [kicker, title, description] = MODE_COPY[mode] || MODE_COPY.overview;
  const canManage = hasCapability(organization, TOURNAMENT_CAPABILITIES.FIXTURE_GENERATE);

  if (fixture.status === 'loading' || fixture.status === 'idle') return <WorkspaceLoading label="Cargando estructura competitiva…" />;
  if (fixture.status === 'error') return <WorkspaceError message={fixture.error} onRetry={() => fixture.refresh().catch(() => {})} />;
  return (
    <div className={styles.page}>
      <ContextBar />
      <FixtureSubnav organizationId={organization.id} />
      <header className={styles.pageHeader}>
        <div><span>{kicker}</span><h1 data-torneos-display="xl" title={title}>{title}</h1><p className={styles.pageContext}>{activeTournament ? <><strong {...importantNameProps(activeTournament.name, 'compact')}>{activeTournament.name}</strong><span>{description}</span></> : 'Seleccioná un torneo activo.'}</p></div>
        <div className={styles.headerBadge}><Trophy size={20} /><span><small>Modo</small><strong>{canManage ? 'Organización' : 'Sólo lectura'}</strong></span></div>
      </header>
      {fixture.notice && <div className={styles.notice} role="status"><CheckCircle2 size={17} />{fixture.notice}</div>}
      <Metrics />
      {mode === 'overview' && <VersionPanel canManage={canManage} />}
      {mode === 'participants' && <ParticipantsPanel canManage={canManage} />}
      {mode === 'pots' && <PotsPanel canManage={canManage} />}
      {mode === 'draw' && <DrawPanel canManage={canManage} />}
      {mode === 'groups' && <section className={styles.panel}><GroupsGrid groups={fixture.groups.filter((group) => group.status === 'published')} /></section>}
      {mode === 'generate' && <GeneratePanel canManage={canManage} />}
      {mode === 'rounds' && <RoundsPanel canManage={hasCapability(organization, TOURNAMENT_CAPABILITIES.FIXTURE_UPDATE_DRAFT)} />}
      {mode === 'bracket' && <RoundsPanel bracket />}
      {mode === 'schedule' && <SchedulePanel canManage={hasCapability(organization, TOURNAMENT_CAPABILITIES.MATCHES_SCHEDULE)} />}
      {mode === 'venues' && <VenuesPanel canManage={hasCapability(organization, TOURNAMENT_CAPABILITIES.VENUES_CREATE)} />}
    </div>
  );
}
