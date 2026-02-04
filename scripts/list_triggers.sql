-- SCRIPT CORTO PARA LISTAR TRIGGERS
-- Ejecutar en Supabase SQL Editor

SELECT 
    t.tgname AS trigger_name,
    p.proname AS function_name,
    pg_get_triggerdef(t.oid) as trigger_definition
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relname = 'partidos'  -- Solo tabla partidos
AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
