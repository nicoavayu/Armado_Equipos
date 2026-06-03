// Test utility to check notifications for current user
import { supabase } from '../supabase';

export const testUserNotifications = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log('[TEST_NOTIFICATIONS] No user logged in');
      return;
    }
    
    console.log('[TEST_NOTIFICATIONS] Current user:', user.id);
    
    // Check all notifications for this user
    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10);
      
    if (error) {
      console.error('[TEST_NOTIFICATIONS] Error:', error);
      return;
    }
    
    console.log('[TEST_NOTIFICATIONS] Found notifications:', notifications.length);
    notifications.forEach((notif, i) => {
      console.log(`[TEST_NOTIFICATIONS] ${i + 1}:`, {
        id: notif.id,
        type: notif.type,
        title: notif.title,
        read: notif.read,
        created_at: notif.created_at,
      });
    });
    
    // Check specifically for match invites
    const matchInvites = notifications.filter((n) => n.type === 'match_invite');
    console.log('[TEST_NOTIFICATIONS] Match invites:', matchInvites.length);
    
    return notifications;
  } catch (err) {
    console.error('[TEST_NOTIFICATIONS] Exception:', err);
  }
};

export const createPushTestNotification = async (type = 'friend_request', partidoId = null) => {
  try {
    const { data, error } = await supabase.rpc('create_push_test_notification', {
      p_type: type,
      p_partido_id: partidoId,
    });

    if (error) {
      console.error('[TEST_PUSH] Error:', error);
      return { ok: false, error };
    }

    console.log('[TEST_PUSH] Created test push notification:', data);
    return { ok: true, data };
  } catch (err) {
    console.error('[TEST_PUSH] Exception:', err);
    return { ok: false, error: err };
  }
};

// Auto-run in development
if (process.env.NODE_ENV === 'development') {
  // Run after a delay to ensure user is loaded
  setTimeout(() => {
    window.testNotifications = testUserNotifications;
    window.testPushNotification = createPushTestNotification;
    console.log('[TEST_NOTIFICATIONS] Available as window.testNotifications()');
    console.log('[TEST_PUSH] Available as window.testPushNotification(type, partidoId)');
  }, 2000);
}
