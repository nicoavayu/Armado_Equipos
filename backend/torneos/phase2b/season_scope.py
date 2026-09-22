"""Phase 2B: apply the season seat model uniformly to organization-derived authority.

Historically only RLS and a handful of RPCs required the actor's season assignment;
most SECURITY DEFINER functions authorized a season-scoped resource with the
organization capability alone (owners always pass; admins/collaborators need the
assignment). The dynamic sweep (season_scope_sweep.py) proved that class of leak
across the API. This module closes it at build time:

  R1  capability call on a row variable whose table carries (or resolves to) a season
  R2  capability call on p_organization_id in a function with a season-scoped parameter
  R3  anchored edits to shared helpers whose organization branch had no season predicate

Every rewrite is an AND with public.has_tournament_season_access(<org>, <season>); the
participant, manager and player branches are untouched. Excluded functions are handled
by other explicit Phase 2A/2B edits.
"""
import json
import pathlib
import re

BASE = pathlib.Path(__file__).resolve().parents[1]
EXCLUDED = {'can_read_tournament_fixture_scope', 'can_read_tournament_projection_scope', 'get_tournament_teams_context',
            'create_tournament_team_entry', 'search_tournament_players', 'search_tournament_arma2_teams',
            'accept_tournament_team_invitation', 'get_tournament_branding_context'}
CAPABILITY = re.compile(r"public\.has_tournament_(?:organization|communications|media|social)_capability\(\s*"
                        r"(p_organization_id|v_\w+\.organization_id)\s*,\s*(?:'[\w.]+'|v_\w+)\s*\)")
# Parameter resolvers, in authority order: the season itself, then the tournament, then resources.
PARAMETERS = [
    ('p_season_id', 'p_season_id'),
    ('p_tournament_id', "(select t.season_id from public.tournaments t where t.id = p_tournament_id and t.organization_id = p_organization_id)"),
    ('p_team_entry_id', "(select e.season_id from public.tournament_team_entries e where e.id = p_team_entry_id and e.organization_id = p_organization_id)"),
    ('p_match_id', "(select m.season_id from public.tournament_matches m where m.id = p_match_id and m.organization_id = p_organization_id)"),
    ('p_match_operation_id', "(select o.season_id from public.tournament_match_operations o where o.id = p_match_operation_id and o.organization_id = p_organization_id)"),
    ('p_fixture_version_id', "(select v.season_id from public.tournament_fixture_versions v where v.id = p_fixture_version_id and v.organization_id = p_organization_id)"),
    ('p_category_id', "(select t.season_id from public.tournament_categories c join public.tournaments t on t.id = c.tournament_id where c.id = p_category_id and c.organization_id = p_organization_id)"),
    ('p_phase_id', "(select t.season_id from public.tournament_phases ph join public.tournaments t on t.id = ph.tournament_id where ph.id = p_phase_id and ph.organization_id = p_organization_id)"),
    ('p_round_id', "(select t.season_id from public.tournament_rounds r join public.tournaments t on t.id = r.tournament_id where r.id = p_round_id and r.organization_id = p_organization_id)"),
    ('p_group_id', "(select t.season_id from public.tournament_groups g join public.tournaments t on t.id = g.tournament_id where g.id = p_group_id and g.organization_id = p_organization_id)"),
    ('p_roster_id', "(select e.season_id from public.tournament_rosters r join public.tournament_team_entries e on e.id = r.team_entry_id where r.id = p_roster_id and r.organization_id = p_organization_id)"),
    ('p_roster_player_id', "(select e.season_id from public.tournament_roster_players rp join public.tournament_team_entries e on e.id = rp.team_entry_id where rp.id = p_roster_player_id and rp.organization_id = p_organization_id)"),
    ('p_participant_id', "(select p.season_id from public.tournament_competition_participants p where p.id = p_participant_id and p.organization_id = p_organization_id)"),
    ('p_participant_set_id', "(select s.season_id from public.tournament_participant_sets s where s.id = p_participant_set_id and s.organization_id = p_organization_id)"),
    ('p_revision_id', "(select rv.season_id from public.tournament_standings_revisions rv where rv.id = p_revision_id and rv.organization_id = p_organization_id)"),
    ('p_gallery_id', "(select g.season_id from public.tournament_media_galleries g where g.id = p_gallery_id and g.organization_id = p_organization_id)"),
    ('p_asset_id', "(select g.season_id from public.tournament_media_assets a join public.tournament_media_galleries g on g.id = a.gallery_id where a.id = p_asset_id and a.organization_id = p_organization_id)"),
    ('p_document_id', "(select d.season_id from public.tournament_documents d where d.id = p_document_id and d.organization_id = p_organization_id)"),
    ('p_version_id', "(select d.season_id from public.tournament_document_versions dv join public.tournament_documents d on d.id = dv.document_id where dv.id = p_version_id and dv.organization_id = p_organization_id)"),
    ('p_announcement_id', "(select an.season_id from public.tournament_announcements an where an.id = p_announcement_id and an.organization_id = p_organization_id)"),
    ('p_purchase_id', "(select pu.season_id from public.tournament_purchases pu where pu.id = p_purchase_id and pu.organization_id = p_organization_id)"),
    ('p_portrait_id', "(select t.season_id from public.tournament_player_portraits pp join public.tournaments t on t.id = pp.tournament_id where pp.id = p_portrait_id and pp.organization_id = p_organization_id)"),
    ('p_team_photo_id', "(select t.season_id from public.tournament_team_photos tp join public.tournaments t on t.id = tp.tournament_id where tp.id = p_team_photo_id and tp.organization_id = p_organization_id)"),
    ('p_suspension_id', "(select t.season_id from public.tournament_player_suspensions su join public.tournaments t on t.id = su.tournament_id where su.id = p_suspension_id and su.organization_id = p_organization_id)"),
    ('p_adjustment_id', "(select t.season_id from public.tournament_points_adjustments pa join public.tournaments t on t.id = pa.tournament_id where pa.id = p_adjustment_id and pa.organization_id = p_organization_id)"),
    ('p_event_id', "(select m.season_id from public.tournament_match_events ev join public.tournament_matches m on m.id = ev.match_id where ev.id = p_event_id and ev.organization_id = p_organization_id)"),
]
# Row-variable resolvers (R1): table -> season expression for a variable of that rowtype.
ROWTYPES = {
    'tournament_announcements': '{v}.season_id', 'tournament_documents': '{v}.season_id',
    'tournament_media_galleries': '{v}.season_id', 'tournament_purchases': '{v}.season_id',
    'tournament_standings_revisions': '{v}.season_id', 'tournament_team_entries': '{v}.season_id',
    'tournament_matches': '{v}.season_id', 'tournament_match_operations': '{v}.season_id',
    'tournament_fixture_versions': '{v}.season_id', 'tournaments': '{v}.season_id',
    'tournament_document_versions': "(select d.season_id from public.tournament_documents d where d.id = {v}.document_id)",
    'tournament_media_assets': "(select g.season_id from public.tournament_media_galleries g where g.id = {v}.gallery_id)",
    'tournament_media_reports': "(select g.season_id from public.tournament_media_galleries g where g.id = {v}.gallery_id)",
    'tournament_media_upload_sessions': "(select g.season_id from public.tournament_media_galleries g where g.id = {v}.gallery_id)",
    'tournament_player_suspensions': "(select t.season_id from public.tournaments t where t.id = {v}.tournament_id)",
    'tournament_points_adjustments': "(select t.season_id from public.tournaments t where t.id = {v}.tournament_id)",
}


def resolver(name, signature, body):
    """Season expression for p_organization_id-based capability calls, or None."""
    params = {a.strip().split()[0] for a in signature.split(',') if a.strip()}
    if 'p_organization_id' not in params:
        return None
    for parameter, expression in PARAMETERS:
        if parameter in params:
            return expression
    return None


def apply(name, signature, body):
    """Return (body, applied_rules) for one historical function body."""
    declared = dict(re.findall(r'(v_\w+)\s+public\.(\w+)%rowtype', body, re.I))
    season = resolver(name, signature, body)
    rules = set()

    def wrap(match):
        org = match.group(1)
        if name in EXCLUDED:
            return match.group(0)
        if org == 'p_organization_id':
            if season is None:
                return match.group(0)
            rules.add('R2')
            return '(' + match.group(0) + ' and public.has_tournament_season_access(p_organization_id, ' + season + '))'
        variable = org.split('.')[0]
        table = declared.get(variable)
        if table not in ROWTYPES:
            return match.group(0)
        rules.add('R1')
        return '(' + match.group(0) + ' and public.has_tournament_season_access(' + org + ', ' + ROWTYPES[table].format(v=variable) + '))'
    body = CAPABILITY.sub(wrap, body)
    # R3 anchored edits: Phase 2B set, then the Phase 2D set (capability calls whose argument is a
    # CASE expression escape the CAPABILITY pattern above, so R2 never reached them).
    for phase, tag in (('phase2b', 'R3'), ('phase2d', 'R3-2D')):
        edits = json.loads((BASE / phase / 'season-scope-edits.json').read_text())
        if name in edits:
            pairs = edits[name] if isinstance(edits[name][0], list) else [edits[name]]
            for old, new in pairs:
                assert body.count(old) == 1, (name, old[:60])
                body = body.replace(old, new)
            rules.add(tag)
    return body, sorted(rules)
