import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Swords } from 'lucide-react';
import { useNotifications } from '../context/NotificationContext';
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
import { prefetchRoute } from '../utils/routePrefetch';

const TabBar = ({ activeTab, onTabChange }) => {
  const navigate = useNavigate();
  const notificationsCtx = useNotifications() || {};
  const unreadCount = notificationsCtx.unreadCount || { friends: 0, teamInvites: 0, matches: 0, total: 0 };
  const isAndroidNative = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  const tabBarStyle = {
    paddingBottom: isAndroidNative
      ? 'calc(max(var(--safe-bottom, 0px), 10px) + 8px)'
      : 'max(env(safe-area-inset-bottom), 4px)',
    paddingTop: isAndroidNative ? '2px' : '0px',
  };

  const tabs = [
    { key: 'home', label: 'Inicio', href: '/', ActiveIcon: IoHome, InactiveIcon: IoHomeOutline },
    {
      key: 'quiero-jugar',
      label: 'Quiero Jugar',
      shortLabel: 'Jugar',
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
      className="app-tabbar fixed bottom-0 left-0 right-0 z-[1000] min-h-[60px] h-auto md:min-h-[66px] bg-[#15102c]/92 backdrop-blur-xl border-t border-white/[0.08] shadow-[0_-10px_28px_rgba(6,4,18,0.45)] transition-[transform,opacity] duration-200"
      style={tabBarStyle}
    >
      <div className="relative grid w-full grid-cols-5">
        <div
          className="pointer-events-none absolute top-0 left-0 h-[2px]"
          style={{
            width: `calc(100% / ${tabs.length})`,
            transform: `translateX(${activeIndex * 100}%)`,
            transition: 'transform 250ms ease-out, opacity 200ms ease-out',
          }}
        >
          <span className="mx-5 block h-full rounded-full bg-[#ec007d] shadow-[0_0_8px_rgba(236,0,125,0.5)] md:mx-6" />
        </div>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          const showUnreadDot = (
            (tab.key === 'amigos' && (unreadCount?.friends || 0) > 0)
            || (tab.key === 'desafios' && (unreadCount?.teamInvites || 0) > 0)
          );
          const IconComponent = isActive ? tab.ActiveIcon : tab.InactiveIcon;
          const useSimulatedActive = isActive && tab.simulatedActive;
          const iconProps = {
            size: 22,
            className: `h-[22px] w-[22px] transition-[opacity,transform,filter,color] duration-200 group-active:scale-95 ${
              isActive ? 'scale-100 opacity-100' : 'scale-100 opacity-55'
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
              onMouseEnter={() => prefetchRoute(tab.href)}
              onTouchStart={() => prefetchRoute(tab.href)}
              onFocus={() => prefetchRoute(tab.href)}
              className={`group relative flex min-h-[42px] flex-1 flex-col items-center justify-center bg-transparent py-1.5 transition-[color,opacity,background-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
                isActive ? 'text-white' : 'text-white/65'
              }`}
            >
              <span className={`relative flex h-6 items-center justify-center ${showUnreadDot ? 'min-w-[34px] gap-1' : 'w-6'}`}>
                <IconComponent {...iconProps} />
                {showUnreadDot && (
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#128BE9] ring-2 ring-[#1f2747] shadow-[0_0_8px_rgba(18,139,233,0.5)]"
                  />
                )}
              </span>
              <span
                className={`mt-1 whitespace-nowrap text-[11px] font-sans tracking-wide transition-[opacity,color,font-weight] duration-200 ${
                  isActive ? 'font-semibold text-white opacity-100' : 'font-medium text-white/70 opacity-60'
                }`}
              >
                {tab.shortLabel ? (
                  <>
                    <span className="sm:hidden">{tab.shortLabel}</span>
                    <span className="hidden sm:inline">{tab.label}</span>
                  </>
                ) : (
                  tab.label
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default TabBar;
