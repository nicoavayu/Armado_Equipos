import React, { useEffect, useState } from 'react';
import { Clock3, LockKeyhole, Plus, UserRound, Users } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import {
  getRoleLabel,
  hasCapability,
  TOURNAMENT_CAPABILITIES,
} from '../domain/capabilities';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import styles from './TorneosShell.module.css';

function safeMemberLabel(member, organization) {
  if (member.role === 'owner') return `Owner de ${organization.name}`;
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
  const [state, setState] = useState({ status: 'loading', members: [], error: '' });
  const canInvite = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.MEMBERS_INVITE,
  );

  const load = async () => {
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const members = await service.listMembers(organization.id);
      setState({ status: 'ready', members, error: '' });
    } catch (error) {
      setState({
        status: 'error',
        members: [],
        error: error?.message || 'No pudimos cargar los miembros.',
      });
    }
  };

  useEffect(() => {
    let active = true;
    service.listMembers(organization.id)
      .then((members) => {
        if (active) setState({ status: 'ready', members, error: '' });
      })
      .catch((error) => {
        if (active) {
          setState({
            status: 'error',
            members: [],
            error: error?.message || 'No pudimos cargar los miembros.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [organization.id, service]);

  if (state.status === 'loading') return <WorkspaceLoading label="Cargando miembros…" />;
  if (state.status === 'error') return <WorkspaceError message={state.error} onRetry={load} />;

  return (
    <div className={styles.membersPage}>
      <header className={styles.pageHeader}>
        <span className={styles.eyebrow}>Acceso institucional</span>
        <h1>Miembros</h1>
        <p>Roles y estados visibles dentro de esta organización.</p>
      </header>

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
            <span className={styles.roleChip}>{getRoleLabel(member.role)}</span>
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
