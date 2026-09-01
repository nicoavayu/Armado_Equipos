BEGIN;

REVOKE ALL ON public.partidos_abiertos_operativos FROM PUBLIC;
GRANT SELECT ON public.partidos_abiertos_operativos TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_open_matches_for_quiero_jugar(double precision, double precision, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_open_matches_for_quiero_jugar(double precision, double precision, integer) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.debug_quiero_jugar_match_audit(double precision, double precision, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debug_quiero_jugar_match_audit(double precision, double precision, integer) TO anon, authenticated;

WITH resolved(id, lat, lng) AS (
  VALUES
    (343, -34.6022363, -58.5200069),
    (345, -34.6129612, -58.3695223),
    (346, -34.6724717, -58.7364264),
    (347, -34.6984264, -58.3145920),
    (348, -34.6022363, -58.5200069),
    (349, -34.6022363, -58.5200069),
    (350, -34.6022363, -58.5200069),
    (353, -36.3560513, -56.7194301),
    (355, -37.3282887, -59.1356957),
    (356, -36.3153624, -57.6755399),
    (361, -35.4324152, -60.1716240),
    (362, -34.6724717, -58.7364264),
    (364, -34.6022363, -58.5200069),
    (381, -34.6022363, -58.5200069),
    (386, -32.9907548, -58.5282737),
    (387, -34.9206797, -57.9537638),
    (391, -34.7036939, -58.5862360),
    (393, -36.3560513, -56.7194301),
    (394, -34.6022363, -58.5200069),
    (396, -36.3153624, -57.6755399),
    (397, -34.6290748, -58.4634771),
    (398, -34.6724717, -58.7364264),
    (399, -34.6984264, -58.3145920),
    (400, -34.4534551, -58.7965583),
    (402, -34.5905550, -58.4359296),
    (404, -35.4324152, -60.1716240),
    (405, -27.5896182, -56.6893413),
    (406, -34.5934412, -60.9461678),
    (418, -35.4324152, -60.1716240),
    (419, -34.6022363, -58.5200069),
    (425, -37.1099492, -56.8539007),
    (426, -43.2665491, -65.2974588),
    (427, -34.9780760, -67.6985070)
)
UPDATE public.partidos p
SET
  sede_latitud = resolved.lat,
  sede_longitud = resolved.lng
FROM resolved
WHERE p.id = resolved.id
  AND (p.sede_latitud IS NULL OR p.sede_longitud IS NULL);

COMMIT;
