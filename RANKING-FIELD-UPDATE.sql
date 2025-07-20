-- SQL script to update calificacion to ranking in all tables

-- Check if ranking column exists in usuarios table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'usuarios' 
        AND column_name = 'ranking'
    ) THEN
        -- Add ranking column to usuarios table
        ALTER TABLE public.usuarios ADD COLUMN ranking NUMERIC;
        
        -- Copy data from calificacion to ranking
        UPDATE public.usuarios SET ranking = calificacion;
    END IF;
END
$$;

-- Check if ranking column exists in jugadores table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'jugadores' 
        AND column_name = 'ranking'
    ) THEN
        -- Add ranking column to jugadores table
        ALTER TABLE public.jugadores ADD COLUMN ranking NUMERIC;
        
        -- Copy data from calificacion to ranking
        UPDATE public.jugadores SET ranking = calificacion;
    END IF;
END
$$;

-- Update any views that reference calificacion
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
    u1.posicion AS user_posicion,
    u1.ranking AS user_ranking,
    u2.nombre AS friend_nombre,
    u2.avatar_url AS friend_avatar_url,
    u2.posicion AS friend_posicion,
    u2.ranking AS friend_ranking
FROM 
    public.amigos a
JOIN 
    public.usuarios u1 ON a.user_id = u1.id
JOIN 
    public.usuarios u2 ON a.friend_id = u2.id;

-- Grant permissions on the view
GRANT SELECT ON public.amigos_with_profiles TO authenticated;
GRANT SELECT ON public.amigos_with_profiles TO anon;