-- ============================================================================
-- VERIFICACION DE POLITICAS (SOLO POLITICAS)
-- ============================================================================

SELECT
    pol.policyname,
    pol.permissive, -- 'PERMISSIVE' o 'RESTRICTIVE'
    pol.roles,
    pol.cmd, -- 'INSERT', 'SELECT', 'ALL', etc.
    pol.qual, -- Expression for USING
    pol.with_check -- Expression for WITH CHECK
FROM pg_policies pol
WHERE pol.tablename = 'notifications';
