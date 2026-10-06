import React from 'react';
import {
  CalendarDays,
  CircleDollarSign,
  ClipboardList,
  MapPin,
  MessageCircle,
  ShieldCheck,
  Timer,
  Users,
} from 'lucide-react';
import {
  BLOCK_REASON_COPY,
  GENDER_LABELS,
  ageRangeLabel,
  capacityLabel,
  entryFeeLabel,
  entryFeeState,
  formatDateTime,
  periodLabel,
  sportLabel,
  whatsappContactUrl,
} from '../../domain/connectedProduct';
import { getCompetitionFormatName } from '../../domain/competitionCatalog';
import CatalogStateChip from './CatalogStateChip';
import styles from './ConnectedProduct.module.css';

// The call for teams of ONE tournament: what a team needs to decide whether to take part. Same component inside the
// app and on the public page, fed by the same safe projection (get_tournament_catalog_entry); the tournament's own
// public page stays its only file. Nothing here is a checkout: Arma2 does not collect the entry fee.
// `mark`: the tournament's logo, rendered by the page that knows its branding rule (the public page shows its own).
export default function CatalogCallSection({ entry, actions = null, headingLevel = 2, compactHeader = false, mark = null }) {
  if (!entry) return null;
  const Heading = `h${headingLevel}`;
  const categories = Array.isArray(entry.categories) ? entry.categories : [];
  const venue = entry.venue;
  const feeState = entryFeeState(entry.entryFee);
  const whatsappUrl = whatsappContactUrl(entry.contactWhatsapp, entry.tournamentName);
  return (
    <section className={styles.callSection} aria-labelledby="catalog-call-title" data-catalog-call="true">
      <header className={styles.callHeader}>
        <div className={mark ? styles.callIdentity : undefined}>
          {mark}
          <div>
          <span className={styles.kicker}><ShieldCheck size={15} aria-hidden="true" /> Convocatoria a equipos</span>
          <Heading id="catalog-call-title">{compactHeader ? 'Convocatoria' : entry.tournamentName}</Heading>
          {!compactHeader && <p>Organiza {entry.organizationName}</p>}
          </div>
        </div>
        <CatalogStateChip state={entry.state} />
      </header>

      {entry.summary && <p className={styles.callSummary}>{entry.summary}</p>}

      {entry.state !== 'open' && entry.blockReason && (
        <p className={styles.callNotice} role="status">{BLOCK_REASON_COPY[entry.blockReason] || 'No está recibiendo solicitudes.'}</p>
      )}

      <dl className={styles.callFacts}>
        <div>
          <dt><MapPin size={15} aria-hidden="true" /> Dónde</dt>
          <dd>
            {venue ? <><strong>{venue.name}</strong>{venue.address ? `, ${venue.address}` : ''}</> : null}
            {venue ? <br /> : null}
            {entry.locality || venue?.locality || 'A confirmar'}
          </dd>
        </div>
        <div>
          <dt><Users size={15} aria-hidden="true" /> Deporte y formato</dt>
          <dd>
            {sportLabel(entry.sportModality)} · {getCompetitionFormatName(entry.competitionFormat, 'Formato a definir')}
            {entry.genderCategory ? ` · ${GENDER_LABELS[entry.genderCategory] || entry.genderCategory}` : ''}
            {entry.teamSize ? ` · ${entry.teamSize} titulares` : ''}
          </dd>
        </div>
        <div>
          <dt><CalendarDays size={15} aria-hidden="true" /> Competencia</dt>
          <dd>{periodLabel(entry.startDate, entry.endDate)}</dd>
        </div>
        <div>
          <dt><Timer size={15} aria-hidden="true" /> Inscripción</dt>
          <dd>
            {entry.registrationClosesAt ? `Cierra ${formatDateTime(entry.registrationClosesAt)}` : 'Sin fecha de cierre publicada'}
            {entry.registrationOpensAt && entry.state === 'upcoming' ? ` · abre ${formatDateTime(entry.registrationOpensAt)}` : ''}
          </dd>
        </div>
      </dl>

      <div className={styles.callFee}>
        <CircleDollarSign size={20} aria-hidden="true" />
        <div>
          {/* Not informed is not «free»: the organization did not publish a price. */}
          <strong>
            {feeState === 'not_informed'
              ? (whatsappUrl ? 'Precio: consultá al organizador' : 'Precio no informado por la organización')
              : entryFeeLabel(entry.entryFee)}
          </strong>
          {entry.entryFee?.includes && <span>Incluye: {entry.entryFee.includes}</span>}
          {entry.entryFee?.paymentNote && <span>{entry.entryFee.paymentNote}</span>}
          {feeState === 'price' && (
            <small>Es información de la organización: Arma2 no cobra ni procesa este pago.</small>
          )}
        </div>
      </div>

      {whatsappUrl && (
        <div className={styles.callContact}>
          <a className={styles.secondaryAction} href={whatsappUrl} target="_blank" rel="noopener noreferrer">
            <MessageCircle size={16} aria-hidden="true" /> Contactar al organizador por WhatsApp
          </a>
          <small>Consultar no es pedir la inscripción ni reserva un lugar.</small>
        </div>
      )}

      {categories.length > 0 && (
        <div className={styles.callCategories}>
          <h3>Categorías</h3>
          <ul>
            {categories.map((category) => (
              <li key={category.slug} data-accepting={category.accepting ? 'true' : 'false'}>
                <div>
                  <strong>{category.name}</strong>
                  <span>
                    {ageRangeLabel(category.minAge, category.maxAge)}
                    {category.gender ? ` · ${GENDER_LABELS[category.gender] || category.gender}` : ''}
                  </span>
                  {category.description && <small>{category.description}</small>}
                </div>
                <span className={styles.capacityLabel}>{capacityLabel(category)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(entry.requirements || entry.rulesSummary) && (
        <div className={styles.callRules}>
          {entry.requirements && (
            <div>
              <h3><ClipboardList size={16} aria-hidden="true" /> Requisitos</h3>
              <p>{entry.requirements}</p>
            </div>
          )}
          {entry.rulesSummary && (
            <div>
              <h3>Reglas</h3>
              <p>{entry.rulesSummary}</p>
            </div>
          )}
        </div>
      )}

      <p className={styles.callFinePrint}>
        Pedir la inscripción no garantiza un lugar: cada solicitud la revisa la organización y sólo una inscripción
        aprobada ocupa un cupo.
      </p>

      {actions && <div className={styles.callActions}>{actions}</div>}
    </section>
  );
}
