import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Clock3,
  Copy,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Plus,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import {
  getRoleDescription,
  getRoleLabel,
  hasCapability,
  TOURNAMENT_CAPABILITIES,
} from '../domain/capabilities';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { useOptionalTorneosCompetition } from '../context/TorneosCompetitionContext';
import { useTorneosFeature } from '../context/TorneosFeaturesContext';
import OrganizationSettingsNav from './OrganizationSettingsNav';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import styles from './TorneosShell.module.css';
import { formatCount } from '../domain/countCopy';
import { getShareableAppOrigin } from '../../../utils/shareableAppUrl';

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

// The membership RPC carries no display name, and the owner never has an invitation email.
// The role chip already says "Propietario"; repeating the organization name only truncated.
function safeMemberLabel(member) {
  if (member.is_viewer) return member.email ? `${member.email} (vos)` : 'Vos';
  if (member.email) return member.email;
  return member.role === 'owner' ? 'Titular de la organización' : `Miembro · ${String(member.user_id).slice(0, 8)}`;
}

const INVITABLE_ROLES = {
  owner: ['admin', 'collaborator'],
  admin: ['collaborator'],
};

export function organizationInvitationUrl(token, origin = getShareableAppOrigin()) {
  return `${origin}/torneos/invitacion/organizacion/${token}`;
}

function formatDate(value) {
  if (!value) return 'Pendiente';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

// The seat limit comes from the season entitlements. A service without that
// method (staging v1: the RPC is not served) yields no limit — the count still
// shows and the assignment RPCs still work — instead of a rejected Promise.all.
const loadSeasonEntitlementsIfServed = (service, input) => (
  typeof service?.loadSeasonEntitlements === 'function'
    ? service.loadSeasonEntitlements(input)
    : Promise.resolve(null)
);

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
  const membersFeature = useTorneosFeature('organization_members');
  const competition = useOptionalTorneosCompetition();
  const offers = (name) => membersFeature && typeof service?.[name] === 'function';
  const isOwner = organization.role === 'owner';
  const canInvite = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.MEMBERS_INVITE,
  );
  // OFFICIALIZATION-V1: invitations, role changes and removals exist only where the
  // mounted service offers them (hybrid gateway); the rules below mirror the RPCs so
  // no button is offered that the backend must refuse.
  const canSendInvitations = canInvite && offers('inviteMember');
  const invitableRoles = INVITABLE_ROLES[organization.role] || [];
  const canChangeRoles = isOwner && offers('updateMemberRole');
  const canRemoveMember = (member) => offers('removeMember')
    && hasCapability(organization, TOURNAMENT_CAPABILITIES.MEMBERS_REMOVE)
    && member.status === 'active'
    && member.role !== 'owner'
    && !member.is_viewer
    && (member.role !== 'admin' || isOwner);
  const [inviteState, setInviteState] = useState({
    open: false, email: '', role: 'collaborator', status: 'idle', error: '', created: null,
  });
  const [invitations, setInvitations] = useState([]);
  const [memberAction, setMemberAction] = useState({ pendingId: '', error: '' });

  const loadInvitations = useCallback(async () => {
    if (!canInvite || !membersFeature || typeof service?.listMemberInvitations !== 'function') {
      setInvitations([]);
      return;
    }
    try {
      setInvitations(await service.listMemberInvitations({ organizationId: organization.id }) || []);
    } catch {
      setInvitations([]);
    }
  }, [canInvite, membersFeature, organization.id, service]);

  useEffect(() => { loadInvitations(); }, [loadInvitations]);

  const reloadMembers = async () => {
    const members = await service.listMembers(organization.id);
    setState((current) => ({ ...current, members }));
  };

  const sendInvitation = async (event) => {
    event.preventDefault();
    if (inviteState.status === 'loading') return;
    setInviteState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const result = await service.inviteMember({
        organizationId: organization.id,
        email: inviteState.email.trim(),
        role: inviteState.role,
      });
      setInviteState({
        open: true,
        email: '',
        role: inviteState.role,
        status: 'idle',
        error: '',
        created: {
          url: organizationInvitationUrl(result.token),
          email: result.email,
          role: result.role,
          expiresAt: result.expiresAt,
        },
      });
      await loadInvitations();
    } catch (error) {
      setInviteState((current) => ({
        ...current, status: 'idle', error: error?.message || 'No pudimos generar la invitación.',
      }));
    }
  };

  const revokeInvitation = async (invitation) => {
    if (memberAction.pendingId) return;
    if (!window.confirm(`¿Revocar la invitación de ${invitation.email}? El enlace dejará de funcionar.`)) return;
    setMemberAction({ pendingId: invitation.id, error: '' });
    try {
      await service.revokeMemberInvitation({ organizationId: organization.id, invitationId: invitation.id });
      await loadInvitations();
      setMemberAction({ pendingId: '', error: '' });
    } catch (error) {
      setMemberAction({ pendingId: '', error: error?.message || 'No pudimos revocar la invitación.' });
    }
  };

  const changeRole = async (member, role) => {
    if (memberAction.pendingId || role === member.role) return;
    if (!window.confirm(`¿Cambiar el rol de ${safeMemberLabel(member)} a ${getRoleLabel(role)}?`)) return;
    setMemberAction({ pendingId: member.id, error: '' });
    try {
      await service.updateMemberRole({ organizationId: organization.id, membershipId: member.id, role });
      await reloadMembers();
      setMemberAction({ pendingId: '', error: '' });
    } catch (error) {
      setMemberAction({ pendingId: '', error: error?.message || 'No pudimos cambiar el rol.' });
    }
  };

  const removeMember = async (member) => {
    if (memberAction.pendingId) return;
    if (!window.confirm(`¿Quitar a ${safeMemberLabel(member)} de la organización? Pierde el acceso y sus cupos de temporada.`)) return;
    setMemberAction({ pendingId: member.id, error: '' });
    try {
      await service.removeMember({ organizationId: organization.id, membershipId: member.id });
      await reloadMembers();
      setMemberAction({ pendingId: '', error: '' });
    } catch (error) {
      setMemberAction({ pendingId: '', error: error?.message || 'No pudimos quitar al miembro.' });
    }
  };

  // POST-BETA perf: the organization's seasons are already in the competition context that
  // OrganizationRouteGuard loads for every organization page. Reading them there (instead of a second
  // get_tournament_competition_context) lets the season accesses load in the same round as the member
  // list when the context is already in memory. Without that provider the page reads them itself.
  const [loadKey, setLoadKey] = useState(0);
  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    Promise.all([
      service.listMembers(organization.id),
      competition ? null : service.loadCompetitionContext(organization.id),
    ])
      .then(([members, ownCompetition]) => {
        if (!active) return;
        setState({
          status: 'ready', members, seasons: ownCompetition?.seasons || [], error: '',
        });
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
  // `competition` only decides whether the page reads the seasons itself; its updates don't reload.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey, organization.id, service, Boolean(competition)]);

  const seasons = competition ? competition.seasons : state.seasons;
  const pageStatus = (() => {
    if (state.status !== 'ready' || !competition) return state.status;
    if (competition.status === 'error') return 'error';
    return competition.status === 'ready' ? 'ready' : 'loading';
  })();
  const pageError = state.status === 'error' ? state.error : (competition?.error || state.error);
  const load = () => {
    if (competition?.status === 'error') competition.refresh().catch(() => {});
    setLoadKey((key) => key + 1);
  };

  useEffect(() => {
    setSelectedSeasonId((current) => (
      seasons.some((season) => season.id === current) ? current : (seasons[0]?.id || '')
    ));
  }, [seasons]);

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
      loadSeasonEntitlementsIfServed(service, {
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
        loadSeasonEntitlementsIfServed(service, {
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

  if (pageStatus === 'loading') return <WorkspaceLoading label="Cargando miembros…" />;
  if (pageStatus === 'error') return <WorkspaceError message={pageError} onRetry={load} />;

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
        <span><Users size={18} /> {formatCount(state.members.length, 'miembro', 'miembros')}</span>
        {canSendInvitations && (
          <button
            type="button"
            className={styles.membersToolbarAction}
            aria-expanded={inviteState.open}
            onClick={() => setInviteState((current) => ({
              ...current,
              open: !current.open,
              role: invitableRoles.includes(current.role) ? current.role : invitableRoles[0],
              error: '',
            }))}
          >
            <Plus size={17} />
            Invitar miembro
          </button>
        )}
      </div>

      {canSendInvitations && inviteState.open && (
        <section className={styles.seasonAssignments} aria-labelledby="invite-member-title">
          <header>
            <div>
              <span className={styles.eyebrow}>Invitación privada</span>
              <h2 id="invite-member-title">Invitar miembro</h2>
              <p>
                Generamos un enlace de un solo uso, válido por 7 días. Sólo puede aceptarlo la cuenta
                de Arma2 con ese email verificado. Compartilo vos: no enviamos emails.
              </p>
            </div>
          </header>
          {inviteState.created ? (
            <div className={styles.inviteResult}>
              <p>
                Enlace para <strong>{inviteState.created.email}</strong> como{' '}
                {getRoleLabel(inviteState.created.role)}. No volverá a mostrarse; vence el{' '}
                {new Date(inviteState.created.expiresAt).toLocaleString('es-AR')}.
              </p>
              <div className={styles.inviteLinkRow}>
                <input readOnly value={inviteState.created.url} aria-label="Enlace de invitación" />
                <button type="button" onClick={() => navigator.clipboard?.writeText(inviteState.created.url)}>
                  <Copy size={15} /> Copiar
                </button>
              </div>
              <button
                type="button"
                className={styles.inviteSecondary}
                onClick={() => setInviteState((current) => ({ ...current, created: null }))}
              >
                Invitar a otra persona
              </button>
            </div>
          ) : (
            <form className={styles.inviteForm} onSubmit={sendInvitation}>
              <label>
                <span>Email</span>
                <input
                  type="email"
                  required
                  value={inviteState.email}
                  onChange={(event) => setInviteState((current) => ({ ...current, email: event.target.value }))}
                  placeholder="nombre@club.com"
                />
              </label>
              <label>
                <span>Rol</span>
                <select
                  value={inviteState.role}
                  onChange={(event) => setInviteState((current) => ({ ...current, role: event.target.value }))}
                >
                  {invitableRoles.map((role) => (
                    <option key={role} value={role}>{getRoleLabel(role)}</option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={inviteState.status === 'loading' || !inviteState.email.trim()}>
                {inviteState.status === 'loading' ? <LoaderCircle className={styles.spinIcon} size={15} /> : <Mail size={15} />}
                Generar enlace
              </button>
            </form>
          )}
          {inviteState.error && <p className={styles.assignmentError} role="alert">{inviteState.error}</p>}
          {!isOwner && (
            <p className={styles.assignmentEmpty}>Sólo el Propietario puede invitar Administradores.</p>
          )}
        </section>
      )}

      {canSendInvitations && invitations.length > 0 && (
        <section className={styles.seasonAssignments} aria-labelledby="pending-invitations-title">
          <header>
            <div>
              <span className={styles.eyebrow}>Pendientes</span>
              <h2 id="pending-invitations-title">Invitaciones enviadas</h2>
            </div>
          </header>
          <div className={styles.assignmentList}>
            {invitations.map((invitation) => (
              <article key={invitation.id}>
                <span>
                  <strong>{invitation.email}</strong>
                  <small>
                    {getRoleLabel(invitation.role)}
                    {' · '}
                    {invitation.status === 'expired'
                      ? 'Vencida'
                      : `Vence ${formatDate(invitation.expiresAt)}`}
                  </small>
                </span>
                {(invitation.role !== 'admin' || isOwner) && (
                  <button
                    type="button"
                    disabled={Boolean(memberAction.pendingId)}
                    onClick={() => revokeInvitation(invitation)}
                  >
                    {memberAction.pendingId === invitation.id
                      ? <LoaderCircle className={styles.spinIcon} size={15} />
                      : <X size={15} />}
                    Revocar
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

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
          {seasons.length > 0 && (
            <label>
              <span>Temporada</span>
              <select
                value={selectedSeasonId}
                onChange={(event) => setSelectedSeasonId(event.target.value)}
              >
                {seasons.map((season) => (
                  <option key={season.id} value={season.id}>{season.name}</option>
                ))}
              </select>
            </label>
          )}
        </header>

        {seasons.length === 0 && (
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
                        <strong>{safeMemberLabel(member)}</strong>
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

      {memberAction.error && (
        <p className={styles.assignmentError} role="alert">{memberAction.error}</p>
      )}

      <div className={styles.memberList}>
        {state.members.map((member) => (
          <article key={member.id}>
            <span className={styles.memberAvatar}><UserRound size={20} /></span>
            <span className={styles.memberIdentity}>
              <strong>{safeMemberLabel(member)}</strong>
              <small>
                <Clock3 size={13} />
                Desde {formatDate(member.joined_at || member.created_at)}
              </small>
            </span>
            <span className={styles.memberRole}>
              {canChangeRoles && member.role !== 'owner' && !member.is_viewer && member.status === 'active' ? (
                <select
                  aria-label={`Rol de ${safeMemberLabel(member)}`}
                  value={member.role}
                  disabled={Boolean(memberAction.pendingId)}
                  onChange={(event) => changeRole(member, event.target.value)}
                >
                  <option value="admin">{getRoleLabel('admin')}</option>
                  <option value="collaborator">{getRoleLabel('collaborator')}</option>
                </select>
              ) : (
                <span className={styles.roleChip}>{getRoleLabel(member.role)}</span>
              )}
              <small>{getRoleDescription(member.role)}</small>
            </span>
            <span className={member.status === 'active' ? styles.activeChip : styles.neutralChip}>
              {member.status === 'active' ? 'Activo' : 'Suspendido'}
            </span>
            {canRemoveMember(member) && (
              <button
                type="button"
                className={styles.memberRemove}
                disabled={Boolean(memberAction.pendingId)}
                onClick={() => removeMember(member)}
                aria-label={`Quitar a ${safeMemberLabel(member)}`}
              >
                {memberAction.pendingId === member.id
                  ? <LoaderCircle className={styles.spinIcon} size={15} />
                  : <Trash2 size={15} />}
              </button>
            )}
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
