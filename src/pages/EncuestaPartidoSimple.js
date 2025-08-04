import React from 'react';
import { useNavigate } from 'react-router-dom';

const EncuestaPartidoSimple = () => {
  const navigate = useNavigate();

  return (
    <div style={{ padding: '20px', textAlign: 'center', color: 'white', background: '#1a1a1a', minHeight: '100vh' }}>
      <h2>Encuesta de Partido</h2>
      <p>Componente temporal para debugging</p>
      <button onClick={() => navigate('/')} style={{ padding: '10px 20px', margin: '10px' }}>
        Volver al inicio
      </button>
    </div>
  );
};

export default EncuestaPartidoSimple;