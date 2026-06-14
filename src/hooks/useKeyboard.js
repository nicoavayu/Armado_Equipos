import { useState, useEffect } from 'react';
import { Keyboard } from '@capacitor/keyboard';
import { Capacitor } from '@capacitor/core';

const KEYBOARD_HEIGHT_CSS_VAR = '--keyboard-height';

const setKeyboardCssHeight = (height) => {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty(KEYBOARD_HEIGHT_CSS_VAR, `${Math.max(0, height || 0)}px`);
};

export function useKeyboard() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    const updateKeyboardState = (height) => {
      const normalizedHeight = Math.max(0, height || 0);
      setKeyboardHeight(normalizedHeight);
      setIsKeyboardOpen(normalizedHeight > 0);
      setKeyboardCssHeight(normalizedHeight);
    };

    if (!Capacitor.isNativePlatform()) {
      // For web, use visual viewport API if available
      if (window.visualViewport) {
        const handleViewportChange = () => {
          const heightDiff = window.innerHeight - window.visualViewport.height;
          updateKeyboardState(heightDiff > 150 ? heightDiff : 0);
        };

        handleViewportChange();
        window.visualViewport.addEventListener('resize', handleViewportChange);
        window.visualViewport.addEventListener('scroll', handleViewportChange);
        return () => {
          window.visualViewport.removeEventListener('resize', handleViewportChange);
          window.visualViewport.removeEventListener('scroll', handleViewportChange);
        };
      }
      updateKeyboardState(0);
      return;
    }

    // For native platforms, use Capacitor Keyboard plugin
    let cancelled = false;
    const listenerHandles = [];
    const addKeyboardListener = (eventName, listener) => {
      Promise.resolve(Keyboard.addListener(eventName, listener))
        .then((handle) => {
          if (!handle) return;
          if (cancelled) {
            handle.remove();
            return;
          }
          listenerHandles.push(handle);
        })
        .catch(() => {});
    };

    const handleKeyboardShow = (info) => {
      updateKeyboardState(info?.keyboardHeight || 0);
    };
    const handleKeyboardHide = () => {
      updateKeyboardState(0);
    };

    addKeyboardListener('keyboardWillShow', handleKeyboardShow);
    addKeyboardListener('keyboardDidShow', handleKeyboardShow);
    addKeyboardListener('keyboardWillHide', handleKeyboardHide);
    addKeyboardListener('keyboardDidHide', handleKeyboardHide);

    return () => {
      cancelled = true;
      listenerHandles.forEach((handle) => handle.remove());
    };
  }, []);

  return { keyboardHeight, isKeyboardOpen };
}
