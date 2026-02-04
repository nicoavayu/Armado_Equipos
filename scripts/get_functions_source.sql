-- Obtener código fuente de funciones sospechosas
SELECT 
    proname, 
    prosrc 
FROM pg_proc 
WHERE proname IN ('set_partido_codigo', 'calculate_falta_jugadores');
