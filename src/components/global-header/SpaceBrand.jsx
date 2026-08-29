import React from 'react';
import Arma2Logo from '../../Logo.png';
import TorneosLogo from '../../assets/branding/arma2-torneos.png';
import { APP_SPACE } from '../../features/space-navigation';
import styles from './GlobalHeader.module.css';

export default function SpaceBrand({ space }) {
  if (space === APP_SPACE.TORNEOS) {
    return (
      <img
        className={styles.torneosOfficialLogo}
        src={TorneosLogo}
        alt="Torneos"
        data-space-brand="torneos"
      />
    );
  }

  return (
    <img
      className={styles.arma2Logo}
      src={Arma2Logo}
      alt="Arma2"
      data-space-brand="arma2"
    />
  );
}
