import React from 'react';
import { useNativeFeatures } from '../hooks/useNativeFeatures';

export default function NetworkStatus() {
  const { networkStatus } = useNativeFeatures();

  if (networkStatus.connected) {
    return null; // Don't show anything when connected
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      background: '#ff4444',
      color: 'white',
      padding: '10px',
      textAlign: 'center',
      zIndex: 10000,
      fontSize: '14px',
      fontFamily: "'Oswald', Arial, sans-serif"
    }}>
      📶 Sin conexión a internet - Algunos datos pueden no estar actualizados
    </div>
  );
}