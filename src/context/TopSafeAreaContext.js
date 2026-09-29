import { createContext, useContext } from 'react';

// True when an ancestor layout already pads the top safe area (--safe-top).
// Screens that can render both standalone and nested inside such a layout read
// it so the inset is applied exactly once: never zero (title under the Android
// 15+/iOS status bar), never twice (double gap).
export const TopSafeAreaAppliedContext = createContext(false);

export const useTopSafeAreaApplied = () => useContext(TopSafeAreaAppliedContext);
