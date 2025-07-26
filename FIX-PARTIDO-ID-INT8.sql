-- Script para corregir tipos de datos entre partidos.id (int8) y jugadores.partido_id (uuid)
-- Cambiar jugadores.partido_id de UUID a int8 para que coincida con partidos.id

-- 1. Verificar tipos actuales
SELECT 
    'partidos' as tabla,
    'id' as columna,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'partidos' AND column_name = 'id' AND table_schema = 'public'

UNION ALL

SELECT 
    'jugadores' as tabla,
    'partido_id' as columna,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'jugadores' AND column_name = 'partido_id' AND table_schema = 'public';

-- 2. Eliminar foreign key constraint existente si existe
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_jugadores_partido' 
        AND table_name = 'jugadores'
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.jugadores 
        DROP CONSTRAINT fk_jugadores_partido;
        
        RAISE NOTICE 'Dropped existing foreign key constraint';
    ELSE
        RAISE NOTICE 'No existing foreign key constraint found';
    END IF;
END $$;

-- 3. Cambiar tipo de jugadores.partido_id de UUID a int8
DO $$ 
BEGIN
    -- Verificar si la columna existe y es UUID
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'jugadores' 
        AND column_name = 'partido_id'
        AND data_type = 'uuid'
        AND table_schema = 'public'
    ) THEN
        -- Cambiar tipo a int8 (bigint)
        ALTER TABLE public.jugadores 
        ALTER COLUMN partido_id TYPE int8 USING NULL;
        
        RAISE NOTICE 'Changed partido_id from UUID to int8';
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'jugadores' 
        AND column_name = 'partido_id'
        AND table_schema = 'public'
    ) THEN
        RAISE NOTICE 'partido_id column exists but is not UUID type';
    ELSE
        -- Crear columna si no existe
        ALTER TABLE public.jugadores 
        ADD COLUMN partido_id int8;
        
        RAISE NOTICE 'Created partido_id column as int8';
    END IF;
END $$;

-- 4. Crear nueva foreign key constraint con tipos correctos
DO $$ 
BEGIN
    ALTER TABLE public.jugadores 
    ADD CONSTRAINT fk_jugadores_partido 
    FOREIGN KEY (partido_id) REFERENCES public.partidos(id) 
    ON DELETE CASCADE;
    
    RAISE NOTICE 'Created new foreign key constraint with correct types';
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Could not create foreign key: %', SQLERRM;
END $$;

-- 5. Recrear índices
DROP INDEX IF EXISTS idx_jugadores_partido_id;
CREATE INDEX idx_jugadores_partido_id ON public.jugadores(partido_id);

-- 6. Verificar estructura final
SELECT 
    'partidos' as tabla,
    'id' as columna,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'partidos' AND column_name = 'id' AND table_schema = 'public'

UNION ALL

SELECT 
    'jugadores' as tabla,
    'partido_id' as columna,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'jugadores' AND column_name = 'partido_id' AND table_schema = 'public';

-- 7. Verificar foreign key
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
    AND kcu.column_name = 'partido_id'
    AND tc.table_schema = 'public';

-- 8. Comentarios
COMMENT ON COLUMN public.jugadores.partido_id 
IS 'Foreign key to partidos.id (int8) - the match this player belongs to';

-- 9. Test insert (comentado para seguridad)
-- INSERT INTO jugadores (partido_id, usuario_id, nombre) 
-- VALUES (1, 'test-user-uuid', 'Test Player');

RAISE NOTICE 'Migration completed. jugadores.partido_id is now int8 to match partidos.id';