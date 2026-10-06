import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTorneosInboxSummary } from './useTorneosInboxSummary';
import styles from './ConnectedProduct.module.css';

// The Torneos bell: it opens the Torneos inbox and its counter comes exclusively from it.
export default function TorneosInboxBell() {
  const navigate = useNavigate();
  const { total } = useTorneosInboxSummary();
  const label = total > 0 ? `Abrir avisos de Torneos, ${total} sin leer` : 'Abrir avisos de Torneos';
  return (
    <button
      type="button"
      className={styles.bell}
      aria-label={label}
      data-torneos-bell="true"
      onClick={() => navigate('/torneos/avisos')}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
        <path fillRule="evenodd" d="M5.25 9a6.75 6.75 0 0113.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 01-.297 1.206c-1.544.57-3.16.99-4.831 1.243a3.75 3.75 0 11-7.48 0 24.585 24.585 0 01-4.831-1.244.75.75 0 01-.298-1.205A8.217 8.217 0 005.25 9.75V9zm4.502 8.9a2.25 2.25 0 104.496 0 25.057 25.057 0 01-4.496 0z" clipRule="evenodd" />
      </svg>
      {total > 0 && <span className={styles.bellCount} aria-hidden="true">{total > 99 ? '99+' : total}</span>}
    </button>
  );
}
