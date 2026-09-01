-- Keep the public commercial catalog honest: only shipped Premium benefits are
-- advertised as available. Other entitlement reservations remain future work.
begin;

update public.tournament_commercial_products
set public_capabilities = '[
  {"code":"higher_limits","label":"Hasta 10.000 archivos y 10 colaboradores","availability":"available"},
  {"code":"social_studio.premium","label":"Estilos Premium para resultados","availability":"available"},
  {"code":"statistics.advanced","label":"Estadísticas avanzadas","availability":"coming_soon"},
  {"code":"branding.advanced","label":"Identidad visual avanzada","availability":"coming_soon"},
  {"code":"sponsors","label":"Sponsors","availability":"coming_soon"},
  {"code":"exports.professional","label":"Exportaciones profesionales","availability":"coming_soon"}
]'::jsonb,
updated_at = now()
where product_code = 'torneos_premium';

commit;
