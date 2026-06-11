import React, { useEffect, useState } from 'react';
import { MoreVertical } from 'lucide-react';

const normalizeToken = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const getModalidadClass = (modalidad) => {
  const raw = normalizeToken(modalidad);
  if (!raw) return 'bg-[#0f2f23] border border-[#22c55e] text-[#dcfce7]';
  if (raw.includes('11')) return 'bg-[#1a2450] border border-[#818cf8] text-[#e0e7ff]';
  if (raw.includes('9')) return 'bg-[#0f3b42] border border-[#22d3ee] text-[#cffafe]';
  if (raw.includes('8')) return 'bg-[#4a1a30] border border-[#f43f5e] text-[#ffe4e6]';
  if (raw.includes('7')) return 'bg-[#321d5a] border border-[#a78bfa] text-[#ede9fe]';
  if (raw.includes('6')) return 'bg-[#1b2f55] border border-[#60a5fa] text-[#dbeafe]';
  if (raw.includes('5')) return 'bg-[#0f2f23] border border-[#22c55e] text-[#dcfce7]';
  return 'bg-slate-700 border border-slate-500 text-white';
};

const getGeneroClass = (tipo) => {
  if (!tipo) return 'bg-[#14344a] border border-[#38bdf8] text-[#dbeafe]';
  const tipoLower = normalizeToken(tipo);
  if (tipoLower.includes('masculino')) return 'bg-[#14344a] border border-[#38bdf8] text-[#dbeafe]';
  if (tipoLower.includes('femenino')) return 'bg-[#4a1538] border border-[#f472b6] text-[#fce7f3]';
  if (tipoLower.includes('mixto')) return 'bg-[#213448] border border-[#2dd4bf] text-[#ccfbf1]';
  return 'bg-slate-700 border border-slate-500 text-white';
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
    <div className="relative rounded-card p-5 min-h-[150px] border border-[rgba(148,134,255,0.2)] bg-[radial-gradient(360px_170px_at_14%_-26%,rgba(139,92,255,0.16),transparent_70%),linear-gradient(165deg,rgba(48,38,98,0.7),rgba(20,16,41,0.94))] transition-all duration-200 shadow-elev-2 hover:border-[rgba(148,134,255,0.45)] overflow-hidden after:content-[''] after:absolute after:top-0 after:inset-x-0 after:h-px after:bg-[linear-gradient(90deg,transparent_6%,rgba(176,160,255,0.4)_50%,transparent_94%)] after:pointer-events-none">
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          {templateImageUrl && !imageFailed ? (
            <img
              src={templateImageUrl}
              alt={`Foto de ${template.nombre || 'partido frecuente'}`}
              className="w-11 h-11 object-contain p-1 bg-[rgba(14,24,61,0.6)] rounded-md border border-white/20 shadow-[0_6px_14px_rgba(0,0,0,0.32)] shrink-0"
              loading="lazy"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="20" height="20" fill="currentColor" className="text-white/90 shrink-0">
              <path d="M224 64C206.3 64 192 78.3 192 96L192 128L160 128C124.7 128 96 156.7 96 192L96 240L544 240L544 192C544 156.7 515.3 128 480 128L448 128L448 96C448 78.3 433.7 64 416 64C398.3 64 384 78.3 384 96L384 128L256 128L256 96C256 78.3 241.7 64 224 64zM96 288L96 480C96 515.3 124.7 544 160 544L480 544C515.3 544 544 515.3 544 480L544 288L96 288z" />
            </svg>
          )}
          <div className="flex flex-col min-w-0">
            <div className="font-bebas text-[20px] leading-5 text-white uppercase tracking-wide truncate drop-shadow-sm">
              {template.nombre || 'Partido frecuente'}
            </div>
            <div className="text-white/80 text-sm font-oswald mt-[2px] capitalize">
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
      <div className="flex flex-nowrap items-center gap-2 mb-4">
        <div className={`font-oswald text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0 whitespace-nowrap ${getModalidadClass(modalidad)}`}>
          {modalidad}
        </div>
        <div className={`font-oswald text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0 whitespace-nowrap ${getGeneroClass(tipo)}`}>
          {tipo}
        </div>
        <div className="chip-pill font-oswald text-white/80">
          {priceLabel}
        </div>
        <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 whitespace-nowrap ${
          isComplete
            ? 'bg-[rgba(34,197,94,0.16)] text-[#4ade80] border border-[rgba(34,197,94,0.5)]'
            : 'bg-[rgba(20,16,41,0.85)] text-white/70 border border-[rgba(148,134,255,0.2)]'
        }`}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="12" height="12" fill="currentColor">
            <path d="M320 312C386.3 312 440 258.3 440 192C440 125.7 386.3 72 320 72C253.7 72 200 125.7 200 192C200 258.3 253.7 312 320 312zM290.3 368C191.8 368 112 447.8 112 546.3C112 562.7 125.3 576 141.7 576L498.3 576C514.7 576 528 562.7 528 546.3C528 447.8 448.2 368 349.7 368L290.3 368z" />
          </svg>
          {jugadoresCount}/{cupoMaximo} jugadores
        </div>
      </div>

      {/* Ubicación */}
      <div className="font-oswald text-sm font-medium text-white/90 flex items-center gap-2 mb-5 overflow-hidden text-ellipsis">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="16" height="16" fill="rgba(255, 255, 255, 0.9)">
          <path d="M0 188.6C0 84.4 86 0 192 0S384 84.4 384 188.6c0 119.3-120.2 262.3-170.4 316.8-11.8 12.8-31.5 12.8-43.3 0-50.2-54.5-170.4-197.5-170.4-316.8zM192 256a64 64 0 1 0 0-128 64 64 0 1 0 0 128z" />
        </svg>
        <span className="truncate">{formatearSede(template.sede || template.lugar || '')}</span>
      </div>

      {/* Buttons */}
      <div className="flex gap-2 mt-2 items-stretch">
        <button
          className="flex-[1.6] font-bebas text-base px-4 py-2.5 border border-white/20 rounded-xl cursor-pointer transition-all duration-200 text-white min-h-[46px] flex items-center justify-center text-center sm:text-[13px] sm:px-3 sm:py-2 sm:min-h-[36px] bg-cta-gradient shadow-cta hover:brightness-105 active:scale-[0.985]"
          onClick={() => onViewDetails && onViewDetails(template)}
        >
          Crear partido
        </button>
        {onHistory && (
          <button
            className="flex-[1] font-bebas text-base px-4 py-2.5 border border-[rgba(148,134,255,0.28)] rounded-xl cursor-pointer transition-all duration-200 text-white/92 min-h-[46px] flex items-center justify-center text-center sm:text-[13px] sm:px-3 sm:py-2 sm:min-h-[36px] bg-white/[0.04] hover:bg-white/[0.09] hover:border-[rgba(148,134,255,0.5)] active:scale-[0.985]"
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
