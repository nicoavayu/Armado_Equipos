-- ============================================================================
-- DIAGNÓSTICO DE POLÍTICAS (RLS) en 'jugadores'
-- ============================================================================
-- El error "infinite recursion" (42P17) significa que una política se llama a sí misma en bucle.
-- Necesitamos ver las definiciones exactas para romper ese ciclo.
-- ============================================================================

SELECT 
    policyname,
    cmd AS command,
    permissive,
    roles,
    qual AS using_expression,
    with_check AS check_expression
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'jugadores'
ORDER BY policyname;
