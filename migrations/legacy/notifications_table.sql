-- Create notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS notifications_type_idx ON public.notifications(type);
CREATE INDEX IF NOT EXISTS notifications_read_idx ON public.notifications(read);
CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON public.notifications(created_at);

-- Add RLS policies
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Policy to allow users to view only their own notifications
CREATE POLICY "Users can view their own notifications" 
  ON public.notifications 
  FOR SELECT 
  USING (auth.uid() = user_id);

-- Policy to allow users to update only their own notifications
CREATE POLICY "Users can update their own notifications" 
  ON public.notifications 
  FOR UPDATE 
  USING (auth.uid() = user_id);

-- Policy to allow service role to insert notifications for any user
CREATE POLICY "Service role can insert notifications" 
  ON public.notifications 
  FOR INSERT 
  WITH CHECK (true);

-- Enable realtime subscriptions for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Comment on table and columns
COMMENT ON TABLE public.notifications IS 'Stores user notifications for various events';
COMMENT ON COLUMN public.notifications.id IS 'Unique identifier for the notification';
COMMENT ON COLUMN public.notifications.user_id IS 'User ID who should receive this notification';
COMMENT ON COLUMN public.notifications.type IS 'Type of notification (e.g., friend_request, match_invite)';
COMMENT ON COLUMN public.notifications.title IS 'Short title for the notification';
COMMENT ON COLUMN public.notifications.message IS 'Detailed message for the notification';
COMMENT ON COLUMN public.notifications.data IS 'Additional JSON data related to the notification';
COMMENT ON COLUMN public.notifications.read IS 'Whether the notification has been read';
COMMENT ON COLUMN public.notifications.created_at IS 'When the notification was created';
COMMENT ON COLUMN public.notifications.updated_at IS 'When the notification was last updated';