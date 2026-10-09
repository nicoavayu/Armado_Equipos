import React, { useEffect, useState } from 'react';
import { ArrowRight, ClipboardList } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTorneosWorkspace } from '../../context/TorneosWorkspaceContext';
import {
  BLOCK_REASON_COPY,
  OPEN_REGISTRATION_STATUSES,
  registrationStage,
} from '../../domain/connectedProduct';
import { canonicalRoutes } from '../../routing/canonicalRoutes';
import styles from './ConnectedProduct.module.css';

// Team entries the person represents that are NOT confirmed tournaments yet (requests in preparation, sent, with
// changes asked, or recently decided). Kept apart from «Mis torneos» on purpose: a request is not a place.
export default function MyRegistrationsSection({ limit = 6, includeDecided = true, onLoaded = null, compact = false }) {
  const { service, status } = useTorneosWorkspace();
  const supported = typeof service?.loadMyRegistrations === 'function';
  const [state, setState] = useState({ status: supported ? 'loading' : 'unsupported', items: [] });

  useEffect(() => {
    if (!supported || status !== 'ready') return undefined;
    let active = true;
    service.loadMyRegistrations({ limit: 30, offset: 0 })
      .then((payload) => {
        if (!active) return;
        const items = (payload?.items || []).filter((item) => (
          OPEN_REGISTRATION_STATUSES.includes(item.status)
          || (includeDecided && ['rejected', 'withdrawn'].includes(item.status))
        ));
        setState({ status: 'ready', items });
        if (typeof onLoaded === 'function') onLoaded(items);
      })
      .catch(() => { if (active) setState({ status: 'error', items: [] }); });
    return () => { active = false; };
    // onLoaded is a notification, not an input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeDecided, service, status, supported]);

  if (state.status !== 'ready' || !state.items.length) return null;
  const items = state.items.slice(0, limit);
  return (
    <section className={styles.registrations} aria-labelledby="registrations-title">
      <div className={styles.sectionTitle}>
        <span><ClipboardList size={15} aria-hidden="true" /> Inscripciones en curso</span>
        <h2 id="registrations-title">Tus solicitudes</h2>
        {!compact && <p>Todavía no son torneos confirmados: la organización decide cada una.</p>}
      </div>
      <ul className={styles.registrationList}>
        {items.map((item) => {
          const stage = registrationStage(item.status);
          return (
            <li key={item.teamEntryId}>
              <Link className={styles.registrationCard} to={canonicalRoutes.participantTeamEntry(item.organizationId, item.teamEntryId)}>
                <span className={styles.stateChip} data-tone={stage.tone}>{stage.label}</span>
                <strong>{item.teamName}</strong>
                <span>{item.tournamentName} · {item.categoryName}</span>
                <small>
                  {item.blockReason ? BLOCK_REASON_COPY[item.blockReason] : stage.detail}
                </small>
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
