import React from 'react';
import { Clock3, MapPin, Users } from 'lucide-react';

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

const INVITE_STATUS_META = {
    available: null,
    already_pending: {
        label: 'Invitación pendiente',
        tone: 'bg-[#4a3410] text-[#fde68a] border border-[#f59e0b]',
        helper: 'Este jugador ya tiene una invitación pendiente para este partido.',
    },
    group_already_invited: {
        label: 'Grupo invitado',
        tone: 'bg-[#2b1d52] text-[#ddd6fe] border border-[#8b5cf6]',
        helper: 'Este grupo ya fue invitado a este partido.',
    },
    roster_full: {
        label: 'Sin cupos',
        tone: 'bg-[rgba(20,16,41,0.85)] text-white/65 border border-[rgba(148,134,255,0.2)]',
        helper: 'La nómina del partido ya está completa.',
    },
};

const MatchSelectionCard = ({
    match,
    isSelected = false,
    onSelect = () => { },
    inviteStatus = 'available'
}) => {
    const jugadoresCount = match.jugadores_count || 0;
    const cupoMaximo = Number(match.cupo_jugadores || 20);
    const isComplete = jugadoresCount >= cupoMaximo;
    const originBadgeLabel = match?.origin_badge || (match?.origin_type === 'challenge' ? 'Desafio' : 'Amistoso');
    const modalidadLabel = match.modalidad || 'F5';
    const tipoLabel = match.tipo_partido || 'Masculino';
    const dateLabel = match?.fecha_display || match?.fecha || 'A coordinar';
    const timeLabel = match?.hora || '';
    const inviteStatusMeta = INVITE_STATUS_META[inviteStatus] || null;
    const isInviteBlocked = inviteStatus !== 'available';

    // Título: Nombre del partido o Fecha + Hora
    const title = match.nombre || `${match.fecha_display || match.fecha} • ${match.hora}`;
    const simplifyVenue = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return 'A coordinar';
        const beforeComma = raw.split(',')[0].trim();
        const beforeDash = beforeComma
            .replace(/\s+[–—-]\s+.*/g, '')
            .trim();
        return beforeDash || beforeComma || raw;
    };
    const address = simplifyVenue(match?.sede);

    const precioRaw = (match?.precio_cancha_por_persona ?? match?.precio_cancha ?? match?.precio ?? match?.valor_cancha);
    let precioNumber = null;
    if (precioRaw !== undefined && precioRaw !== null && String(precioRaw).trim() !== '') {
        const parsed = Number(String(precioRaw).replace(/[^0-9.,-]/g, '').replace(/,/g, '.'));
        if (!Number.isNaN(parsed) && Number.isFinite(parsed)) precioNumber = parsed;
    }
    const precioLabel = (precioNumber !== null && precioNumber > 0)
        ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(precioNumber)
        : 'Sin precio';

    return (
        <div
            onClick={onSelect}
            className={`relative bg-[linear-gradient(165deg,rgba(48,38,98,0.7),rgba(20,16,41,0.94))] rounded-card p-4 min-h-[140px] border transition-all duration-200 cursor-pointer shadow-elev-1
                ${isSelected
                    ? 'border-[#ec007d]/80 ring-1 ring-[#ec007d]/45'
                    : `${isComplete || isInviteBlocked ? 'border-white/[0.08] opacity-85' : 'border-[rgba(148,134,255,0.2)] hover:brightness-[1.03] hover:border-[rgba(148,134,255,0.45)]'}`
                }
                ${isInviteBlocked && !isSelected ? 'active:scale-100' : 'active:scale-[0.99]'}`}
        >
            {/* Header: fecha/hora + cupos */}
            <div className="flex justify-between items-start gap-3">
                <div className={`inline-flex items-center gap-1.5 text-[13px] font-oswald ${isComplete ? 'text-white/45' : 'text-white/85'}`}>
                    <Clock3 size={12} />
                    <span className="font-semibold">{dateLabel}{timeLabel ? ` • ${timeLabel}` : ''}</span>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                    <div className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold
                        ${isComplete
                            ? 'bg-[rgba(20,16,41,0.85)] text-white/65 border border-[rgba(148,134,255,0.2)]'
                            : 'bg-[rgba(34,197,94,0.16)] text-[#4ade80] border border-[rgba(34,197,94,0.5)]'
                        }`}>
                        <Users size={12} className={isComplete ? 'opacity-55' : 'opacity-90'} />
                        {jugadoresCount}/{cupoMaximo}
                    </div>
                    {inviteStatusMeta ? (
                        <div className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold tracking-[0.02em] ${inviteStatusMeta.tone}`}>
                            {inviteStatusMeta.label}
                        </div>
                    ) : null}
                </div>
            </div>

            <h4 className={`font-oswald text-[18px] sm:text-[16px] font-semibold leading-tight tracking-[0.01em] truncate -mt-0.5 mb-1 ${isComplete ? 'text-white/55' : 'text-white'}`}>
                {title}
            </h4>

            <div className="flex flex-wrap items-center gap-2">
                <span className={`font-oswald text-[11px] font-semibold px-2.5 py-1 rounded-2xl whitespace-nowrap ${getOriginClass(originBadgeLabel)}`}>
                    {originBadgeLabel}
                </span>
                <span className={`font-oswald text-[11px] font-semibold px-2.5 py-1 rounded-2xl whitespace-nowrap ${getModalidadClass(modalidadLabel)}`}>
                    {modalidadLabel}
                </span>
                <span className={`font-oswald text-[11px] font-semibold px-2.5 py-1 rounded-2xl whitespace-nowrap ${getGeneroClass(tipoLabel)}`}>
                    {tipoLabel}
                </span>
                <span className="chip-pill font-oswald text-white/80">
                    {precioLabel}
                </span>
            </div>

            <div className={`flex items-center gap-1.5 border-t border-white/10 pt-2 ${isComplete ? 'text-white/40' : 'text-white/75'}`}>
                <MapPin size={12} className={`shrink-0 ${isComplete ? 'opacity-45' : 'opacity-85'}`} />
                <p className="text-[13px] font-medium truncate tracking-wide">
                    {address}
                </p>
            </div>

            {inviteStatusMeta ? (
                <p className="mt-2 text-[12px] leading-snug text-white/65">
                    {inviteStatusMeta.helper}
                </p>
            ) : null}
        </div>
    );
};

export default MatchSelectionCard;
