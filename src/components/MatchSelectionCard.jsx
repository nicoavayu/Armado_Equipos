import React from 'react';
import { Clock3, MapPin, Users } from 'lucide-react';

const MatchSelectionCard = ({
    match,
    isSelected = false,
    onSelect = () => { },
    inviteStatus = 'available'
}) => {
    const jugadoresCount = match.jugadores_count || 0;
    const cupoMaximo = match.cupo_jugadores || 20;
    const faltan = cupoMaximo - jugadoresCount;
    const isComplete = jugadoresCount >= cupoMaximo;

    // Título: Nombre del partido o Fecha + Hora
    const title = match.nombre || `${match.fecha_display || match.fecha} • ${match.hora}`;
    const showDateTimeInTitle = !match.nombre;

    // Address simplification: Street + City only
    const simplifyAddress = (address) => {
        if (!address) return '';
        // Common unwanted parts to remove
        const partsToRemove = [
            'Provincia de Buenos Aires',
            'Buenos Aires',
            'Argentina',
            'B1', 'B7', 'B6', 'C1', // Common postal code starts
            'CP'
        ];

        let simplified = address;
        partsToRemove.forEach(part => {
            const regex = new RegExp(`,?\\s*${part}\\s*`, 'gi');
            simplified = simplified.replace(regex, '');
        });

        // Clean up trailing commas and spaces
        simplified = simplified.replace(/,\s*$/, '').trim();

        // If it looks like it has a city at the end but it's not CABA, let's try to keep the last part as city if it's there
        // Actually, the user asked for "Calle + Ciudad". Most addresses in this app are "Calle, Ciudad"
        return simplified;
    };

    const simplifiedAddress = simplifyAddress(match.sede);

    return (
        <div
            onClick={onSelect}
            className={`relative rounded-2xl p-4 transition-all duration-300 cursor-pointer flex flex-col gap-2.5 border
                ${isSelected
                    ? 'bg-[#1d2f66]/85 border-[#2ea7ff]/70 shadow-[0_12px_32px_rgba(0,0,0,0.45)] ring-1 ring-[#2ea7ff]/35'
                    : (isComplete ? 'bg-white/10 border-white/10' : 'bg-[#162347]/80 border-white/15') + ' shadow-[0_8px_24px_rgba(0,0,0,0.35)] hover:border-white/30 hover:bg-[#1b2b57]/90'
                }
                ${inviteStatus !== 'available' && !isSelected ? 'active:scale-100' : 'active:scale-[0.99]'}
            `}
        >
            {/* Header: Título y Status de jugadores */}
            <div className="flex justify-between items-start gap-3">
                <div className="flex-1 min-w-0">
                    <h4 className={`font-oswald text-[20px] font-semibold uppercase truncate leading-tight tracking-wide transition-colors
                        ${isComplete ? 'text-white/35' : 'text-white'}
                    `}>
                        {title}
                    </h4>
                    {!showDateTimeInTitle && (
                        <p className={`text-[11px] font-medium mt-1 uppercase tracking-wide transition-colors inline-flex items-center gap-1.5
                            ${isComplete ? 'text-white/25' : 'text-[#9bb5de]'}
                        `}>
                            <Clock3 size={11} />
                            {match.fecha_display || match.fecha} • {match.hora}
                        </p>
                    )}
                </div>

                <div className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all
                    ${isComplete
                        ? 'bg-white/5 text-white/35 border border-white/10'
                        : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-[0_4px_12px_rgba(16,185,129,0.14)]'
                    }
                `}>
                    <Users size={12} className={isComplete ? 'opacity-20' : 'opacity-70'} />
                    {isComplete ? 'Completo' : `Faltan ${faltan}`}
                </div>
            </div>

            {/* Ubicación Simplificada */}
            <div className={`flex items-center gap-1.5 border-t border-white/10 pt-2 transition-colors
                ${isComplete ? 'text-white/25' : 'text-[#90a4c7]'}
            `}>
                <MapPin size={12} className={`shrink-0 ${isComplete ? 'opacity-25' : 'opacity-60'}`} />
                <p className="text-[12px] font-medium truncate tracking-wide">
                    {simplifiedAddress}
                </p>
            </div>
        </div>
    );
};

export default MatchSelectionCard;
