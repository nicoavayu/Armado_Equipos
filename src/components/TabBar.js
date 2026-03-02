import React from 'react';
import { useNavigate } from 'react-router-dom';

const TabBar = ({ activeTab, onTabChange }) => {
  const navigate = useNavigate();

  const handleTabClick = (tab) => {
    if (tab === 'home') navigate('/');
    else if (tab === 'quiero-jugar') navigate('/quiero-jugar');
    else if (tab === 'desafios') navigate('/desafios');
    else if (tab === 'amigos') navigate('/amigos');
    else if (tab === 'profile') navigate('/profile');

    if (onTabChange) onTabChange(tab);
  };

  return (
    <div className="app-tabbar fixed bottom-0 left-0 right-0 flex min-h-[70px] h-auto md:min-h-[80px] z-[1000] bg-white/10 backdrop-blur-[20px] border-t border-white/20 pb-[var(--safe-bottom,0px)] shadow-[0_-8px_32px_rgba(0,0,0,0.3)] transition-[transform,opacity] duration-200">
      {/* Home */}
      <button
        className={`flex-1 flex flex-col items-center justify-center text-white bg-transparent border-r border-white/20 py-2 cursor-pointer transition-all duration-300 font-oswald text-sm md:py-3 md:pb-2 ${activeTab === 'home' ? 'bg-white/30' : ''}`}
        onClick={() => handleTabClick('home')}
      >
        <div className="relative flex items-center justify-center mb-1">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 md:w-6 md:h-6 drop-shadow-sm">
            <path d="M11.47 3.84a.75.75 0 011.06 0l8.69 8.69a.75.75 0 101.06-1.06l-8.689-8.69a2.25 2.25 0 00-3.182 0l-8.69 8.69a.75.75 0 001.061 1.06l8.69-8.69z" />
            <path d="M12 5.432l8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75V21a.75.75 0 01-.75.75H5.625a1.875 1.875 0 01-1.875-1.875v-6.198a2.29 2.29 0 00.091-.086L12 5.43z" />
          </svg>
        </div>
        <span className="text-[10px] md:text-xs font-bold tracking-wider font-sans mt-1">Inicio</span>
      </button>

      {/* Quiero Jugar */}
      <button
        className={`flex-1 flex flex-col items-center justify-center text-white bg-transparent border-r border-white/20 py-2 cursor-pointer transition-all duration-300 ${activeTab === 'quiero-jugar' ? 'bg-white/30 shadow-inner' : ''}`}
        onClick={() => handleTabClick('quiero-jugar')}
      >
        <div className="relative flex items-center justify-center mb-0.5">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 md:w-5 md:h-5 drop-shadow-sm">
            <path fillRule="evenodd" d="M4.5 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.347c1.295.712 1.295 2.573 0 3.286L7.28 19.99c-1.25.687-2.779-.217-2.779-1.643V5.653Z" clipRule="evenodd" />
          </svg>
        </div>
        <span className="text-[10px] md:text-xs font-bold tracking-wider font-sans mt-1">Quiero Jugar</span>
      </button>

      {/* Desafíos */}
      <button
        className={`flex-1 flex flex-col items-center justify-center text-white bg-transparent border-r border-white/20 py-2 cursor-pointer transition-all duration-300 ${activeTab === 'desafios' ? 'bg-white/30 shadow-inner' : ''}`}
        onClick={() => handleTabClick('desafios')}
      >
        <div className="relative flex items-center justify-center mb-0.5">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 md:w-5 md:h-5 drop-shadow-sm">
            <path fillRule="evenodd" d="M5.625 3.75A1.875 1.875 0 0 0 3.75 5.625v2.25c0 .621.302 1.203.809 1.558l2.41 1.686a6.723 6.723 0 0 0 2.79 1.145 5.982 5.982 0 0 1-2.289 1.39.75.75 0 0 0-.47.696v.9c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-.9a.75.75 0 0 0-.47-.697 5.982 5.982 0 0 1-2.289-1.39 6.723 6.723 0 0 0 2.79-1.144l2.41-1.686a1.875 1.875 0 0 0 .809-1.558v-2.25A1.875 1.875 0 0 0 18.375 3.75h-1.5v-.375A1.875 1.875 0 0 0 15 1.5H9a1.875 1.875 0 0 0-1.875 1.875v.375h-1.5Zm1.5 1.5h9.75v.65a5.25 5.25 0 0 1-4.875 5.236A5.25 5.25 0 0 1 7.125 5.9v-.65Z" clipRule="evenodd" />
            <path d="M9 18.75A1.5 1.5 0 0 0 7.5 20.25v.75c0 .414.336.75.75.75h7.5a.75.75 0 0 0 .75-.75v-.75A1.5 1.5 0 0 0 15 18.75H9Z" />
          </svg>
        </div>
        <span className="text-[10px] md:text-xs font-bold tracking-wider font-sans mt-1">Desafíos</span>
      </button>

      {/* Amigos */}
      <button
        className={`flex-1 flex flex-col items-center justify-center text-white bg-transparent border-r border-white/20 py-2 cursor-pointer transition-all duration-300 ${activeTab === 'amigos' ? 'bg-white/30 shadow-inner' : ''}`}
        onClick={() => handleTabClick('amigos')}
      >
        <div className="relative flex items-center justify-center mb-0.5">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 md:w-5 md:h-5 drop-shadow-sm">
            <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
          </svg>
        </div>
        <span className="text-[10px] md:text-xs font-bold tracking-wider font-sans mt-1">Amigos</span>
      </button>

      {/* Perfil */}
      <button
        className={`flex-1 flex flex-col items-center justify-center text-white bg-transparent border-none py-2 cursor-pointer transition-all duration-300 ${activeTab === 'profile' ? 'bg-white/30 shadow-inner' : ''} active:bg-white/40`}
        onClick={() => handleTabClick('profile')}
      >
        <div className="relative flex items-center justify-center mb-0.5">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 md:w-5 md:h-5 drop-shadow-sm">
            <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM3.751 20.105a8.25 8.25 0 0 1 16.498 0 .75.75 0 0 1-.437.695A18.683 18.683 0 0 1 12 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 0 1-.437-.695Z" clipRule="evenodd" />
          </svg>
        </div>
        <span className="text-[10px] md:text-xs font-bold tracking-wider font-sans mt-1">Perfil</span>
      </button>
    </div>
  );
};

export default TabBar;
