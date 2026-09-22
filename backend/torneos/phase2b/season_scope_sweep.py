"""Dynamic season-scope sweep over every authenticated-callable SECURITY DEFINER function.

Extends the Phase 2B season-leak finding from three read helpers to the whole API. Two
twin tournaments are fixtured in alpha-league with the historical RPCs where possible:
A in the season the admin is assigned to, B in a season the admin is not assigned to.
Every function that takes a season-scoped resource is invoked as the admin against A
and against B, and as the owner against B as the positive control. Each invocation runs
inside a transaction that is rolled back; only fixtures persist. Verdicts compare live
outcomes and returned values; nothing is inferred from source text.

Verdicts:
  SCOPED             owner passes authorization on B; admin passes it on A but is denied (42501) on B
  LEAK               owner passes authorization on B and the admin also gets past it on B
  CAPABILITY_DENIED  admin denied on A and B alike (capability, not season); owner passes on B
  PRECONDITION       owner, admin A and admin B fail identically with a non-42501 error: a shared
                     precondition (missing pipeline/asset/state) stops the call before authorization
  INCONCLUSIVE       the owner control is denied on B too: fixture/arguments insufficient

"Passes authorization" means the call returned, or failed later with a non-42501 error
(validation/state), which only happens after the authorization block. The pair (play/reg)
recorded is the first on which the owner passes; otherwise the play pair.
  NOT_SWEPT          no season-scoped resource parameter, Core-wired (covered elsewhere), or self-scoped

Organization-level functions (p_organization_id without a season-scoped resource) get a second,
simpler probe: the owner of another organization must be denied while the owner passes
(ORG_SCOPED); the same PASSED/DENIED classification applies.
"""
import json
import pathlib
import sys
import time
import uuid

BASE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE / 'tools'))
sys.path.insert(0, str(BASE / 'phase2b'))
from lab import sql  # noqa: E402
from adapter import as_user, lit  # noqa: E402

SKIP = {'accept_tournament_team_invitation', 'search_tournament_players', 'search_tournament_arma2_teams',
        'create_tournament_team_entry'}
# Authority is the current identity's own rows (deliveries, availability, managed teams, own stats):
# an organization admin gets nothing from another season through them by construction.
SELF_SCOPED = {'get_tournament_communications_inbox', 'get_player_tournament_statistics', 'get_player_tournament_suspensions',
               'get_my_managed_match_squad_context', 'respond_match_availability', 'mark_tournament_announcement_read',
               'acknowledge_tournament_document', 'is_tournament_team_manager'}
# Per-function argument overrides (fixture key or literal SQL) where the generic mapping is wrong.
OVERRIDES = {
    'save_match_squad': {'p_team_entry_id': 'home_team_entry_id'}, 'submit_match_squad': {'p_team_entry_id': 'home_team_entry_id'},
    'get_match_squad_context': {'p_team_entry_id': 'home_team_entry_id'},
    'get_published_tournament_matches': {'p_team_entry_id': 'null'},
    'has_tournament_entitlement': {'p_capability': 'entitlement_capability'},
}
SCOPED_PARAMS = {'tournament_id', 'season_id', 'category_id', 'team_entry_id', 'roster_id', 'roster_player_id',
                 'match_id', 'match_operation_id', 'fixture_version_id', 'phase_id', 'round_id', 'group_id',
                 'participant_id', 'announcement_id', 'version_id', 'gallery_id', 'revision_id', 'asset_id',
                 'portrait_id', 'team_photo_id', 'suspension_id', 'adjustment_id', 'event_id', 'purchase_id',
                 'source_fixture_version_id', 'supersedes_id', 'source_phase_id', 'document_id'}


def q(query):
    return sql('baseline', query).strip()


def first(query):
    """INSERT ... RETURNING prints the value and then its command tag."""
    return q(query).splitlines()[0]


def claims(identity, core):
    now = int(time.time())
    return {'sub': identity, 'core_user_id': core, 'role': 'authenticated', 'iss': 'urn:arma2:local:identity-bridge',
            'aud': 'arma2-torneos-local', 'session_id': str(uuid.uuid4()), 'jti': str(uuid.uuid4()),
            'iat': now, 'nbf': now, 'exp': now + 120}


def rpc(actor, statement):
    try:
        return as_user(actor, statement)
    except RuntimeError as error:
        return 'ERR ' + str(error).splitlines()[0]


def fixture(owner, org, season, slug, venue, court, log, play):
    """Idempotent twin tournament created with the historical defaults RPC. 'reg' pairs stay in
    registration (editable/submitted entries); 'play' pairs are frozen, fixtured, started, with one
    scheduled match and an open operation. Both get comms, a document and a gallery."""
    f = {'organization_id': org, 'season_id': season, 'venue_id': venue, 'court_id': court,
         'entitlement_capability': q('select capability from public.tournament_entitlement_capabilities order by capability limit 1')}
    modality = q('select code from public.tournament_sport_modalities where team_size=5 limit 1')
    t = q(f"select id from public.tournaments where organization_id='{org}' and slug='{slug}'")
    if not t:
        log.append(['create_tournament_with_defaults', slug, rpc(owner, f"select public.create_tournament_with_defaults('{org}','{season}','{slug}','{slug}',null,'{modality}','league','mixed',null,null,'{uuid.uuid4()}')")])
        t = q(f"select id from public.tournaments where organization_id='{org}' and slug='{slug}'")
        q(f"update public.tournaments set status='registration' where id='{t}' and status='draft'")
    f['tournament_id'] = t
    f['category_id'] = q(f"select id from public.tournament_categories where tournament_id='{t}' and slug='open'") or \
        first(f"insert into public.tournament_categories(organization_id,tournament_id,name,slug) values('{org}','{t}','Open','open') returning id")
    entries = json.loads(q(f"select coalesce(json_agg(id order by name),'[]') from public.tournament_team_entries where tournament_id='{t}'"))
    while len(entries) < 5:
        r = rpc(owner, f"select public.create_tournament_team_entry('{org}','{t}','{f['category_id']}',null,'Team {slug} {len(entries)+1}',null,null,null,'manual',null,null,null,'{uuid.uuid4()}')")
        log.append(['create_tournament_team_entry', slug, r if isinstance(r, str) else 'ok'])
        entries.append(json.loads(r[0])['entryId'])
    editable = entries[4]  # kept editable (in_progress with an active owner manager)
    f['team_entry_id'] = editable
    f['roster_id'] = q(f"select id from public.tournament_rosters where team_entry_id='{editable}' order by version desc limit 1")
    q(f"update public.tournament_team_entries set status='in_progress' where id='{editable}' and status='draft';"
      f"insert into public.tournament_team_managers(organization_id,team_entry_id,user_id,email_normalized,display_name,role,status,invited_by,accepted_at)"
      f" select '{org}','{editable}','{owner['sub']}','owner-{slug}@example.test','Owner Manager','captain','active','{owner['sub']}',now()"
      f" where not exists (select 1 from public.tournament_team_managers where team_entry_id='{editable}' and user_id='{owner['sub']}')")
    f['provisional_player_id'] = q(f"select id from public.tournament_provisional_players where organization_id='{org}' and display_name='Provisional {slug}' limit 1")
    if not f['provisional_player_id']:
        log.append(['create_tournament_provisional_player', slug, rpc(owner, f"select public.create_tournament_provisional_player('{org}','{editable}','Provisional {slug}')")])
        f['provisional_player_id'] = q(f"select id from public.tournament_provisional_players where organization_id='{org}' and display_name='Provisional {slug}' limit 1")
    f['roster_player_id'] = q(f"select id from public.tournament_roster_players where roster_id='{f['roster_id']}' limit 1")
    if not f['roster_player_id'] and f['provisional_player_id']:
        log.append(['add_tournament_roster_player', slug, rpc(owner, f"select public.add_tournament_roster_player('{org}','{editable}','{f['roster_id']}',null,'{f['provisional_player_id']}','Provisional {slug}',null,9::smallint,'ARQ',null,true)")])
        f['roster_player_id'] = q(f"select id from public.tournament_roster_players where roster_id='{f['roster_id']}' limit 1")
    if not play:
        q(f"update public.tournament_team_entries set status='submitted',submitted_by='{owner['sub']}',submitted_at=coalesce(submitted_at,now()) where id='{entries[3]}' and status='draft';"
          f"update public.tournament_rosters set status='submitted',submitted_at=coalesce(submitted_at,now()) where status='draft' and team_entry_id='{entries[3]}'")
        f['submitted_entry_id'] = entries[3]
        for key in ('participant_set_id', 'participant_id', 'fixture_version_id', 'phase_id', 'round_id', 'group_id', 'match_id', 'match_operation_id', 'revision_id'):
            f[key] = ''
        return comms(owner, org, t, f, slug, log)
    approved = "','".join(entries[:4])
    q(f"update public.tournament_team_entries set status='approved',submitted_by='{owner['sub']}',submitted_at=coalesce(submitted_at,now()),approved_at=coalesce(approved_at,now()) where id in ('{approved}') and status='draft';"
      f"update public.tournament_rosters set status='approved',submitted_at=coalesce(submitted_at,now()),approved_at=coalesce(approved_at,now()) where status='draft' and team_entry_id in ('{approved}')")
    if not q(f"select id from public.tournament_participant_sets where tournament_id='{t}' and status='frozen'"):
        log.append(['freeze_tournament_participants', slug, rpc(owner, f"select public.freeze_tournament_participants('{org}','{t}','{f['category_id']}','{uuid.uuid4()}')")])
    f['participant_set_id'] = q(f"select id from public.tournament_participant_sets where tournament_id='{t}' and status='frozen'")
    f['participant_id'] = q(f"select id from public.tournament_competition_participants where participant_set_id='{f['participant_set_id']}' limit 1")
    if not q(f"select id from public.tournament_fixture_versions where tournament_id='{t}' limit 1"):
        log.append(['generate_tournament_fixture', slug, rpc(owner, f"select public.generate_tournament_fixture('{org}','{t}','{f['category_id']}','seed-{slug}','{{}}','{uuid.uuid4()}')")])
    f['fixture_version_id'] = q(f"select id from public.tournament_fixture_versions where tournament_id='{t}' order by version_number desc limit 1")
    if q(f"select status from public.tournament_fixture_versions where id='{f['fixture_version_id']}'") == 'draft':
        log.append(['publish_tournament_fixture', slug, rpc(owner, f"select public.publish_tournament_fixture('{org}','{f['fixture_version_id']}')")])
    if q(f"select status from public.tournaments where id='{t}'") == 'scheduled':
        log.append(['start_tournament_competition', slug, rpc(owner, f"select public.start_tournament_competition('{org}','{t}')")])
    f['phase_id'] = q(f"select id from public.tournament_phases where fixture_version_id='{f['fixture_version_id']}' order by sequence_number limit 1")
    f['round_id'] = q(f"select id from public.tournament_rounds where phase_id='{f['phase_id']}' order by sort_order limit 1")
    f['group_id'] = q(f"select id from public.tournament_groups where phase_id='{f['phase_id']}' limit 1")
    f['match_id'] = q(f"select id from public.tournament_matches where round_id='{f['round_id']}' order by match_number limit 1")
    if q(f"select status from public.tournament_matches where id='{f['match_id']}'") == 'unscheduled':
        hours = 2 if slug.endswith('-a') else 6  # twin tournaments share the court; avoid a schedule conflict
        log.append(['schedule_tournament_match', slug, rpc(owner, f"select public.schedule_tournament_match('{org}','{f['match_id']}',now()+interval '{hours} hours','{venue}','{court}',60,false,null)")])
    f['home_team_entry_id'] = q(f"select home_team_entry_id from public.tournament_match_team_entries('{f['match_id']}')") if f['match_id'] else ''
    f['match_operation_id'] = q(f"select id from public.tournament_match_operations where match_id='{f['match_id']}' order by operation_version desc limit 1")
    if not f['match_operation_id']:
        log.append(['open_tournament_match_operation', slug, rpc(owner, f"select public.open_tournament_match_operation('{org}','{f['match_id']}',null)")])
        f['match_operation_id'] = q(f"select id from public.tournament_match_operations where match_id='{f['match_id']}' order by operation_version desc limit 1")
    f['revision_id'] = q(f"select id from public.tournament_standings_revisions where tournament_id='{t}' order by revision_number desc limit 1")
    if not f['revision_id']:
        log.append(['rebuild_tournament_standings', slug, rpc(owner, f"select public.rebuild_tournament_standings('{org}','{t}','{f['category_id']}','{f['phase_id']}',null,'sweep','{uuid.uuid4()}')")])
        f['revision_id'] = q(f"select id from public.tournament_standings_revisions where tournament_id='{t}' order by revision_number desc limit 1")
    return comms(owner, org, t, f, slug, log)


def comms(owner, org, t, f, slug, log):
    f['announcement_id'] = q(f"select id from public.tournament_announcements where tournament_id='{t}' limit 1")
    if not f['announcement_id']:
        log.append(['create_tournament_announcement_draft', slug, rpc(owner, f"select public.create_tournament_announcement_draft('{org}','{t}',null,'general','Sweep title','Sweep summary','Sweep body','normal','none',null,null,null,'{uuid.uuid4()}')")])
        f['announcement_id'] = q(f"select id from public.tournament_announcements where tournament_id='{t}' limit 1")
    f['document_id'] = q(f"select id from public.tournament_documents where tournament_id='{t}' limit 1")
    if not f['document_id']:
        log.append(['create_tournament_document', slug, rpc(owner, f"select public.create_tournament_document('{org}','{t}',null,'regulation','Sweep document','Sweep summary','Sweep body','none',null,'{uuid.uuid4()}')")])
        f['document_id'] = q(f"select id from public.tournament_documents where tournament_id='{t}' limit 1")
    f['version_id'] = q(f"select id from public.tournament_document_versions where document_id='{f['document_id']}' order by version desc limit 1")
    f['gallery_id'] = q(f"select id from public.tournament_media_galleries where tournament_id='{t}' limit 1")
    if not f['gallery_id']:
        log.append(['create_tournament_media_gallery', slug, rpc(owner, f"select public.create_tournament_media_gallery('{org}','{t}','{f['category_id']}',null,null,'Sweep gallery',null,'organization','{uuid.uuid4()}')")])
        f['gallery_id'] = q(f"select id from public.tournament_media_galleries where tournament_id='{t}' limit 1")
    return f


DEFAULTS = {
    'p_idempotency_key': lambda: lit(uuid.uuid4()), 'p_query': lambda: "'ab'", 'p_slug': lambda: lit('sweep-' + uuid.uuid4().hex[:8]),
    'p_public_slug': lambda: "'alpha-cup'", 'p_status': lambda: "'scheduled'", 'p_decision': lambda: "'approved'",
    'p_capability': lambda: "'tournaments.read'", 'p_role': lambda: "'delegate'", 'p_email': lambda: "'sweep@example.test'",
    'p_limit': lambda: '8', 'p_offset': lambda: '0', 'p_action': lambda: "'reseed'", 'p_kind': lambda: "'x'",
    'p_primary_position': lambda: "'ARQ'", 'p_secondary_position': lambda: 'null', 'p_shirt_number': lambda: '7::smallint',
    'p_is_goalkeeper': lambda: 'true', 'p_reason': lambda: "'sweep reason'", 'p_notes': lambda: "'sweep'",
    'p_product_code': lambda: "'PREMIUM'", 'p_provider': lambda: "'FAKE'", 'p_provider_environment': lambda: "'local'",
    'p_editorial_status': lambda: "'approved'", 'p_policy': lambda: "'organization_only'", 'p_view': lambda: "'all'",
    'p_filter': lambda: "'all'", 'p_visibility': lambda: "'organization'", 'p_variant': lambda: "'square'", 'p_theme': lambda: "'base'",
    'p_piece': lambda: "'standings'", 'p_declared_mime': lambda: "'image/jpeg'", 'p_file_name': lambda: "'photo.jpg'",
    'p_byte_size': lambda: '1024', 'p_match_status': lambda: "'played'", 'p_zoom': lambda: '1', 'p_focal_x': lambda: '0.5',
    'p_focal_y': lambda: '0.5', 'p_target_order': lambda: '1', 'p_sort_order': lambda: '1', 'p_version': lambda: '1',
    'p_points': lambda: '1', 'p_group_count': lambda: '2', 'p_qualifier_count': lambda: '2', 'p_matches': lambda: '1',
    'p_duration_minutes': lambda: '60', 'p_expected_recipient_count': lambda: '0', 'p_max_age': lambda: '40::smallint',
    'p_min_age': lambda: '18::smallint', 'p_team_size': lambda: '5::smallint', 'p_seed': lambda: "'seed'",
    'p_resolution': lambda: "'dismissed'", 'p_priority': lambda: "'normal'", 'p_announcement_type': lambda: "'general'",
    'p_audience_type': lambda: "'general'", 'p_acknowledgement_mode': lambda: "'none'", 'p_document_type': lambda: "'regulation'",
    'p_link_type': lambda: "'external'", 'p_entity_kind': lambda: "'match'", 'p_workspace_type': lambda: "'organization'",
    'p_sport_modality': lambda: "(select code from public.tournament_sport_modalities where team_size=5 limit 1)", 'p_competition_format': lambda: "'league'", 'p_gender_category': lambda: "'mixed'",
    'p_registration_source': lambda: "'manual'", 'p_response': lambda: "'available'", 'p_reason_code': lambda: "'other'",
    'p_timezone': lambda: "'America/Argentina/Buenos_Aires'", 'p_token': lambda: lit('x' * 64), 'p_path': lambda: "'x'",
    'p_place_id': lambda: 'null', 'p_external_url': lambda: "'https://example.test/x'", 'p_label': lambda: "'Sweep link'",
    'p_title': lambda: "'Sweep title'", 'p_summary': lambda: "'Sweep summary'", 'p_body': lambda: "'Sweep body'",
    'p_name': lambda: "'Sweep name'", 'p_display_name': lambda: "'Sweep name'", 'p_description': lambda: "'Sweep description'",
    'p_comment': lambda: "'sweep'", 'p_detail': lambda: "'sweep detail'", 'p_note': lambda: "'sweep'",
    'p_override_reason': lambda: "'sweep override reason'", 'p_review_reason': lambda: "'sweep'", 'p_reason_text': lambda: "'sweep'",
    'p_correction_reason': lambda: 'null', 'p_scheduled_for': lambda: 'null', 'p_effective_at': lambda: 'null',
    'p_scheduled_at': lambda: "now()+interval '3 hours'", 'p_configuration': lambda: "'{}'::jsonb", 'p_patch': lambda: "'{}'::jsonb",
    'p_windows': lambda: "'[]'::jsonb", 'p_pots': lambda: "'[]'::jsonb", 'p_players': lambda: "'[]'::jsonb",
    'p_score': lambda: "'{\"homeScore\":1,\"awayScore\":0,\"scoreType\":\"played\"}'::jsonb", 'p_outcome': lambda: "'{\"result\":\"played\"}'::jsonb",
    'p_event': lambda: "'{}'::jsonb", 'p_issues': lambda: "'[]'::jsonb", 'p_payload': lambda: "'{}'::jsonb",
    'p_primary_color': lambda: "'#112233'", 'p_secondary_color': lambda: "'#445566'", 'p_short_name': lambda: "'SWP'",
    'p_category_slug': lambda: "'open'", 'p_specific_user_id': lambda: 'null', 'p_report_id': lambda: 'null',
    'p_include_arma2_branding': lambda: 'false', 'p_publish': lambda: 'false', 'p_published': lambda: 'true',
    'p_submit_for_review': lambda: 'false', 'p_request_hide': lambda: 'false', 'p_require_edit': lambda: 'false',
    'p_override_warnings': lambda: 'false', 'p_confirm': lambda: 'true', 'p_double_leg': lambda: 'false',
    'p_can_export': lambda: 'true', 'p_discipline': lambda: 'true', 'p_documents': lambda: 'true', 'p_general': lambda: 'true',
    'p_callups': lambda: 'true', 'p_match_changes': lambda: 'true', 'p_summaries': lambda: 'true',
    'p_clear_end_date': lambda: 'false', 'p_clear_start_date': lambda: 'false', 'p_start_date': lambda: 'null',
    'p_end_date': lambda: 'null', 'p_avatar_url': lambda: 'null', 'p_address': lambda: "'Sweep 1'", 'p_locality': lambda: 'null',
    'p_latitude': lambda: 'null', 'p_longitude': lambda: 'null', 'p_manager_email': lambda: 'null',
    'p_manager_display_name': lambda: 'null', 'p_manager_user_id': lambda: 'null', 'p_arma2_team_id': lambda: 'null',
    'p_arma2_user_id': lambda: 'null', 'p_user_id': lambda: 'null', 'p_session_id': lambda: 'null',
    'p_resource_id': lambda: 'null', 'p_entity_id': lambda: 'null',
}


def argument(name, typ, f, overrides=None):
    key = name[2:]
    if overrides and name in overrides:
        value = overrides[name]
        if f.get(value):
            return lit(f[value])
        return 'null' if value.isidentifier() else value  # absent fixture key -> null; SQL stays SQL
    if key in f and f[key]:
        return lit(f[key])
    if name in DEFAULTS:
        return DEFAULTS[name]()
    if name.endswith('_id') and typ == 'uuid':
        return 'null'
    return {'uuid': lit(uuid.uuid4()), 'text': "'sweep'", 'integer': '1', 'smallint': '1::smallint', 'bigint': '1',
            'boolean': 'true', 'jsonb': "'{}'::jsonb", 'timestamp with time zone': 'now()', 'date': 'current_date',
            'numeric': '0.5', 'double precision': '0.5', 'text[]': "array[]::text[]"}.get(typ, 'null')


def invoke(actor, call):
    out = sql('baseline', "BEGIN; CREATE FUNCTION pg_temp.sweep(s text) RETURNS text LANGUAGE plpgsql AS $sweep$ DECLARE v text; BEGIN EXECUTE s INTO v; RETURN 'OK '||coalesce(left(v,160),'null'); EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE||' '||SQLERRM; END $sweep$;"
              " GRANT EXECUTE ON FUNCTION pg_temp.sweep(text) TO authenticated; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims=" +
              lit(json.dumps(actor)) + "; SELECT pg_temp.sweep(" + lit('select ' + call) + "); ROLLBACK;")
    return out.splitlines()[5].strip()


def classify(result):
    if result.startswith('OK '):
        value = result[3:]
        return 'EMPTY' if value in ('null', 'false', 'f', '[]', '{}', '') else 'OK'
    if result.startswith('42501') or 'permission denied' in result:
        return 'DENIED'
    return 'ERROR'  # past the authorization block: validation, state or constraint failure


PASSED = ('OK', 'EMPTY', 'ERROR')


def main():
    actors = {a['role']: a for a in json.loads(q("""select json_agg(x) from (select m.role,m.user_id,i.core_user_id
      from public.tournament_organization_members m join public.torneos_identity i on i.id=m.user_id
      join public.tournament_organizations o on o.id=m.organization_id where o.slug='alpha-league') x"""))}
    owner = claims(actors['owner']['user_id'], actors['owner']['core_user_id'])
    admin = claims(actors['admin']['user_id'], actors['admin']['core_user_id'])
    other = json.loads(q("""select json_agg(x) from (select m.user_id,i.core_user_id from public.tournament_organization_members m
      join public.torneos_identity i on i.id=m.user_id join public.tournament_organizations o on o.id=m.organization_id
      where o.slug='bravo-league' and m.role='owner') x"""))[0]
    stranger = claims(other['user_id'], other['core_user_id'])  # owner of another workspace
    org = q("select id from public.tournament_organizations where slug='alpha-league'")
    seasons = {s['slug']: s['id'] for s in json.loads(q(f"select json_agg(x) from (select slug,id from public.tournament_seasons where organization_id='{org}') x"))}
    assigned = q(f"select string_agg(s.slug,',') from public.tournament_season_member_assignments a join public.tournament_organization_members m on m.id=a.membership_id join public.tournament_seasons s on s.id=a.season_id where m.user_id='{admin['sub']}'")
    assert assigned == 'season-one', assigned
    log = []
    venue = q(f"select id from public.tournament_venues where organization_id='{org}' and name='Sweep Venue'")
    if not venue:
        log.append(['create_tournament_venue', 'org', rpc(owner, f"select public.create_tournament_venue('{org}','Sweep Venue','Sweep 1')")])
        venue = q(f"select id from public.tournament_venues where organization_id='{org}' and name='Sweep Venue'")
    court = q(f"select id from public.tournament_courts where venue_id='{venue}' limit 1")
    if not court:
        modality = q('select code from public.tournament_sport_modalities where team_size=5 limit 1')
        log.append(['create_tournament_court', 'org', rpc(owner, f"select public.create_tournament_court('{org}','{venue}','Court 1','{modality}',null)")])
        court = q(f"select id from public.tournament_courts where venue_id='{venue}' limit 1")
    pairs = {'play': (fixture(owner, org, seasons['season-one'], 'sweep-play-a', venue, court, log, True),
                      fixture(owner, org, seasons['season-two'], 'sweep-play-b', venue, court, log, True)),
             'reg': (fixture(owner, org, seasons['season-one'], 'sweep-reg-a', venue, court, log, False),
                     fixture(owner, org, seasons['season-two'], 'sweep-reg-b', venue, court, log, False))}
    functions = json.loads(q("""select json_agg(x order by x.name) from (
      select p.proname name, p.oid::regprocedure::text signature, format_type(p.prorettype,null) returns,
        (select coalesce(json_agg(json_build_object('name',a.n,'type',a.t) order by a.i),'[]') from unnest(p.proargnames,
           (select array_agg(format_type(t,null)) from unnest(p.proargtypes) t)) with ordinality a(n,t,i)) args
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef and p.prokind='f' and has_function_privilege('authenticated',p.oid,'EXECUTE')) x"""))
    rows = []
    for fn in functions:
        names = [a['name'][2:] for a in fn['args']]
        if fn['name'] in SKIP:
            rows.append({'function': fn['signature'], 'verdict': 'NOT_SWEPT', 'reason': 'Core-wired; season scope covered by test_core_wiring.py'})
            continue
        if fn['name'] in SELF_SCOPED:
            rows.append({'function': fn['signature'], 'verdict': 'NOT_SWEPT', 'reason': 'self-scoped: acts only on the current identity\'s own rows'})
            continue
        if not any(n in SCOPED_PARAMS for n in names):
            if 'organization_id' in names:
                fa = pairs['play'][0]
                call = 'public.' + fn['name'] + '(' + ','.join(argument(a['name'], a['type'], fa, OVERRIDES.get(fn['name'])) for a in fn['args']) + ')'
                own, foreign = invoke(owner, call), invoke(stranger, call)
                co, cf = classify(own), classify(foreign)
                if co not in PASSED:
                    verdict = 'INCONCLUSIVE'
                elif co == 'ERROR' and own == foreign:
                    verdict = 'PRECONDITION'
                else:
                    verdict = 'ORG_SCOPED' if cf in ('DENIED', 'EMPTY') else 'ORG_LEAK'
                rows.append({'function': fn['signature'], 'returns': fn['returns'], 'verdict': verdict, 'fixture_pair': 'org',
                             'owner_own_organization': own, 'foreign_owner_same_arguments': foreign})
                continue
            rows.append({'function': fn['signature'], 'verdict': 'NOT_SWEPT', 'reason': 'no organization or season-scoped resource parameter (self-scoped or public)'})
            continue
        # Use the first fixture pair on which the owner control passes authorization (play first).
        chosen = None
        for pair, (fa, fb) in pairs.items():
            calls = {label: 'public.' + fn['name'] + '(' + ','.join(argument(a['name'], a['type'], f, OVERRIDES.get(fn['name'])) for a in fn['args']) + ')'
                     for label, f in (('A', fa), ('B', fb))}
            owner_b = invoke(owner, calls['B'])
            if chosen is None or (classify(owner_b) in PASSED and classify(chosen[2]) not in PASSED) or \
                    (classify(owner_b) == 'OK' and classify(chosen[2]) != 'OK'):
                chosen = (pair, calls, owner_b)
            if classify(owner_b) == 'OK':
                break
        pair, calls, owner_b = chosen
        admin_a, admin_b = invoke(admin, calls['A']), invoke(admin, calls['B'])
        ca, cb, co = classify(admin_a), classify(admin_b), classify(owner_b)
        if co not in PASSED:
            verdict = 'INCONCLUSIVE'
        elif co == 'ERROR' and admin_a == admin_b == owner_b:
            verdict = 'PRECONDITION'
        elif cb == 'DENIED':
            verdict = 'SCOPED' if ca in PASSED else 'CAPABILITY_DENIED'
        elif cb == 'EMPTY':
            verdict = 'SCOPED' if ca == 'OK' else 'INCONCLUSIVE'
        else:
            verdict = 'LEAK'  # admin got past authorization on the unassigned season
        rows.append({'function': fn['signature'], 'returns': fn['returns'], 'verdict': verdict, 'fixture_pair': pair,
                     'admin_assigned_season': admin_a, 'admin_unassigned_season': admin_b, 'owner_unassigned_season': owner_b})
    summary = {'functions': len(rows), 'swept': sum(r['verdict'] != 'NOT_SWEPT' for r in rows)}
    for v in ('SCOPED', 'LEAK', 'CAPABILITY_DENIED', 'PRECONDITION', 'INCONCLUSIVE', 'ORG_SCOPED', 'ORG_LEAK', 'NOT_SWEPT'):
        summary[v] = sum(r['verdict'] == v for r in rows)
    (BASE / 'phase2b/season-scope-sweep.json').write_text(json.dumps({
        'summary': summary, 'admin_assigned_seasons': assigned,
        'fixtures': {pair: {'A': fa, 'B': fb} for pair, (fa, fb) in pairs.items()},
        'fixture_log': [[a, b, (c if isinstance(c, str) else 'ok')] for a, b, c in log],
        'results': rows}, indent=2) + '\n')
    print(json.dumps(summary))
    for r in rows:
        if r['verdict'] in ('LEAK', 'INCONCLUSIVE', 'CAPABILITY_DENIED', 'PRECONDITION', 'ORG_LEAK'):
            print(r['verdict'], r['function'], '|', r.get('admin_assigned_season', r.get('owner_own_organization')), '|', r.get('admin_unassigned_season', r.get('foreign_owner_same_arguments')), '|', r.get('owner_unassigned_season', ''))
    return summary


if __name__ == '__main__':
    s = main()
    sys.exit(0 if s['LEAK'] == 0 and s['ORG_LEAK'] == 0 else 1)
