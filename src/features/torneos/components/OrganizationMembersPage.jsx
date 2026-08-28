import React, { useEffect, useState } from 'react';
import {
  Check,
  Clock3,
  LoaderCircle,
  LockKeyhole,
  Plus,
  UserRound,
  Users,
} from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import {
  getRoleDescription,
  getRoleLabel,
  hasCapability,
  TOURNAMENT_CAPABILITIES,
} from '../domain/capabilities';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import OrganizationSettingsNav from './OrganizationSettingsNav';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import styles from './TorneosShell.module.css';

const ORGANIZATION_ROLE_GUIDE = ['owner', 'admin', 'collaborator'];
const RELATIONAL_ROLE_GUIDE = ['delegate', 'player'];

function RoleGuideGroup({ label, roles }) {
  return (
    <div className={styles.roleGuideGroup}>
      <h3>{label}</h3>
      <div>
        {roles.map((role) => (
          <article key={role}>
            <strong>{getRoleLabel(role)}</strong>
            <p>{getRoleDescription(role)}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function safeMemberLabel(member, organization) {
  if (member.role === 'owner') return `Propietario de ${organization.name}`;
  return `Miembro · ${String(member.user_id).slice(0, 8)}`;
}

function formatDate(value) {
  if (!value) return 'Pendiente';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export default function OrganizationMembersPage() {
  const { organization } = useOutletContext();
  const { service } = useTorneosWorkspace();
  const [state, setState] = useState({
    status: 'loading', members: [], seasons: [], error: '',
  });
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [assignmentState, setAssignmentState] = useState({
    status: 'idle', assignments: [], entitlements: null, error: '', pendingId: '',
  });
  const canInvite = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.MEMBERS_INVITE,
  );

  const load = async () => {
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const [members, competition] = await Promise.all([
        service.listMembers(organization.id),
        service.loadCompetitionContext(organization.id),
      ]);
      const seasons = competition?.seasons || [];
      setState({ status: 'ready', members, seasons, error: '' });
      setSelectedSeasonId((current) => (
        seasons.some((season) => season.id === current) ? current : (seasons[0]?.id || '')
      ));
    } catch (error) {
      setState({
        status: 'error',
        members: [],
        seasons: [],
        error: error?.message || 'No pudimos cargar los miembros.',
      });
    }
  };

  useEffect(() => {
    let active = true;
    Promise.all([
      service.listMembers(organization.id),
      service.loadCompetitionContext(organization.id),
    ])
      .then(([members, competition]) => {
        if (!active) return;
        const seasons = competition?.seasons || [];
        setState({ status: 'ready', members, seasons, error: '' });
        setSelectedSeasonId((current) => (
          seasons.some((season) => season.id === current) ? current : (seasons[0]?.id || '')
        ));
      })
      .catch((error) => {
        if (active) {
          setState({
            status: 'error',
            members: [],
            seasons: [],
            error: error?.message || 'No pudimos cargar los miembros.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [organization.id, service]);

  useEffect(() => {
    if (!selectedSeasonId) {
      setAssignmentState({
        status: 'idle', assignments: [], entitlements: null, error: '', pendingId: '',
      });
      return undefined;
    }
    let active = true;
    setAssignmentState((current) => ({ ...current, status: 'loading', error: '' }));
    Promise.all([
      service.listSeasonMemberAssignments({
        organizationId: organization.id,
        seasonId: selectedSeasonId,
      }),
      service.loadSeasonEntitlements({
        organizationId: organization.id,
        seasonId: selectedSeasonId,
      }),
    ])
      .then(([assignments, entitlements]) => {
        if (active) {
          setAssignmentState({
            status: 'ready', assignments, entitlements, error: '', pendingId: '',
          });
        }
      })
      .catch((error) => {
        if (active) {
          setAssignmentState({
            status: 'error', assignments: [], entitlements: null,
            error: error?.message || 'No pudimos cargar los accesos de la temporada.',
            pendingId: '',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [organization.id, selectedSeasonId, service]);

  const toggleAssignment = async (member) => {
    if (!selectedSeasonId || assignmentState.pendingId) return;
    const isAssigned = assignmentState.assignments.some(
      (assignment) => assignment.membershipId === member.id,
    );
    setAssignmentState((current) => ({ ...current, pendingId: member.id, error: '' }));
    try {
      if (isAssigned) {
        await service.removeSeasonMemberAssignment({
          organizationId: organization.id,
          seasonId: selectedSeasonId,
          membershipId: member.id,
        });
      } else {
        await service.assignSeasonMember({
          organizationId: organization.id,
          seasonId: selectedSeasonId,
          membershipId: member.id,
        });
      }
      const [assignments, entitlements] = await Promise.all([
        service.listSeasonMemberAssignments({
          organizationId: organization.id,
          seasonId: selectedSeasonId,
        }),
        service.loadSeasonEntitlements({
          organizationId: organization.id,
          seasonId: selectedSeasonId,
        }),
      ]);
      setAssignmentState({
        status: 'ready', assignments, entitlements, error: '', pendingId: '',
      });
    } catch (error) {
      setAssignmentState((current) => ({
        ...current,
        pendingId: '',
        error: error?.message || 'No pudimos actualizar el acceso a la temporada.',
      }));
    }
  };

  if (state.status === 'loading') return <WorkspaceLoading label="Cargando miembros…" />;
  if (state.status === 'error') return <WorkspaceError message={state.error} onRetry={load} />;

  return (
    <div className={styles.membersPage}>
      <header className={styles.pageHeader}>
        <span className={styles.eyebrow}>Acceso institucional</span>
        <h1>Miembros</h1>
        <p>Roles y estados visibles dentro de esta organización.</p>
      </header>

      <OrganizationSettingsNav />

      <section className={styles.roleGuide} aria-labelledby="role-guide-title">
        <header>
          <span className={styles.eyebrow}>Permisos claros</span>
          <h2 id="role-guide-title">Qué permite cada acceso</h2>
          <p>Los roles de organización y los accesos asignados a un equipo tienen alcances distintos.</p>
        </header>
        <RoleGuideGroup label="Organización" roles={ORGANIZATION_ROLE_GUIDE} />
        <RoleGuideGroup label="Por equipo o plantel asignado" roles={RELATIONAL_ROLE_GUIDE} />
      </section>

      <div className={styles.membersToolbar}>
        <span><Users size={18} /> {state.members.length} miembros</span>
        <button type="button" disabled title="Las invitaciones estarán disponibles en una próxima fase">
          <Plus size={17} />
          Invitar miembro
          <small>Próximamente</small>
        </button>
      </div>

      {!canInvite && (
        <div className={styles.readOnlyBanner}>
          <LockKeyhole size={18} />
          Tu rol permite ver miembros, pero no administrarlos.
        </div>
      )}

      <section className={styles.seasonAssignments} aria-labelledby="season-assignments-title">
        <header>
          <div>
            <span className={styles.eyebrow}>Acceso por temporada</span>
            <h2 id="season-assignments-title">Asignaciones explícitas</h2>
            <p>
              El propietario accede a todas las temporadas y no ocupa cupo. Administradores y
              colaboradores sólo acceden a las temporadas que les asignes.
            </p>
          </div>
          {state.seasons.length > 0 && (
            <label>
              <span>Temporada</span>
              <select
                value={selectedSeasonId}
                onChange={(event) => setSelectedSeasonId(event.target.value)}
              >
                {state.seasons.map((season) => (
                  <option key={season.id} value={season.id}>{season.name}</option>
                ))}
              </select>
            </label>
          )}
        </header>

        {state.seasons.length === 0 && (
          <p className={styles.assignmentEmpty}>Creá una temporada para asignar accesos.</p>
        )}

        {selectedSeasonId && assignmentState.status === 'loading' && (
          <p className={styles.assignmentEmpty}>
            <LoaderCircle className={styles.spinIcon} size={16} /> Cargando accesos…
          </p>
        )}

        {selectedSeasonId && assignmentState.status !== 'loading' && (
          <>
            <div className={styles.assignmentSummary}>
              <strong>
                {assignmentState.assignments.length}
                {' / '}
                {assignmentState.entitlements?.limits?.administrativeCollaboratorLimit ?? '—'}
              </strong>
              <span>cupos usados en esta temporada</span>
            </div>
            {assignmentState.error && (
              <p className={styles.assignmentError} role="alert">{assignmentState.error}</p>
            )}
            <div className={styles.assignmentList}>
              {state.members
                .filter((member) => (
                  member.status === 'active'
                  && (member.role === 'admin' || member.role === 'collaborator')
                ))
                .map((member) => {
                  const isAssigned = assignmentState.assignments.some(
                    (assignment) => assignment.membershipId === member.id,
                  );
                  const isPending = assignmentState.pendingId === member.id;
                  return (
                    <article key={member.id}>
                      <span>
                        <strong>{safeMemberLabel(member, organization)}</strong>
                        <small>{getRoleLabel(member.role)}</small>
                      </span>
                      <button
                        type="button"
                        className={isAssigned ? styles.assignmentActive : ''}
                        disabled={!canInvite || Boolean(assignmentState.pendingId)}
                        onClick={() => toggleAssignment(member)}
                        aria-pressed={isAssigned}
                      >
                        {isPending ? <LoaderCircle className={styles.spinIcon} size={15} /> : (
                          isAssigned ? <Check size={15} /> : <Plus size={15} />
                        )}
                        {isAssigned ? 'Asignado' : 'Asignar'}
                      </button>
                    </article>
                  );
                })}
            </div>
          </>
        )}
      </section>

      <div className={styles.memberList}>
        {state.members.map((member) => (
          <article key={member.id}>
            <span className={styles.memberAvatar}><UserRound size={20} /></span>
            <span className={styles.memberIdentity}>
              <strong>{safeMemberLabel(member, organization)}</strong>
              <small>
                <Clock3 size={13} />
                Desde {formatDate(member.joined_at || member.created_at)}
              </small>
            </span>
            <span className={styles.memberRole}>
              <span className={styles.roleChip}>{getRoleLabel(member.role)}</span>
              <small>{getRoleDescription(member.role)}</small>
            </span>
            <span className={member.status === 'active' ? styles.activeChip : styles.neutralChip}>
              {member.status === 'active' ? 'Activo' : member.status}
            </span>
          </article>
        ))}
      </div>

      {state.members.length === 0 && (
        <div className={styles.emptyPanel}>
          No hay miembros visibles para esta organización.
        </div>
      )}
    </div>
  );
}
