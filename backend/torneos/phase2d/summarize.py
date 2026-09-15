"""Phase 2D conclusion and residual-risk ledger, computed from the evidence files (never asserted by hand).

Objective: close ONLY the residual risk of the 33 SECURITY DEFINER RPCs left INCONCLUSIVE /
NOT_EXERCISED — certify the one the staging v1 feature set needs (review_tournament_team_entry)
and make the other 32 technically unreachable for a staging v1 client (DB ACL + gateway
allowlist), with the one parent path that reached them. PASS (A) requires every condition
below; otherwise (B) BLOCKED with the failed conditions listed.
"""
import hashlib
import json
import pathlib

BASE = pathlib.Path(__file__).resolve().parents[1]
ROOT = BASE.parents[1]
LAB = ROOT / 'integration/torneos-core-contracts'
PHASE2C_BASELINE_SHA = '97634b658c91b620c60bdceb53c9638a601fa7aba01ae3a999e6857e37d08692'
P0 = 'review_tournament_team_entry'


def load(path):
    return json.loads(path.read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


baseline_sha = sha(BASE / 'supabase/migrations/00000000000000_torneos_baseline_v1.sql')
gate_sha = sha(BASE / 'supabase/migrations/00000000000001_staging_v1_rpc_exposure.sql')
gate = load(BASE / 'phase2d/staging-v1-rpc-gate.json')
allow = load(BASE / 'phase2d/staging-v1-rpc-allowlist.json')
ALLOW = [n for v in allow['features'].values() for n in v]
acl_diff = load(BASE / 'phase2d/evidence/real-image-acl-diff.json')
ledger3a = load(BASE / 'phase3a/inconclusive-ledger.json')
differences = {d['function']: d['change'] for d in load(BASE / 'evidence/intentional-function-differences.json')}
review = {f['name']: f for f in load(BASE / 'evidence/security-definer-review.json')['functions']}
phase2b = load(BASE / 'phase2b/results.json')
sweep = phase2b['season_scope_sweep']
exposure = load(LAB / 'evidence/exposure-results.json')
acl33 = load(LAB / 'evidence/exposure-acl-33.json')['functions']
p0 = load(LAB / 'evidence/exposure-p0-matrix.json')
gw = load(LAB / 'evidence/exposure-gateway-sweep.json')['rows']
pg = load(LAB / 'evidence/exposure-postgrest-sweep.json')['rows']
acl = load(LAB / 'evidence/acl-results.json')
recert = load(LAB / 'evidence/acl-security-definer-recert.json')
e2e = load(LAB / 'evidence/e2e-results.json')
finding = load(LAB / 'evidence/finding-p3a-f1.json')
install = load(LAB / 'evidence/install.json')
core_unit = (LAB / 'evidence/core-unit-tests.txt').read_text()
edge = (LAB / 'evidence/edge-suite-tests.txt').read_text()
guard = (LAB / 'evidence/migrations-guard.txt').read_text()

GATED = [g['name'] for g in gate['functions']]
by_name = {r['name']: r for r in acl33}
p0_rows = p0['rows']
denies = [r for r in p0_rows if r.get('result') == 'DENY']
passes = [r for r in p0_rows if r.get('result') == 'PASS' and r.get('decision') in ('approved', 'changes_requested', 'rejected')]
conditions = {
    'base_is_phase2c_992dd282': install['torneos']['certified_sha256'] == baseline_sha and baseline_sha != PHASE2C_BASELINE_SHA,
    'only_p0_body_changed_in_baseline': [k for k, v in differences.items() if 'Phase 2D' in v] == [P0],
    'gate_migration_installed_after_baseline': [(m['file'].split('/')[-1], m['sha256'], m['applied']) for m in install['torneos']['migrations_after_baseline']] == [('00000000000001_staging_v1_rpc_exposure.sql', gate_sha, True)],
    'gate_is_32_off_plus_parent_paths': gate['off_functions'] == 32 and gate['gated_count'] == 33 and gate['parent_paths'] == 1,
    'real_image_before_after_checks': all(acl_diff['checks'].values()),
    'acl_after_only_review_keeps_authenticated': [r['name'] for r in acl33 if r['after_live']['authenticated']] == [P0] and all(not r['after_live']['anon'] and r['after_live']['service_role'] for r in acl33),
    'acl_before_all_33_authenticated_at_992dd282': all(r['before_992dd282']['authenticated'] for r in acl33),
    'allowlist_disjoint_from_gate_and_off': not (set(ALLOW) & set(GATED)) and P0 in ALLOW and len(ALLOW) == len(set(ALLOW)),
    'p0_season_rule_applied': 'has_tournament_season_access' in review[P0]['authorization_evidence']['direct_guards'] and 'Phase 2D' in review[P0]['authorization_evidence']['season_rule'],
    'p0_pass_matrix': sorted(r['actor'] for r in passes) == sorted(['owner (gateway, real Core session)', 'owner', 'owner', 'admin seated on season A', 'admin seated on season B (season B entry)']) and {r['decision'] for r in passes} == {'approved', 'changes_requested', 'rejected'},
    'p0_deny_matrix': len(denies) >= 10 and all(r['status'] in (401, 403) for r in denies),
    'p0_invalid_payload_and_roster_atomic': sorted({r['result'] for r in p0_rows if r.get('result', '').startswith('REJECTED')}) == ['REJECTED_22023', 'REJECTED_23514'],
    'wrappers_service_role_only_and_delegating': any(r.get('decision') == 'approve/reject wrappers' for r in p0_rows) and review['approve_tournament_team_entry']['category'] == 'SERVICE_ONLY' and review['reject_tournament_team_entry']['category'] == 'SERVICE_ONLY',
    'direct_postgrest_deny_33_anon_and_authenticated': len(pg) == 66 and all(r['verdict'] == 'DENIED_BEFORE_BODY' for r in pg),
    'gateway_deny_33_valid_core_session': len(gw) == 33 and all(r['post'] == [403, 'rpc not enabled'] and r['get'][0] == 403 for r in gw),
    'exposure_suite_pass': exposure['fail'] == 0 and exposure['pass'] >= 18,
    'phase2c_acl_suite_pass': acl['fail'] == 0 and acl['pass'] >= 16,
    'p3a_f1_closed': 'CLOSED' in finding['status'] and finding['phase2c_observed']['anon_execute_public_functions'] == '12/359',
    'phase3a_e2e_no_regression': e2e['fail'] == 0 and e2e['pass'] >= 40 and not any(r['status'] == 'FINDING' for r in e2e['results']),
    'core_unit_pass': 'ℹ pass 15' in core_unit and 'ℹ fail 0' in core_unit,
    'edge_suite_pass': 'ℹ pass 76' in edge and 'ℹ fail 0' in edge,
    'migrations_guard_ok': 'OK' in guard and 'ℹ fail 0' in guard,
    'security_definer_305_disposition': recert['total'] == 305 and recert['maintained'] == 305 and recert['staging_v1_gated'] == 33,
    'season_and_workspace_isolation': sweep['LEAK'] == 0 and sweep['ORG_LEAK'] == 0 and sweep['SCOPED'] >= 100 and phase2b['conclusion'].startswith('A)'),
    'core_contracts_sso_revocation': all(r['status'] == 'PASS' for r in e2e['results'] if any(k in r['name'] for k in ('verified email', 'logout', 'directory', 'team snapshot', 'revok'))),
    'no_privilege_escalation_no_secrets': all(r['status'] == 'PASS' for r in acl['results'] if r['name'].startswith(('no privilege escalation', 'no secrets'))) and all(r['status'] == 'PASS' for r in exposure['results'] if r['name'].startswith('no secrets')),
    'staging_v1_features_work': all(r['status'] == 'PASS' for r in exposure['results'] if r['name'].startswith(('fixture:', 'staging v1 features'))),
}
failed = [k for k, v in conditions.items() if not v]

# ---------------------------------------------------------------- residual-risk ledger
entries = []
for f in ledger3a['functions']:
    name = f['function'].split('(')[0]
    row = by_name[name]
    common = {'function': f['function'], 'area': f['area'], 'phase2b_verdict': f['phase2b_verdict'], 'phase3a_status': f['phase3a_status'],
              'acl_before_992dd282': row['before_992dd282'], 'acl_after_phase2d': row['after_live']}
    if name == P0:
        entries.append({**common, 'phase2d_status': 'CERTIFIED',
            'certified_on': 'real Supabase stack (PostgREST + gateway + real Core session), fixture built through the allowlisted RPCs',
            'fix': 'season rule R3-2D (generator): organization capability AND has_tournament_season_access(entry season); the CASE capability argument had escaped the Phase 2B R2 pattern',
            'matrix': {'pass': [r['actor'] + ' / ' + r['decision'] for r in passes], 'deny': [r['actor'] for r in denies],
                       'rejected': [r.get('payload') for r in p0_rows if r.get('result', '').startswith('REJECTED')]},
            'wrappers': 'approve_tournament_team_entry / reject_tournament_team_entry: SERVICE_ONLY (no client EXECUTE, not allowlisted); as service_role with an identity they delegate to review and inherit its guards',
            'gateway_allowlisted': True, 'evidence': ['integration/torneos-core-contracts/evidence/exposure-p0-matrix.json', 'integration/torneos-core-contracts/evidence/exposure-results.json']})
    else:
        notes = []
        if name == 'update_draft_fixture':
            notes.append('season rule NOT applied by the generator (CASE capability argument escapes the R2 pattern, same class as the P0); must receive the rule and a fixture before its feature is enabled')
        if name == 'schedule_tournament_match':
            notes.append('reachable internally from auto_schedule_tournament_matches (client RPC, SCOPED in Phase 2B): that parent is gated too')
        entries.append({**common, 'phase2d_status': 'NOT_EXERCISED — SERVER-SIDE DISABLED FOR STAGING V1',
            'db_gate': 'REVOKE EXECUTE FROM anon, authenticated (00000000000001_staging_v1_rpc_exposure.sql); service_role kept',
            'gateway_allowlisted': False,
            'direct_postgrest': {r['role']: r['verdict'] for r in pg if r['function'] == name},
            'gateway_valid_core_session': next(r['post'] for r in gw if r['function'] == name),
            're_enable_requires': 'fixture/test certification of this function + explicit GRANT migration after the gate + allowlist entry',
            'notes': notes})
for g in gate['functions']:
    if g['area'] == 'parent path':
        row = by_name[g['name']]
        entries.append({'function': g['function'], 'area': 'parent path', 'phase2b_verdict': 'SCOPED', 'phase3a_status': 'n/a (not in the 33)',
            'acl_before_992dd282': row['before_992dd282'], 'acl_after_phase2d': row['after_live'],
            'phase2d_status': 'GATED FOR STAGING V1 (parent path)', 'reason': g['reason'],
            'db_gate': 'REVOKE EXECUTE FROM anon, authenticated; service_role kept', 'gateway_allowlisted': False,
            'direct_postgrest': {r['role']: r['verdict'] for r in pg if r['function'] == g['name']},
            'gateway_valid_core_session': next(r['post'] for r in gw if r['function'] == g['name']),
            're_enable_requires': 'enable schedule_tournament_match first (its own certification), then GRANT + allowlist'})
residual = {
    'phase': '2D', 'source': 'backend/torneos/phase3a/inconclusive-ledger.json (33) + phase2d/staging-v1-rpc-gate.json (parent path)',
    'summary': {'certified': 1, 'not_exercised_server_side_disabled': 32, 'parent_paths_gated': 1,
                'rule': 'A disabled function must be certified with its own fixture/test before a GRANT migration and an allowlist entry re-enable it.'},
    'functions': entries,
}
(BASE / 'phase2d/residual-ledger.json').write_text(json.dumps(residual, indent=2, ensure_ascii=False) + '\n')

result = {
    'conclusion': 'A) STAGING RPC EXPOSURE GATE PASS' if not failed else 'B) BLOCKED',
    'failed_conditions': failed,
    'conditions': conditions,
    'objective': 'Close only the residual risk of the 33 INCONCLUSIVE / NOT_EXERCISED SECURITY DEFINER RPCs for staging v1: certify the P0, disable the other 32 server-side (DB ACL + gateway allowlist), gate the parent path.',
    'branch': 'claude/arma2-phase-2d-rpc-exposure-a542ad',
    'base_commit': '992dd282 (Phase 2C HEAD)',
    'baseline_sha256': {'phase2c': PHASE2C_BASELINE_SHA, 'phase2d': baseline_sha},
    'gate_migration_sha256': gate_sha,
    'solution': {
        'db': 'migration 00000000000001_staging_v1_rpc_exposure.sql (generated by phase2d/build_gate.py): REVOKE EXECUTE FROM anon, authenticated on the 32 OFF RPCs + the parent auto_schedule_tournament_matches; service_role kept; idempotent; fail-closed pre/postconditions',
        'gateway': 'staging v1 RPC allowlist (phase2d/staging-v1-rpc-allowlist.json, 43 RPCs by feature) enforced in gateway.mjs on /torneos/rest/v1/rpc/<name> after bearer verification, before the session/identity checks',
        'p0': 'generator R3-2D anchored edit (phase2d/season-scope-edits.json) so review_tournament_team_entry requires the actor\'s season assignment; baseline regenerated',
    },
    'effective_execute_by_role_on_real_image': {'before(992dd282)': acl_diff['runs']['before-real']['execute'], 'after(phase2d + gate)': acl_diff['runs']['after-real']['execute']},
    'real_vs_template0': {'objects_compared': acl_diff['real_vs_template0_objects_compared'], 'api_privilege_mismatches': len(acl_diff['real_vs_template0_api_privilege_mismatches'])},
    'allowlist': {'total': len(ALLOW), 'features': {k: len(v) for k, v in allow['features'].items()}, 'exercised_through_gateway_by_exposure_suite': p0['coverage']['exercised_through_gateway']},
    'p0_matrix': {'pass': len(passes), 'deny': len(denies), 'rejected_payloads': len([r for r in p0_rows if r.get('result', '').startswith('REJECTED')])},
    'sweeps': {'direct_postgrest_rows': len(pg), 'gateway_rows': len(gw)},
    'regression': {
        'exposure_suite': {'pass': exposure['pass'], 'fail': exposure['fail']},
        'phase2c_acl_suite': {'pass': acl['pass'], 'fail': acl['fail']},
        'phase3a_e2e': {'pass': e2e['pass'], 'fail': e2e['fail']},
        'phase2b_recert': phase2b['conclusion'],
        'security_definer_recert': {'total': recert['total'], 'maintained': recert['maintained'], 'staging_v1_gated': recert['staging_v1_gated']},
        'season_scope_sweep': sweep,
        'core_unit': '15/15', 'edge_suite': '76/76', 'migrations_guard': 'OK',
    },
    'residual_ledger': residual['summary'],
    'scope': 'Non-production only. No staging, no Production, no deploy, no Mercado Pago, no SSO change, no Core-contract change.',
}
(BASE / 'phase2d/results.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
print(json.dumps({'conclusion': result['conclusion'], 'failed_conditions': failed}))
