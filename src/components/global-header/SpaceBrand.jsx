import React from 'react';
import Arma2Logo from '../../Logo.png';
import TorneosLogo from '../../assets/branding/arma2-torneos.png';
import { APP_SPACE } from '../../features/space-navigation';
import styles from './GlobalHeader.module.css';

// `unread`: a small dot right after the logo, at its baseline (next to Arma2's «2» / Torneos' «S»), never over it.
export default function SpaceBrand({ space, unread = false, unreadTestId }) {
  const torneos = space === APP_SPACE.TORNEOS;
  return (
    <span className={styles.brandMark} data-space={torneos ? 'torneos' : 'arma2'}>
      {torneos ? (
        <img
          className={styles.torneosOfficialLogo}
          src={TorneosLogo}
          alt="Torneos"
          data-space-brand="torneos"
        />
      ) : (
        <img
          className={styles.arma2Logo}
          src={Arma2Logo}
          alt="Arma2"
          data-space-brand="arma2"
        />
      )}
      {unread && <span className={styles.spaceUnreadDot} data-testid={unreadTestId} aria-hidden="true" />}
    </span>
  );
}
