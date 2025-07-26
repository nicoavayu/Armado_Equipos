-- Agregar foreign key desde jugadores.partido_id a partidos.id
-- Esto permite que Supabase reconozca la relación para los joins

-- Primero verificar que ambas columnas sean UUID
-- Si partido_id no es UUID, convertirla
DO $$ 
BEGIN
    -- Verificar si la columna partido_id existe y su tipo
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'jugadores' 
        AND column_name = 'partido_id'
        AND data_type != 'uuid'
    ) THEN
        -- Si existe pero no es UUID, convertirla
        ALTER TABLE public.jugadores 
        ALTER COLUMN partido_id TYPE UUID USING partido_id::UUID;
        
        RAISE NOTICE 'Converted partido_id to UUID type';
    END IF;
    
    -- Si la columna no existe, crearla
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'jugadores' 
        AND column_name = 'partido_id'
    ) THEN
        ALTER TABLE public.jugadores 
        ADD COLUMN partido_id UUID;
        
        RAISE NOTICE 'Added partido_id column as UUID';
    END IF;
END $$;

-- Agregar la foreign key constraint si no existe
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_jugadores_partido' 
        AND table_name = 'jugadores'
    ) THEN
        ALTER TABLE public.jugadores 
        ADD CONSTRAINT fk_jugadores_partido 
        FOREIGN KEY (partido_id) REFERENCES public.partidos(id) 
        ON DELETE CASCADE;
        
        RAISE NOTICE 'Added foreign key constraint fk_jugadores_partido';
    ELSE
        RAISE NOTICE 'Foreign key constraint already exists';
    END IF;
END $$;

-- Crear índice para mejorar performance de los joins
CREATE INDEX IF NOT EXISTS idx_jugadores_partido_id 
ON public.jugadores(partido_id);

-- Verificar la relación
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
    AND kcu.column_name = 'partido_id';

-- Comentarios para documentar la relación
COMMENT ON CONSTRAINT fk_jugadores_partido ON public.jugadores 
IS 'Foreign key relationship between jugadores.partido_id and partidos.id';

COMMENT ON COLUMN public.jugadores.partido_id 
IS 'References partidos.id - the match this player belongs to';