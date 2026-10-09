import React from 'react';
import {
  Bell,
  Compass,
  Home,
  Trophy,
  UserRound,
} from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTorneosFeatures } from '../../context/TorneosFeaturesContext';
import { useTorneosInboxSummary } from './useTorneosInboxSummary';
import shellStyles from '../TorneosShell.module.css';
import styles from './ConnectedProduct.module.css';

// The personal navigation of Torneos: what a participant (or anyone outside an organization) moves between. Five
// destinations, the same on desktop and on the phone bar, none of them administrative.
export const PERSONAL_NAVIGATION = Object.freeze([
  { label: 'Inicio', path: '/torneos', icon: Home, match: (path) => path === '/torneos' || path === '/torneos/' },
  {
    label: 'Explorar', path: '/torneos/explorar', icon: Compass, feature: 'tournament_catalog',
    match: (path) => path.startsWith('/torneos/explorar'),
  },
  {
    label: 'Mis torneos', mobileLabel: 'Torneos', path: '/torneos/mis-torneos', icon: Trophy,
    match: (path) => ['/torneos/mis-torneos', '/torneos/torneo/', '/torneos/mis-partidos', '/torneos/mis-equipos']
      .some((prefix) => path.startsWith(prefix)),
  },
  {
    label: 'Avisos', path: '/torneos/avisos', icon: Bell, badge: true,
    match: (path) => path.startsWith('/torneos/avisos') || path.startsWith('/torneos/comunicados'),
  },
  { label: 'Perfil', path: '/torneos/perfil', icon: UserRound, match: (path) => path.startsWith('/torneos/perfil') },
]);

export default function PersonalNavigation({ mobile = false, keyboardHidden = false }) {
  const { pathname } = useLocation();
  const features = useTorneosFeatures();
  const { total } = useTorneosInboxSummary();
  const items = PERSONAL_NAVIGATION.filter(({ feature }) => !feature || features[feature] !== false);
  return (
    <nav
      className={mobile
        ? `${shellStyles.mobileNavigation} ${styles.personalMobileNavigation} ${keyboardHidden ? shellStyles.mobileNavigationHidden : ''}`
        : shellStyles.desktopNavigation}
      aria-label={mobile ? 'Navegación móvil de Torneos' : 'Navegación de Torneos'}
      aria-hidden={mobile && keyboardHidden ? 'true' : undefined}
      data-personal-navigation={mobile ? 'mobile' : 'desktop'}
    >
      {items.map(({ label, mobileLabel, path, icon: Icon, match, badge }) => {
        const active = match(pathname);
        return (
          <NavLink
            key={path}
            to={path}
            end
            className={`${shellStyles.navigationItem} ${active ? shellStyles.navigationItemActive : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <span className={`${shellStyles.navigationIcon} ${styles.navigationIconWithBadge}`} aria-hidden="true">
              <Icon size={mobile ? 20 : 18} strokeWidth={1.9} />
              {badge && total > 0 && <span className={styles.navigationBadge}>{total > 9 ? '9+' : total}</span>}
            </span>
            <span>{mobile && mobileLabel ? mobileLabel : label}</span>
            {badge && total > 0 && <span className={styles.srOnly}>{`, ${total} sin leer`}</span>}
          </NavLink>
        );
      })}
    </nav>
  );
}
