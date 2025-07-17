import React from 'react';
import './TabBar.css';

const TabBar = ({ activeTab, onTabChange }) => {
  return (
    <div className="tab-bar">
      <button 
        className={`tab-item ${activeTab === 'simple' ? 'active' : ''}`}
        onClick={() => onTabChange('simple')}
      >
        <img src="/rapido.svg" alt="Rápido" className="tab-icon-img" />
        <span className="tab-label">Rápido</span>
      </button>
      <button 
        className={`tab-item ${activeTab === 'votacion' ? 'active' : ''}`}
        onClick={() => onTabChange('votacion')}
      >
        <img src="/participativo.svg" alt="Participativo" className="tab-icon-img" />
        <span className="tab-label">Participativo</span>
      </button>
      <button 
        className={`tab-item ${activeTab === 'quiero-jugar' ? 'active' : ''}`}
        onClick={() => onTabChange('quiero-jugar')}
      >
        <img src="/play.svg" alt="Quiero Jugar" className="tab-icon-img" />
        <span className="tab-label">Quiero Jugar</span>
      </button>
      <button 
        className={`tab-item ${activeTab === 'profile' ? 'active' : ''}`}
        onClick={() => onTabChange('profile')}
      >
        <img src="/profile.svg" alt="Perfil" className="tab-icon-img" />
        <span className="tab-label">Perfil</span>
      </button>
    </div>
  );
};

export default TabBar;