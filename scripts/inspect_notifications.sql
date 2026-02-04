-- ============================================================================
-- INSPECCION: NOTIFICATIONS (Políticas y Triggers)
-- ============================================================================

-- 1. Listar TODAS las políticas activas sobre 'notifications'
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'notifications';

-- 2. Listar TRIGGERS (a veces un trigger bloquea inserts)
SELECT event_object_table as table_name, trigger_name, event_manipulation as event, action_statement as action
FROM information_schema.triggers
WHERE event_object_table = 'notifications';

-- 3. Ver permisos de GRANTS para el rol 'authenticated' (Opcional pero útil)
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'notifications' AND grantee = 'authenticated';
