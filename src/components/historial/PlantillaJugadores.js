import React from 'react';

/**
 * Componente que muestra la plantilla de jugadores de un partido
 * @param {Array} jugadores - Lista de jugadores del partido
 */
const PlantillaJugadores = ({ jugadores = [] }) => {
  if (!jugadores || jugadores.length === 0) {
    return (
      <div className="text-center text-[#aaa] italic p-5 bg-[#2a2a40] rounded-[10px] mt-4">
        No hay jugadores registrados para este partido
      </div>
    );
  }

  return (
    <div className="mt-5">
      <h3 className="text-xl text-white border-l-4 border-fifa-cyan pl-3 mb-4 font-bebas uppercase tracking-wider">
        Plantilla de Jugadores
      </h3>
      <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(150px,1fr))] max-[768px]:grid-cols-[repeat(auto-fill,minmax(120px,1fr))]">
        {jugadores.map((jugador, index) => (
          <div
            key={jugador.uuid || index}
            className="bg-[#2a2a40] rounded-[10px] p-4 flex flex-col items-center transition-transform duration-200 hover:-translate-y-[3px] hover:shadow-[0_5px_15px_rgba(0,0,0,0.3)]"
          >
            <div className="w-[70px] h-[70px] rounded-full overflow-hidden mb-2.5 bg-[#16162e] flex items-center justify-center border-[3px] border-[#8178e5] max-[768px]:w-[60px] max-[768px]:h-[60px]">
              {jugador.foto_url || jugador.avatar_url ? (
                <img
                  src={jugador.foto_url || jugador.avatar_url}
                  alt={jugador.nombre}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-[#444] text-white text-[1.8rem] font-bold">
                  {jugador.nombre?.charAt(0) || '?'}
                </div>
              )}
            </div>
            <div className="text-center w-full">
              <div className="font-semibold text-base mb-1 text-white whitespace-nowrap overflow-hidden text-ellipsis max-[768px]:text-[0.9rem]">
                {jugador.nombre}
              </div>
              {jugador.score && (
                <div className="text-[0.8rem] text-[#aaa]">
                  Score: {jugador.score}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PlantillaJugadores;