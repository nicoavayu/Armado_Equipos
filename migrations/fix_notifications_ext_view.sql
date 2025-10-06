-- Fix notifications_ext view without schema qualification
-- This ensures the view works properly with PostgREST

drop view if exists public.notifications_ext;

create view public.notifications_ext as
select
  n.*,
  (n.data->>'matchId')::text  as match_id_text,
  (n.data->>'matchCode')::text as match_code
from public.notifications n;

alter view public.notifications_ext set (security_invoker = on);
grant usage on schema public to anon, authenticated;
grant select on public.notifications_ext to anon, authenticated;

select pg_notify('pgrst','reload schema');