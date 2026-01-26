import React from 'react';

/**
 * Tarjeta para mostrar jugadores destacados con badges
 * @param {Object} props
 * @param {Object} props.jugador - Datos del jugador
 * @param {String} props.tipo - Tipo de destacado (mvp, arquero, sucio)
 */
const JugadorDestacadoCard = ({ jugador, tipo }) => {
  if (!jugador) return null;

  // Configurar badge según el tipo
  const getBadgeInfo = () => {
    switch (tipo) {
      case 'mvp':
        return {
          icon: '🏆',
          label: 'MVP',
          cardBorderClass: 'border-t-[3px] border-[#ffd700]',
          badgeBgClass: 'bg-[#ffd700] text-[#333]',
          avatarBorderClass: 'border-[#ffd700]',
        };
      case 'arquero':
        return {
          icon: '🧤',
          label: 'Mejor Arquero',
          cardBorderClass: 'border-t-[3px] border-[#4caf50]',
          badgeBgClass: 'bg-[#4caf50] text-white',
          avatarBorderClass: 'border-[#4caf50]',
        };
      case 'sucio':
        return {
          icon: '🃏',
          label: 'Tarjeta Negra',
          cardBorderClass: 'border-t-[3px] border-[#ff6b6b]',
          badgeBgClass: 'bg-[#ff6b6b] text-white',
          avatarBorderClass: 'border-[#ff6b6b]',
        };
      default:
        return {
          icon: '⭐',
          label: 'Destacado',
          cardBorderClass: '',
          badgeBgClass: 'bg-[#8178e5] text-white',
          avatarBorderClass: 'border-[#8178e5]',
        };
    }
  };

  const { icon, label, cardBorderClass, badgeBgClass, avatarBorderClass } = getBadgeInfo();

  return (
    <div className={`bg-[#2a2a40] rounded-[10px] p-4 flex flex-col items-center relative overflow-hidden transition-all duration-200 hover:-translate-y-[5px] hover:shadow-[0_5px_15px_rgba(0,0,0,0.3)] ${cardBorderClass}`}>
      <div className={`absolute top-0 right-0 py-[5px] px-[10px] rounded-bl-[10px] text-[0.8rem] font-semibold flex items-center gap-[5px] ${badgeBgClass}`}>
        <span className="text-[1rem]">{icon}</span>
        <span className="hidden md:inline">{label}</span>
      </div>
      <div className={`w-20 h-20 rounded-full overflow-hidden mb-2.5 bg-[#16162e] flex items-center justify-center border-[3px] ${avatarBorderClass}`}>
        {jugador.avatar_url ? (
          <img
            src={jugador.avatar_url}
            alt={jugador.nombre}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-[#444] text-white text-[2rem] font-bold">
            {jugador.nombre.charAt(0)}
          </div>
        )}
      </div>
      <div className="text-center">
        <div className="font-semibold text-base mb-1 text-white">{jugador.nombre}</div>
        {jugador.position && (
          <div className="text-[0.8rem] text-[#aaa]">{jugador.position}</div>
        )}
      </div>
    </div>
  );
};

export default JugadorDestacadoCard;