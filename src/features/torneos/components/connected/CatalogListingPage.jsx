import React, {
  useCallback,
  useEffect,
  useState,
} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Compass,
  Globe2,
  Inbox,
  Loader2,
  Save,
  ShieldAlert,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useTorneosWorkspace } from '../../context/TorneosWorkspaceContext';
import { canonicalRoutes } from '../../routing/canonicalRoutes';
import { BLOCK_REASON_COPY } from '../../domain/connectedProduct';
import TournamentPublicPageSettings from '../TournamentPublicPageSettings';
import { CatalogStateChip } from './TournamentCatalog';
import styles from './ConnectedProduct.module.css';

const APPLICATION_STATES = Object.freeze([
  { value: 'open', label: 'Abiertas', detail: 'Los equipos pueden pedir y enviar solicitudes.' },
  { value: 'paused', label: 'Pausadas', detail: 'Nadie puede enviar ahora; lo ya enviado sigue en tu bandeja.' },
  { value: 'closed', label: 'Cerradas', detail: 'No se reciben más solicitudes.' },
]);

function toForm(listing) {
  const fee = listing?.entryFeeCents;
  return {
    summary: listing?.summary || '',
    locality: listing?.locality || '',
    venueId: listing?.venueId || '',
    feeMode: fee === null || fee === undefined ? 'unknown' : (Number(fee) === 0 ? 'free' : 'amount'),
    feeAmount: fee ? String(Math.round(Number(fee) / 100)) : '',
    entryFeeIncludes: listing?.entryFeeIncludes || '',
    paymentNote: listing?.paymentNote || '',
    requirements: listing?.requirements || '',
    rulesSummary: listing?.rulesSummary || '',
  };
}

function CapacityRow({ category, disabled, onSave }) {
  const [value, setValue] = useState(category.capacity ? String(category.capacity) : '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setValue(category.capacity ? String(category.capacity) : ''); }, [category.capacity]);
  const parsed = value.trim() === '' ? null : Number.parseInt(value, 10);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 2 && parsed <= 256);
  const changed = (parsed ?? null) !== (category.capacity ?? null);
  return (
    <li className={styles.capacityRow}>
      <div>
        <strong>{category.name}</strong>
        <span>
          {category.approved} {category.approved === 1 ? 'aprobado' : 'aprobados'}
          {' · '}
          {category.pending} {category.pending === 1 ? 'solicitud pendiente' : 'solicitudes pendientes'}
        </span>
      </div>
      <label>
        <span className={styles.srOnly}>Cupo de {category.name}</span>
        <input
          type="number"
          inputMode="numeric"
          min={2}
          max={256}
          placeholder="Sin cupo"
          value={value}
          disabled={disabled || busy}
          aria-invalid={!valid}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <button
        type="button"
        className={styles.secondaryAction}
        disabled={disabled || busy || !valid || !changed}
        onClick={async () => {
          setBusy(true);
          try { await onSave(category, parsed); } finally { setBusy(false); }
        }}
      >
        {busy ? <Loader2 className={styles.spin} size={15} aria-hidden="true" /> : 'Guardar'}
      </button>
    </li>
  );
}

// The organizer's call for teams. Three explicit, separate decisions shown together: the tournament's public page
// (existing), its appearance in Explorar torneos, and whether requests are received. Plus what a team needs to
// decide (place, cost, requirements, rules) and the optional capacity per category. Nothing here is a checkout.
export default function CatalogListingPage() {
  const { organizationId, tournamentId } = useParams();
  const { service } = useTorneosWorkspace();
  const [state, setState] = useState({ status: 'loading', settings: null, error: '' });
  const [form, setForm] = useState(toForm(null));
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState({ tone: '', text: '' });

  const load = useCallback(async () => {
    try {
      const settings = await service.loadCatalogListingSettings({ organizationId, tournamentId });
      setState({ status: 'ready', settings, error: '' });
      setForm(toForm(settings.listing));
    } catch (error) {
      setState({ status: 'error', settings: null, error: error?.message || 'No pudimos cargar la convocatoria.' });
    }
  }, [organizationId, service, tournamentId]);

  useEffect(() => { load(); }, [load]);

  const run = async (key, action, success) => {
    setBusy(key);
    setNotice({ tone: '', text: '' });
    try {
      const settings = await action();
      if (settings?.listing) {
        setState({ status: 'ready', settings, error: '' });
        setForm(toForm(settings.listing));
      } else {
        await load();
      }
      setNotice({ tone: 'success', text: success });
    } catch (error) {
      setNotice({ tone: 'error', text: error?.message || 'No pudimos guardar el cambio.' });
    } finally {
      setBusy('');
    }
  };

  if (state.status === 'loading') return <div className={styles.skeletonBlock} role="status"><span className={styles.srOnly}>Cargando convocatoria…</span></div>;
  if (state.status === 'error') {
    return (
      <section className={styles.stateCard} role="alert">
        <h1>No pudimos abrir la convocatoria</h1>
        <p>{state.error}</p>
        <button type="button" className={styles.secondaryAction} onClick={load}>Reintentar</button>
      </section>
    );
  }

  const { settings } = state;
  const { listing } = settings;
  const canManage = settings.canManage === true;
  const removed = listing.platformRemoved === true;
  const feeCents = form.feeMode === 'free' ? 0
    : form.feeMode === 'amount' && form.feeAmount.trim() ? Number.parseInt(form.feeAmount, 10) * 100 : null;
  const feeValid = form.feeMode !== 'amount' || (Number.isInteger(feeCents) && feeCents > 0);
  const formValid = form.summary.trim().length >= 10 && form.locality.trim().length >= 2 && feeValid;

  const saveListing = (event) => {
    event.preventDefault();
    if (!formValid) return;
    run('save', () => service.saveCatalogListing({
      organizationId,
      tournamentId,
      summary: form.summary.trim(),
      locality: form.locality.trim(),
      venueId: form.venueId || null,
      entryFeeCents: feeCents,
      entryFeeIncludes: form.entryFeeIncludes.trim() || null,
      paymentNote: form.paymentNote.trim() || null,
      requirements: form.requirements.trim() || null,
      rulesSummary: form.rulesSummary.trim() || null,
    }), 'Convocatoria guardada.');
  };

  const field = (key) => ({
    value: form[key],
    disabled: !canManage || removed,
    onChange: (event) => setForm((current) => ({ ...current, [key]: event.target.value })),
  });

  return (
    <div className={styles.page}>
      <Link className={styles.backLink} to={canonicalRoutes.tournamentTeams(organizationId, tournamentId)}>
        <ArrowLeft size={17} aria-hidden="true" /> Equipos
      </Link>
      <header className={styles.pageHero}>
        <span className={styles.kicker}><Compass size={15} aria-hidden="true" /> Convocatoria a equipos</span>
        <h1>{settings.tournament.name}</h1>
        <p>
          Publicá el torneo en Explorar torneos para que equipos de Arma2 pidan inscribirse. Cada paso es una decisión
          separada: nada se publica ni se abre solo.
        </p>
      </header>

      {removed && (
        <p className={styles.callNotice} role="alert">
          <ShieldAlert size={16} aria-hidden="true" /> Arma2 retiró esta convocatoria del catálogo
          {listing.platformRemovedReason ? `: ${listing.platformRemovedReason}` : '.'} No puede volver a publicarse.
        </p>
      )}
      {notice.text && (
        <p className={notice.tone === 'error' ? styles.errorText : styles.successNotice} role={notice.tone === 'error' ? 'alert' : 'status'}>
          {notice.tone === 'error' ? <AlertCircle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />} {notice.text}
        </p>
      )}

      <ol className={styles.publicationSteps}>
        <li>
          <header><span>1</span><div><h2><Globe2 size={17} aria-hidden="true" /> Página pública</h2><p>La ficha del torneo. La convocatoria se muestra ahí.</p></div></header>
          <TournamentPublicPageSettings
            organizationId={organizationId}
            tournamentId={tournamentId}
            canPublish={canManage}
            service={service}
            onChange={load}
          />
        </li>
        <li>
          <header>
            <span>2</span>
            <div>
              <h2><Compass size={17} aria-hidden="true" /> Aparición en Explorar torneos</h2>
              <p>{listing.status === 'listed' ? 'Visible en el catálogo.' : 'No aparece en el catálogo.'}</p>
            </div>
            {settings.visibleInCatalog && <CatalogStateChip state={settings.catalogState} />}
          </header>
          {canManage && !removed && (
            listing.status === 'listed' ? (
              <button type="button" className={styles.secondaryAction} disabled={Boolean(busy)}
                onClick={() => run('unlist', () => service.setCatalogListingStatus({ organizationId, tournamentId, listed: false }),
                  'La convocatoria salió del catálogo y las solicitudes quedaron pausadas.')}>
                Retirar del catálogo
              </button>
            ) : (
              <button type="button" className={styles.primaryAction} disabled={Boolean(busy) || !listing.exists}
                onClick={() => run('list', () => service.setCatalogListingStatus({ organizationId, tournamentId, listed: true }),
                  'Convocatoria publicada en Explorar torneos. Las solicitudes siguen cerradas hasta que las abras.')}>
                Publicar en Explorar torneos
              </button>
            )
          )}
          {!listing.exists && <p className={styles.help}>Primero guardá los datos de la convocatoria (abajo).</p>}
        </li>
        <li>
          <header>
            <span>3</span>
            <div>
              <h2><Inbox size={17} aria-hidden="true" /> Solicitudes de inscripción</h2>
              <p>{APPLICATION_STATES.find((item) => item.value === listing.applicationsState)?.detail}</p>
            </div>
          </header>
          <div className={styles.segmented} role="radiogroup" aria-label="Recepción de solicitudes">
            {APPLICATION_STATES.map((item) => (
              <button
                key={item.value}
                type="button"
                role="radio"
                aria-checked={listing.applicationsState === item.value}
                disabled={!canManage || removed || Boolean(busy) || listing.applicationsState === item.value || !listing.exists}
                onClick={() => run(`state:${item.value}`, () => service.setApplicationsState({ organizationId, tournamentId, state: item.value }),
                  `Solicitudes ${item.label.toLowerCase()}.`)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {settings.blockReason && listing.applicationsState === 'open' && (
            <p className={styles.warningText}>{BLOCK_REASON_COPY[settings.blockReason]}</p>
          )}
          <Link className={styles.textAction} to={canonicalRoutes.tournamentApplications(organizationId, tournamentId)}>
            Ver solicitudes recibidas <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </li>
      </ol>

      <form className={styles.profileSection} onSubmit={saveListing} aria-labelledby="listing-form-title">
        <header>
          <h2 id="listing-form-title">Lo que un equipo necesita para decidir</h2>
          <p>Se publica tal cual en la convocatoria. No se publican planteles, contactos ni datos internos.</p>
        </header>
        <label className={styles.field}>
          <span>Resumen (10 a 280 caracteres)</span>
          <textarea rows={3} maxLength={280} {...field('summary')} />
        </label>
        <div className={styles.fieldRow}>
          <label className={styles.field}>
            <span>Localidad</span>
            <input maxLength={80} placeholder="Ej.: Palermo, CABA" {...field('locality')} />
          </label>
          <label className={styles.field}>
            <span>Sede principal (opcional)</span>
            <select {...field('venueId')}>
              <option value="">Sin sede publicada</option>
              {settings.venues.map((venue) => (
                <option key={venue.id} value={venue.id}>{venue.name}{venue.locality ? ` · ${venue.locality}` : ''}</option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className={styles.field}>
          <legend>Costo de inscripción por equipo</legend>
          <div className={styles.segmented} role="radiogroup" aria-label="Costo">
            {[['unknown', 'A confirmar'], ['free', 'Sin costo'], ['amount', 'Con costo']].map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={form.feeMode === value}
                disabled={!canManage || removed}
                onClick={() => setForm((current) => ({ ...current, feeMode: value }))}>{label}</button>
            ))}
          </div>
          {form.feeMode === 'amount' && (
            <label className={styles.field}>
              <span>Monto en pesos</span>
              <input type="number" inputMode="numeric" min={1} {...field('feeAmount')} aria-invalid={!feeValid} />
            </label>
          )}
        </fieldset>
        {form.feeMode === 'amount' && (
          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span>Qué incluye (opcional)</span>
              <input maxLength={300} {...field('entryFeeIncludes')} />
            </label>
            <label className={styles.field}>
              <span>Cómo se paga (opcional)</span>
              <input maxLength={300} placeholder="Ej.: transferencia a la liga antes del sorteo" {...field('paymentNote')} />
            </label>
          </div>
        )}
        {form.feeMode === 'amount' && <p className={styles.help}>Arma2 no cobra ni procesa este pago: es información para los equipos.</p>}
        <label className={styles.field}>
          <span>Requisitos (opcional)</span>
          <textarea rows={2} maxLength={600} {...field('requirements')} />
        </label>
        <label className={styles.field}>
          <span>Reglas principales (opcional)</span>
          <textarea rows={4} maxLength={1200} {...field('rulesSummary')} />
        </label>
        {canManage && !removed && (
          <div className={styles.formActions}>
            <button type="submit" className={styles.primaryAction} disabled={!formValid || Boolean(busy)}>
              {busy === 'save' ? <Loader2 className={styles.spin} size={17} aria-hidden="true" /> : <Save size={17} aria-hidden="true" />}
              Guardar convocatoria
            </button>
          </div>
        )}
      </form>

      <section className={styles.profileSection} aria-labelledby="capacity-title">
        <header>
          <h2 id="capacity-title">Cupos por categoría</h2>
          <p>Opcional. Un cupo lo ocupa una inscripción aprobada; las solicitudes pendientes no. Sin cupo, no hay límite publicado.</p>
        </header>
        <ul className={styles.capacityList}>
          {settings.categories.map((category) => (
            <CapacityRow
              key={category.id}
              category={category}
              disabled={!canManage || removed || Boolean(busy)}
              onSave={(item, maxTeams) => run(`capacity:${item.id}`, () => service.saveCategoryCapacity({
                organizationId, tournamentId, categoryId: item.id, maxTeams,
              }), `Cupo de ${item.name} guardado.`)}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
