import React from 'react';
import logo from '../assets/arma2-torneos-logo.png';
import logoInverted from '../assets/arma2-torneos-logo-inverted.png';
import styles from './TorneosBrand.module.css';

export default function TorneosBrand({
  inverted = false,
  className = '',
  decorative = false,
}) {
  return (
    <span className={`${styles.brand} ${className}`.trim()}>
      <img
        className={styles.image}
        src={inverted ? logoInverted : logo}
        alt={decorative ? '' : 'Arma2 Torneos'}
      />
    </span>
  );
}
