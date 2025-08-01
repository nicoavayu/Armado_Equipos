import React from 'react';
import { useNavigate } from 'react-router-dom';
import './TabBar.css';

const TabBar = ({ activeTab, onTabChange }) => {
  const navigate = useNavigate();
  
  const handleTabClick = (tab) => {
    if (tab === 'home') navigate('/');
    else if (tab === 'quiero-jugar') navigate('/quiero-jugar');
    else if (tab === 'amigos') navigate('/amigos');
    else if (tab === 'profile') navigate('/profile');
    
    if (onTabChange) onTabChange(tab);
  };
  
  return (
    <div className="tab-bar">
      {/* Home */}
      <button 
        className={`tab-item ${activeTab === 'home' ? 'active' : ''}`}
        onClick={() => handleTabClick('home')}
      >
        <div className="tab-icon-container">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={28} height={28}>
            <path d="M11.47 3.84a.75.75 0 011.06 0l8.69 8.69a.75.75 0 101.06-1.06l-8.689-8.69a2.25 2.25 0 00-3.182 0l-8.69 8.69a.75.75 0 001.061 1.06l8.69-8.69z" />
            <path d="M12 5.432l8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75V21a.75.75 0 01-.75.75H5.625a1.875 1.875 0 01-1.875-1.875v-6.198a2.29 2.29 0 00.091-.086L12 5.43z" />
          </svg>
        </div>
        <span className="tab-label">Inicio</span>
      </button>
      
      
      {/* Quiero Jugar */}
      <button 
        className={`tab-item ${activeTab === 'quiero-jugar' ? 'active' : ''}`}
        onClick={() => handleTabClick('quiero-jugar')}
      >
        <div className="tab-icon-container">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={28} height={28}>
            <path fillRule="evenodd" d="M4.5 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.347c1.295.712 1.295 2.573 0 3.286L7.28 19.99c-1.25.687-2.779-.217-2.779-1.643V5.653Z" clipRule="evenodd" />
          </svg>
        </div>
        <span className="tab-label">Quiero Jugar</span>
      </button>
      
      {/* Amigos */}
      <button 
        className={`tab-item ${activeTab === 'amigos' ? 'active' : ''}`}
        onClick={() => handleTabClick('amigos')}
      >
        <div className="tab-icon-container">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={28} height={28}>
            <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
          </svg>
        </div>
        <span className="tab-label">Amigos</span>
      </button>
      
      {/* Perfil */}
      <button 
        className={`tab-item ${activeTab === 'profile' ? 'active' : ''}`}
        onClick={() => handleTabClick('profile')}
      >
        <div className="tab-icon-container">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={28} height={28}>
            <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM3.751 20.105a8.25 8.25 0 0 1 16.498 0 .75.75 0 0 1-.437.695A18.683 18.683 0 0 1 12 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 0 1-.437-.695Z" clipRule="evenodd" />
          </svg>
        </div>
        <span className="tab-label">Perfil</span>
      </button>
    </div>
  );
};

export default TabBar;
