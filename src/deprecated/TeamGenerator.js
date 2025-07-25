import React from 'react';

function TeamGenerator({ teams }) {
  return (
    <div>
      <h2>Equipos Generados</h2>
      {teams.map((team, index) => (
        <div key={index}>
          <h3>Equipo {index + 1}</h3>
          <ul>
            {team.map((player, index) => (
              <li key={index}>
                {player.name} - Puntaje: {player.score}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default TeamGenerator;
