import React from 'react';
import { FaCrown } from 'react-icons/fa';
import { MoreVertical, LogOut, UserRoundPlus, XCircle } from 'lucide-react';

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

const getOriginClass = (originLabel) => {
    const value = normalizeToken(originLabel);
    if (value.includes('desafio')) return 'bg-[#2b1d52] border border-[#c084fc] text-[#f3e8ff]';
    if (value.includes('amistoso')) return 'bg-[#3b3112] border border-[#facc15] text-[#fef08a]';
    return 'bg-[#334155] border border-[#64748B] text-white';
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
    const MAX_SUBSTITUTE_SLOTS = 4;
    const matchName = String(partido?.nombre || partido?.titulo || partido?.name || '').trim();
    const isChallengeLikeOrigin = (
        normalizeToken(partido?.origin_badge || '').includes('desafio')
        || normalizeToken(partido?.origin_type || '') === 'challenge'
        || /^desaf[ií]o\s*:/.test(matchName.toLowerCase())
    );
    const hasChallengeOrigin = (
        isChallengeLikeOrigin
        || Boolean(partido?.challenge_id || partido?.challengeId)
    );
    const isTeamMatch = partido?.source_type === 'team_match';
    const useTeamMatchPresentation = isTeamMatch || isChallengeLikeOrigin;
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
    const cupoMaximo = Number(partido.cupo_jugadores || 20);
    const jugadores = Array.isArray(partido.jugadores) ? partido.jugadores : [];
    const jugadoresCount = typeof jugadores?.[0]?.count === 'number' ? jugadores[0].count : jugadores.length;
    const flaggedSubstitutes = jugadores.filter((j) => Boolean(j?.is_substitute)).length;
    const overflowSubstitutes = Math.max(0, jugadoresCount - cupoMaximo);
    const substitutesCount = Math.min(MAX_SUBSTITUTE_SLOTS, Math.max(flaggedSubstitutes, overflowSubstitutes));
    const titularesCount = Math.max(0, jugadoresCount - substitutesCount);
    const titularesDisplayCount = Math.min(titularesCount, cupoMaximo);
    const isComplete = titularesDisplayCount >= cupoMaximo;
    const dateLabel = partido?.fecha_display || partido?.fecha || 'A coordinar';
    const timeLabel = partido?.hora || '';
    const originBadgeLabel = useTeamMatchPresentation
        ? (partido?.origin_badge
            || (hasChallengeOrigin ? 'Desafio' : 'Amistoso'))
        : (hasChallengeOrigin ? 'Desafio' : 'Amistoso');
    const isChallengeCard = String(originBadgeLabel || '').toLowerCase().includes('desafio');
    const cardToneClass = isChallengeCard
        ? 'bg-[linear-gradient(168deg,rgba(52,42,104,0.78),rgba(28,22,60,0.94))]'
        : 'bg-[linear-gradient(168deg,rgba(42,34,86,0.66),rgba(24,19,52,0.92))]';
    const generoLabel = useTeamMatchPresentation
        ? (partido?.genero_partido || 'Masculino')
        : (partido?.tipo_partido || 'Masculino');
    const totalPlayersTarget = Number(partido?.cupo_jugadores);
    const playersChipLabel = Number.isFinite(totalPlayersTarget) && totalPlayersTarget > 0
        ? (useTeamMatchPresentation ? `${totalPlayersTarget} jugadores` : `${titularesDisplayCount}/${cupoMaximo}`)
        : (useTeamMatchPresentation ? 'Sin cupo' : `${titularesDisplayCount}/${cupoMaximo}`);
    const teamsLabel = partido?.team_a?.name && partido?.team_b?.name
        ? `${partido.team_a.name} vs ${partido.team_b.name}`
        : null;

    return (
        <div
            onClick={onSelect}
            className={`relative ${cardToneClass} backdrop-blur-md rounded-none p-4 mb-2.5 border transition-all duration-200 shadow-[0_10px_28px_rgba(6,4,18,0.45),inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-3.5 cursor-pointer
      ${isFinished ? 'border-white/[0.06]' : 'border-white/[0.09]'}
      ${isSelected ? 'border-[#ec007d]/80 ring-1 ring-[#ec007d]/45' : 'hover:brightness-[1.04] hover:border-[rgba(139,124,255,0.4)]'}
      ${primaryAction ? '' : 'active:scale-95'}
    `}
        >
            {/* Header: Fecha/Hora a la izquierda, Admin Badge a la derecha */}
            <div className="flex justify-between items-start mb-2.5">
                    <div className={`flex items-center gap-2 ${isFinished ? 'opacity-70' : ''}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="15" height="15" fill="#a99cff">
                        <path d="M224 64C206.3 64 192 78.3 192 96L192 128L160 128C124.7 128 96 156.7 96 192L96 240L544 240L544 192C544 156.7 515.3 128 480 128L448 128L448 96C448 78.3 433.7 64 416 64C398.3 64 384 78.3 384 96L384 128L256 128L256 96C256 78.3 241.7 64 224 64zM96 288L96 480C96 515.3 124.7 544 160 544L480 544C515.3 544 544 515.3 544 480L544 288L96 288z" />
                    </svg>
                    <div className="font-oswald text-[15px] font-semibold text-white capitalize tracking-[0.01em]">
                        {dateLabel}{timeLabel ? ` • ${timeLabel}` : ''}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {isFinished ? (
                        <div className="bg-[#4CAF50] text-white px-2 py-1 rounded-none text-[11px] font-semibold whitespace-nowrap flex items-center gap-1 shadow-sm">
                            ✓ Finalizado
                        </div>
                    ) : userRole === 'admin' ? (
                        <div className="flex items-center gap-1 bg-[#201a44] px-2 py-1 rounded-none text-[10px] font-semibold shrink-0 border border-[#0EA9C6]">
                            <FaCrown size={10} color="#0EA9C6" style={{ marginRight: '1px' }} />
                            <span className="font-semibold uppercase text-[#0EA9C6]">Admin</span>
                        </div>
                    ) : null}

                    {/* Menu */}
                    {showMenu && (
                        <div className="relative">
                            <button
                                type="button"
                                className="kebab-menu-btn"
                                onMouseDown={(e) => e.stopPropagation()}
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
                                    className="admin-action-menu absolute right-0 mt-2 w-48 z-10"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div className="py-1">
                                        {userJoined && onAbandon && (
                                            <button
                                                type="button"
                                                className="admin-action-menu-item admin-action-menu-item--danger"
                                                onMouseDown={(e) => e.stopPropagation()}
                                                onClick={(e) => { e.stopPropagation(); onAbandon(partido); }}
                                            >
                                                <LogOut size={16} />
                                                <span>Abandonar partido</span>
                                            </button>
                                        )}
                                        {userRole === 'admin' && onCancel && (
                                            <button
                                                type="button"
                                                className="admin-action-menu-item admin-action-menu-item--danger"
                                                onMouseDown={(e) => e.stopPropagation()}
                                                onClick={(e) => { e.stopPropagation(); onCancel(partido); }}
                                            >
                                                <XCircle size={16} />
                                                <span>Cancelar partido</span>
                                            </button>
                                        )}
                                        {isFinished && onClear && (
                                            <button
                                                type="button"
                                                className="admin-action-menu-item"
                                                onMouseDown={(e) => e.stopPropagation()}
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

            {/* Tipo, Modalidad, Precio y Jugadores */}
            <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                {originBadgeLabel ? (
                    <div className={`font-oswald text-[11px] font-semibold px-2 py-[3px] rounded-none shrink-0 whitespace-nowrap ${getOriginClass(originBadgeLabel)} ${isFinished ? 'opacity-70' : ''}`}>
                        {originBadgeLabel}
                    </div>
                ) : null}
                <div className={`font-oswald text-[11px] font-semibold px-2 py-[3px] rounded-none shrink-0 whitespace-nowrap ${getModalidadClass(partido.modalidad)} ${isFinished ? 'opacity-70' : ''}`}>
                    {partido.modalidad || 'F5'}
                </div>
                <div className={`font-oswald text-[11px] font-semibold px-2 py-[3px] rounded-none shrink-0 whitespace-nowrap ${getGeneroClass(generoLabel)} ${isFinished ? 'opacity-70' : ''}`}>
                    {generoLabel}
                </div>
                <div className={`font-oswald text-[11px] font-semibold text-white/75 px-2 py-[3px] rounded-none border border-white/10 bg-[#161232]/90 shrink-0 whitespace-nowrap ${isFinished ? 'opacity-70' : ''}`}>
                    {precioLabel}
                </div>
                <div className={`px-2 py-[3px] rounded-none text-[11px] font-semibold shrink-0 whitespace-nowrap ${!isTeamMatch && isComplete
                        ? 'bg-[#165a2e] text-[#22c55e] border border-[#22c55e]'
                        : 'bg-[#161232]/90 text-white/75 border border-white/10'
                        } ${isFinished ? 'opacity-70' : ''}`}>
                    <span className="inline-flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="12" height="12" fill="currentColor">
                            <path d="M320 312C386.3 312 440 258.3 440 192C440 125.7 386.3 72 320 72C253.7 72 200 125.7 200 192C200 258.3 253.7 312 320 312zM290.3 368C191.8 368 112 447.8 112 546.3C112 562.7 125.3 576 141.7 576L498.3 576C514.7 576 528 562.7 528 546.3C528 447.8 448.2 368 349.7 368L290.3 368z" />
                        </svg>
                        {playersChipLabel}
                    </span>
                </div>
                {!useTeamMatchPresentation && substitutesCount > 0 ? (
                    <div className={`px-2 py-[3px] rounded-none text-[11px] font-semibold shrink-0 whitespace-nowrap border border-amber-400/30 bg-amber-500/10 text-amber-300 ${isFinished ? 'opacity-70' : ''}`}>
                        <span className="inline-flex items-center gap-1">
                            <UserRoundPlus size={12} />
                            {substitutesCount}/{MAX_SUBSTITUTE_SLOTS}
                        </span>
                    </div>
                ) : null}
            </div>

            {useTeamMatchPresentation && teamsLabel ? (
                <div className={`font-oswald text-[13px] font-medium text-white/85 mb-2.5 ${isFinished ? 'opacity-70' : ''}`}>
                    {teamsLabel}
                </div>
            ) : null}

            {/* Ubicación */}
            <div className={`font-oswald text-[13px] font-medium text-white/80 flex items-center gap-2 ${primaryAction ? 'mb-4' : ''} overflow-hidden text-ellipsis ${isFinished ? 'opacity-70' : ''}`}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="16" height="16" fill="rgba(255, 255, 255, 0.9)">
                    <path d="M0 188.6C0 84.4 86 0 192 0S384 84.4 384 188.6c0 119.3-120.2 262.3-170.4 316.8-11.8 12.8-31.5 12.8-43.3 0-50.2-54.5-170.4-197.5-170.4-316.8zM192 256a64 64 0 1 0 0-128 64 64 0 1 0 0 128z" />
                </svg>
                <span className="truncate">{useTeamMatchPresentation ? (partido.sede || 'A coordinar') : partido.sede?.split(',')[0]}</span>
            </div>

            {primaryAction && (
                <div className="flex gap-3 mt-3">
                    <button
                        className={`flex-1 font-bebas text-[15px] px-4 py-2 border border-transparent rounded-none cursor-pointer transition-all text-white min-h-[40px] flex items-center justify-center text-center sm:text-[13px] sm:px-3 sm:py-2 sm:min-h-[36px] ${primaryAction.disabled ? 'bg-[#201a44] text-white/45 cursor-not-allowed border-white/10' : primaryAction.className || 'bg-primary shadow-lg hover:brightness-110'} disabled:opacity-60`}
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
