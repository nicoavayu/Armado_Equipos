import React from 'react';
import MatchInfoHeader from './MatchInfoHeader';
import './MatchInfoSection.css';

// Robust parser for price strings returning number or null
const parsePriceNumber = (raw) => {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (str === '') return null;

  // Remove currency symbols and spaces but keep digits, dots, commas and minus
  let cleaned = str.replace(/[^0-9.,-]/g, '');
  if (cleaned === '') return null;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  const hasDot = lastDot !== -1;
  const hasComma = lastComma !== -1;

  // Both separators present
  if (hasDot && hasComma) {
    // Determine which is the decimal separator by which comes last
    if (lastComma > lastDot) {
      // ',' is decimal, '.' thousands -> remove dots, replace comma with dot
      cleaned = cleaned.replace(/\./g, '').replace(/,/g, '.');
    } else {
      // '.' is decimal, ',' thousands (US) -> remove commas
      // Also handle multiple dots (thousands separators) by keeping only the last dot as decimal
      cleaned = cleaned.replace(/,/g, '');
      const parts = cleaned.split('.');
      if (parts.length > 1) {
        const decimal = parts.pop();
        const integer = parts.join('');
        cleaned = integer + '.' + decimal;
      }
    }
  } else if (hasComma && !hasDot) {
    // Only comma: treat as decimal separator
    cleaned = cleaned.replace(/,/g, '.');
  } else if (hasDot && !hasComma) {
    // Only dot: could be decimal or thousands. If multiple dots, assume all but last are thousands
    const parts = cleaned.split('.');
    if (parts.length > 1) {
      const decimal = parts.pop();
      const integer = parts.join('');
      cleaned = integer + '.' + decimal;
    }
  }

  // Remove leading zeros except when number is like 0.xxx or -0.xxx
  // Keep minus if present
  try {
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  } catch (e) {
    return null;
  }
};

const formatPriceARS = (n) => {
  try {
    const num = Number(n);
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(num);
  } catch (e) {
    return `$ ${String(n)}`;
  }
};

export default function MatchInfoSection(props) {
  // Keep named props for compatibility
  const { nombre, fecha, hora, sede, modalidad, tipo, rightActions } = props;

  const getShortVenue = (venue) => {
    if (!venue) return '';
    return venue.split(' ')[0];
  };

  const getGoogleMapsUrl = (venue) => {
    if (!venue) return '#';
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}`;
  };

  // Accept canonical partido prop only
  const partidoObj = props.partido || {};

  // Prefer existing 'precio_cancha_por_persona' then legacy 'valor_cancha' variants.
  const rawPrecio = partidoObj?.precio_cancha_por_persona ?? partidoObj?.valor_cancha ?? partidoObj?.valorCancha ?? partidoObj?.valor ?? null;
  // Treat 0 as valid price. Only fallback when null/undefined/empty string
  const precioFieldExists = rawPrecio !== null && rawPrecio !== undefined && String(rawPrecio).trim() !== '';
  const precioNumber = precioFieldExists ? parsePriceNumber(rawPrecio) : null;
  const priceDisplay = precioFieldExists ? (precioNumber !== null ? formatPriceARS(precioNumber) : 'Sin precio') : 'Sin precio';

  return (
    <div className="view-container">{/* container enforced to not overflow */}
      <div className="match-info-container">
        <div className="match-info-card">
          <div className="match-info-row">
            <div className="match-info-item">
              <svg className="match-info-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z" />
              </svg>
              <div className="match-info-text">{fecha || 'Sin fecha'}</div>
            </div>

            <div className="match-info-separator" aria-hidden></div>

            <div className="match-info-item">
              <svg className="match-info-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z" />
              </svg>
              <div className="match-info-text">{hora || 'Sin hora'}</div>
            </div>

            <div className="match-info-separator" aria-hidden></div>

            <div className="match-info-item">
              <svg className="match-info-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
              </svg>
              <div className="match-info-text">{modalidad || 'F5'}</div>
            </div>

            <div className="match-info-separator" aria-hidden></div>

            <div className="match-info-item">
              <svg className="match-info-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
              <div className="match-info-text">{tipo || 'Masculino'}</div>
            </div>

            {sede && (
              <>
                <div className="match-info-separator" aria-hidden></div>
                <div className="match-info-item">
                  <svg className="match-info-icon" viewBox="0 0 384 512" fill="currentColor" aria-hidden>
                    <path d="M0 188.6C0 84.4 86 0 192 0S384 84.4 384 188.6c0 119.3-120.2 262.3-170.4 316.8-11.8 12.8-31.5 12.8-43.3 0-50.2-54.5-170.4-197.5-170.4-316.8zM192 256a64 64 0 1 0 0-128 64 64 0 1 0 0 128z" />
                  </svg>
                  <a
                    href={getGoogleMapsUrl(sede)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="match-info-text venue-link"
                  >
                    {getShortVenue(sede)}
                  </a>
                </div>
              </>
            )}

            <div className="match-info-separator" aria-hidden></div>

            {/* PRICE ITEM: material-like attach_money icon and formatted price */}
            <div className="match-info-item match-info-price" aria-live="polite">
              <svg className="match-info-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.27c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1H8.1c.12 2.19 1.76 3.42 3.7 3.83V21h3v-2.24c1.95-.37 3.5-1.5 3.5-3.67 0-2.84-2.43-3.81-4.5-4.19z" />
              </svg>
              <div className="match-info-text">{priceDisplay}</div>
            </div>
          </div>

          {rightActions ? <div className="match-info-actions">{rightActions}</div> : null}
        </div>
      </div>
    </div>
  );
}