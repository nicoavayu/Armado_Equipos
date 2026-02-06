-- INSPECTION SCRIPT: RLS and Constraints
-- Run this in Supabase SQL Editor

-- 1. Check RLS Policies for critical tables
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename IN ('partidos', 'jugadores', 'match_join_requests')
ORDER BY tablename, cmd;

-- 2. Check Constraints on jugadores (Verify the unique constraint)
SELECT
    conname as constraint_name,
    contype as type,
    pg_get_constraintdef(c.oid) as definition
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
WHERE t.relname = 'jugadores';

-- 3. Check for recursive triggers or weirdness
SELECT
    tgname as trigger_name,
    relname as table_name,
    tgtype,
    proname as function_name
FROM pg_trigger tr
JOIN pg_class cl ON cl.oid = tr.tgrelid
JOIN pg_proc pr ON pr.oid = tr.tgfoid
WHERE relname IN ('partidos', 'jugadores')
  AND tgisinternal = false;
