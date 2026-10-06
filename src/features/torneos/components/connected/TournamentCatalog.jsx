import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Compass,
  MapPin,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Timer,
  Users,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CATALOG_SORTS,
  CATALOG_STATE,
  GENDER_LABELS,
  entryFeeLabel,
  formatDay,
  periodLabel,
  sportLabel,
} from '../../domain/connectedProduct';
import { getCompetitionFormatName } from '../../domain/competitionCatalog';
import styles from './ConnectedProduct.module.css';

// URL ⇄ filters. The URL is the state, so a search can be shared and the back button restores it.
const PARAM = Object.freeze({
  query: 'q', locality: 'localidad', sport: 'deporte', gender: 'genero', scope: 'todas',
  from: 'desde', to: 'hasta', sort: 'orden', page: 'pagina',
});

export function readCatalogFilters(searchParams) {
  const page = Number.parseInt(searchParams.get(PARAM.page) || '1', 10);
  const sort = searchParams.get(PARAM.sort);
  return {
    query: searchParams.get(PARAM.query) || '',
    locality: searchParams.get(PARAM.locality) || '',
    sport: searchParams.get(PARAM.sport) || '',
    gender: searchParams.get(PARAM.gender) || '',
    scope: searchParams.get(PARAM.scope) === '1' ? 'all' : 'open',
    from: searchParams.get(PARAM.from) || '',
    to: searchParams.get(PARAM.to) || '',
    sort: CATALOG_SORTS.some((item) => item.value === sort) ? sort : 'closing',
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 50) : 1,
  };
}

function writeCatalogFilters(filters) {
  const next = new URLSearchParams();
  if (filters.query) next.set(PARAM.query, filters.query);
  if (filters.locality) next.set(PARAM.locality, filters.locality);
  if (filters.sport) next.set(PARAM.sport, filters.sport);
  if (filters.gender) next.set(PARAM.gender, filters.gender);
  if (filters.scope === 'all') next.set(PARAM.scope, '1');
  if (filters.from) next.set(PARAM.from, filters.from);
  if (filters.to) next.set(PARAM.to, filters.to);
  if (filters.sort && filters.sort !== 'closing') next.set(PARAM.sort, filters.sort);
  if (filters.page > 1) next.set(PARAM.page, String(filters.page));
  return next;
}

export function CatalogStateChip({ state }) {
  const meta = CATALOG_STATE[state] || CATALOG_STATE.closed;
  return <span className={styles.stateChip} data-tone={meta.tone}>{meta.label}</span>;
}

function CatalogCard({ item, to }) {
  const categories = Array.isArray(item.categories) ? item.categories : [];
  const shown = categories.slice(0, 3);
  return (
    <article className={styles.catalogCard}>
      <header className={styles.catalogCardHeader}>
        <CatalogStateChip state={item.state} />
        {item.registrationClosesAt && item.state === 'open' && (
          <span className={styles.closingHint}>
            <Timer size={14} aria-hidden="true" />
            Cierra {formatDay(item.registrationClosesAt)}
          </span>
        )}
      </header>
      <div className={styles.catalogCardTitle}>
        <h2>{item.tournamentName}</h2>
        <p>{item.organizationName}</p>
      </div>
      {item.summary && <p className={styles.catalogCardSummary}>{item.summary}</p>}
      <dl className={styles.catalogFacts}>
        <div>
          <dt><MapPin size={14} aria-hidden="true" /> Dónde</dt>
          <dd>{[item.venueName, item.locality].filter(Boolean).join(' · ') || 'A confirmar'}</dd>
        </div>
        <div>
          <dt><Users size={14} aria-hidden="true" /> Formato</dt>
          <dd>
            {sportLabel(item.sportModality)}
            {' · '}
            {getCompetitionFormatName(item.competitionFormat, 'Formato a definir')}
            {item.genderCategory ? ` · ${GENDER_LABELS[item.genderCategory] || item.genderCategory}` : ''}
          </dd>
        </div>
        <div>
          <dt><CalendarDays size={14} aria-hidden="true" /> Cuándo</dt>
          <dd>{periodLabel(item.startDate, item.endDate)}</dd>
        </div>
      </dl>
      <div className={styles.catalogCardFooter}>
        <ul className={styles.categoryChips} aria-label="Categorías">
          {shown.map((category) => <li key={category.slug}>{category.name}</li>)}
          {categories.length > shown.length && <li>+{categories.length - shown.length}</li>}
        </ul>
        <span className={styles.feeLabel}>{entryFeeLabel(item.entryFee)}</span>
      </div>
      <Link className={styles.cardLink} to={to} aria-label={`Ver convocatoria de ${item.tournamentName}`}>
        Ver convocatoria
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </article>
  );
}

function CatalogSkeleton() {
  return (
    <div className={styles.catalogGrid} aria-hidden="true">
      {[1, 2, 3].map((key) => <div key={key} className={styles.catalogSkeleton}><span /><span /><span /></div>)}
    </div>
  );
}

// The catalog itself. `entryPath(item)` decides where a card leads (the in-app call page or the public one);
// `service` is the catalog service of the current composition (never Core).
export default function TournamentCatalog({ service, entryPath, intro = null }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readCatalogFilters(searchParams), [searchParams]);
  const [draftQuery, setDraftQuery] = useState(filters.query);
  const [showFilters, setShowFilters] = useState(false);
  const [facets, setFacets] = useState(null);
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  const requestRef = useRef(0);
  const resultsRef = useRef(null);

  useEffect(() => { setDraftQuery(filters.query); }, [filters.query]);

  useEffect(() => {
    let active = true;
    service.loadFacets().then((value) => { if (active) setFacets(value); }).catch(() => { if (active) setFacets(null); });
    return () => { active = false; };
  }, [service]);

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState((current) => ({ status: 'loading', data: current.data, error: '' }));
    try {
      const data = await service.search(filters);
      if (requestRef.current === requestId) setState({ status: 'ready', data, error: '' });
    } catch (error) {
      if (requestRef.current === requestId) {
        setState({ status: 'error', data: null, error: error?.message || 'No pudimos cargar las convocatorias.' });
      }
    }
  }, [filters, service]);

  useEffect(() => {
    load();
    return () => { requestRef.current += 1; };
  }, [load]);

  const update = (patch, { resetPage = true } = {}) => {
    const next = { ...filters, ...patch, ...(resetPage ? { page: 1 } : {}) };
    setSearchParams(writeCatalogFilters(next));
  };

  const goToPage = (page) => {
    update({ page }, { resetPage: false });
    window.requestAnimationFrame(() => resultsRef.current?.focus());
  };

  const items = state.data?.items || [];
  const total = state.data?.total || 0;
  const pageSize = state.data?.pageSize || 12;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const activeFilters = ['locality', 'sport', 'gender', 'from', 'to'].filter((key) => filters[key]).length
    + (filters.scope === 'all' ? 1 : 0);

  return (
    <div className={styles.catalog}>
      {intro}
      <form
        className={styles.catalogSearch}
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          update({ query: draftQuery.trim() });
        }}
      >
        <label className={styles.searchField}>
          <Search size={18} aria-hidden="true" />
          <span className={styles.srOnly}>Buscar por torneo, organizador o localidad</span>
          <input
            type="search"
            value={draftQuery}
            maxLength={80}
            placeholder="Torneo, organizador o localidad"
            onChange={(event) => setDraftQuery(event.target.value)}
          />
        </label>
        <button type="submit" className={styles.primaryAction}>Buscar</button>
        <button
          type="button"
          className={styles.secondaryAction}
          aria-expanded={showFilters}
          aria-controls="catalog-filters"
          onClick={() => setShowFilters((value) => !value)}
        >
          <SlidersHorizontal size={17} aria-hidden="true" />
          Filtros{activeFilters ? ` (${activeFilters})` : ''}
        </button>
      </form>

      <div id="catalog-filters" className={styles.catalogFilters} hidden={!showFilters}>
        <label>
          <span>Localidad</span>
          <select value={filters.locality} onChange={(event) => update({ locality: event.target.value })}>
            <option value="">Todas</option>
            {(facets?.localities || []).map((item) => (
              <option key={item.label} value={item.label}>{item.label} ({item.count})</option>
            ))}
          </select>
        </label>
        <label>
          <span>Deporte</span>
          <select value={filters.sport} onChange={(event) => update({ sport: event.target.value })}>
            <option value="">Todos</option>
            {(facets?.sports || []).map((item) => (
              <option key={item.value} value={item.value}>{sportLabel(item.value)} ({item.count})</option>
            ))}
          </select>
        </label>
        <label>
          <span>Rama</span>
          <select value={filters.gender} onChange={(event) => update({ gender: event.target.value })}>
            <option value="">Todas</option>
            {Object.entries(GENDER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>Empieza desde</span>
          <input type="date" value={filters.from} onChange={(event) => update({ from: event.target.value })} />
        </label>
        <label>
          <span>Empieza hasta</span>
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => update({ to: event.target.value })} />
        </label>
        <label className={styles.checkboxField}>
          <input
            type="checkbox"
            checked={filters.scope === 'open'}
            onChange={(event) => update({ scope: event.target.checked ? 'open' : 'all' })}
          />
          <span>Sólo con inscripción abierta</span>
        </label>
        {activeFilters > 0 && (
          <button
            type="button"
            className={styles.textAction}
            onClick={() => update({ locality: '', sport: '', gender: '', from: '', to: '', scope: 'open' })}
          >
            Limpiar filtros
          </button>
        )}
      </div>

      <div className={styles.catalogToolbar}>
        <p ref={resultsRef} tabIndex={-1} className={styles.resultCount} aria-live="polite">
          {state.status === 'loading' && !state.data ? 'Buscando convocatorias…' : `${total} ${total === 1 ? 'convocatoria' : 'convocatorias'}`}
        </p>
        <label className={styles.sortField}>
          <span>Ordenar por</span>
          <select value={filters.sort} onChange={(event) => update({ sort: event.target.value })}>
            {CATALOG_SORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
      </div>

      {state.status === 'loading' && !state.data && <CatalogSkeleton />}

      {state.status === 'error' && (
        <section className={styles.stateCard} role="alert">
          <RefreshCw size={26} aria-hidden="true" />
          <h2>No pudimos cargar las convocatorias</h2>
          <p>{state.error}</p>
          <button type="button" className={styles.secondaryAction} onClick={load}>Reintentar</button>
        </section>
      )}

      {state.status !== 'error' && state.data && items.length === 0 && (
        <section className={styles.stateCard}>
          <Compass size={28} aria-hidden="true" />
          <h2>{filters.scope === 'open' && !filters.query && activeFilters === 0
            ? 'Todavía no hay convocatorias abiertas'
            : 'No encontramos convocatorias con esos filtros'}</h2>
          <p>
            Las organizaciones publican acá cuando abren la inscripción a equipos. Probá con otros filtros
            {filters.scope === 'open' ? ' o mirá también las que ya cerraron.' : '.'}
          </p>
          {filters.scope === 'open' && (
            <button type="button" className={styles.secondaryAction} onClick={() => update({ scope: 'all' })}>
              Ver también las cerradas
            </button>
          )}
        </section>
      )}

      {items.length > 0 && (
        <div className={styles.catalogGrid} aria-busy={state.status === 'loading'}>
          {items.map((item) => <CatalogCard key={item.publicSlug} item={item} to={entryPath(item)} />)}
        </div>
      )}

      {pages > 1 && (
        <nav className={styles.pagination} aria-label="Páginas de convocatorias">
          <button
            type="button"
            className={styles.secondaryAction}
            disabled={filters.page <= 1 || state.status === 'loading'}
            onClick={() => goToPage(filters.page - 1)}
          >
            <ChevronLeft size={17} aria-hidden="true" /> Anterior
          </button>
          <span>Página {filters.page} de {pages}</span>
          <button
            type="button"
            className={styles.secondaryAction}
            disabled={filters.page >= pages || state.status === 'loading'}
            onClick={() => goToPage(filters.page + 1)}
          >
            Siguiente <ChevronRight size={17} aria-hidden="true" />
          </button>
        </nav>
      )}
    </div>
  );
}
