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

const getOriginClass = (originLabel) => {
    const value = normalizeToken(originLabel);
    if (value.includes('desafio')) return 'border-[#ec007d]/50 bg-[#ec007d]/12 text-[#ffb1d8]';
    if (value.includes('amistoso')) return 'border-[#facc15]/40 bg-[#facc15]/10 text-[#fde68a]';
    return 'border-slate-400/40 bg-slate-500/15 text-slate-200';
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
    isPostMatch = false,
    postMatchInfo = null,
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
        ? 'bg-[radial-gradient(360px_180px_at_12%_-30%,rgba(236,0,125,0.14),transparent_70%),linear-gradient(165deg,rgba(56,44,116,0.82),rgba(22,17,46,0.95))]'
        : 'bg-[radial-gradient(360px_180px_at_12%_-30%,rgba(139,92,255,0.18),transparent_70%),linear-gradient(165deg,rgba(48,38,98,0.72),rgba(20,16,41,0.94))]';
    const accentEdgeClass = isChallengeCard
        ? 'before:bg-[linear-gradient(180deg,#ec007d,rgba(236,0,125,0.1))]'
        : 'before:bg-[linear-gradient(180deg,#8b5cff,rgba(139,92,255,0.08))]';
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
            className={`relative ${cardToneClass} rounded-card p-4 pl-5 mb-3 border overflow-hidden transition-all duration-200 shadow-elev-2 sm:p-3.5 sm:pl-4 cursor-pointer
      before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] ${accentEdgeClass}
      ${isFinished ? 'border-white/[0.06] before:opacity-40' : 'border-[rgba(148,134,255,0.16)]'}
      ${isSelected ? 'border-[#ec007d]/80 ring-1 ring-[#ec007d]/45' : 'hover:brightness-[1.05] hover:border-[rgba(148,134,255,0.42)] hover:shadow-[0_12px_32px_rgba(5,3,16,0.5),0_0_20px_rgba(106,67,255,0.16)]'}
      ${primaryAction ? '' : 'active:scale-[0.985]'}
    `}
        >
            {/* Header: Fecha/Hora a la izquierda, Admin Badge a la derecha */}
            <div className="flex justify-between items-start mb-3">
                    <div className={`flex items-center gap-2.5 ${isFinished ? 'opacity-70' : ''}`}>
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-[linear-gradient(140deg,rgba(139,92,255,0.3),rgba(106,67,255,0.08))] border border-[rgba(148,134,255,0.32)] shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="14" height="14" fill="#cfc4ff">
                            <path d="M224 64C206.3 64 192 78.3 192 96L192 128L160 128C124.7 128 96 156.7 96 192L96 240L544 240L544 192C544 156.7 515.3 128 480 128L448 128L448 96C448 78.3 433.7 64 416 64C398.3 64 384 78.3 384 96L384 128L256 128L256 96C256 78.3 241.7 64 224 64zM96 288L96 480C96 515.3 124.7 544 160 544L480 544C515.3 544 544 515.3 544 480L544 288L96 288z" />
                        </svg>
                    </span>
                    <div className="min-w-0">
                        <div className="font-oswald text-[14px] font-bold text-white capitalize tracking-[0.01em] leading-tight">
                            {dateLabel}
                        </div>
                        {timeLabel ? (
                            <div className="font-sans text-[11px] font-semibold text-[#b0a0ff]/85 leading-tight mt-px">
                                {timeLabel} hs
                            </div>
                        ) : null}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {isPostMatch ? (
                        <div className="border border-[#8b5cff]/50 bg-[#8b5cff]/12 text-[#cfc4ff] px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap flex items-center gap-1">
                            Post partido
                        </div>
                    ) : isFinished ? (
                        <div className="border border-[#22c55e]/45 bg-[#22c55e]/12 text-[#86efac] px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap flex items-center gap-1">
                            ✓ Finalizado
                        </div>
                    ) : userRole === 'admin' ? (
                        <div className="flex items-center gap-1 bg-[#0EA9C6]/10 px-2.5 py-1 rounded-full text-[10px] font-bold shrink-0 border border-[#0EA9C6]/50">
                            <FaCrown size={10} color="#2fc5e2" style={{ marginRight: '1px' }} />
                            <span className="font-bold uppercase tracking-[0.06em] text-[#7fdef0]">Admin</span>
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
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
                {originBadgeLabel ? (
                    <div className={`font-sans text-[11px] font-bold px-2.5 py-[3px] rounded-full border shrink-0 whitespace-nowrap ${getOriginClass(originBadgeLabel)} ${isFinished ? 'opacity-70' : ''}`}>
                        {originBadgeLabel}
                    </div>
                ) : null}
                <div className={`font-sans text-[11px] font-bold px-2.5 py-[3px] rounded-full border shrink-0 whitespace-nowrap ${getModalidadClass(partido.modalidad)} ${isFinished ? 'opacity-70' : ''}`}>
                    {partido.modalidad || 'F5'}
                </div>
                <div className={`font-sans text-[11px] font-bold px-2.5 py-[3px] rounded-full border shrink-0 whitespace-nowrap ${getGeneroClass(generoLabel)} ${isFinished ? 'opacity-70' : ''}`}>
                    {generoLabel}
                </div>
                <div className={`font-sans text-[11px] font-semibold text-white/70 px-2.5 py-[3px] rounded-full border border-white/[0.12] bg-[#0c0a1d]/80 shrink-0 whitespace-nowrap ${isFinished ? 'opacity-70' : ''}`}>
                    {precioLabel}
                </div>
                <div className={`px-2.5 py-[3px] rounded-full text-[11px] font-bold shrink-0 whitespace-nowrap border ${!isTeamMatch && isComplete
                        ? 'border-[#22c55e]/50 bg-[#22c55e]/12 text-[#86efac]'
                        : 'border-white/[0.12] bg-[#0c0a1d]/80 text-white/70'
                        } ${isFinished ? 'opacity-70' : ''}`}>
                    <span className="inline-flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="12" height="12" fill="currentColor">
                            <path d="M320 312C386.3 312 440 258.3 440 192C440 125.7 386.3 72 320 72C253.7 72 200 125.7 200 192C200 258.3 253.7 312 320 312zM290.3 368C191.8 368 112 447.8 112 546.3C112 562.7 125.3 576 141.7 576L498.3 576C514.7 576 528 562.7 528 546.3C528 447.8 448.2 368 349.7 368L290.3 368z" />
                        </svg>
                        {playersChipLabel}
                    </span>
                </div>
                {!useTeamMatchPresentation && substitutesCount > 0 ? (
                    <div className={`px-2.5 py-[3px] rounded-full text-[11px] font-bold shrink-0 whitespace-nowrap border border-amber-400/35 bg-amber-500/10 text-amber-300 ${isFinished ? 'opacity-70' : ''}`}>
                        <span className="inline-flex items-center gap-1">
                            <UserRoundPlus size={12} />
                            {substitutesCount}/{MAX_SUBSTITUTE_SLOTS}
                        </span>
                    </div>
                ) : null}
            </div>

            {useTeamMatchPresentation && teamsLabel ? (
                <div className={`font-oswald text-[14px] font-bold text-white/90 mb-2.5 ${isFinished ? 'opacity-70' : ''}`}>
                    {teamsLabel}
                </div>
            ) : null}

            {/* Ubicación */}
            <div className={`font-sans text-[12.5px] font-medium text-white/65 flex items-center gap-1.5 ${(primaryAction || (isPostMatch && postMatchInfo)) ? 'mb-4' : ''} overflow-hidden text-ellipsis ${isFinished ? 'opacity-70' : ''}`}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="13" height="13" fill="#cfc4ff">
                    <path d="M0 188.6C0 84.4 86 0 192 0S384 84.4 384 188.6c0 119.3-120.2 262.3-170.4 316.8-11.8 12.8-31.5 12.8-43.3 0-50.2-54.5-170.4-197.5-170.4-316.8zM192 256a64 64 0 1 0 0-128 64 64 0 1 0 0 128z" />
                </svg>
                <span className="truncate">{useTeamMatchPresentation ? (partido.sede || 'A coordinar') : partido.sede?.split(',')[0]}</span>
            </div>

            {isPostMatch && postMatchInfo ? (
                <div className="mt-1">
                    <div className="flex flex-col gap-0.5 mb-3">
                        {postMatchInfo.encuestaLabel ? (
                            <div className="font-sans text-[12.5px] font-medium text-white/75">{postMatchInfo.encuestaLabel}</div>
                        ) : null}
                        {postMatchInfo.pagoLabel ? (
                            <div className="font-sans text-[12.5px] font-medium text-white/75">{postMatchInfo.pagoLabel}</div>
                        ) : null}
                    </div>
                    <div className="flex gap-3">
                        {[postMatchInfo.encuestaAction, postMatchInfo.pagosAction].filter(Boolean).map((action, idx) => (
                            <button
                                key={idx}
                                className={`flex-1 min-w-0 whitespace-nowrap truncate font-bebas font-semibold text-[15px] tracking-[0.02em] px-3 py-2 border rounded-xl cursor-pointer transition-all text-white min-h-[44px] flex items-center justify-center text-center sm:text-[13px] sm:px-3 sm:py-2 sm:min-h-[40px] ${action.disabled
                                    ? 'bg-[#1d1740] text-white/40 cursor-not-allowed border-white/10'
                                    : action.primary
                                        ? 'bg-cta-gradient border-white/20 shadow-cta hover:brightness-105 active:scale-[0.985]'
                                        : 'bg-white/[0.06] border-[rgba(148,134,255,0.28)] hover:bg-white/[0.12]'}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (action.disabled) return;
                                    action.onClick?.(e);
                                }}
                            >
                                {action.label}
                            </button>
                        ))}
                    </div>
                </div>
            ) : primaryAction ? (
                <div className="flex gap-3 mt-3">
                    <button
                        className={`flex-1 min-w-0 whitespace-nowrap font-bebas font-semibold text-[15px] px-4 py-2 border border-transparent rounded-xl cursor-pointer transition-all text-white min-h-[44px] flex items-center justify-center text-center sm:text-[13px] sm:px-3 sm:py-2 sm:min-h-[40px] ${primaryAction.disabled ? 'bg-[#1d1740] text-white/40 cursor-not-allowed border-white/10' : primaryAction.className || 'bg-cta-gradient shadow-cta hover:brightness-110'} disabled:opacity-60`}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (primaryAction.disabled) return;
                            primaryAction.onClick?.(e);
                        }}
                    >
                        {primaryAction.label}
                    </button>
                </div>
            ) : null}
        </div>
    );
};

export default MatchCard;
