import React from 'react';
import { useNotifications } from '../../context/NotificationContext';
import NotificationsBell from '../NotificationsBell';
import { APP_SPACE, useSpaceNavigation } from '../../features/space-navigation';
import SpaceSelector from './SpaceSelector';
import UserAvatarMenu from './UserAvatarMenu';
import styles from './GlobalHeader.module.css';

// The header is shared by both products, but its two account controls belong to the product that renders it.
// Core passes nothing and gets its own avatar menu (availability, awards, Core profile) and notifications bell.
// Torneos passes its own `accountMenu` and `notificationsControl`, so opening the profile or the bell never
// leaves Torneos; switching product stays an explicit action of the space selector.
export default function GlobalHeader({
  className = '',
  accountMenu = null,
  notificationsControl = null,
  currentUnread = null,
}) {
  const { currentSpace, switchSpace, isSpaceAvailable } = useSpaceNavigation();
  const notificationsContext = useNotifications() || {};
  const unreadCount = currentSpace === APP_SPACE.ARMA2
    ? notificationsContext.unreadCount || { total: 0 }
    : { total: 0 };
  const notificationsAvailable = isSpaceAvailable(APP_SPACE.ARMA2);

  return (
    <header
      className={`${styles.header} ${currentSpace === APP_SPACE.TORNEOS ? styles.headerTorneos : ''} ${className}`}
      data-testid="global-header"
    >
      <div className={styles.headerInner}>
        <div className={styles.headerSideLeft}>{accountMenu || <UserAvatarMenu />}</div>
        <div className={styles.headerCenter}>
          <SpaceSelector
            currentUnread={currentUnread || (currentSpace === APP_SPACE.ARMA2
              ? { status: 'ready', hasUnread: Number(unreadCount.total) > 0 }
              : null)}
          />
        </div>
        <div className={styles.headerSideRight}>
          {notificationsControl || (
            <NotificationsBell
              unreadCount={unreadCount}
              disabled={!notificationsAvailable}
              onClick={() => switchSpace(APP_SPACE.ARMA2, { route: '/notifications' })}
            />
          )}
        </div>
      </div>
    </header>
  );
}
