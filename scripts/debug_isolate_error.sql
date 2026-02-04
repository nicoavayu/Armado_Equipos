-- ============================================================================
-- DEBUG AGRESIVO: AISLAR EL ERROR 500
-- ============================================================================
-- Este script hace dos cosas:
-- 1. Nos muestra las columnas REALES de la tabla (para ver si hay errores de tipo).
-- 2. ELIMINA TEMPORALMENTE todos los triggers custom para ver si el insert funciona "limpio".
-- ============================================================================

-- PASO 1: VER COLUMNAS (Mirar output "Data Output")
SELECT 
    column_name, 
    data_type, 
    udt_name 
FROM information_schema.columns 
WHERE table_name = 'partidos' 
ORDER BY ordinal_position;

-- PASO 2: DESACTIVAR TRIGGERS (Para probar si el INSERT base funciona)
DROP TRIGGER IF EXISTS trg_set_partido_codigo ON public.partidos;
DROP TRIGGER IF EXISTS trg_calculate_falta_jugadores ON public.partidos;
DROP TRIGGER IF EXISTS trg_add_creator_as_player ON public.partidos;

-- (No te preocupes, si esto funciona, los volvemos a crear corregidos después)
