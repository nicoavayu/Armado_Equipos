-- ============================================================================
-- DIAGNOSTICO DE BASE DE DATOS - TABLA PARTIDOS
-- ============================================================================
-- Ejecuta esto en el Editor SQL de Supabase para ver el estado real de la tabla.
-- ============================================================================

-- 1. VERIFICAR SI ES TABLA O VISTA
SELECT 
    n.nspname as schema,
    c.relname as relation,
    CASE c.relkind 
        WHEN 'r' THEN 'table' 
        WHEN 'v' THEN 'view' 
        WHEN 'm' THEN 'materialized_view' 
        ELSE c.relkind::text 
    END as type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname = 'partidos'
AND n.nspname = 'public';

-- 2. LISTAR COLUMNAS (Para ver si sedeMaps existe y qué tipo es)
SELECT 
    column_name, 
    data_type, 
    column_default, 
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'partidos';

-- 3. LISTAR TODOS LOS TRIGGERS ACTIVOS EN PARTIDOS
SELECT 
    t.tgname AS trigger_name,
    p.proname AS function_name,
    pg_get_triggerdef(t.oid) as trigger_definition
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relname = 'partidos'
AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- 4. LISTAR POLÍTICAS RLS (Solo para confirmar)
SELECT 
    policyname,
    cmd as command,
    qual as using_expression,
    with_check as check_expression
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'partidos';
