import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageTitle from './PageTitle';

// Ejemplo de uso del componente PageTitle
const PageTitleExample = () => {
  const navigate = useNavigate();

  return (
    <div className="voting-bg content-with-tabbar">
      <div className="voting-modern-card" style={{ maxWidth: 650 }}>
        {/* Ejemplo 1: Con botón de volver */}
        <PageTitle onBack={() => navigate(-1)}>HISTORIAL</PageTitle>
        
        <div style={{ padding: '20px', color: 'white' }}>
          <p>Contenido de la vista...</p>
        </div>
        
        {/* Ejemplo 2: Sin botón de volver */}
        <PageTitle>QUIERO JUGAR</PageTitle>
        
        <div style={{ padding: '20px', color: 'white' }}>
          <p>Más contenido...</p>
        </div>
        
        {/* Ejemplo 3: Usando prop title en lugar de children */}
        <PageTitle title="CONFIGURACIÓN" onBack={() => navigate('/')} />
        
        <div style={{ padding: '20px', color: 'white' }}>
          <p>Contenido de configuración...</p>
        </div>
      </div>
    </div>
  );
};

export default PageTitleExample;