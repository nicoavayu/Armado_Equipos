import { useState, useEffect } from 'react';
import { Keyboard } from '@capacitor/keyboard';
import { Capacitor } from '@capacitor/core';

export function useKeyboard() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      // For web, use visual viewport API if available
      if (window.visualViewport) {
        const handleViewportChange = () => {
          const heightDiff = window.innerHeight - window.visualViewport.height;
          setKeyboardHeight(heightDiff > 150 ? heightDiff : 0);
          setIsKeyboardOpen(heightDiff > 150);
        };

        window.visualViewport.addEventListener('resize', handleViewportChange);
        return () => {
          window.visualViewport.removeEventListener('resize', handleViewportChange);
        };
      }
      return;
    }

    // For native platforms, use Capacitor Keyboard plugin
    const keyboardWillShow = Keyboard.addListener('keyboardWillShow', info => {
      setKeyboardHeight(info.keyboardHeight);
      setIsKeyboardOpen(true);
    });

    const keyboardWillHide = Keyboard.addListener('keyboardWillHide', () => {
      setKeyboardHeight(0);
      setIsKeyboardOpen(false);
    });

    return () => {
      keyboardWillShow.remove();
      keyboardWillHide.remove();
    };
  }, []);

  return { keyboardHeight, isKeyboardOpen };
}