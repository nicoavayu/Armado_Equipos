import React from 'react';
import { parseLocalDate } from '../utils/dateLocal';

import FitText from './FitText';

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

function formatPriceCompact(n) {
  try {
    const num = Number(n);
    return `$${Math.round(num).toLocaleString('es-AR')}`;
  } catch (e) {
    return 'Sin $';
  }
}

// sedeUnaPalabra per user's rules
function sedeUnaPalabra(sede) {
  if (!sede) return 'SIN';
  const s = String(sede).trim();
  if (s === '') return 'SIN';
  // take part before first comma
  const beforeComma = s.includes(',') ? s.split(',')[0].trim() : s;
  const words = beforeComma.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'SIN';
  const skip = new Set(['la', 'el', 'los', 'las', 'de', 'del']);
  for (let w of words) {
    const cleaned = w.replace(/[^\p{L}\p{N}_-]/gu, ''); // remove punctuation
    if (!cleaned) continue;
    if (!skip.has(cleaned.toLowerCase())) return cleaned;
  }
  // fallback to first raw word (may contain punctuation)
  return words[0] || 'SIN';
}

export default function MatchInfoSection(props) {
  // Keep named props for compatibility
  const { fecha, hora, sede, modalidad, tipo, rightActions, topOffsetClassName } = props;
  const partidoObj = props.partido || {};

  const fechaRaw = partidoObj?.fecha ?? fecha;
  const fechaDisplay = (() => {
    try {
      if (!fechaRaw) return 'Sin fecha';
      const normalized = String(fechaRaw).trim().slice(0, 10);
      const d = parseLocalDate(normalized);
      if (!d || !isFinite(d.getTime())) return normalized;
      const dd = `${String(d.getDate()).padStart(2, '0')}`;
      const mm = `${String(d.getMonth() + 1).padStart(2, '0')}`;
      const yy = String(d.getFullYear()).slice(-2);
      return `${dd}/${mm}/${yy}`;
    } catch (_) { return String(fechaRaw).trim().slice(0, 10); }
  })();

  const horaRaw = partidoObj?.hora ?? hora;
  const horaDisplay = horaRaw || 'Sin hora';

  const modalidadDisplay = partidoObj?.modalidad ?? modalidad ?? 'F5';

  const tipoRaw = partidoObj?.tipo_partido ?? tipo ?? 'Masculino';
  const tipoDisplay = tipoRaw;

  const sedeRaw = partidoObj?.sede ?? sede;
  const sedeFull = sedeRaw;
  const sedeOne = sedeUnaPalabra(sedeFull);

  const rawPrecio = partidoObj?.precio_cancha_por_persona ?? partidoObj?.valor_cancha ?? partidoObj?.valorCancha ?? partidoObj?.valor ?? null;
  const precioFieldExists = rawPrecio !== null && rawPrecio !== undefined && String(rawPrecio).trim() !== '';
  const precioNumber = precioFieldExists ? parsePriceNumber(rawPrecio) : null;
  const priceDisplay = precioFieldExists && precioNumber !== null ? formatPriceCompact(precioNumber) : 'Sin $';

  const topOffset = topOffsetClassName || 'mt-[76px] sm:mt-[70px]';

  return (
    <div className="relative left-1/2 -translate-x-1/2 w-screen max-w-[100vw] px-0 mx-0 overflow-hidden box-border">
      <div className="relative w-full flex justify-center items-start m-0 p-0">
        <div className={`${topOffset} mb-0 p-3 relative w-full max-w-none box-border bg-white/[0.04] rounded-none flex justify-center sm:max-w-full sm:p-[8px_10px] border-t border-b border-white/[0.08]`}>
          <div
            className="flex items-center w-full overflow-hidden flex-nowrap"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
              gap: '0px',
            }}
          >
            <div className="flex items-center justify-center min-w-0 px-[clamp(4px,1.2vw,10px)] border-r border-white/[0.1]">
              <div className="flex flex-col items-center gap-1.5 text-white min-w-0 w-full sm:gap-1">
              <svg className="w-[clamp(12px,2.2vw,20px)] h-[clamp(12px,2.2vw,20px)] shrink-0 sm:w-3.5 sm:h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z" />
              </svg>
              <FitText className="text-[clamp(10px,1.6vw,14px)] font-['Oswald'] font-medium text-white whitespace-nowrap overflow-hidden text-ellipsis w-full text-center sm:text-[11px]">{fechaDisplay}</FitText>
            </div>
            </div>

            <div className="flex items-center justify-center min-w-0 px-[clamp(4px,1.2vw,10px)] border-r border-white/[0.1]">
              <div className="flex flex-col items-center gap-1.5 text-white min-w-0 w-full sm:gap-1">
              <svg className="w-[clamp(12px,2.2vw,20px)] h-[clamp(12px,2.2vw,20px)] shrink-0 sm:w-3.5 sm:h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z" />
              </svg>
              <FitText className="text-[clamp(10px,1.6vw,14px)] font-['Oswald'] font-medium text-white whitespace-nowrap overflow-hidden text-ellipsis w-full text-center sm:text-[11px]">{horaDisplay}</FitText>
            </div>
            </div>

            <div className="flex items-center justify-center min-w-0 px-[clamp(4px,1.2vw,10px)] border-r border-white/[0.1]">
              <div className="flex flex-col items-center gap-1.5 text-white min-w-0 w-full sm:gap-1">
              <svg className="w-[clamp(12px,2.2vw,20px)] h-[clamp(12px,2.2vw,20px)] shrink-0 sm:w-3.5 sm:h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
              </svg>
              <FitText className="text-[clamp(10px,1.6vw,14px)] font-['Oswald'] font-medium text-white whitespace-nowrap overflow-hidden text-ellipsis w-full text-center sm:text-[11px]">{modalidadDisplay}</FitText>
            </div>
            </div>

            <div className="flex items-center justify-center min-w-0 px-[clamp(4px,1.2vw,10px)] border-r border-white/[0.1]">
              <div className="flex flex-col items-center gap-1.5 text-white min-w-0 w-full sm:gap-1">
              <svg className="w-[clamp(12px,2.2vw,20px)] h-[clamp(12px,2.2vw,20px)] shrink-0 sm:w-3.5 sm:h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
              <FitText className="text-[clamp(10px,1.6vw,14px)] font-['Oswald'] font-medium text-white whitespace-nowrap overflow-hidden text-ellipsis w-full text-center sm:text-[11px]">{tipoDisplay}</FitText>
            </div>
            </div>

            <div className="flex items-center justify-center min-w-0 px-[clamp(4px,1.2vw,10px)] border-r border-white/[0.1]">
              <div className="flex flex-col items-center gap-1.5 text-white min-w-0 w-full sm:gap-1">
              <svg className="w-[clamp(12px,2.2vw,20px)] h-[clamp(12px,2.2vw,20px)] shrink-0 sm:w-3.5 sm:h-3.5" viewBox="0 0 384 512" fill="currentColor" aria-hidden>
                <path d="M0 188.6C0 84.4 86 0 192 0S384 84.4 384 188.6c0 119.3-120.2 262.3-170.4 316.8-11.8 12.8-31.5 12.8-43.3 0-50.2-54.5-170.4-197.5-170.4-316.8zM192 256a64 64 0 1 0 0-128 64 64 0 1 0 0 128z" />
              </svg>
              <a className="text-white no-underline transition-colors duration-200 hover:text-[#4CAF50] hover:underline" href={sedeFull ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(sedeFull)}` : '#'} target="_blank" rel="noopener noreferrer">
                <div className="text-[clamp(10px,1.6vw,14px)] font-['Oswald'] font-medium text-white whitespace-nowrap overflow-hidden text-ellipsis w-full text-center sm:text-[11px] hover:text-[#4CAF50]">{sedeOne}</div>
              </a>
            </div>
            </div>

            <div className="flex items-center justify-center min-w-0 px-[clamp(4px,1.2vw,10px)]">
              <div className="flex flex-col items-center gap-1.5 text-white min-w-0 w-full sm:gap-1" aria-live="polite">
              <svg className="w-[clamp(12px,2.2vw,20px)] h-[clamp(12px,2.2vw,20px)] shrink-0 sm:w-3.5 sm:h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <text x="12" y="17" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="20" fontWeight="bold" fill="currentColor">$</text>
              </svg>
              <FitText className="text-[clamp(10px,1.6vw,14px)] font-['Oswald'] font-medium text-white whitespace-nowrap overflow-hidden text-ellipsis w-full text-center sm:text-[11px]">{priceDisplay}</FitText>
            </div>
            </div>
          </div>

          {rightActions ? <div className="mt-2 flex gap-2 justify-end">{rightActions}</div> : null}
        </div>
      </div>
    </div>
  );
}
