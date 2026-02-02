-- Migration: Fix Trigger Referencing Deleted jugadores Column
-- Date: 2026-01-30
-- Issue: record "new" has no field "jugadores" error on UPDATE to partidos table

-- STEP 1: Diagnose - Find all triggers on partidos table
-- Run this first to identify the problematic trigger
SELECT 
    tgname AS trigger_name,
    proname AS function_name,
    prosrc AS function_source
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relname = 'partidos'
  AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- STEP 2: View function source for any function that might use jugadores
-- Replace 'function_name_here' with the function name from STEP 1
-- SELECT prosrc FROM pg_proc WHERE proname = 'function_name_here';

-- STEP 3: Common culprits - Check if these functions exist and reference jugadores
-- These are typical functions that might calculate player-related fields

-- Check for falta_jugadores calculation function
SELECT proname, prosrc 
FROM pg_proc 
WHERE prosrc LIKE '%jugadores%' 
  AND prosrc LIKE '%NEW%'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- STEP 4: Fix - Replace any function that uses NEW.jugadores
-- Example: If there's a function that calculates falta_jugadores from jugadores array

-- Option A: If the function calculates falta_jugadores
CREATE OR REPLACE FUNCTION public.calculate_falta_jugadores()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_jugadores_count int;
BEGIN
  -- Count actual players from jugadores table instead of using NEW.jugadores array
  SELECT COUNT(*)
  INTO v_jugadores_count
  FROM public.jugadores
  WHERE partido_id = NEW.id;
  
  -- Calculate how many players are missing
  NEW.falta_jugadores := GREATEST(0, NEW.cupo_jugadores - v_jugadores_count);
  
  RETURN NEW;
END;
$$;

-- Drop and recreate trigger if it exists
DROP TRIGGER IF EXISTS trg_calculate_falta_jugadores ON public.partidos;
CREATE TRIGGER trg_calculate_falta_jugadores
  BEFORE INSERT OR UPDATE ON public.partidos
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_falta_jugadores();

-- Option B: If the function is just updating updated_at (already exists, should be fine)
-- This is already in add_updated_at_trigger.sql and doesn't use jugadores

-- Option C: If there's a function that syncs jugadores count
CREATE OR REPLACE FUNCTION public.sync_partido_jugadores_count()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_jugadores_count int;
BEGIN
  -- Only calculate on INSERT/UPDATE, not when jugadores column is being set
  -- Count from jugadores table
  SELECT COUNT(*)
  INTO v_jugadores_count
  FROM public.jugadores
  WHERE partido_id = NEW.id;
  
  -- Store count if there's a column for it (optional)
  -- NEW.jugadores_count := v_jugadores_count;
  
  RETURN NEW;
END;
$$;

-- STEP 5: Verify - After applying fix, test with an UPDATE
-- UPDATE public.partidos SET nombre = nombre WHERE id = <some_id>;
-- Should not throw "record new has no field jugadores" error

-- STEP 6: Reload schema
SELECT pg_notify('pgrst', 'reload schema');

-- NOTES:
-- 1. The error occurs because a trigger function is trying to access NEW.jugadores
--    but that column was deleted from the partidos table
-- 2. The fix is to replace array access with a COUNT query to the jugadores table
-- 3. If falta_jugadores needs to be calculated, it should be done from the count
-- 4. Make sure to identify the exact trigger name from STEP 1 before applying fixes
