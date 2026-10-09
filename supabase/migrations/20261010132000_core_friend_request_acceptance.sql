-- Core: only the recipient accepts a friend request.
--
-- amigos_insert_sender let the sender insert a row with any status, and
-- amigos_update_recipient_or_sender let either side change it: a sender could create or
-- turn a request into 'accepted' on their own (a friendship the other person never
-- accepted). The app always inserts 'pending'; the recipient accepts or rejects; either
-- side deletes (cancel, unfriend, or clear a rejection before asking again).
-- Rules enforced for API writes (anon/authenticated; backend functions are unaffected):
--   * insert: only as the sender (existing policy), only 'pending', never to oneself;
--   * update: user_id/friend_id never change; status only moves pending → accepted or
--     pending → rejected, and only by the recipient (friend_id = auth.uid());
--   * delete: unchanged (either side).

create or replace function app_private.tg_amigos_request_rules()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.status, 'pending') <> 'pending' then
      raise exception 'amigos: a request starts as pending; only its recipient can accept it'
        using errcode = '42501';
    end if;
    new.status := 'pending';
    return new;
  end if;

  if new.user_id is distinct from old.user_id or new.friend_id is distinct from old.friend_id then
    raise exception 'amigos: user_id and friend_id cannot change' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if v_uid is null or v_uid is distinct from old.friend_id then
      raise exception 'amigos: only the recipient can answer a friend request' using errcode = '42501';
    end if;
    if old.status <> 'pending' or new.status not in ('accepted', 'rejected') then
      raise exception 'amigos: a request can only go from pending to accepted or rejected'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_amigos_request_rules on public.amigos;
create trigger trg_amigos_request_rules
before insert or update on public.amigos
for each row execute function app_private.tg_amigos_request_rules();

-- The policies say the same thing (defense in depth, and readable in the dashboard).
drop policy if exists amigos_insert_sender on public.amigos;
create policy amigos_insert_sender
on public.amigos for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and friend_id <> (select auth.uid())
  and status = 'pending'
);
