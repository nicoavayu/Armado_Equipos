-- Add UNIQUE constraint to prevent duplicate friend relationships
-- This constraint ensures that there can only be one relationship between any two users

-- First, remove any duplicate relationships (keeping the most recent one)
WITH duplicates AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY 
        LEAST(user_id, friend_id), 
        GREATEST(user_id, friend_id) 
      ORDER BY updated_at DESC
    ) as rn
  FROM public.amigos
)
DELETE FROM public.amigos 
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Add the UNIQUE constraint if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'unique_friendship' 
    AND table_name = 'amigos'
  ) THEN
    ALTER TABLE public.amigos 
    ADD CONSTRAINT unique_friendship UNIQUE (user_id, friend_id);
  END IF;
END $$;

-- Also add a constraint to prevent self-friendship
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'no_self_friendship' 
    AND table_name = 'amigos'
  ) THEN
    ALTER TABLE public.amigos 
    ADD CONSTRAINT no_self_friendship CHECK (user_id != friend_id);
  END IF;
END $$;

-- Add comment about the constraints
COMMENT ON CONSTRAINT unique_friendship ON public.amigos IS 'Ensures only one relationship record between any two users';
COMMENT ON CONSTRAINT no_self_friendship ON public.amigos IS 'Prevents users from sending friend requests to themselves';