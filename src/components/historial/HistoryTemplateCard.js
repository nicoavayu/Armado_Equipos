import React, { useState } from 'react';
import { MoreVertical } from 'lucide-react';

const formatPrice = (precioRaw) => {
  if (precioRaw === undefined || precioRaw === null || String(precioRaw).trim() === '') return 'Sin precio';
  const parsed = Number(String(precioRaw).replace(/[^0-9.,-]/g, '').replace(/,/g, '.'));
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return 'Sin precio';
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(parsed);
};

const formatearSede = (sede = '') => {
  if (sede === 'La Terraza Fútbol 5, 8') return 'La Terraza Fútbol 5 y 8';
  return sede;
};

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
    <div className="relative bg-slate-900 rounded-2xl p-5 min-h-[150px] border border-slate-800 transition-all duration-300 shadow-xl hover:-translate-y-[2px] hover:shadow-2xl hover:border-slate-700">
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="20" height="20" fill="currentColor" className="text-white/90 shrink-0">
            <path d="M224 64C206.3 64 192 78.3 192 96L192 128L160 128C124.7 128 96 156.7 96 192L96 240L544 240L544 192C544 156.7 515.3 128 480 128L448 128L448 96C448 78.3 433.7 64 416 64C398.3 64 384 78.3 384 96L384 128L256 128L256 96C256 78.3 241.7 64 224 64zM96 288L96 480C96 515.3 124.7 544 160 544L480 544C515.3 544 544 515.3 544 480L544 288L96 288z" />
          </svg>
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
            <div className="flex items-center gap-1.5 bg-slate-700 px-2.5 py-1.5 rounded-full text-[11px] font-semibold shrink-0 border border-[#0EA9C6]">
              <span className="font-semibold uppercase text-[#0EA9C6]">Admin</span>
            </div>
          )}
          {(onEdit || onDelete) && (
            <div className="relative">
              <button
                className="p-2 rounded-full border border-slate-700 hover:border-slate-500 hover:bg-slate-800 text-slate-200"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((prev) => !prev);
                }}
                aria-label="Más acciones"
              >
                <MoreVertical size={16} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-700 bg-slate-900 shadow-lg z-10">
                  <div className="py-1">
                    {onEdit && (
                      <button
                        className="w-full px-3 py-2 flex items-center gap-2 text-left text-slate-100 hover:bg-slate-800"
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
                        className="w-full px-3 py-2 flex items-center gap-2 text-left text-red-200 hover:bg-slate-800"
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
        <div className="font-oswald text-[11px] font-semibold text-white px-2.5 py-1.5 rounded-lg bg-slate-700 border-2 border-[#4CAF50] shrink-0 whitespace-nowrap">
          {modalidad}
        </div>
        <div className="font-oswald text-[11px] font-semibold text-white px-2.5 py-1.5 rounded-lg bg-slate-700 border-2 border-[#2196F3] shrink-0 whitespace-nowrap">
          {tipo}
        </div>
        <div className="font-oswald text-[11px] font-semibold text-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 shrink-0 whitespace-nowrap">
          {priceLabel}
        </div>
        <div className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold shrink-0 whitespace-nowrap ${
          isComplete
            ? 'bg-[#165a2e] text-[#22c55e] border border-[#22c55e]'
            : 'bg-slate-900 text-slate-300 border border-slate-700'
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
          className="flex-[1.6] font-bebas text-base px-4 py-2.5 border-2 border-transparent rounded-xl cursor-pointer transition-all text-white min-h-[44px] flex items-center justify-center text-center bg-primary shadow-lg hover:brightness-110 hover:-translate-y-px"
          onClick={() => onViewDetails && onViewDetails(template)}
        >
          CREAR PARTIDO
        </button>
        {onHistory && (
          <button
            className="flex-[1] font-oswald font-semibold text-sm tracking-wide px-4 py-2.5 border border-white/20 rounded-xl cursor-pointer transition-all text-white/85 min-h-[44px] flex items-center justify-center text-center bg-transparent hover:bg-white/10 hover:border-white/35 hover:text-white"
            onClick={() => onHistory && onHistory(template)}
          >
            HISTORIAL
          </button>
        )}
      </div>
    </div>
  );
};

export default HistoryTemplateCard;
