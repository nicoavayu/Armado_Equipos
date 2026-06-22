import logger from '../utils/logger';
import { useEffect } from 'react';
import { processPendingNotifications } from '../services/notificationService';

export const useNotificationProcessor = () => {
  useEffect(() => {
    // Process notifications every minute
    const interval = setInterval(async () => {
      try {
        await processPendingNotifications();
      } catch (error) {
        logger.error('Error processing notifications:', error);
      }
    }, 60000); // 1 minute

    // Process immediately on mount
    processPendingNotifications().catch(logger.error);

    return () => clearInterval(interval);
  }, []);
};