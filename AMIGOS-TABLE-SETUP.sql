-- Create the amigos table
CREATE TABLE IF NOT EXISTS public.amigos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    friend_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    CONSTRAINT unique_friendship UNIQUE (user_id, friend_id)
);

-- Add comment to the table
COMMENT ON TABLE public.amigos IS 'Stores friendship relationships between users';

-- Add RLS policies
ALTER TABLE public.amigos ENABLE ROW LEVEL SECURITY;

-- Policy to allow users to view their own friendships
CREATE POLICY "Users can view their own friendships" ON public.amigos
    FOR SELECT
    USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Policy to allow users to create friend requests
CREATE POLICY "Users can create friend requests" ON public.amigos
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy to allow users to update friendships they are part of
CREATE POLICY "Users can update friendships they are part of" ON public.amigos
    FOR UPDATE
    USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Policy to allow users to delete friendships they are part of
CREATE POLICY "Users can delete friendships they are part of" ON public.amigos
    FOR DELETE
    USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_amigos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_amigos_updated_at
BEFORE UPDATE ON public.amigos
FOR EACH ROW
EXECUTE FUNCTION update_amigos_updated_at();

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_amigos_user_id ON public.amigos(user_id);
CREATE INDEX IF NOT EXISTS idx_amigos_friend_id ON public.amigos(friend_id);
CREATE INDEX IF NOT EXISTS idx_amigos_status ON public.amigos(status);