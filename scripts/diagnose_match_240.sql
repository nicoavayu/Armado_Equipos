-- ============================================================================
-- DIAGNOSTICO MATCH 240
-- ============================================================================

-- 1. Ver el partido para confirmar que existe
SELECT id, nombre, fecha, hora, cupo_jugadores, creado_por 
FROM public.partidos 
WHERE id = 240;

-- 2. Ver cuántos jugadores reales hay en la base de datos para este partido
SELECT count(*) as total_jugadores_real 
FROM public.jugadores 
WHERE partido_id = 240;

-- 3. Ver quiénes son esos jugadores (si hay)
SELECT id, nombre, usuario_id, partido_id 
FROM public.jugadores 
WHERE partido_id = 240;

-- 4. Ver si hay algún "clean" o "blocked" relation (opcional)
-- (Solo para estar seguros)

-- SI EL SELECT #2 DA "0", ENTONCES EL JUGADOR NO EXISTE (SE BORRÓ O NUNCA SE CREÓ).
-- SI EL SELECT #2 DA "1" PERO EN LA APP VES 0, ES UN TEMA DE VISIBILIDAD (RLS).
