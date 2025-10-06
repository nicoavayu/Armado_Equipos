-- Recrear vista + permisos + reload (todo junto)

DROP VIEW IF EXISTS public.notifications_ext;

CREATE VIEW public.notifications_ext AS
SELECT
  n.*, 
  (n.data->>'matchId')::text  AS match_id_text,
  (n.data->>'matchCode')::text AS match_code
FROM public.notifications n;

ALTER VIEW public.notifications_ext SET (security_invoker = on);

GRANT SELECT ON public.notifications_ext TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');

-- Sanity check (debe devolver 0+ filas, sin error)
-- SELECT id, match_id_text FROM public.notifications_ext LIMIT 1;
