-- ============================================================================
-- DIAGNOSE: Usuarios & Amigos Visibility
-- ============================================================================

SELECT tablename, policyname, permissive, roles, cmd, qual, with_check 
FROM pg_policies 
WHERE tablename IN ('usuarios', 'amigos');
