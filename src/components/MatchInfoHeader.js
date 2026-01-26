import React from 'react';


const MatchInfoHeader = ({ nombre, fecha, hora, sede }) => {
  const getShortVenueName = (venue) => {
    if (!venue) return '';
    return venue.split(/[,(]/)[0].trim();
  };

  // Fecha corta “jue 14 ago” (sin punto final) en es-AR
  const formatFechaCorta = (f) => {
    try {
      const d = new Date(`${f}T00:00:00`);
      return d
        .toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
        .replace(/\./g, ''); // algunos navegadores agregan punto
    } catch {
      return '';
    }
  };

  const fechaStr = fecha ? formatFechaCorta(fecha) : '';
  const horaStr = hora ? (hora.length > 5 ? hora.slice(0, 5) : hora) : '';
  const venueShort = getShortVenueName(sede);

  return (
    <div className="w-full box-border m-0 p-0 flex flex-col items-center text-center bg-transparent">
      <div className="font-['Bebas_Neue'] text-[28px] sm:text-[24px] lg:text-[32px] leading-[1.05] tracking-[1.2px] text-white font-bold uppercase mb-2.5 shadow-[0_2px_4px_rgba(0,0,0,0.3)] break-words">
        {nombre || 'PARTIDO'}
      </div>

      <div className="font-['Oswald'] text-[15px] sm:text-[14px] leading-[1.2] text-white/90 m-0 capitalize tracking-[0.5px] shadow-[0_1px_2px_rgba(0,0,0,0.2)]">
        {fechaStr}
        {horaStr && fechaStr && ' · '}
        {horaStr}
        {venueShort && (fechaStr || horaStr) && ' – '}
        {venueShort && (
          <a
            href={`https://www.google.com/maps/search/${encodeURIComponent(venueShort)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white underline decoration-white/60 hover:decoration-white decoration-2 underline-offset-2 transition-all duration-200 font-medium hover:opacity-100 opacity-100"
          >
            {venueShort}
          </a>
        )}
      </div>
    </div>
  );
};

export default MatchInfoHeader;
