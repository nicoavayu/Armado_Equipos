import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Swords } from 'lucide-react';
import {
  IoFootball,
  IoFootballOutline,
  IoHome,
  IoHomeOutline,
  IoPeople,
  IoPeopleOutline,
  IoPerson,
  IoPersonOutline,
} from 'react-icons/io5';

const TabBar = ({ activeTab, onTabChange }) => {
  const navigate = useNavigate();

  const tabs = [
    { key: 'home', label: 'Inicio', href: '/', ActiveIcon: IoHome, InactiveIcon: IoHomeOutline },
    {
      key: 'quiero-jugar',
      label: 'Quiero Jugar',
      href: '/quiero-jugar',
      ActiveIcon: IoFootball,
      InactiveIcon: IoFootballOutline,
    },
    {
      key: 'desafios',
      label: 'Desafíos',
      href: '/desafios',
      ActiveIcon: Swords,
      InactiveIcon: Swords,
      simulatedActive: true,
    },
    { key: 'amigos', label: 'Amigos', href: '/amigos', ActiveIcon: IoPeople, InactiveIcon: IoPeopleOutline },
    { key: 'profile', label: 'Perfil', href: '/profile', ActiveIcon: IoPerson, InactiveIcon: IoPersonOutline },
  ];

  const handleTabClick = (tab) => {
    navigate(tab.href);

    if (onTabChange) onTabChange(tab.key);
  };
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.key === activeTab)
  );

  return (
    <div
      className="app-tabbar fixed bottom-0 left-0 right-0 z-[1000] min-h-[62px] h-auto md:min-h-[70px] bg-white/5 backdrop-blur-md border-t border-white/10 shadow-[0_-8px_24px_rgba(0,0,0,0.16)] pb-[max(env(safe-area-inset-bottom),4px)] transition-[transform,opacity] duration-200"
    >
      <div className="relative grid w-full grid-cols-5">
        <div
          className="pointer-events-none absolute top-0 left-0 h-[3px]"
          style={{
            width: `calc(100% / ${tabs.length})`,
            transform: `translateX(${activeIndex * 100}%)`,
            transition: 'transform 250ms ease-out, opacity 200ms ease-out',
          }}
        >
          <span className="mx-3 block h-full rounded-full bg-white/90 shadow-[0_0_8px_rgba(255,255,255,0.22)] md:mx-4" />
        </div>
        {tabs.map((tab, index) => {
          const isActive = activeTab === tab.key;
          const IconComponent = isActive ? tab.ActiveIcon : tab.InactiveIcon;
          const useSimulatedActive = isActive && tab.simulatedActive;
          const iconProps = {
            size: 24,
            className: `h-6 w-6 transition-[opacity,transform,filter,color] duration-200 group-active:scale-95 ${
              isActive ? 'scale-100 opacity-100' : 'scale-100 opacity-60'
            } ${
              useSimulatedActive
                ? 'drop-shadow-[0_2px_6px_rgba(255,255,255,0.25)]'
                : isActive
                ? 'drop-shadow-[0_2px_4px_rgba(255,255,255,0.2)]'
                : 'drop-shadow-none'
            }`,
          };

          if (tab.simulatedActive) {
            iconProps.strokeWidth = useSimulatedActive ? 2.9 : 2.1;
          }

          return (
            <button
              key={tab.key}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => handleTabClick(tab)}
              className={`group relative flex min-h-[42px] flex-1 flex-col items-center justify-center bg-transparent py-1.5 md:py-2 transition-[color,opacity,background-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
                index < tabs.length - 1 ? 'border-r border-white/10' : ''
              } ${isActive ? 'text-white' : 'text-white/70'}`}
            >
              <span className="relative flex h-6 w-6 items-center justify-center">
                <IconComponent {...iconProps} />
              </span>
              <span
                className={`mt-1.5 text-[12px] font-sans tracking-wide transition-[opacity,color,font-weight] duration-200 ${
                  isActive ? 'font-bold text-white opacity-100' : 'font-semibold text-white/75 opacity-60'
                }`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default TabBar;
