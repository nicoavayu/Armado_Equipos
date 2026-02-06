
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'partidos';

SELECT definition
FROM pg_views
WHERE viewname = 'partidos_view';
