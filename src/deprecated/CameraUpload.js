import React from 'react';
import { useNativeFeatures } from '../hooks/useNativeFeatures';

export default function CameraUpload({ onPhotoTaken, children }) {
  const { takePicture, vibrate, isNative } = useNativeFeatures();

  const handleTakePhoto = async () => {
    try {
      await vibrate('light');
      if (isNative) {
        // En dispositivos nativos, usar cámara nativa
        const photo = await takePicture();
        if (photo) {
          onPhotoTaken(photo);
        }
      } else {
        // En web, abrir selector de archivos
        document.getElementById('foto-input').click();
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      // Fallback a selector de archivos
      document.getElementById('foto-input').click();
    }
  };

  return (
    <button 
      onClick={handleTakePhoto}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}