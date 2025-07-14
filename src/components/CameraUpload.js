import React from 'react';
import { useNativeFeatures } from '../hooks/useNativeFeatures';

export default function CameraUpload({ onPhotoTaken, children }) {
  const { takePicture, vibrate } = useNativeFeatures();

  const handleTakePhoto = async () => {
    try {
      await vibrate('light');
      const photo = await takePicture();
      if (photo) {
        onPhotoTaken(photo);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
    }
  };

  return (
    <button 
      onClick={handleTakePhoto}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer'
      }}
    >
      {children}
    </button>
  );
}