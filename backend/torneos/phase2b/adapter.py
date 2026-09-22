"""Phase 2B server adapter: Phase 2A Core contract client -> SQL attestation -> historical RPC.

Gateway shape (Phase 1.5): the gateway verifies the local bearer, derives
sub/core_user_id/session_id from it, pre-authorizes with the adapter role, calls the
Core contract, appends one short-lived attestation, then proxies the unchanged RPC
request to PostgREST with the user's own bearer. This module models that sequence
against the local lab only: adapter steps run as torneos_core_adapter (the server
login's NOLOGIN membership) and the RPC runs as authenticated with the same claims
PostgREST would set. No remote target, environment lookup or browser credential.
"""
import json
import pathlib
import sys
import time

BASE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE / 'tools'))
sys.path.insert(0, str(BASE / 'phase2a'))
from lab import sql  # noqa: E402
from contracts import CoreClient, Denied  # noqa: E402

ROUTES = {'verified_email': '/v1/verified-email', 'directory_players': '/v1/directory',
          'directory_teams': '/v1/directory', 'team_snapshot': '/v1/team-snapshot'}


def lit(value):
    return "'" + str(value).replace("'", "''") + "'"


def as_user(claims, query, role='authenticated'):
    """PostgREST-equivalent execution of one client statement; returns result lines."""
    out = sql('baseline', 'BEGIN; SET LOCAL ROLE ' + role + '; SET LOCAL request.jwt.claims=' +
              lit(json.dumps(claims)) + '; ' + query + '; COMMIT;')
    return out.splitlines()[3:-1]


class Adapter:
    """Server-side steps. Never runs as the user; never bypasses the RPC's own checks."""

    def __init__(self, client):
        assert isinstance(client, CoreClient)
        self.client = client

    def _as_adapter(self, claims, statement):
        out = sql('baseline', 'BEGIN; SET LOCAL ROLE torneos_core_adapter; SET LOCAL request.jwt.claims=' +
                  lit(json.dumps(claims)) + '; ' + statement + '; COMMIT;')
        return out.splitlines()[3:-1]

    def authorize(self, claims, contract, request):
        rows = self._as_adapter(claims, 'select private.authorize_core_contract(' + lit(contract) + ',' +
                                lit(json.dumps(request)) + '::jsonb)')
        return json.loads(rows[0])

    def attest(self, claims, contract, request_hash, response, observed_at):
        self._as_adapter(claims, 'insert into private.core_contract_attestations'
                         '(identity_id,session_id,contract,request_hash,response,observed_at) values (' +
                         lit(claims['sub']) + ',' + lit(claims['session_id']) + ',' + lit(contract) + ',' +
                         lit(request_hash) + ',' + lit(json.dumps(response)) + '::jsonb,to_timestamp(' +
                         str(int(observed_at)) + '))')

    def prepare(self, claims, contract, request):
        """Local authorization first; Core second; attestation last. Any failure leaves nothing behind."""
        authorization = self.authorize(claims, contract, request)
        assert authorization['identity_id'] == claims['sub']
        response = self.client.call(ROUTES[contract], {
            'core_user_id': claims['core_user_id'], 'session_id': claims['session_id'],
            **authorization['core_request']})
        observed = response.get('checked_at', response.get('captured_at', int(time.time())))
        self.attest(claims, contract, authorization['request_hash'], response, observed)
        return authorization


class Gateway:
    """The four historical RPC routes as the gateway would serve them."""

    def __init__(self, adapter):
        self.adapter = adapter

    def accept_invitation(self, claims, token):
        self.adapter.prepare(claims, 'verified_email', {'token': token})
        return json.loads(as_user(claims, 'select public.accept_tournament_team_invitation(' + lit(token) + ')')[0])

    def search_players(self, claims, organization_id, tournament_id, query, limit=8, team_entry_id=None):
        self.adapter.prepare(claims, 'directory_players', {
            'organization_id': organization_id, 'tournament_id': tournament_id,
            'team_entry_id': team_entry_id, 'query': query, 'limit': limit})
        return json.loads(as_user(claims, 'select public.search_tournament_players(' + lit(organization_id) + ',' +
                                  lit(tournament_id) + ',' + lit(query) + ',' + str(int(limit)) + ',' +
                                  ('null' if team_entry_id is None else lit(team_entry_id)) + ')')[0])

    def search_teams(self, claims, organization_id, tournament_id, query, limit=8):
        self.adapter.prepare(claims, 'directory_teams', {
            'organization_id': organization_id, 'tournament_id': tournament_id, 'query': query, 'limit': limit})
        return json.loads(as_user(claims, 'select public.search_tournament_arma2_teams(' + lit(organization_id) + ',' +
                                  lit(tournament_id) + ',' + lit(query) + ',' + str(int(limit)) + ')')[0])

    def import_team(self, claims, organization_id, tournament_id, category_id, core_team_id, idempotency_key,
                    primary_color=None, secondary_color=None):
        self.adapter.prepare(claims, 'team_snapshot', {
            'organization_id': organization_id, 'tournament_id': tournament_id,
            'category_id': category_id, 'core_team_id': core_team_id})
        return json.loads(as_user(claims, 'select public.create_tournament_team_entry(' + lit(organization_id) + ',' +
                                  lit(tournament_id) + ',' + lit(category_id) + ',' + lit(core_team_id) +
                                  ",null,null," + ('null' if primary_color is None else lit(primary_color)) + ',' +
                                  ('null' if secondary_color is None else lit(secondary_color)) +
                                  ",'arma2_team',null,null,null," + lit(idempotency_key) + ')')[0])


__all__ = ['Adapter', 'Gateway', 'Denied', 'as_user', 'lit']
