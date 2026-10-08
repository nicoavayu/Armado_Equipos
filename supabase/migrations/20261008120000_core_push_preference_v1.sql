-- Core — the account's push preference as an explicit contract, enforced where every push passes.
--
-- Reuses the existing preference (public.usuarios.push_enabled, default true), which only the main notification
-- trigger (enqueue_remote_push_from_notification) honoured: the targeted dispatch flows (push-dispatch-now: join
-- requests, team invitations, call to vote, challenges, surveys, removals) insert their push rows straight into
-- public.notification_delivery_log and nothing there looked at it, and no screen could change it.
--
--   * get_my_push_preference() / set_my_push_preference(boolean): the signed-in account reads and changes ITS own
--     preference (auth.uid(); nothing else is reachable). Turning it off also skips the account's push rows still
--     waiting in the queue, so nothing already queued is sent afterwards.
--   * a BEFORE INSERT trigger on notification_delivery_log turns every new queued push row of an account with the
--     preference off into `skipped / push_disabled`, whoever enqueues it (today's flows and any future one). The
--     sender only claims queued / retryable rows, so a skipped row is never delivered.
--
-- Push only: in-app notifications (Core's own inbox, channel in_app) and Torneos' internal inbox are untouched, and
-- device tokens stay registered (turning it back on needs no new permission). Nothing here sends anything.
BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.usuarios') IS NULL OR to_regclass('public.notification_delivery_log') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'usuarios' AND column_name = 'push_enabled'
    ) THEN
    RAISE EXCEPTION 'CORE_PUSH_PREFERENCE_PRECONDITION_FAILED: usuarios.push_enabled / notification_delivery_log';
  END IF;
END $pre$;

create or replace function public.get_my_push_preference()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_enabled boolean;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select coalesce(u.push_enabled, true) into v_enabled from public.usuarios u where u.id = v_uid;
  return jsonb_build_object('pushEnabled', coalesce(v_enabled, true));
end;
$$;

create or replace function public.set_my_push_preference(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_skipped integer := 0;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_enabled is null then
    raise exception using errcode = '22023', message = 'PUSH_PREFERENCE_REQUIRED';
  end if;
  update public.usuarios set push_enabled = p_enabled where id = v_uid;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_NOT_FOUND';
  end if;
  if not p_enabled then
    update public.notification_delivery_log
    set status = 'skipped', error_text = 'push_disabled', error_code = 'push_disabled'
    where user_id = v_uid and channel = 'push' and status in ('queued', 'retryable_failed');
    get diagnostics v_skipped = row_count;
  end if;
  return jsonb_build_object('pushEnabled', p_enabled, 'pendingSkipped', v_skipped);
end;
$$;

-- The single choke point: every push row enters the queue through this table.
create or replace function public.notification_delivery_respect_push_preference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel = 'push' and new.status = 'queued' and new.user_id is not null
    and exists (select 1 from public.usuarios u where u.id = new.user_id and u.push_enabled = false) then
    new.status := 'skipped';
    new.error_text := 'push_disabled';
    new.error_code := 'push_disabled';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notification_delivery_push_preference on public.notification_delivery_log;
create trigger trg_notification_delivery_push_preference
before insert on public.notification_delivery_log
for each row execute function public.notification_delivery_respect_push_preference();

revoke all on function public.get_my_push_preference() from public, anon;
revoke all on function public.set_my_push_preference(boolean) from public, anon;
revoke all on function public.notification_delivery_respect_push_preference() from public, anon, authenticated;
grant execute on function public.get_my_push_preference() to authenticated, service_role;
grant execute on function public.set_my_push_preference(boolean) to authenticated, service_role;

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notification_delivery_push_preference' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'CORE_PUSH_PREFERENCE_POSTCONDITION_FAILED: trigger';
  END IF;
  IF has_function_privilege('anon', 'public.set_my_push_preference(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'CORE_PUSH_PREFERENCE_POSTCONDITION_FAILED: anon';
  END IF;
END $post$;

COMMIT;
