import React from 'react';

const ProfileStats = ({ profile }) => {
  if (!profile) return null;

  const partidosJugados = profile.partidos_jugados || 0;
  const partidosAbandonados = profile.partidos_abandonados || 0;
  const mvps = profile.mvps || 0;
  const tarjetasRojas = profile.tarjetas_rojas || 0;
  const rating = profile.rating || 5.0;

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="text-lg font-semibold mb-4">Estadísticas</h3>
      
      <div className="grid grid-cols-2 gap-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-green-600">{partidosJugados}</div>
          <div className="text-sm text-gray-600">Partidos Jugados</div>
        </div>
        
        <div className="text-center">
          <div className="text-2xl font-bold text-red-600">{partidosAbandonados}</div>
          <div className="text-sm text-gray-600">Partidos Abandonados</div>
        </div>
        
        <div className="text-center">
          <div className="text-2xl font-bold text-yellow-600">{mvps}</div>
          <div className="text-sm text-gray-600">MVPs</div>
        </div>
        
        <div className="text-center">
          <div className="text-2xl font-bold text-red-500">{tarjetasRojas}</div>
          <div className="text-sm text-gray-600">Tarjetas Rojas</div>
        </div>
      </div>
      
      <div className="mt-4 text-center">
        <div className="text-xl font-bold text-blue-600">{rating.toFixed(1)}</div>
        <div className="text-sm text-gray-600">Rating</div>
      </div>
    </div>
  );
};

export default ProfileStats;