-- Follow-up cleanup for the legacy per-organization/tournament/gallery photo
-- ceilings neutralized in the preceding migration. Keep the useful rate and
-- open-session controls, but stop calculating counts and limits that can no
-- longer reject an upload.
do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.request_tournament_media_upload_session(uuid,text,text,bigint,uuid)'::regprocedure
  ) into v_definition;

  v_updated := replace(v_definition, '  v_org_photos integer := 0;' || chr(10), '');
  v_updated := replace(v_updated, '  v_tournament_photos integer := 0;' || chr(10), '');
  v_updated := replace(v_updated, '  v_gallery_photos integer := 0;' || chr(10), '');
  v_updated := replace(v_updated, '  v_org_quota bigint;' || chr(10), '');
  v_updated := replace(v_updated, '  v_tournament_quota bigint;' || chr(10), '');
  v_updated := replace(v_updated, '  v_gallery_quota bigint;' || chr(10), '');

  v_updated := replace(v_updated,
    '  v_org_quota := CASE WHEN v_tier = ''mvp_simple'' THEN 419430400 ELSE 5368709120 END;' || chr(10),
    '');
  v_updated := replace(v_updated,
    '  v_tournament_quota := CASE WHEN v_tier = ''mvp_simple'' THEN 209715200 ELSE 2147483648 END;' || chr(10),
    '');
  v_updated := replace(v_updated,
    '  v_gallery_quota := CASE WHEN v_tier = ''mvp_simple'' THEN 52428800 ELSE 536870912 END;' || chr(10),
    '');

  v_updated := replace(v_updated, '    SELECT
      (SELECT count(*) FROM public.tournament_media_assets asset
       WHERE asset.organization_id = v_gallery.organization_id AND asset.status <> ''revoked'')
      + (SELECT count(*) FROM public.tournament_media_upload_sessions session
         WHERE session.organization_id = v_gallery.organization_id
           AND session.status = ''issued'' AND session.expires_at > now()),
      (SELECT count(*) FROM public.tournament_media_assets asset
       WHERE asset.tournament_id = v_gallery.tournament_id AND asset.status <> ''revoked'')
      + (SELECT count(*) FROM public.tournament_media_upload_sessions session
         WHERE session.tournament_id = v_gallery.tournament_id
           AND session.status = ''issued'' AND session.expires_at > now()),
      (SELECT count(*) FROM public.tournament_media_assets asset
       WHERE asset.gallery_id = p_gallery_id AND asset.status <> ''revoked'')
      + (SELECT count(*) FROM public.tournament_media_upload_sessions session
         WHERE session.gallery_id = p_gallery_id
           AND session.status = ''issued'' AND session.expires_at > now())
    INTO v_org_photos,v_tournament_photos,v_gallery_photos;
', '');
  v_updated := replace(v_updated, '    IF false THEN
      RAISE EXCEPTION USING errcode = ''22023'', message = ''TORNEOS_MEDIA_QUOTA_EXCEEDED'';
    END IF;
', '');

  if v_updated = v_definition
    or v_updated like '%v_org_photos%'
    or v_updated like '%v_tournament_photos%'
    or v_updated like '%v_gallery_photos%'
    or v_updated like '%v_org_quota%'
    or v_updated like '%v_tournament_quota%'
    or v_updated like '%v_gallery_quota%'
  then
    raise exception 'legacy media subquota work was not removed completely';
  end if;

  execute v_updated;
end;
$migration$;

comment on function public.request_tournament_media_upload_session(uuid,text,text,bigint,uuid) is
  'Issues upload sessions after file/rate/open-session validation. Commercial capacity is enforced by the season-wide 25/1000 asset-count trigger.';
