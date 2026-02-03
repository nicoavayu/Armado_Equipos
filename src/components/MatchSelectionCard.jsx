import React from 'react';
import { MapPin, Users } from 'lucide-react';

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
            className={`relative rounded-xl p-4 backdrop-blur-sm transition-all duration-300 cursor-pointer flex flex-col gap-2 
                ${isSelected
                    ? 'bg-white/18 border-blue-500/65 shadow-[0_10px_30px_rgba(0,0,0,0.45)] ring-1 ring-blue-500/30 scale-[1.01]'
                    : (isComplete ? 'bg-white/10 border-white/12' : 'bg-white/14 border-white/18') + ' shadow-[0_8px_24px_rgba(0,0,0,0.35)] hover:bg-white/20 hover:border-white/25'
                }
                ${inviteStatus !== 'available' && !isSelected ? 'active:scale-100' : 'active:scale-95'}
                ${!isComplete && !isSelected ? 'border-l-4 border-l-blue-500/40' : ''}
            `}
        >
            {/* Header: Título y Status de jugadores */}
            <div className="flex justify-between items-start gap-3">
                <div className="flex-1 min-w-0">
                    <h4 className={`font-oswald text-base font-bold uppercase truncate leading-tight tracking-tight transition-colors
                        ${isComplete ? 'text-white/35' : 'text-white'}
                    `}>
                        {title}
                    </h4>
                    {!showDateTimeInTitle && (
                        <p className={`text-[11px] font-medium mt-1 uppercase tracking-wide transition-colors
                            ${isComplete ? 'text-white/25' : 'text-slate-400'}
                        `}>
                            {match.fecha_display || match.fecha} • {match.hora}
                        </p>
                    )}
                </div>

                <div className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all
                    ${isComplete
                        ? 'bg-white/5 text-white/30 border border-white/10'
                        : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 shadow-[0_4px_12px_rgba(16,185,129,0.1)]'
                    }
                `}>
                    <Users size={12} className={isComplete ? 'opacity-20' : 'opacity-60'} />
                    {isComplete ? 'Completo' : `Faltan ${faltan}`}
                </div>
            </div>

            {/* Ubicación Simplificada */}
            <div className={`flex items-center gap-1.5 border-t border-white/5 pt-1 transition-colors
                ${isComplete ? 'text-white/20' : 'text-slate-500'}
            `}>
                <MapPin size={12} className={`shrink-0 ${isComplete ? 'opacity-20' : 'opacity-40'}`} />
                <p className="text-[11px] font-medium truncate italic tracking-wide">
                    {simplifiedAddress}
                </p>
            </div>
        </div>
    );
};

export default MatchSelectionCard;
