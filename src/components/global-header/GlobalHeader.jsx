import React from 'react';
import { useNotifications } from '../../context/NotificationContext';
import NotificationsBell from '../NotificationsBell';
import { APP_SPACE, useSpaceNavigation } from '../../features/space-navigation';
import SpaceSelector from './SpaceSelector';
import UserAvatarMenu from './UserAvatarMenu';
import styles from './GlobalHeader.module.css';

export default function GlobalHeader({ className = '' }) {
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
        <div className={styles.headerSideLeft}><UserAvatarMenu /></div>
        <div className={styles.headerCenter}><SpaceSelector /></div>
        <div className={styles.headerSideRight}>
          <NotificationsBell
            unreadCount={unreadCount}
            disabled={!notificationsAvailable}
            onClick={() => switchSpace(APP_SPACE.ARMA2, { route: '/notifications' })}
          />
        </div>
      </div>
    </header>
  );
}

