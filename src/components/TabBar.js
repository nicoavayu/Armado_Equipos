import React from 'react';
import './TabBar.css';
import NotificationBadge from './NotificationBadge';
import { useNotifications } from '../context/NotificationContext';

const TabBar = ({ activeTab, onTabChange }) => {
  const { unreadCount } = useNotifications();
  
  return (
    <div className="tab-bar">
      {/* Home */}
      <button 
        className={`tab-item ${activeTab === 'home' ? 'active' : ''}`}
        onClick={() => onTabChange('home')}
      >
        <div className="tab-icon-container">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={28} height={28}>
            <path d="M11.47 3.84a.75.75 0 011.06 0l8.69 8.69a.75.75 0 101.06-1.06l-8.689-8.69a2.25 2.25 0 00-3.182 0l-8.69 8.69a.75.75 0 001.061 1.06l8.69-8.69z" />
            <path d="M12 5.432l8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75V21a.75.75 0 01-.75.75H5.625a1.875 1.875 0 01-1.875-1.875v-6.198a2.29 2.29 0 00.091-.086L12 5.43z" />
          </svg>
        </div>
        <span className="tab-label">Inicio</span>
      </button>
      
      {/* Armar Equipos */}
      <button 
        className={`tab-item ${activeTab === 'votacion' ? 'active' : ''}`}
        onClick={() => onTabChange('votacion')}
      >
        <div className="tab-icon-container">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={28} height={28}>
            <path d="M4.5 6.375a4.125 4.125 0 1 1 8.25 0 4.125 4.125 0 0 1-8.25 0ZM14.25 8.625a3.375 3.375 0 1 1 6.75 0 3.375 3.375 0 0 1-6.75 0ZM1.5 19.125a7.125 7.125 0 0 1 14.25 0v.003l-.001.119a.75.75 0 0 1-.363.63 13.067 13.067 0 0 1-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 0 1-.364-.63l-.001-.122ZM17.25 19.128l-.001.144a2.25 2.25 0 0 1-.233.96 10.088 10.088 0 0 0 5.06-1.01.75.75 0 0 0 .42-.643 4.875 4.875 0 0 0-6.957-4.611 8.586 8.586 0 0 1 1.71 5.157v.003Z" />
          </svg>
          {unreadCount.matches > 0 && <NotificationBadge count={unreadCount.matches} />}
        </div>
        <span className="tab-label">Armar Equipos</span>
      </button>
      
      {/* Quiero Jugar */}
      <button 
        className={`tab-item ${activeTab === 'quiero-jugar' ? 'active' : ''}`}
        onClick={() => onTabChange('quiero-jugar')}
      >
        <div className="tab-icon-container">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={28} height={28}>
            <path fillRule="evenodd" d="M4.5 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.347c1.295.712 1.295 2.573 0 3.286L7.28 19.99c-1.25.687-2.779-.217-2.779-1.643V5.653Z" clipRule="evenodd" />
          </svg>
          {unreadCount.matches > 0 && <NotificationBadge count={unreadCount.matches} />}
        </div>
        <span className="tab-label">Quiero Jugar</span>
      </button>
      
      {/* Amigos */}
      <button 
        className={`tab-item ${activeTab === 'amigos' ? 'active' : ''}`}
        onClick={() => onTabChange('amigos')}
      >
        <div className="tab-icon-container">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={28} height={28}>
            <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
          </svg>
          {unreadCount.friends > 0 && <NotificationBadge count={unreadCount.friends} />}
        </div>
        <span className="tab-label">Amigos</span>
      </button>
      
      {/* Perfil */}
      <button 
        className={`tab-item ${activeTab === 'profile' ? 'active' : ''}`}
        onClick={() => onTabChange('profile')}
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
