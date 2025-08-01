import React, { createContext, useContext, useState } from 'react';

const BadgeContext = createContext();

export const useBadges = () => {
  const context = useContext(BadgeContext);
  if (!context) {
    throw new Error('useBadges must be used within a BadgeProvider');
  }
  return context;
};

export const BadgeProvider = ({ children }) => {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const triggerBadgeRefresh = () => {
    console.log('[BADGE_CONTEXT] Triggering badge refresh');
    setRefreshTrigger(prev => prev + 1);
  };

  return (
    <BadgeContext.Provider value={{ refreshTrigger, triggerBadgeRefresh }}>
      {children}
    </BadgeContext.Provider>
  );
};