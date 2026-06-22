import logger from './logger';
// Quick test to verify notifications_ext view works
import { supabase } from '../supabase';

export const testNotificationsView = async () => {
  try {
    logger.debug('[CHECK_VIEW] Testing notifications_ext view...');
    
    const { data, error } = await supabase
      .from('notifications_ext')
      .select('id')
      .limit(1);
      
    logger.debug('[CHECK_VIEW]', { data, error });
    
    if (error) {
      logger.error('[CHECK_VIEW] View test failed:', error);
      return false;
    }
    
    logger.debug('[CHECK_VIEW] View test passed');
    return true;
  } catch (err) {
    logger.error('[CHECK_VIEW] Exception:', err);
    return false;
  }
};

// Auto-run test in development
if (process.env.NODE_ENV === 'development') {
  setTimeout(testNotificationsView, 1000);
}