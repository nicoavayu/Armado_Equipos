-- Core: a guest's voting photo is changed only by whoever is voting as that guest.
--
-- Link voting identifies a guest by name, with the match code and nothing else (no login,
-- no extra code — a product decision kept here). Before voting, the guest may upload their
-- photo: issue-voting-photo-token checks the code, the open voting window and a guest slot,
-- then bind_voting_photo_slot binds the browser's guest session to that slot. The binding
-- was only "one slot per session", so any holder of the code, opening a fresh session per
-- slot, could replace the photo of every guest of the match, again and again, including
-- guests who had already voted with their own photo.
--
-- Same trust model as the vote itself (the first one to take a name is that guest):
--   * a slot belongs to the first session that claims it; any other session is refused
--     (the function returns NULL and the edge function answers 409, as it already does for
--     a session bound to another slot), so nobody overwrites a photo uploaded by the guest;
--   * a guest who already finished voting cannot be claimed by a new session;
--   * only slots a guest can vote as (guest starters, the "¿Quién sos?" list) are claimable.
-- The session that owns a slot keeps uploading as before. No client or edge-function change:
-- the edge function already treats any result other than the requested player as refusal.
-- Existing claims are kept (the earliest claim of a slot owns it); nothing is deleted.

create or replace function public.bind_voting_photo_slot(
  p_match_id bigint,
  p_guest_session_id text,
  p_player_id bigint
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_bound bigint;
  v_name_norm text;
begin
  if p_match_id is null or p_player_id is null or coalesce(p_guest_session_id, '') = '' then
    return null;
  end if;

  -- One claim at a time per slot: two sessions racing for it cannot both win.
  perform pg_advisory_xact_lock(hashtextextended('voting_photo_slot:' || p_match_id || ':' || p_player_id, 0));

  select player_id into v_bound
  from public.voting_photo_slot_claims
  where match_id = p_match_id and guest_session_id = p_guest_session_id;

  if v_bound is null then
    -- A guest starter: exactly the people the voting screen lets someone be.
    select public.public_normalize_voter_name(j.nombre) into v_name_norm
    from public.jugadores j
    where j.id = p_player_id
      and j.partido_id = p_match_id
      and j.usuario_id is null
      and coalesce(j.is_substitute, false) = false;
    if v_name_norm is null then
      return null;
    end if;

    -- Already claimed by another session: that guest's photo is theirs.
    if exists (
      select 1 from public.voting_photo_slot_claims c
      where c.match_id = p_match_id and c.player_id = p_player_id
    ) then
      return null;
    end if;

    -- That guest already voted: their identity is taken.
    if exists (
      select 1 from public.public_voters v
      where v.partido_id = p_match_id
        and v.completed_at is not null
        and (coalesce(v.votante_nombre_norm, '') = v_name_norm or coalesce(v.nombre_norm, '') = v_name_norm)
    ) then
      return null;
    end if;

    insert into public.voting_photo_slot_claims (match_id, guest_session_id, player_id)
    values (p_match_id, p_guest_session_id, p_player_id)
    on conflict (match_id, guest_session_id) do nothing;

    select player_id into v_bound
    from public.voting_photo_slot_claims
    where match_id = p_match_id and guest_session_id = p_guest_session_id;
  end if;

  if v_bound is distinct from p_player_id then
    -- This session owns another slot (unchanged behavior).
    return v_bound;
  end if;

  -- Claims made before this rule may share a slot: the earliest one owns it.
  if (
    select c.guest_session_id
    from public.voting_photo_slot_claims c
    where c.match_id = p_match_id and c.player_id = p_player_id
    order by c.created_at, c.guest_session_id
    limit 1
  ) is distinct from p_guest_session_id then
    return null;
  end if;

  return p_player_id;
end;
$function$;

revoke all on function public.bind_voting_photo_slot(bigint, text, bigint) from public, anon, authenticated;
grant execute on function public.bind_voting_photo_slot(bigint, text, bigint) to service_role;

create index if not exists voting_photo_slot_claims_match_player_idx
  on public.voting_photo_slot_claims (match_id, player_id);
