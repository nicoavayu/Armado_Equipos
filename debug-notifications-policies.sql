-- Debug and fix notifications RLS policies

-- 1. Check current policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'notifications'
ORDER BY policyname;

-- 2. Check if RLS is enabled
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'notifications';

-- 3. Drop ALL existing policies to start fresh
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Service role can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notifications;

-- 4. Disable and re-enable RLS to ensure clean state
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 5. Create new comprehensive policies

-- Allow users to read their own notifications
CREATE POLICY "Users can read own notifications" 
  ON public.notifications 
  FOR SELECT 
  TO authenticated
  USING (auth.uid() = user_id);

-- Allow users to update their own notifications (mark as read)
CREATE POLICY "Users can update own notifications" 
  ON public.notifications 
  FOR UPDATE 
  TO authenticated
  USING (auth.uid() = user_id);

-- Allow authenticated users to insert notifications (for invitations)
CREATE POLICY "Users can create notifications" 
  ON public.notifications 
  FOR INSERT 
  TO authenticated
  WITH CHECK (true);

-- 6. Verify the new policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'notifications'
ORDER BY policyname;