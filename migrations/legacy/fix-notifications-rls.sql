-- Fix RLS policies for notifications table to allow user invitations

-- Drop existing insert policy that only allows service role
DROP POLICY IF EXISTS "Service role can insert notifications" ON public.notifications;

-- Create new policy that allows authenticated users to insert notifications
-- This allows users to send invitations to their friends
CREATE POLICY "Authenticated users can insert notifications" 
  ON public.notifications 
  FOR INSERT 
  TO authenticated
  WITH CHECK (true);

-- Optional: Add a more restrictive policy if you want to limit who can send notifications
-- CREATE POLICY "Users can send notifications to friends" 
--   ON public.notifications 
--   FOR INSERT 
--   TO authenticated
--   WITH CHECK (
--     -- Check if the sender and recipient are friends
--     EXISTS (
--       SELECT 1 FROM public.amigos 
--       WHERE (usuario_id = auth.uid() AND amigo_id = user_id)
--          OR (usuario_id = user_id AND amigo_id = auth.uid())
--     )
--   );

-- Verify the policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'notifications'
ORDER BY policyname;