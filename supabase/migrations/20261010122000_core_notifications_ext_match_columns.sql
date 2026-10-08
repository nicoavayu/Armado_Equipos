-- Core: notifications_ext exposes the match columns the app filters by.
--
-- The web/native app reads match invitations, kicks and invite caches through
-- `notifications_ext` filtered by `match_id_text` (PartidoInvitacion,
-- InviteAmigosModal, ChatButton, useAdminPanelState, notificationService,
-- privateFriendGroups). Production's view was created by hand with
-- `match_id_text` and `match_code` (docs/FIX_404_NOTIFICATIONS_EXT.md,
-- docs/DEPLOY_NOTIFICATIONS_EXT.md), but the repository schema never got them:
-- on any database built from supabase/migrations (Staging, labs, CI, disaster
-- recovery) those requests fail with 42703 and a registered player who opens
-- an in-app match invitation sees "Invitación inválida".
--
-- The columns are appended (CREATE OR REPLACE VIEW keeps existing columns,
-- grants and security_invoker) and only when missing, so a database that
-- already has them — Production — is left untouched.
do $notifications_ext_match_columns$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notifications_ext' and column_name = 'match_id_text'
  ) then
    create or replace view public.notifications_ext with (security_invoker = on) as
    select
      n.id,
      n.user_id,
      n.partido_id,
      n.type,
      n.title,
      n.message,
      n.data,
      n.status,
      n.read,
      n.read_at,
      n.send_at,
      n.created_at,
      n.updated_at,
      p.nombre as partido_nombre,
      p.fecha as partido_fecha,
      p.hora as partido_hora,
      p.sede as partido_sede,
      (n.data ->> 'matchId')::text as match_id_text,
      (n.data ->> 'matchCode')::text as match_code
    from public.notifications n
    left join public.partidos p on p.id = n.partido_id;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notifications_ext' and column_name = 'match_id_text'
  ) then
    raise exception 'notifications_ext.match_id_text is still missing';
  end if;
  if coalesce((select 'security_invoker=on' = any(reloptions) or 'security_invoker=true' = any(reloptions)
               from pg_class where oid = 'public.notifications_ext'::regclass), false) is false then
    raise exception 'notifications_ext must stay security_invoker';
  end if;
end
$notifications_ext_match_columns$;

notify pgrst, 'reload schema';
