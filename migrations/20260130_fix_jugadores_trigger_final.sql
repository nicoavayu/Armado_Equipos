-- ============================================================================
-- FIX: Postgres Trigger Error - "record new has no field jugadores"
-- Date: 2026-01-30
-- ============================================================================
-- PROBLEMA: La columna partidos.jugadores fue eliminada, pero un trigger
--           todavía intenta acceder a NEW.jugadores
-- SOLUCIÓN: Reemplazar la función para que cuente desde public.jugadores
-- ============================================================================

-- PASO 1: DIAGNÓSTICO - Ejecutar primero para identificar el trigger
-- ============================================================================

-- Listar todos los triggers en public.partidos
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

-- Buscar funciones que usan NEW.jugadores
SELECT 
    proname AS function_name,
    prosrc AS source_code
FROM pg_proc 
WHERE prosrc ILIKE '%NEW.jugadores%'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- ============================================================================
-- PASO 2: FIX - Ejecutar después de identificar el trigger
-- ============================================================================

-- CASO MÁS COMÚN: Función que calcula falta_jugadores
-- IMPORTANTE: partidos.falta_jugadores es BOOLEAN, no número

CREATE OR REPLACE FUNCTION public.calculate_falta_jugadores()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_jugadores_count int;
BEGIN
  -- Contar jugadores desde la tabla jugadores (no desde array)
  SELECT COUNT(*)
  INTO v_jugadores_count
  FROM public.jugadores
  WHERE partido_id = NEW.id;
  
  -- falta_jugadores es BOOLEAN: true si faltan jugadores
  NEW.falta_jugadores := (v_jugadores_count < COALESCE(NEW.cupo_jugadores, 0));
  
  RETURN NEW;
END;
$$;

-- Recrear el trigger (ajustar nombre si es diferente)
DROP TRIGGER IF EXISTS trg_calculate_falta_jugadores ON public.partidos;
CREATE TRIGGER trg_calculate_falta_jugadores
  BEFORE INSERT OR UPDATE ON public.partidos
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_falta_jugadores();

-- ============================================================================
-- ALTERNATIVA: Si el trigger tiene otro nombre
-- ============================================================================
-- Reemplazar 'nombre_real_del_trigger' y 'nombre_real_funcion' con los valores
-- encontrados en el PASO 1

-- DROP TRIGGER IF EXISTS nombre_real_del_trigger ON public.partidos;
-- CREATE TRIGGER nombre_real_del_trigger
--   BEFORE INSERT OR UPDATE ON public.partidos
--   FOR EACH ROW
--   EXECUTE FUNCTION public.calculate_falta_jugadores();

-- ============================================================================
-- PASO 3: VERIFICACIÓN
-- ============================================================================

-- Recargar schema de PostgREST
SELECT pg_notify('pgrst', 'reload schema');

-- Test: Este UPDATE no debería dar error
-- UPDATE public.partidos SET nombre = nombre WHERE id = 1;

-- ============================================================================
-- RESUMEN DE CAMBIOS
-- ============================================================================
-- 
-- ANTES:
--   NEW.falta_jugadores := NEW.cupo_jugadores - array_length(NEW.jugadores, 1)
--   ❌ Error: NEW.jugadores no existe
--
-- DESPUÉS:
--   SELECT COUNT(*) INTO v_count FROM jugadores WHERE partido_id = NEW.id
--   NEW.falta_jugadores := (v_count < NEW.cupo_jugadores)
--   ✅ Cuenta desde tabla jugadores
--   ✅ Retorna BOOLEAN (no número)
--
-- POR QUÉ:
--   - La columna partidos.jugadores fue eliminada
--   - Los jugadores ahora están en tabla separada: public.jugadores
--   - falta_jugadores es BOOLEAN: true = faltan jugadores, false = completo
--
-- ============================================================================
