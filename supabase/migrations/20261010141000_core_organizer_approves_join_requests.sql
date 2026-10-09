-- Core: organizers can approve join requests again.
--
-- The organizer approves through the approve-join-request edge function, which calls
-- public.approve_join_request with the organizer's own token. The canonical grants
-- (20260727215106: execute on public functions only for an explicit allowlist) left it out,
-- so every approval answered "forbidden". After 20261010140000 an approved request is the
-- normal way for an account outside a match to get in, so it must work.
--
-- approve_join_request authorizes by itself (SECURITY DEFINER):
--   * a signed-in caller (auth.uid()), and only the match creator, may approve;
--   * the request and the match rows are locked (FOR UPDATE), so concurrent approvals can
--     never exceed cupo starters + 4 substitutes;
--   * only pending (or already approved, idempotent) requests.
-- So the caller only needs EXECUTE: no edge-function change, and the service role is not
-- involved (it would skip the creator check). anon stays without it.

-- (Core Production already grants it to authenticated and anon: then only anon is closed.)
select app_private.alignment_save_function_acl('public.approve_join_request(bigint)'::regprocedure);
revoke all on function public.approve_join_request(bigint) from public, anon;
grant execute on function public.approve_join_request(bigint) to authenticated, service_role;

do $$
begin
  if not has_function_privilege('authenticated', 'public.approve_join_request(bigint)', 'execute')
     or has_function_privilege('anon', 'public.approve_join_request(bigint)', 'execute') then
    raise exception 'approve_join_request must be executable by authenticated only (and the service role)';
  end if;
  if not (select prosecdef and prosrc ~ 'auth\.uid\(\)' and prosrc ~ 'FOR UPDATE OF r, p' and prosrc ~ 'Forbidden'
          from pg_proc where oid = 'public.approve_join_request(bigint)'::regprocedure) then
    raise exception 'approve_join_request must keep its own creator check and row locks';
  end if;
end;
$$;
