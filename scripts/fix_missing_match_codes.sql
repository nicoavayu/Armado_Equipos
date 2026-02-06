-- Fix missing match codes
-- This script assigns a unique code to matches that don't have one

-- Update matches with null codigo
UPDATE partidos
SET codigo = 'M' || id::text
WHERE codigo IS NULL;

-- Verify the update
SELECT id, codigo, nombre, fecha
FROM partidos
WHERE codigo LIKE 'M%'
ORDER BY id DESC
LIMIT 10;
