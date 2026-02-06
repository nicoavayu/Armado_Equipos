-- Inspect RLS policies for jugadores table
SELECT
    polname,
    polcmd,
    polroles,
    pg_get_expr(polqual, polrelid) as policy_qual,
    pg_get_expr(polwithcheck, polrelid) as policy_check
FROM
    pg_policy
WHERE
    polrelid = 'public.jugadores'::regclass;
