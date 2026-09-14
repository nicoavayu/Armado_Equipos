"""Phase 2B: wire the four historical Core-dependent RPC bodies to the local contract boundary.

Each edit is anchored on exact historical text and asserted unique, so a drifted
source fails the build instead of silently producing a different function.
"""


def _replace(body, old, new, name):
    assert body.count(old) == 1, (name, old[:60])
    return body.replace(old, new)


def wire_accept_invitation(body):
    name = 'accept_tournament_team_invitation'
    body = _replace(body, "  v_user_email text;\n  v_email_verified_at timestamptz;\n  v_email_has_edge_space boolean;\n",
                    "  v_verification jsonb;\n", name)
    old = ("  select lower(email), email_confirmed_at, email is distinct from btrim(email)\n"
           "  into v_user_email, v_email_verified_at, v_email_has_edge_space\n"
           "  from auth.users\n"
           "  where id = auth.uid();\n"
           "  if v_email_verified_at is null\n"
           "    or v_email_has_edge_space\n"
           "    or v_user_email is distinct from v_invitation.email_normalized\n"
           "  then\n"
           "    raise exception using errcode = '42501', message = 'TORNEOS_INVITATION_INVALID';\n"
           "  end if;\n")
    new = ("  -- Phase 2B: Core verified-email contract, attested server-side for this identity,\n"
           "  -- Core session and exactly this invitation target; single use, short lived.\n"
           "  v_verification := private.consume_core_attestation(\n"
           "    'verified_email',\n"
           "    jsonb_build_object('expected_email', v_invitation.email_normalized)\n"
           "  );\n"
           "  if (v_verification->>'verified') is distinct from 'true'\n"
           "    or (v_verification->>'matches') is distinct from 'true'\n"
           "  then\n"
           "    raise exception using errcode = '42501', message = 'TORNEOS_INVITATION_INVALID';\n"
           "  end if;\n")
    body = _replace(body, old, new, name)
    return body, 'Phase 2B: verified email comes from the attested Core verified-email contract instead of auth.users; invitation state/expiry/manager checks retained'


def _season_and_length(body, name, status_clause):
    old = ("    or not exists (\n"
           "      select 1 from public.tournaments\n"
           f"      where id = p_tournament_id and organization_id = p_organization_id{status_clause}\n"
           "    )\n"
           "    or char_length(btrim(coalesce(p_query, ''))) < 2\n")
    new = ("    or not exists (\n"
           "      select 1 from public.tournaments\n"
           f"      where id = p_tournament_id and organization_id = p_organization_id{status_clause}\n"
           "        and public.has_tournament_season_access(p_organization_id, season_id)\n"
           "    )\n"
           "    or char_length(btrim(coalesce(p_query, ''))) not between 2 and 100\n")
    return _replace(body, old, new, name)


def wire_search_players(body):
    name = 'search_tournament_players'
    body = _replace(body, "declare v_result jsonb;\n",
                    "declare\n  v_result jsonb;\n  v_directory jsonb;\n  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 12);\n", name)
    body = _season_and_length(body, name, " and status <> 'archived'")
    start = body.index("  select coalesce(jsonb_agg(jsonb_build_object(\n    'userId', result.id,")
    end = body.index("  ) result;\n", start) + len("  ) result;\n")
    new = ("  -- Phase 2B: Core directory contract (players). Each result is a current, discoverable\n"
           "  -- Core account; its local shadow identity is allocated exactly as the certified bridge does.\n"
           "  v_directory := private.consume_core_attestation(\n"
           "    'directory_players',\n"
           "    jsonb_build_object(\n"
           "      'organizationId', p_organization_id, 'tournamentId', p_tournament_id,\n"
           "      'teamEntryId', p_team_entry_id, 'query', btrim(p_query), 'limit', v_limit\n"
           "    )\n"
           "  );\n"
           "  insert into public.torneos_identity (core_user_id)\n"
           "  select (item->>'core_user_id')::uuid\n"
           "  from jsonb_array_elements(coalesce(v_directory->'items', '[]'::jsonb)) item\n"
           "  on conflict (core_user_id) do nothing;\n"
           "  select coalesce(jsonb_agg(jsonb_build_object(\n"
           "    'userId', identity.id,\n"
           "    'displayName', item->>'display_name',\n"
           "    'avatarUrl', item->'avatar_url',\n"
           "    'positions', coalesce(item->'positions', '[]'::jsonb),\n"
           "    'linkedAccount', true,\n"
           "    'teamName', null\n"
           "  ) order by item->>'display_name', identity.id), '[]'::jsonb)\n"
           "  into v_result\n"
           "  from jsonb_array_elements(coalesce(v_directory->'items', '[]'::jsonb)) item\n"
           "  join public.torneos_identity identity\n"
           "    on identity.core_user_id = (item->>'core_user_id')::uuid;\n")
    body = body[:start] + new + body[end:]
    return body, 'Phase 2B: players come from the attested Core directory contract; season access and 2..100 query length required; Core team name/priority not part of the contract (teamName null); local shadow identities allocated for results'


def wire_search_teams(body):
    name = 'search_tournament_arma2_teams'
    body = _replace(body, "declare v_result jsonb;\n",
                    "declare\n  v_result jsonb;\n  v_directory jsonb;\n  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 12);\n", name)
    body = _season_and_length(body, name, "\n        and status = 'registration'")
    start = body.index("  select coalesce(jsonb_agg(jsonb_build_object(\n    'id', team.id,")
    end = body.index("  ) team;\n", start) + len("  ) team;\n")
    new = ("  -- Phase 2B: Core directory contract (teams the caller may import). Colors/format are not\n"
           "  -- part of the certified contract and are null.\n"
           "  v_directory := private.consume_core_attestation(\n"
           "    'directory_teams',\n"
           "    jsonb_build_object(\n"
           "      'organizationId', p_organization_id, 'tournamentId', p_tournament_id,\n"
           "      'query', btrim(p_query), 'limit', v_limit\n"
           "    )\n"
           "  );\n"
           "  select coalesce(jsonb_agg(jsonb_build_object(\n"
           "    'id', item->>'core_team_id',\n"
           "    'name', item->>'name',\n"
           "    'crestUrl', item->'crest_url',\n"
           "    'primaryColor', null,\n"
           "    'secondaryColor', null,\n"
           "    'format', null\n"
           "  ) order by item->>'name', item->>'core_team_id'), '[]'::jsonb)\n"
           "  into v_result\n"
           "  from jsonb_array_elements(coalesce(v_directory->'items', '[]'::jsonb)) item;\n")
    body = body[:start] + new + body[end:]
    return body, 'Phase 2B: teams come from the attested Core directory contract (owner/admin importable, discoverable); season access and 2..100 query length required; colors/format null'


def wire_team_entry_import(body):
    """Applied after the Phase 2A season guard; replaces the historical Core team lookup."""
    name = 'create_tournament_team_entry'
    body = _replace(body, "  v_arma2_team public.teams%rowtype;\n", "  v_snapshot jsonb;\n", name)
    start = body.index("  if p_arma2_team_id is not null then\n    select * into v_arma2_team")
    # The nested missing-team IF is indented deeper; anchor the outer END IF on its exact indentation.
    end = body.index("\n  end if;\n", start) + len("\n  end if;\n")
    new = ("  if p_arma2_team_id is not null then\n"
           "    -- Phase 2B: frozen Core team snapshot attested for this actor, destination and team.\n"
           "    v_snapshot := private.consume_core_attestation(\n"
           "      'team_snapshot',\n"
           "      jsonb_build_object(\n"
           "        'organizationId', p_organization_id, 'tournamentId', p_tournament_id,\n"
           "        'categoryId', p_category_id, 'coreTeamId', p_arma2_team_id\n"
           "      )\n"
           "    );\n"
           "    if (v_snapshot->>'core_team_id')::uuid is distinct from p_arma2_team_id then\n"
           "      raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';\n"
           "    end if;\n"
           "    v_name := btrim(v_snapshot->>'name');\n"
           "  end if;\n")
    body = body[:start] + new + body[end:]
    old = "  ) returning * into v_entry;\n\n  insert into public.tournament_rosters (\n"
    new = ("  ) returning * into v_entry;\n\n"
           "  if p_arma2_team_id is not null then\n"
           "    insert into private.tournament_team_entry_core_snapshots (\n"
           "      team_entry_id, organization_id, tournament_id, core_team_id, name, crest_url,\n"
           "      players, source_revision, captured_at, imported_by\n"
           "    ) values (\n"
           "      v_entry.id, p_organization_id, p_tournament_id, p_arma2_team_id,\n"
           "      v_snapshot->>'name', v_snapshot->>'crest_url', coalesce(v_snapshot->'players', '[]'::jsonb),\n"
           "      (v_snapshot->>'source_revision')::integer, to_timestamp((v_snapshot->>'captured_at')::bigint), v_uid\n"
           "    );\n"
           "  end if;\n\n"
           "  insert into public.tournament_rosters (\n")
    body = _replace(body, old, new, name)
    return body, 'Phase 2B: Core team import consumes the attested frozen snapshot (name from Core, colors as submitted, candidates stored privately); manual/provisional flow and Phase 2A season guard retained'


WIRING = {
    'accept_tournament_team_invitation': wire_accept_invitation,
    'search_tournament_players': wire_search_players,
    'search_tournament_arma2_teams': wire_search_teams,
}
