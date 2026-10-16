import React from 'react';
import { APPLE_UNLINK_HELP_URL, APPLE_UNLINK_STEPS } from './accountDeletion';

// Cómo desvincular Arma2 del Apple ID a mano (Apple TN3194 / Support 102571), cuando no se pudo revocar automáticamente.
export default function AppleUnlinkSteps({ className }) {
  return (
    <p className={className}>
      {APPLE_UNLINK_STEPS}{' '}
      <a className="underline" href={APPLE_UNLINK_HELP_URL} target="_blank" rel="noopener noreferrer">Ayuda de Apple</a>
    </p>
  );
}
