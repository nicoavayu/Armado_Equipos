import React from 'react';
import { CATALOG_STATE } from '../../domain/connectedProduct';
import styles from './ConnectedProduct.module.css';

// The registration state of a call («Inscripción abierta», «Cerrada», …), the same chip on every screen.
export default function CatalogStateChip({ state }) {
  const meta = CATALOG_STATE[state] || CATALOG_STATE.closed;
  return <span className={styles.stateChip} data-tone={meta.tone}>{meta.label}</span>;
}
