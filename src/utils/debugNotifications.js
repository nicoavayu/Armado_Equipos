import { supabase } from '../supabase';

/**
 * Debug utility to test notification queries directly
 * Run in browser console: window.debugNotifications()
 */
window.debugNotifications = async () => {
  console.log('=== NOTIFICATION DEBUG START ===');
  
  // 1. Get current user
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) {
    console.error('❌ Error getting user:', userError);
    return;
  }
  console.log('✅ Current user:', user.id);
  
  // 2. Try direct query WITHOUT RLS (as service role would)
  console.log('\n--- Test 1: Direct query with user_id filter ---');
  const { data: test1, error: error1, count: count1 } = await supabase
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('user_id', user.id);
  
  console.log('Result:', { count: count1, data: test1, error: error1 });
  
  // 3. Try query without any filter
  console.log('\n--- Test 2: Query ALL notifications (no filter) ---');
  const { data: test2, error: error2, count: count2 } = await supabase
    .from('notifications')
    .select('*', { count: 'exact' });
  
  console.log('Result:', { count: count2, data: test2, error: error2 });
  
  // 4. Try to insert a test notification
  console.log('\n--- Test 3: Insert test notification ---');
  const testNotif = {
    user_id: user.id,
    type: 'test',
    title: 'Test Notification',
    message: 'This is a test',
    data: { test: true },
    read: false,
    send_at: new Date().toISOString()
  };
  
  const { data: test3, error: error3 } = await supabase
    .from('notifications')
    .insert([testNotif])
    .select()
    .single();
  
  console.log('Insert result:', { data: test3, error: error3 });
  
  // 5. Check RLS policies
  console.log('\n--- Test 4: Check if RLS is blocking ---');
  console.log('If Test 1 returns 0 but Test 2 returns data, RLS is blocking SELECT');
  console.log('If Test 3 fails, RLS is blocking INSERT');
  
  console.log('\n=== NOTIFICATION DEBUG END ===');
  console.log('\n📋 NEXT STEPS:');
  console.log('1. If Test 1 returns 0 but notifications exist → RLS SELECT policy is wrong');
  console.log('2. If Test 2 fails → Table permissions issue');
  console.log('3. If Test 3 fails → RLS INSERT policy is wrong');
  console.log('\n💡 To fix RLS, run this in Supabase SQL Editor:');
  console.log(`
-- Drop all existing policies
DROP POLICY IF EXISTS "notifications_select_policy" ON notifications;
DROP POLICY IF EXISTS "notifications_insert_policy" ON notifications;
DROP POLICY IF EXISTS "notifications_update_policy" ON notifications;
DROP POLICY IF EXISTS "notifications_delete_policy" ON notifications;

-- Create correct policies
CREATE POLICY "notifications_select_policy" ON notifications
FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "notifications_insert_policy" ON notifications
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "notifications_update_policy" ON notifications
FOR UPDATE TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "notifications_delete_policy" ON notifications
FOR DELETE TO authenticated
USING (user_id = auth.uid());
  `);
};

console.log('✅ Debug utility loaded. Run: window.debugNotifications()');
