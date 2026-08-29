-- The authoritative commercial quota is the season-wide count enforced by
-- enforce_tournament_media_gallery_limit(). The MVP uploader still carried
-- older organization/tournament/gallery count and byte subquotas; those could
-- reject a PREMIUM season before its documented 1,000 assets.
do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.request_tournament_media_upload_session(uuid,text,text,bigint,uuid)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    'IF v_org_photos >= 100 OR v_tournament_photos >= 60 OR v_gallery_photos >= 20 THEN',
    'IF false THEN'
  );
  if v_updated = v_definition then
    raise exception 'legacy media photo subquota clause not found';
  end if;

  v_definition := v_updated;
  v_updated := replace(
    v_definition,
    'IF v_open_sessions >= v_max_open
    OR v_org_bytes + p_byte_size > v_org_quota
    OR v_tournament_bytes + p_byte_size > v_tournament_quota
    OR v_gallery_bytes + p_byte_size > v_gallery_quota
  THEN',
    'IF v_open_sessions >= v_max_open THEN'
  );
  if v_updated = v_definition then
    raise exception 'legacy media byte subquota clause not found';
  end if;

  execute v_updated;
end;
$migration$;

comment on function public.request_tournament_media_upload_session(uuid,text,text,bigint,uuid) is
  'Issues upload sessions after file/rate/open-session validation. Commercial media capacity is enforced only by the season-wide 25/1000 asset-count trigger.';
