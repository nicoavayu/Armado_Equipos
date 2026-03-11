-- Backfill: link historical "Futbol martes" matches to their frequent template.
-- Safe scope:
-- - only rows with template_id IS NULL
-- - only rows that match the template's exact name/time/sede/owner
-- - only for the specific template id confirmed in production

WITH target_template AS (
  SELECT
    id,
    nombre,
    hora,
    sede,
    creado_por
  FROM public.partidos_frecuentes
  WHERE id = '75a07ed5-76de-4f76-b73b-18cf02607bc8'
),
candidates AS (
  SELECT p.id
  FROM public.partidos p
  JOIN target_template t ON TRUE
  WHERE p.template_id IS NULL
    AND p.nombre = t.nombre
    AND p.hora = t.hora
    AND COALESCE(p.sede, '') = COALESCE(t.sede, '')
    AND p.creado_por = t.creado_por
)
UPDATE public.partidos p
SET template_id = t.id
FROM target_template t
WHERE p.id IN (SELECT id FROM candidates);
