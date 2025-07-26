-- Script para corregir el modelo de datos de la tabla jugadores
-- Asegurar que partido_id sea UUID y tenga foreign key a partidos.id

-- 1. Verificar estructura actual de la tabla jugadores
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'jugadores' 
AND table_schema = 'public'
ORDER BY ordinal_position;

-- 2. Agregar columna partido_id si no existe
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'jugadores' 
        AND column_name = 'partido_id'
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.jugadores 
        ADD COLUMN partido_id UUID;
        
        RAISE NOTICE 'Added partido_id column as UUID';
    ELSE
        RAISE NOTICE 'partido_id column already exists';
    END IF;
END $$;

-- 3. Convertir partido_id a UUID si no lo es
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'jugadores' 
        AND column_name = 'partido_id'
        AND data_type != 'uuid'
        AND table_schema = 'public'
    ) THEN
        -- Intentar convertir datos existentes
        ALTER TABLE public.jugadores 
        ALTER COLUMN partido_id TYPE UUID USING partido_id::UUID;
        
        RAISE NOTICE 'Converted partido_id to UUID type';
    ELSE
        RAISE NOTICE 'partido_id is already UUID or does not exist';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Could not convert partido_id to UUID: %', SQLERRM;
END $$;

-- 4. Crear foreign key constraint si no existe
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_jugadores_partido' 
        AND table_name = 'jugadores'
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.jugadores 
        ADD CONSTRAINT fk_jugadores_partido 
        FOREIGN KEY (partido_id) REFERENCES public.partidos(id) 
        ON DELETE CASCADE;
        
        RAISE NOTICE 'Added foreign key constraint fk_jugadores_partido';
    ELSE
        RAISE NOTICE 'Foreign key constraint already exists';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Could not create foreign key: %', SQLERRM;
END $$;

-- 5. Crear índice para performance
CREATE INDEX IF NOT EXISTS idx_jugadores_partido_id 
ON public.jugadores(partido_id);

-- 6. Crear índice para usuario_id también
CREATE INDEX IF NOT EXISTS idx_jugadores_usuario_id 
ON public.jugadores(usuario_id);

-- 7. Verificar la estructura final
SELECT 
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name = 'jugadores'
    AND tc.table_schema = 'public';

-- 8. Verificar datos existentes
SELECT 
    COUNT(*) as total_jugadores,
    COUNT(partido_id) as jugadores_con_partido_id,
    COUNT(*) - COUNT(partido_id) as jugadores_sin_partido_id
FROM public.jugadores;

-- 9. Comentarios para documentar
COMMENT ON COLUMN public.jugadores.partido_id 
IS 'Foreign key to partidos.id - the match this player belongs to';

COMMENT ON CONSTRAINT fk_jugadores_partido ON public.jugadores 
IS 'Foreign key relationship between jugadores.partido_id and partidos.id';

-- 10. Mostrar estructura final de la tabla
\d public.jugadores;