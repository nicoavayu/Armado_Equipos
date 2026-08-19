import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, MapPin, Plus } from 'lucide-react';
import { useOutletContext, useParams } from 'react-router-dom';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { hasCapability, TOURNAMENT_CAPABILITIES } from '../domain/capabilities';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import styles from './FixtureWorkspace.module.css';

//
// Sedes y canchas son de la organización, no del torneo: las tablas no tienen
// `tournament_id`. Esta pantalla existe para que dejen de necesitar un torneo y
// una categoría activos sólo porque la lectura venía empaquetada dentro del
// contexto de programación.
//
// La programación —ventanas semanales, horarios, reprogramaciones— sí es del
// torneo y vive en `.../torneo/:tournamentId/programacion`, consumiendo estas
// sedes y canchas de la organización.
//

const STATUS_LABELS = Object.freeze({
  active: 'Activa',
  archived: 'Archivada',
  inactive: 'Inactiva',
});

const statusLabel = (status) => STATUS_LABELS[status] || 'Sin definir';

const MODALITIES = [
  ['football_5', 'Fútbol 5'],
  ['football_6', 'Fútbol 6'],
  ['football_7', 'Fútbol 7'],
  ['football_8', 'Fútbol 8'],
  ['football_9', 'Fútbol 9'],
  ['football_11', 'Fútbol 11'],
  ['futsal', 'Futsal'],
];

const EMPTY_VENUE = Object.freeze({
  name: '', address: '', locality: '', timezone: 'America/Argentina/Buenos_Aires',
});

export default function OrganizationVenuesPage() {
  const { organizationId } = useParams();
  const { organization } = useOutletContext();
  const { service } = useTorneosWorkspace();
  const { venueId } = useParams();
  const requestRef = useRef(0);
  const [state, setState] = useState({
    status: 'loading', venues: [], courts: [], error: '', notice: '',
  });
  const [venue, setVenue] = useState(EMPTY_VENUE);
  const [court, setCourt] = useState({ venueId: '', name: '', sportModality: 'football_7' });
  const [busy, setBusy] = useState(false);

  const canManageVenues = hasCapability(organization, TOURNAMENT_CAPABILITIES.VENUES_CREATE);

  const load = useCallback(async ({ notice = '' } = {}) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (typeof service?.loadOrganizationVenues !== 'function') {
      setState({ status: 'ready', venues: [], courts: [], error: '', notice });
      return;
    }
    setState((current) => ({ ...current, status: 'loading', error: '', notice }));
    try {
      const payload = await service.loadOrganizationVenues(organizationId);
      if (requestRef.current !== requestId) return;
      setState({
        status: 'ready',
        venues: payload?.venues || [],
        courts: payload?.courts || [],
        error: '',
        notice,
      });
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setState({
        status: 'error',
        venues: [],
        courts: [],
        error: error?.message || 'No pudimos cargar las sedes.',
        notice: '',
      });
    }
  }, [organizationId, service]);

  useEffect(() => {
    load();
    return () => { requestRef.current += 1; };
  }, [load]);

  const run = async (operation, notice) => {
    if (busy) return;
    setBusy(true);
    try {
      await operation();
      await load({ notice });
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error?.message || 'No pudimos guardar el recurso.',
      }));
    } finally {
      setBusy(false);
    }
  };

  if (state.status === 'loading') return <WorkspaceLoading label="Cargando sedes y canchas…" />;
  if (state.status === 'error') {
    return <WorkspaceError message={state.error} onRetry={() => load().catch(() => {})} />;
  }

  const activeVenues = state.venues.filter((item) => item.status === 'active');
  const highlighted = venueId
    ? state.venues.find((item) => item.id === venueId) || null
    : null;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span>Recursos</span>
          <h1>Sedes</h1>
          <p>
            Infraestructura reusable de la organización. Se comparte entre todos
            los torneos y no pertenece a ninguno.
          </p>
        </div>
      </header>

      {state.notice && (
        <div className={styles.notice} role="status">
          <CheckCircle2 size={17} aria-hidden="true" />
          {state.notice}
        </div>
      )}
      {state.error && <div className={styles.notice} role="alert">{state.error}</div>}

      <div className={styles.venueLayout}>
        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <span>Recursos activos</span>
              <h2>Sedes y canchas</h2>
            </div>
          </div>
          {state.venues.length === 0 ? (
            <p>Todavía no hay sedes cargadas en esta organización.</p>
          ) : (
            <div className={styles.venueList}>
              {state.venues.map((item) => (
                <article
                  key={item.id}
                  aria-current={highlighted?.id === item.id ? 'true' : undefined}
                >
                  <MapPin size={19} aria-hidden="true" />
                  <div>
                    <h3>{item.name}</h3>
                    <p>{item.address}</p>
                    <small>
                      {state.courts.filter((value) => value.venueId === item.id).length}
                      {' canchas · '}
                      {statusLabel(item.status)}
                    </small>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {canManageVenues && (
          <section className={styles.resourceForms}>
            <form
              className={styles.panel}
              onSubmit={(event) => {
                event.preventDefault();
                run(
                  () => service.createVenue({ organizationId, ...venue }),
                  'Sede creada.',
                ).then(() => setVenue(EMPTY_VENUE));
              }}
            >
              <h2>Nueva sede</h2>
              <label>
                <span>Nombre</span>
                <input
                  required
                  value={venue.name}
                  onChange={(event) => setVenue({ ...venue, name: event.target.value })}
                />
              </label>
              <label>
                <span>Dirección</span>
                <input
                  required
                  value={venue.address}
                  onChange={(event) => setVenue({ ...venue, address: event.target.value })}
                />
              </label>
              <label>
                <span>Localidad</span>
                <input
                  value={venue.locality}
                  onChange={(event) => setVenue({ ...venue, locality: event.target.value })}
                />
              </label>
              <button type="submit" disabled={busy}>
                <Plus size={16} aria-hidden="true" /> Crear sede
              </button>
            </form>

            <form
              className={styles.panel}
              onSubmit={(event) => {
                event.preventDefault();
                run(
                  () => service.createCourt({ organizationId, ...court }),
                  'Cancha creada.',
                ).then(() => setCourt((current) => ({ ...current, name: '' })));
              }}
            >
              <h2>Nueva cancha</h2>
              <label>
                <span>Sede</span>
                <select
                  required
                  value={court.venueId}
                  onChange={(event) => setCourt({ ...court, venueId: event.target.value })}
                >
                  <option value="">Seleccionar</option>
                  {activeVenues.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Nombre</span>
                <input
                  required
                  value={court.name}
                  onChange={(event) => setCourt({ ...court, name: event.target.value })}
                />
              </label>
              <label>
                <span>Modalidad</span>
                <select
                  value={court.sportModality}
                  onChange={(event) => setCourt({ ...court, sportModality: event.target.value })}
                >
                  {MODALITIES.map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={busy}>
                <Plus size={16} aria-hidden="true" /> Crear cancha
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
