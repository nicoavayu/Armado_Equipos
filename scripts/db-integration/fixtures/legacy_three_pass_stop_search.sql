-- ==========================================================================
-- FIXTURE DE TEST — implementación ANTERIOR de "Dejar de buscar".
--
-- NO es una migración y no se aplica a ninguna base real. Sólo la carga
-- scripts/db-integration/run.mjs, sobre el Postgres embebido, para demostrar
-- que la prueba de concurrencia FALLA con la implementación anterior y PASA
-- con la nueva.
--
-- Repone exactamente las tres piezas que la corrección cambió:
--   1. cancel_my_availability() con la estrategia de "hasta tres pasadas";
--   2. backfill_auto_match_proposal_members() sin el lock por usuario;
--   3. enforce_auto_match_member_eligibility() sin el guardia del lock ni la
--      revalidación for-share.
--
-- Y borra las funciones nuevas, para que no quede ningún camino corregido
-- disponible durante la corrida "legacy".
-- ==========================================================================

begin;

drop function if exists public.cancel_my_availability_detailed();
drop function if exists public.auto_match_cancel_search();
drop function if exists public.cancel_my_availability();

-- 1. La versión revisada: tres pasadas sobre las membresías.
create or replace function public.cancel_my_availability()
returns table (
  availability_cancelled integer,
  gestation_memberships_released integer,
  created_invites_withdrawn integer,
  created_memberships_kept integer
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid;
  v_proposal public.auto_match_proposals;
  v_member public.auto_match_proposal_members;
  v_row record;
  v_pass integer;
  v_touched integer;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'not_authenticated'; end if;

  availability_cancelled := 0;
  gestation_memberships_released := 0;
  created_invites_withdrawn := 0;
  created_memberships_kept := 0;

  perform pg_advisory_xact_lock(hashtext('auto_match_sync:' || v_uid::text));

  update public.player_availability
     set status = 'cancelled', updated_at = now()
   where user_id = v_uid and status = 'active';
  get diagnostics availability_cancelled = row_count;

  for v_pass in 1..3 loop
    v_touched := 0;

    for v_row in
      select distinct m.proposal_id as id
      from public.auto_match_proposal_members m
      join public.auto_match_proposals p on p.id = m.proposal_id
      where m.user_id = v_uid
        and (
          (p.status in ('collecting', 'ready') and m.response in ('pending', 'accepted'))
          or (p.status = 'created' and m.response = 'pending')
        )
      order by 1
    loop
      select * into v_proposal
      from public.auto_match_proposals
      where id = v_row.id
      for update;
      if v_proposal.id is null then continue; end if;

      select * into v_member
      from public.auto_match_proposal_members
      where proposal_id = v_row.id and user_id = v_uid
      for update;
      if v_member.proposal_id is null then continue; end if;

      if v_proposal.status in ('collecting', 'ready')
         and v_member.response in ('pending', 'accepted') then
        update public.auto_match_proposal_members
           set response = 'declined',
               response_reason = 'user_declined',
               responded_at = now(),
               confirmed_at = null,
               invite_expires_at = null
         where proposal_id = v_row.id and user_id = v_uid;

        gestation_memberships_released := gestation_memberships_released + 1;
        v_touched := v_touched + 1;
        perform public.process_auto_match_member_exit(v_row.id);

      elsif v_proposal.status = 'created' and v_member.response = 'pending' then
        update public.auto_match_proposal_members
           set response = 'expired',
               response_reason = 'invite_expired',
               responded_at = now(),
               confirmed_at = null,
               invite_expires_at = null
         where proposal_id = v_row.id and user_id = v_uid;

        created_invites_withdrawn := created_invites_withdrawn + 1;
        v_touched := v_touched + 1;
      end if;
    end loop;

    exit when v_touched = 0;
  end loop;

  select count(*)
  into created_memberships_kept
  from public.auto_match_proposal_members m
  join public.auto_match_proposals p on p.id = m.proposal_id
  where m.user_id = v_uid
    and p.status = 'created'
    and m.response = 'accepted'
    and p.proposed_starts_at > now();

  return next;
end;
$$;

revoke all on function public.cancel_my_availability() from public, anon;
grant execute on function public.cancel_my_availability() to authenticated;

-- 2. backfill sin lock por usuario (versión de 20260715003000).
create or replace function public.backfill_auto_match_proposal_members(p_proposal_id bigint)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_proposal public.auto_match_proposals;
  v_candidate record;
  v_active integer;
  v_capacity integer;
  v_added integer := 0;
begin
  select * into v_proposal
  from public.auto_match_proposals
  where id = p_proposal_id
  for update;

  if v_proposal.id is null or v_proposal.status not in ('collecting', 'ready') then
    return 0;
  end if;

  v_capacity := public.auto_match_invitation_capacity(v_proposal.format);
  select count(*) into v_active
  from public.auto_match_proposal_members m
  where m.proposal_id = p_proposal_id
    and m.response not in ('declined', 'expired', 'waitlisted');

  for v_candidate in
    select a.id as availability_id, a.user_id, a.can_organize
    from public.player_availability a
    where public.auto_match_availability_is_eligible(a.id)
      and public.auto_match_availability_fits_proposal(a.id, p_proposal_id)
      and not exists (
        select 1
        from public.auto_match_proposal_members m
        where m.proposal_id = p_proposal_id and m.user_id = a.user_id
      )
    order by a.created_at, a.id
  loop
    exit when v_active >= v_capacity;

    insert into public.auto_match_proposal_members (
      proposal_id, availability_id, user_id, response, can_organize, invite_expires_at
    ) values (
      p_proposal_id, v_candidate.availability_id, v_candidate.user_id,
      'pending', v_candidate.can_organize,
      public.auto_match_invite_deadline(now(), v_proposal.proposed_starts_at)
    ) on conflict do nothing;

    if found then
      v_active := v_active + 1;
      v_added := v_added + 1;
      perform public.enqueue_auto_match_notification(
        p_proposal_id,
        'auto_match_gestating',
        'Se libero un lugar',
        format('Se libero un lugar en un %s compatible con tus horarios. Entra para confirmar si te sumas.', v_proposal.format),
        array[v_candidate.user_id]::uuid[],
        format('joined:%s', v_candidate.user_id),
        null
      );
    end if;
  end loop;

  return v_added;
end;
$$;

-- 3. Trigger sin el guardia del lock (versión de 20260716120000).
create or replace function public.enforce_auto_match_member_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.response not in ('pending', 'accepted') then return new; end if;

  if tg_op = 'INSERT' then
    if new.availability_id is not null
       and public.auto_match_availability_is_eligible(new.availability_id)
       and public.auto_match_availability_fits_proposal(new.availability_id, new.proposal_id) then
      return new;
    end if;
    return null;
  end if;

  if old.response = 'expired'
     and new.response = 'accepted'
     and old.confirmed_at is not null
     and coalesce(old.response_reason, '') in ('', 'schedule_conflict', 'availability_ineligible')
     and public.auto_match_member_snapshot_is_valid_for_proposal(
       new.proposal_id, new.user_id
     )
     and public.auto_match_member_has_free_slot(new.proposal_id, new.user_id)
     and not exists (
       select 1
       from public.auto_match_proposal_members core
       where core.proposal_id = new.proposal_id
         and core.response = 'accepted'
         and core.user_id <> new.user_id
         and not public.auto_match_member_snapshots_are_compatible(
           new.proposal_id, new.user_id, core.user_id
         )
     ) then
    return new;
  end if;

  if public.auto_match_member_snapshot_fits_proposal(new.proposal_id, new.user_id) then
    return new;
  end if;

  if new.response = 'accepted' and old.response is distinct from 'accepted' then
    raise exception 'auto_match_location_or_account_ineligible';
  end if;
  return null;
end;
$$;

commit;
