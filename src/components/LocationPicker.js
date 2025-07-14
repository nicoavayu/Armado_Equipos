import React, { useState } from 'react';
import { useNativeFeatures } from '../hooks/useNativeFeatures';

export default function LocationPicker({ onLocationSelected }) {
  const { getCurrentLocation, vibrate } = useNativeFeatures();
  const [loading, setLoading] = useState(false);

  const handleGetLocation = async () => {
    setLoading(true);
    try {
      await vibrate('light');
      const position = await getCurrentLocation();
      if (position) {
        const { latitude, longitude } = position.coords;
        // Use reverse geocoding to get address (you might want to add a geocoding service)
        const locationText = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
        onLocationSelected(locationText);
      }
    } catch (error) {
      console.error('Error getting location:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button 
      onClick={handleGetLocation}
      disabled={loading}
      style={{
        background: 'rgba(0, 123, 255, 0.8)',
        color: 'white',
        border: 'none',
        padding: '10px 15px',
        borderRadius: '8px',
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.6 : 1
      }}
    >
      {loading ? '📍 Obteniendo...' : '📍 Usar mi ubicación'}
    </button>
  );
}