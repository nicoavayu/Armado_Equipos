-- STEP 1: Find all triggers on partidos table
-- Copy and run this in Supabase SQL Editor

SELECT 
    t.tgname AS trigger_name,
    p.proname AS function_name,
    p.prosrc AS function_source
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relname = 'partidos'
  AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY t.tgname;

-- STEP 2: Find any function that references jugadores in NEW context
-- This will show the exact function causing the error

SELECT 
    proname AS function_name,
    prosrc AS source_code
FROM pg_proc 
WHERE prosrc ILIKE '%NEW.jugadores%'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
