-- SQL script to ensure proper UUID handling in the amigos table

-- First, check if the amigos table exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'amigos') THEN
        -- Create the amigos table with proper UUID types
        CREATE TABLE public.amigos (
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
    ELSE
        -- Table exists, check column types and fix if needed
        
        -- Check if user_id is UUID
        IF EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'amigos' 
            AND column_name = 'user_id' 
            AND data_type != 'uuid'
        ) THEN
            -- Alter user_id to UUID
            ALTER TABLE public.amigos 
            ALTER COLUMN user_id TYPE UUID USING user_id::uuid;
        END IF;
        
        -- Check if friend_id is UUID
        IF EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'amigos' 
            AND column_name = 'friend_id' 
            AND data_type != 'uuid'
        ) THEN
            -- Alter friend_id to UUID
            ALTER TABLE public.amigos 
            ALTER COLUMN friend_id TYPE UUID USING friend_id::uuid;
        END IF;
        
        -- Check if id is UUID
        IF EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'amigos' 
            AND column_name = 'id' 
            AND data_type != 'uuid'
        ) THEN
            -- Alter id to UUID
            ALTER TABLE public.amigos 
            ALTER COLUMN id TYPE UUID USING id::uuid;
        END IF;
        
        -- Ensure foreign key constraints are correct
        DO $$
        BEGIN
            -- Check if user_id foreign key exists
            IF NOT EXISTS (
                SELECT 1 
                FROM information_schema.table_constraints tc
                JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
                WHERE tc.constraint_type = 'FOREIGN KEY' 
                AND tc.table_schema = 'public' 
                AND tc.table_name = 'amigos' 
                AND ccu.column_name = 'user_id'
                AND ccu.table_name = 'users'
            ) THEN
                -- Add foreign key constraint for user_id
                ALTER TABLE public.amigos
                ADD CONSTRAINT amigos_user_id_fkey
                FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
            END IF;
            
            -- Check if friend_id foreign key exists
            IF NOT EXISTS (
                SELECT 1 
                FROM information_schema.table_constraints tc
                JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
                WHERE tc.constraint_type = 'FOREIGN KEY' 
                AND tc.table_schema = 'public' 
                AND tc.table_name = 'amigos' 
                AND ccu.column_name = 'friend_id'
                AND ccu.table_name = 'users'
            ) THEN
                -- Add foreign key constraint for friend_id
                ALTER TABLE public.amigos
                ADD CONSTRAINT amigos_friend_id_fkey
                FOREIGN KEY (friend_id) REFERENCES auth.users(id) ON DELETE CASCADE;
            END IF;
        EXCEPTION
            WHEN others THEN
                RAISE NOTICE 'Error adding foreign key constraints: %', SQLERRM;
        END;
        $$;
    END IF;
END;
$$;

-- Create a view to join amigos with usuarios for easier querying
CREATE OR REPLACE VIEW public.amigos_with_profiles AS
SELECT 
    a.id,
    a.user_id,
    a.friend_id,
    a.status,
    a.created_at,
    a.updated_at,
    u1.nombre AS user_nombre,
    u1.avatar_url AS user_avatar_url,
    u2.nombre AS friend_nombre,
    u2.avatar_url AS friend_avatar_url
FROM 
    public.amigos a
JOIN 
    public.usuarios u1 ON a.user_id = u1.id
JOIN 
    public.usuarios u2 ON a.friend_id = u2.id;

-- Grant permissions on the view
GRANT SELECT ON public.amigos_with_profiles TO authenticated;
GRANT SELECT ON public.amigos_with_profiles TO anon;

-- Add RLS policy to the view
CREATE POLICY "Users can view their own friendship profiles" ON public.amigos_with_profiles
    FOR SELECT
    USING (auth.uid() = user_id OR auth.uid() = friend_id);