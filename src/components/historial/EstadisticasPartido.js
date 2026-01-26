import React from 'react';

/**
 * Componente que muestra estadísticas del partido basadas en encuestas
 * @param {Array} encuestas - Lista de encuestas del partido
 */
const EstadisticasPartido = ({ encuestas = [] }) => {
  // Calcular estadísticas
  const totalEncuestas = encuestas.length;

  // Contar cuántas encuestas reportan que el partido se jugó
  const partidosJugados = encuestas.filter((e) => e.se_jugo).length;

  // Porcentaje de partido limpio
  const votosPartidoLimpio = encuestas.filter((e) => e.partido_limpio).length;
  const porcentajeLimpio = totalEncuestas > 0
    ? Math.round((votosPartidoLimpio / totalEncuestas) * 100)
    : 0;

  // Contar ausencias reportadas (jugadores únicos)
  const ausenciasSet = new Set();
  encuestas.forEach((encuesta) => {
    if (!encuesta.asistieron_todos && encuesta.jugadores_ausentes) {
      encuesta.jugadores_ausentes.forEach((id) => ausenciasSet.add(id));
    }
  });
  const ausenciasReportadas = ausenciasSet.size;

  // Contar jugadores violentos reportados (jugadores únicos)
  const violentosSet = new Set();
  encuestas.forEach((encuesta) => {
    if (!encuesta.partido_limpio && encuesta.jugadores_violentos) {
      encuesta.jugadores_violentos.forEach((id) => violentosSet.add(id));
    }
  });
  const violentosReportados = violentosSet.size;

  return (
    <div className="mt-5">
      <h3 className="text-xl text-white border-l-4 border-fifa-cyan pl-3 mb-4 font-bebas uppercase tracking-wider">
        Estadísticas del Partido
      </h3>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4 max-[768px]:grid-cols-[repeat(auto-fill,minmax(120px,1fr))]">
        <div className="bg-[#2a2a40] rounded-[10px] p-4 text-center transition-transform duration-200 hover:-translate-y-[3px]">
          <div className="text-[1.8rem] font-bold text-[#8178e5] mb-[5px] max-[768px]:text-[1.5rem]">{totalEncuestas}</div>
          <div className="text-[0.9rem] text-[#aaa] max-[768px]:text-[0.8rem]">Encuestas respondidas</div>
        </div>

        <div className="bg-[#2a2a40] rounded-[10px] p-4 text-center transition-transform duration-200 hover:-translate-y-[3px]">
          <div className="text-[1.8rem] font-bold text-[#8178e5] mb-[5px] max-[768px]:text-[1.5rem]">{partidosJugados > 0 ? 'Sí' : 'No'}</div>
          <div className="text-[0.9rem] text-[#aaa] max-[768px]:text-[0.8rem]">¿Se jugó el partido?</div>
        </div>

        <div className="bg-[#2a2a40] rounded-[10px] p-4 text-center transition-transform duration-200 hover:-translate-y-[3px]">
          <div className="text-[1.8rem] font-bold text-[#8178e5] mb-[5px] max-[768px]:text-[1.5rem]">{porcentajeLimpio}%</div>
          <div className="text-[0.9rem] text-[#aaa] max-[768px]:text-[0.8rem]">Partido limpio</div>
          <div className="h-1.5 bg-[#16162e] rounded-[3px] mt-2.5 overflow-hidden">
            <div
              className="h-full bg-[#8178e5] rounded-[3px] transition-[width] duration-1000 ease-in-out"
              style={{ width: `${porcentajeLimpio}%` }}
            ></div>
          </div>
        </div>

        <div className="bg-[#2a2a40] rounded-[10px] p-4 text-center transition-transform duration-200 hover:-translate-y-[3px]">
          <div className="text-[1.8rem] font-bold text-[#8178e5] mb-[5px] max-[768px]:text-[1.5rem]">{ausenciasReportadas}</div>
          <div className="text-[0.9rem] text-[#aaa] max-[768px]:text-[0.8rem]">Ausencias reportadas</div>
        </div>

        <div className="bg-[#2a2a40] rounded-[10px] p-4 text-center transition-transform duration-200 hover:-translate-y-[3px]">
          <div className="text-[1.8rem] font-bold text-[#8178e5] mb-[5px] max-[768px]:text-[1.5rem]">{violentosReportados}</div>
          <div className="text-[0.9rem] text-[#aaa] max-[768px]:text-[0.8rem]">Jugadores con tarjeta negra</div>
        </div>
      </div>

      {totalEncuestas === 0 && (
        <div className="text-center text-[#aaa] italic p-5 bg-[#2a2a40] rounded-[10px] mt-4">
          No hay encuestas respondidas para este partido
        </div>
      )}
    </div>
  );
};

export default EstadisticasPartido;