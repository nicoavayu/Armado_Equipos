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
      ? 'calc(max(var(--safe-bottom, 0px), 10px) + 6px)'
      : 'max(env(safe-area-inset-bottom), 8px)',
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
      className="app-tabbar fixed bottom-0 left-0 right-0 z-[1000] px-3 pt-1.5 transition-[transform,opacity] duration-200"
      style={tabBarStyle}
    >
      <div className="relative mx-auto grid w-full max-w-[560px] grid-cols-5 overflow-hidden rounded-[22px] border border-white/[0.1] bg-[#120e28]/95 shadow-[0_18px_44px_rgba(5,3,16,0.65),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl">
        {/* Active pill that glides behind the selected tab */}
        <div
          className="pointer-events-none absolute inset-y-1.5 left-0 p-0"
          style={{
            width: `calc(100% / ${tabs.length})`,
            transform: `translateX(${activeIndex * 100}%)`,
            transition: 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          <span className="mx-1.5 flex h-full flex-col rounded-2xl bg-[linear-gradient(160deg,rgba(139,92,255,0.32),rgba(106,67,255,0.14))] border border-[rgba(148,134,255,0.35)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_0_18px_rgba(106,67,255,0.25)]" />
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
            size: 21,
            className: `h-[21px] w-[21px] transition-[opacity,transform,filter,color] duration-200 group-active:scale-95 ${
              isActive ? 'scale-100 opacity-100' : 'scale-100 opacity-55'
            } ${
              useSimulatedActive
                ? 'drop-shadow-[0_0_8px_rgba(176,160,255,0.55)]'
                : isActive
                ? 'drop-shadow-[0_0_6px_rgba(176,160,255,0.45)]'
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
              className={`group relative z-[1] flex min-h-[56px] flex-1 flex-col items-center justify-center bg-transparent py-1.5 transition-[color,opacity,background-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
                isActive ? 'text-white' : 'text-white/60'
              }`}
            >
              <span className={`relative flex h-6 items-center justify-center ${showUnreadDot ? 'min-w-[34px] gap-1' : 'w-6'}`}>
                <IconComponent {...iconProps} />
                {showUnreadDot && (
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full bg-[#ec007d] ring-2 ring-[#120e28] shadow-[0_0_8px_rgba(236,0,125,0.6)]"
                  />
                )}
              </span>
              <span
                className={`mt-0.5 whitespace-nowrap text-[10.5px] font-sans tracking-wide transition-[opacity,color,font-weight] duration-200 ${
                  isActive ? 'font-semibold text-white opacity-100' : 'font-medium text-white/65 opacity-70'
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
