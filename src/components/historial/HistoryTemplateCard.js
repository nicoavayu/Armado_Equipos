import React, { useEffect, useState } from 'react';
import { MoreVertical } from 'lucide-react';

const normalizeToken = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const getModalidadClass = (modalidad) => {
  const raw = normalizeToken(modalidad);
  if (!raw) return 'border-[#22c55e]/45 bg-[#22c55e]/10 text-[#86efac]';
  if (raw.includes('11')) return 'border-[#818cf8]/45 bg-[#818cf8]/10 text-[#c7d2fe]';
  if (raw.includes('9')) return 'border-[#22d3ee]/45 bg-[#22d3ee]/10 text-[#a5f3fc]';
  if (raw.includes('8')) return 'border-[#f43f5e]/45 bg-[#f43f5e]/10 text-[#fda4af]';
  if (raw.includes('7')) return 'border-[#a78bfa]/45 bg-[#a78bfa]/10 text-[#ddd6fe]';
  if (raw.includes('6')) return 'border-[#60a5fa]/45 bg-[#60a5fa]/10 text-[#bfdbfe]';
  if (raw.includes('5')) return 'border-[#22c55e]/45 bg-[#22c55e]/10 text-[#86efac]';
  return 'border-slate-400/40 bg-slate-500/15 text-slate-200';
};

const getGeneroClass = (tipo) => {
  if (!tipo) return 'border-[#38bdf8]/45 bg-[#38bdf8]/10 text-[#bae6fd]';
  const tipoLower = normalizeToken(tipo);
  if (tipoLower.includes('masculino')) return 'border-[#38bdf8]/45 bg-[#38bdf8]/10 text-[#bae6fd]';
  if (tipoLower.includes('femenino')) return 'border-[#f472b6]/45 bg-[#f472b6]/10 text-[#fbcfe8]';
  if (tipoLower.includes('mixto')) return 'border-[#2dd4bf]/45 bg-[#2dd4bf]/10 text-[#99f6e4]';
  return 'border-slate-400/40 bg-slate-500/15 text-slate-200';
};

const formatPrice = (precioRaw) => {
  if (precioRaw === undefined || precioRaw === null || String(precioRaw).trim() === '') return 'Sin precio';
  const parsed = Number(String(precioRaw).replace(/[^0-9.,-]/g, '').replace(/,/g, '.'));
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return 'Sin precio';
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(parsed);
};

const formatearSede = (sede = '') => String(sede || '').split(',')[0].trim();

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const formatDiaSemana = (diaRaw) => {
  if (diaRaw === undefined || diaRaw === null || diaRaw === '') return '';
  if (typeof diaRaw === 'string' && Number.isNaN(Number(diaRaw))) return diaRaw.toLowerCase();
  const idx = Number(diaRaw);
  if (Number.isFinite(idx) && idx >= 0 && idx <= 6) return DIAS_SEMANA[idx];
  return '';
};

const formatFechaCorta = (fechaRaw) => {
  if (!fechaRaw) return '';
  const raw = String(fechaRaw).trim().slice(0, 10);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const day = String(Number(m[3]));
  const month = String(Number(m[2]));
  return `${day}/${month}`;
};

const inferCupoFromModalidad = (modalidad = '') => {
  const m = String(modalidad || '').toUpperCase().trim();
  if (m === 'F5') return 10;
  if (m === 'F6') return 12;
  if (m === 'F7') return 14;
  if (m === 'F8') return 16;
  if (m === 'F9') return 18;
  if (m === 'F11') return 22;
  return 10;
};

const HistoryTemplateCard = ({
  template,
  onViewDetails,
  onHistory,
  onDelete,
  onEdit,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const templateImageUrl = String(template?.imagen_url || '').trim();
  useEffect(() => {
    setImageFailed(false);
  }, [templateImageUrl]);
  if (!template) return null;

  const modalidad = template.modalidad || 'F5';
  const tipo = template.tipo_partido || 'Masculino';
  const priceLabel = formatPrice(template.precio_cancha_por_persona ?? template.precio ?? template.valor_cancha);
  const jugadoresCount = Number(
    template.jugadores?.[0]?.count
    || template.jugadores_count
    || (Array.isArray(template.jugadores_frecuentes) ? template.jugadores_frecuentes.length : 0)
    || 0
  );
  const cupoMaximo = Number(template.cupo_jugadores || template.cupo || template.cantidad_jugadores || 0) || inferCupoFromModalidad(modalidad);
  const isComplete = jugadoresCount >= cupoMaximo;
  const isAdmin = template.soy_admin || template.es_admin || template.is_admin;
  const diaSemanaLabel = formatDiaSemana(template.dia_semana);
  const fechaCortaLabel = formatFechaCorta(template.fecha);
  const horaLabel = template.hora || '';
  const diaHoraLabel = (diaSemanaLabel && fechaCortaLabel && horaLabel)
    ? `${diaSemanaLabel} ${fechaCortaLabel} • ${horaLabel}`
    : ((diaSemanaLabel && horaLabel)
      ? `${diaSemanaLabel} • ${horaLabel}`
      : (diaSemanaLabel || fechaCortaLabel || horaLabel || ''));

  return (
    <div className="relative rounded-card p-4 pl-5 min-h-[150px] border border-[rgba(148,134,255,0.16)] bg-[linear-gradient(165deg,rgba(48,38,98,0.72),rgba(20,16,41,0.94))] transition-[border-color] duration-200 shadow-elev-1 hover:border-[rgba(148,134,255,0.45)] overflow-hidden before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-[linear-gradient(180deg,#8b5cff,rgba(139,92,255,0.08))]">
      {/* Header */}
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {templateImageUrl && !imageFailed ? (
            <img
              src={templateImageUrl}
              alt={`Foto de ${template.nombre || 'partido frecuente'}`}
              className="w-10 h-10 object-contain p-1 bg-[rgba(20,16,41,0.7)] rounded-[10px] border border-[rgba(148,134,255,0.32)] shrink-0"
              loading="lazy"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-[linear-gradient(140deg,rgba(139,92,255,0.3),rgba(106,67,255,0.08))] border border-[rgba(148,134,255,0.32)] shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="16" height="16" fill="#cfc4ff">
                <path d="M224 64C206.3 64 192 78.3 192 96L192 128L160 128C124.7 128 96 156.7 96 192L96 240L544 240L544 192C544 156.7 515.3 128 480 128L448 128L448 96C448 78.3 433.7 64 416 64C398.3 64 384 78.3 384 96L384 128L256 128L256 96C256 78.3 241.7 64 224 64zM96 288L96 480C96 515.3 124.7 544 160 544L480 544C515.3 544 544 515.3 544 480L544 288L96 288z" />
              </svg>
            </span>
          )}
          <div className="flex flex-col min-w-0">
            <div className="font-oswald text-[16px] font-bold leading-tight text-white tracking-[0.01em] truncate">
              {template.nombre || 'Partido frecuente'}
            </div>
            <div className="font-sans text-[11px] font-semibold text-[#b0a0ff]/85 mt-px capitalize">
              {diaHoraLabel}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <div className="flex items-center gap-1.5 bg-[rgba(106,67,255,0.18)] px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 border border-[rgba(139,92,255,0.5)]">
              <span className="font-semibold uppercase tracking-[0.06em] text-[#cfc4ff]">Admin</span>
            </div>
          )}
          {(onEdit || onDelete) && (
            <div className="relative">
              <button
                className="kebab-menu-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((prev) => !prev);
                }}
                aria-label="Más acciones"
              >
                <MoreVertical size={16} />
              </button>
              {menuOpen && (
                <div className="admin-action-menu absolute right-0 mt-2 w-48 z-10">
                  <div className="py-1">
                    {onEdit && (
                      <button
                        className="admin-action-menu-item"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpen(false);
                          onEdit(template);
                        }}
                      >
                        <span>Editar plantilla</span>
                      </button>
                    )}
                    {onDelete && (
                      <button
                        className="admin-action-menu-item admin-action-menu-item--danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpen(false);
                          onDelete(template);
                        }}
                      >
                        <span>Borrar plantilla</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Chips */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <div className={`font-sans text-[11px] font-bold px-2.5 py-[3px] rounded-full border shrink-0 whitespace-nowrap ${getModalidadClass(modalidad)}`}>
          {modalidad}
        </div>
        <div className={`font-sans text-[11px] font-bold px-2.5 py-[3px] rounded-full border shrink-0 whitespace-nowrap ${getGeneroClass(tipo)}`}>
          {tipo}
        </div>
        <div className="font-sans text-[11px] font-semibold text-white/70 px-2.5 py-[3px] rounded-full border border-white/[0.12] bg-[#0c0a1d]/80 shrink-0 whitespace-nowrap">
          {priceLabel}
        </div>
        <div className={`px-2.5 py-[3px] rounded-full text-[11px] font-bold shrink-0 whitespace-nowrap border ${
          isComplete
            ? 'border-[#22c55e]/50 bg-[#22c55e]/12 text-[#86efac]'
            : 'border-white/[0.12] bg-[#0c0a1d]/80 text-white/70'
        }`}>
          <span className="inline-flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="12" height="12" fill="currentColor">
              <path d="M320 312C386.3 312 440 258.3 440 192C440 125.7 386.3 72 320 72C253.7 72 200 125.7 200 192C200 258.3 253.7 312 320 312zM290.3 368C191.8 368 112 447.8 112 546.3C112 562.7 125.3 576 141.7 576L498.3 576C514.7 576 528 562.7 528 546.3C528 447.8 448.2 368 349.7 368L290.3 368z" />
            </svg>
            {jugadoresCount}/{cupoMaximo} jugadores
          </span>
        </div>
      </div>

      {/* Ubicación */}
      <div className="font-sans text-[12.5px] font-medium text-white/65 flex items-center gap-1.5 mb-4 overflow-hidden text-ellipsis">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="13" height="13" fill="#cfc4ff">
          <path d="M0 188.6C0 84.4 86 0 192 0S384 84.4 384 188.6c0 119.3-120.2 262.3-170.4 316.8-11.8 12.8-31.5 12.8-43.3 0-50.2-54.5-170.4-197.5-170.4-316.8zM192 256a64 64 0 1 0 0-128 64 64 0 1 0 0 128z" />
        </svg>
        <span className="truncate">{formatearSede(template.sede || template.lugar || '')}</span>
      </div>

      {/* Buttons */}
      <div className="flex gap-2 mt-1 items-stretch">
        <button
          className="flex-[1.6] font-bebas font-semibold text-[15px] px-4 py-2 border border-transparent rounded-2xl cursor-pointer transition-[filter,transform] duration-150 text-white min-h-[42px] flex items-center justify-center text-center sm:text-[13px] sm:px-3 sm:py-2 sm:min-h-[38px] bg-cta-gradient shadow-cta hover:brightness-110 active:scale-[0.985]"
          onClick={() => onViewDetails && onViewDetails(template)}
        >
          Crear partido
        </button>
        {onHistory && (
          <button
            className="flex-[1] font-bebas font-semibold text-[15px] px-4 py-2 border border-[rgba(148,134,255,0.28)] rounded-2xl cursor-pointer transition-[background-color,border-color,transform] duration-150 text-white/92 min-h-[42px] flex items-center justify-center text-center sm:text-[13px] sm:px-3 sm:py-2 sm:min-h-[38px] bg-white/[0.04] hover:bg-white/[0.09] hover:border-[rgba(148,134,255,0.5)] active:scale-[0.985]"
            onClick={() => onHistory && onHistory(template)}
          >
            Historial
          </button>
        )}
      </div>
    </div>
  );
};

export default HistoryTemplateCard;
