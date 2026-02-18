import React from 'react';
import { FaCrown } from 'react-icons/fa';
import { MoreVertical, LogOut, UserRoundPlus, XCircle } from 'lucide-react';

const getModalidadClass = (modalidad) => {
    if (!modalidad) return 'bg-slate-700 border-2 border-[#4CAF50]';
    if (modalidad.includes('5')) return 'bg-slate-700 border-2 border-[#4CAF50]';
    if (modalidad.includes('6')) return 'bg-slate-700 border-2 border-[#FF9800]';
    if (modalidad.includes('7')) return 'bg-slate-700 border-2 border-[#9c27b0]';
    if (modalidad.includes('8')) return 'bg-slate-700 border-2 border-[#f44336]';
    if (modalidad.includes('11')) return 'bg-slate-700 border-2 border-[#3f51b5]';
    return 'bg-slate-700 border-2 border-[#4CAF50]';
};

const getTipoClass = (tipo) => {
    if (!tipo) return 'bg-slate-700 border-2 border-[#2196F3]';
    const tipoLower = String(tipo).toLowerCase();
    if (tipoLower.includes('masculino')) return 'bg-slate-700 border-2 border-[#2196F3]';
    if (tipoLower.includes('femenino')) return 'bg-slate-700 border-2 border-[#E91E63]';
    if (tipoLower.includes('mixto')) return 'bg-slate-700 border-2 border-[#FFC107]';
    return 'bg-slate-700 border-2 border-[#2196F3]';
};

const MatchCard = ({
    partido,
    isFinished = false,
    userRole = 'player',
    userJoined = false,
    onMenuToggle = (id) => { },
    isMenuOpen = false,
    onAbandon = null,
    onCancel = null,
    onClear = null,
    primaryAction = null,
    isSelected = false,
    onSelect = () => { },
}) => {
    const MAX_SUBSTITUTE_SLOTS = 2;
    const showMenu = (userJoined || userRole === 'admin' || isFinished) && (onAbandon || onCancel || onClear);

    const precioRaw = (partido?.precio_cancha_por_persona ?? partido?.precio_cancha ?? partido?.precio ?? partido?.valor_cancha);
    let precioNumber = null;
    if (precioRaw !== undefined && precioRaw !== null && String(precioRaw).trim() !== '') {
        const parsed = Number(String(precioRaw).replace(/[^0-9.,-]/g, '').replace(/,/g, '.'));
        if (!Number.isNaN(parsed) && Number.isFinite(parsed)) precioNumber = parsed;
    }
    const precioLabel = (precioNumber !== null && precioNumber > 0)
        ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(precioNumber)
        : 'Sin precio';
    const matchName = typeof partido?.nombre === 'string' ? partido.nombre.trim() : '';

    const cupoMaximo = Number(partido.cupo_jugadores || 20);
    const jugadores = Array.isArray(partido.jugadores) ? partido.jugadores : [];
    const jugadoresCount = typeof jugadores?.[0]?.count === 'number' ? jugadores[0].count : jugadores.length;
    const flaggedSubstitutes = jugadores.filter((j) => Boolean(j?.is_substitute)).length;
    const overflowSubstitutes = Math.max(0, jugadoresCount - cupoMaximo);
    const substitutesCount = Math.min(MAX_SUBSTITUTE_SLOTS, Math.max(flaggedSubstitutes, overflowSubstitutes));
    const titularesCount = Math.max(0, jugadoresCount - substitutesCount);
    const titularesDisplayCount = Math.min(titularesCount, cupoMaximo);
    const isComplete = titularesDisplayCount >= cupoMaximo;

    return (
        <div
            onClick={onSelect}
            className={`relative bg-slate-900 rounded-2xl p-5 mb-3 min-h-[150px] border transition-all duration-300 shadow-xl sm:p-4 cursor-pointer
      ${isFinished ? '!bg-slate-950 !border-slate-800' : 'border-slate-800'}
      ${isSelected ? 'border-blue-500 ring-2 ring-blue-500/50 scale-[1.02]' : 'hover:-translate-y-[1px] hover:shadow-2xl hover:border-slate-700'}
      ${primaryAction ? '' : 'active:scale-95'}
    `}
        >
            {/* Header: Fecha/Hora a la izquierda, Admin Badge a la derecha */}
            <div className="flex justify-between items-start mb-3">
                <div className={`flex flex-col ${isFinished ? 'opacity-70' : ''}`}>
                    <div className="flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="20" height="20" fill="currentColor">
                            <path d="M224 64C206.3 64 192 78.3 192 96L192 128L160 128C124.7 128 96 156.7 96 192L96 240L544 240L544 192C544 156.7 515.3 128 480 128L448 128L448 96C448 78.3 433.7 64 416 64C398.3 64 384 78.3 384 96L384 128L256 128L256 96C256 78.3 241.7 64 224 64zM96 288L96 480C96 515.3 124.7 544 160 544L480 544C515.3 544 544 515.3 544 480L544 288L96 288z" />
                        </svg>
                        <div className="font-oswald text-[18px] font-bold text-white capitalize">
                            {partido.fecha_display || partido.fecha} • {partido.hora}
                        </div>
                    </div>
                    {matchName && (
                        <p className="font-oswald text-[13px] font-medium text-white/70 tracking-wide truncate mt-1 pl-7">
                            {matchName}
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {isFinished ? (
                        <div className="bg-[#4CAF50] text-white px-2 py-1 rounded-xl text-[11px] font-semibold whitespace-nowrap flex items-center gap-1 shadow-sm">
                            ✓ Finalizado
                        </div>
                    ) : userRole === 'admin' ? (
                        <div className="flex items-center gap-1 bg-slate-700 px-2 py-1 rounded-full text-[10px] font-semibold shrink-0 border border-[#0EA9C6]">
                            <FaCrown size={10} color="#0EA9C6" style={{ marginRight: '1px' }} />
                            <span className="font-semibold uppercase text-[#0EA9C6]">Admin</span>
                        </div>
                    ) : null}

                    {/* Menu */}
                    {showMenu && (
                        <div className="relative">
                            <button
                                className="p-2 rounded-full border border-slate-700 hover:border-slate-500 hover:bg-slate-800 text-slate-200"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onMenuToggle?.(partido.id);
                                }}
                                aria-label="Más acciones"
                            >
                                <MoreVertical size={16} />
                            </button>
                            {isMenuOpen && (
                                <div
                                    className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-700 bg-slate-900 shadow-lg z-10"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div className="py-1">
                                        {userJoined && onAbandon && (
                                            <button
                                                className="w-full px-3 py-2 flex items-center gap-2 text-left text-slate-100 hover:bg-slate-800"
                                                onClick={(e) => { e.stopPropagation(); onAbandon(partido); }}
                                            >
                                                <LogOut size={16} />
                                                <span>Abandonar partido</span>
                                            </button>
                                        )}
                                        {userRole === 'admin' && onCancel && (
                                            <button
                                                className="w-full px-3 py-2 flex items-center gap-2 text-left text-red-200 hover:bg-slate-800"
                                                onClick={(e) => { e.stopPropagation(); onCancel(partido); }}
                                            >
                                                <XCircle size={16} />
                                                <span>Cancelar partido</span>
                                            </button>
                                        )}
                                        {isFinished && onClear && (
                                            <button
                                                className="w-full px-3 py-2 flex items-center gap-2 text-left text-slate-100 hover:bg-slate-800"
                                                onClick={(e) => { e.stopPropagation(); onClear(partido); }}
                                            >
                                                <XCircle size={16} />
                                                <span>Borrar partido</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Modalidad, Tipo, Precio y Jugadores */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
                <div className={`font-oswald text-[11px] font-semibold text-white px-2.5 py-1.5 rounded-lg border border-transparent shrink-0 whitespace-nowrap ${getModalidadClass(partido.modalidad)} ${isFinished ? 'opacity-70' : ''}`}>
                    {partido.modalidad || 'F5'}
                </div>
                <div className={`font-oswald text-[11px] font-semibold text-white px-2.5 py-1.5 rounded-lg border border-transparent shrink-0 whitespace-nowrap ${getTipoClass(partido.tipo_partido)} ${isFinished ? 'opacity-70' : ''}`}>
                    {partido.tipo_partido || 'Masculino'}
                </div>
                <div className={`font-oswald text-[11px] font-semibold text-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 shrink-0 whitespace-nowrap ${isFinished ? 'opacity-70' : ''}`}>
                    {precioLabel}
                </div>
                <div className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold shrink-0 whitespace-nowrap ${isComplete
                    ? 'bg-[#165a2e] text-[#22c55e] border border-[#22c55e]'
                    : 'bg-slate-900 text-slate-300 border border-slate-700'
                    } ${isFinished ? 'opacity-70' : ''}`}>
                    <span className="inline-flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="12" height="12" fill="currentColor">
                            <path d="M320 312C386.3 312 440 258.3 440 192C440 125.7 386.3 72 320 72C253.7 72 200 125.7 200 192C200 258.3 253.7 312 320 312zM290.3 368C191.8 368 112 447.8 112 546.3C112 562.7 125.3 576 141.7 576L498.3 576C514.7 576 528 562.7 528 546.3C528 447.8 448.2 368 349.7 368L290.3 368z" />
                        </svg>
                        {titularesDisplayCount}/{cupoMaximo}
                    </span>
                </div>
                {substitutesCount > 0 && (
                    <div className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold shrink-0 whitespace-nowrap border border-amber-400/30 bg-amber-500/10 text-amber-300 ${isFinished ? 'opacity-70' : ''}`}>
                        <span className="inline-flex items-center gap-1">
                            <UserRoundPlus size={12} />
                            {substitutesCount}/{MAX_SUBSTITUTE_SLOTS}
                        </span>
                    </div>
                )}
            </div>

            {/* Ubicación */}
            <div className={`font-oswald text-sm font-medium text-white/90 flex items-center gap-2 ${primaryAction ? 'mb-5' : ''} overflow-hidden text-ellipsis ${isFinished ? 'opacity-70' : ''}`}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="16" height="16" fill="rgba(255, 255, 255, 0.9)">
                    <path d="M0 188.6C0 84.4 86 0 192 0S384 84.4 384 188.6c0 119.3-120.2 262.3-170.4 316.8-11.8 12.8-31.5 12.8-43.3 0-50.2-54.5-170.4-197.5-170.4-316.8zM192 256a64 64 0 1 0 0-128 64 64 0 1 0 0 128z" />
                </svg>
                <span className="truncate">{partido.sede?.split(',')[0]}</span>
            </div>

            {primaryAction && (
                <div className="flex gap-3 mt-4">
                    <button
                        className={`flex-1 font-bebas text-base px-4 py-2.5 border-2 border-transparent rounded-xl cursor-pointer transition-all text-white min-h-[44px] flex items-center justify-center text-center sm:text-[13px] sm:px-3 sm:py-2 sm:min-h-[36px] ${primaryAction.disabled ? 'bg-slate-700 text-slate-300 cursor-not-allowed' : primaryAction.className || 'bg-primary shadow-lg hover:brightness-110 hover:-translate-y-px'} disabled:opacity-60`}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (primaryAction.disabled) return;
                            primaryAction.onClick?.(e);
                        }}
                    >
                        {primaryAction.label}
                    </button>
                </div>
            )}
        </div>
    );
};

export default MatchCard;
