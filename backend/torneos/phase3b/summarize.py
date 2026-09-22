"""Phase 3B conclusion, computed from the evidence files (never asserted by hand).

Tri-state (decision 2026-09-15: hybrid non-production architecture, remote Torneos project deferred):
  local_conditions            — the Edge gateway port certified ≡ the Node gateway on the certified lab
                                (15 conditions, unchanged);
  hybrid_conditions           — R1 (Core staging identified), R2-LOCAL (isolated Torneos stack:
                                bootstrap hash-pinned, shared catalog contract 16/16, 479/0 ACL
                                equivalence, data API, isolation, reset reproducibility, offline
                                tests, zero remote requests), then R3 (Core contract v1+v1.1 on Core
                                staging: STRICT — migrations + CLI-shaped ledger rows, deployed function
                                + signed harness 9/9 exact, ACL probe, rollback rehearsed offline, D1
                                positive; a 503/404 or a dry-run is never "deployed"), R4 (local gateway
                                ↔ remote Core), R5 (hybrid E2E), B04;
  remote_to_remote_conditions — the remote Torneos project, remote bootstrap, hosted gateway, remote
                                certify and B03: DEFERRED to the final pre-launch gate; NEVER blocking.
Conclusion: HYBRID_REMOTE_LOCAL_CERTIFIED when every local + hybrid condition holds, otherwise
HYBRID_BLOCKED with the failing/pending names. remote_to_remote.status is always
REMOTE_TO_REMOTE_PENDING_PRELAUNCH until that gate runs. The 17.6.1.147 drift run is reported as
informative only (drift_informative.blocking = false). Missing evidence is a pending condition,
listed by name, never inferred.
"""
import glob
import hashlib
import json
import pathlib
import re

BASE = pathlib.Path(__file__).resolve().parents[1]
ROOT = BASE.parents[1]
LAB = ROOT / 'integration/torneos-core-contracts'
EVID = BASE / 'phase3b/evidence'


def load(path):
    return json.loads(pathlib.Path(path).read_text())


def latest(pattern):
    files = sorted(glob.glob(str(EVID / pattern)))
    return load(files[-1]) if files else None


def counts(txt):
    t = pathlib.Path(txt).read_text() if pathlib.Path(txt).exists() else ''
    p = re.search(r'ℹ pass (\d+)', t)
    f = re.search(r'ℹ fail (\d+)', t)
    return (int(p.group(1)) if p else 0, int(f.group(1)) if f else -1)


def sha(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


e2e_node = load(LAB / 'evidence/e2e-results.json')
e2e_edge = load(LAB / 'evidence/e2e-results-edge.json')
exp_node = load(LAB / 'evidence/exposure-results.json')
exp_edge = load(LAB / 'evidence/exposure-results-edge.json')
equiv = load(LAB / 'evidence/equivalence-results.json')
d1 = load(LAB / 'evidence/d1-session-authority.json') if (LAB / 'evidence/d1-session-authority.json').exists() else None
d1_tests = counts(LAB / 'evidence/d1-tests.txt')
# Operator decision on D1 (2026-09-15): recorded as evidence, never asserted here. It is bound to
# the evidence VALUES it was taken on: a re-run that changes them makes the decision stale.
d1_decision = load(EVID / 'd1-decision.json') if (EVID / 'd1-decision.json').exists() else None
D1_REQUIRED_SEMANTICS = {
    'every authenticated Torneos request requires a CURRENT Core session verdict',
    'Core contract unavailable → 503 CORE_UNAVAILABLE',
    'never serve with a stale session',
    'revocation / ban / soft-delete stay immediate (next request)',
    'no verdict cache',
    'no DB-to-DB between Torneos and Core',
    'no Core service_role in Torneos',
}
d1_decision_current = bool(d1 and d1_decision) and all(d1['summary'].get(k) == v for k, v in d1_decision['basis']['summary_expected'].items())
d1_accepted = bool(d1_decision) and d1_decision.get('decision') == 'ACCEPTED' \
    and d1_decision.get('classification') == 'KNOWN AVAILABILITY TRADE-OFF, NOT SECURITY REGRESSION' \
    and set(d1_decision.get('approved_remote_semantics', [])) == D1_REQUIRED_SEMANTICS \
    and set(d1_decision.get('alternatives_rejected', [])) == set('ABCDEF') \
    and d1_decision_current
sweep_edge = load(LAB / 'evidence/exposure-gateway-sweep-edge.json')
port_tests = counts(EVID / 'gateway-port-tests.txt')
inventory_tests = counts(EVID / 'inventory-harness-tests.txt')
core_unit = counts(EVID / 'core-unit-tests.txt')
guard = (EVID / 'migrations-guard.txt').read_text() if (EVID / 'migrations-guard.txt').exists() else ''

fn_dir = BASE / 'supabase/functions/torneos-gateway'
copies_in_sync = (
    sha(fn_dir / 'staging-v1-rpc-allowlist.json') == sha(BASE / 'phase2d/staging-v1-rpc-allowlist.json')
    and sha(fn_dir / 'schemas.json') == sha(BASE / 'phase2a/schemas.json')
    and sha(fn_dir / 'session.schema.json') == sha(BASE / 'phase3b/contracts/session.schema.json')
)
baseline_sha = sha(BASE / 'supabase/migrations/00000000000000_torneos_baseline_v1.sql')
gate_sha = sha(BASE / 'supabase/migrations/00000000000001_staging_v1_rpc_exposure.sql')
CERTIFIED = {
    'baseline': 'f857bd0939054bc1a32a3855894b7b20e14a0c7456c9d5c8c5e8432e5b8ed19f',
    'gate': '3df4b96eecc7321eaeda84a480f089fe4bff2b28c20aa4479db92caf33457e62',
    'verify_sql_rendered': '0d6ef458d0d46375d8332c6a85e014597a7d30f0d4891d1b62e12df88c9c844c',
    'expect': '2c0772c2bda3433e60a44c00b62a8ef79de976c205a7a88379c9e44dfdb81118',
    'image_id': 'sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453',
}
expect_sha = sha(BASE / 'phase3b/contracts/torneos-bootstrap-expect.json')

local = {
    'edge_gateway_e2e_40_checks_pass': e2e_edge['gateway'] == 'edge' and e2e_edge['fail'] == 0 and e2e_edge['pass'] == 40,
    'node_gateway_e2e_regression_pass': e2e_node['fail'] == 0 and e2e_node['pass'] == 40,
    'edge_gateway_exposure_pass': exp_edge.get('gateway') == 'edge' and exp_edge['fail'] == 0,
    'node_gateway_exposure_pass': exp_node['fail'] == 0,
    'edge_32_off_plus_parent_403_post_and_get': len(sweep_edge['rows']) == 33 and all(r['post'][0] == 403 and r['get'][0] == 403 and r['post'][1] == 'rpc not enabled' for r in sweep_edge['rows']),
    'node_vs_edge_equivalence_only_documented_D1': equiv['compared'] >= 100 and equiv['equivalent'] == equiv['compared'] - len(equiv['differences']) and all(d['documented'] == 'D1' and d.get('justification') and d.get('counterpart') for d in equiv['differences']),
    # D1 review: the counterpart suite (d1.test.mjs) must show that neither gateway serves a
    # session-gated request without the online Core verdict, that nothing is cached, and that the
    # difference is the verdict transport — otherwise D1 would be an undocumented regression.
    'd1_counterpart_evidence_pass': d1 is not None and d1_tests[1] == 0 and d1_tests[0] >= 6
        and d1['summary'].get('node_serves_without_online_verdict') is False
        and d1['summary'].get('edge_serves_without_online_verdict') is False
        and d1['summary'].get('edge_session_verdicts_per_gated_request') == 1
        and d1['summary'].get('node_session_verdicts_via_contract') == 0
        and d1['summary'].get('gotrue_user_alone_refuses') == {'not_after': False, 'banned': False, 'soft_deleted': False, 'logout': True},
    # The operator accepted D1 as a known availability trade-off bound to the evidence above;
    # the approved remote semantics are the ones the Edge gateway already implements (no cache,
    # 503 CORE_UNAVAILABLE, immediate revocation). Alternatives A–F are rejected, not deferred.
    'd1_operator_decision_accepted_and_current': d1_accepted,
    'offline_port_unit_tests_pass': port_tests == (5, 0),
    'inventory_harness_tests_pass': inventory_tests[1] == 0 and inventory_tests[0] >= 12,
    'core_contract_v1_1_unit_tests_pass': core_unit[1] == 0 and core_unit[0] >= 77,
    'migrations_guard_ok': 'Exactly the approved canonical migrations are present' in guard,
    'bundled_documents_byte_identical': copies_in_sync,
    'baseline_is_phase2d_certified': baseline_sha == CERTIFIED['baseline'],
    'gate_is_phase2d_certified': gate_sha == CERTIFIED['gate'],
}

inv = latest('remote-inventory-*.json')
created = latest('project-create-*.json')
boot = latest('bootstrap-*.json')
core = latest('core-contract-*.json')
gw = latest('gateway-deploy-*.json')
cert = latest('remote-certify-*.json')
# R2-LOCAL evidence (prefix local-torneos-: never matched by the remote globs above).
lboot = latest('local-torneos-bootstrap-*.json')
lcerts = [load(f) for f in sorted(glob.glob(str(EVID / 'local-torneos-certify-*.json')))]
lcert = lcerts[-1] if lcerts else None
ldrift = latest('local-torneos-drift-*.json')
local_tests = counts(EVID / 'local-torneos-tests.txt')


def cert_check(name_prefix, ok):
    if not cert:
        return False
    rows = [c for c in cert['checks'] if c['name'].startswith(name_prefix)]
    return bool(rows) and all(ok(c) for c in rows)


def lcert_section(section):
    if not lcert:
        return False
    rows = [c for c in lcert['checks'] if c['section'] == section]
    return bool(rows) and all(c['ok'] for c in rows)


def reset_reproducible():
    # Two certify runs from two different fresh bootstraps (distinct run stamps) with identical
    # catalog and api_view hashes: run 1 → reset → run 2.
    good = [c for c in lcerts if c.get('ok') and c.get('catalog_hash') and c.get('api_view_sha256')]
    if len(good) < 2:
        return False
    a, b = good[-2], good[-1]
    return a['bootstrap_run']['stamp'] != b['bootstrap_run']['stamp'] and a['catalog_hash'] == b['catalog_hash'] and a['api_view_sha256'] == b['api_view_sha256']


# ───────────────────────── R3 strict evaluation (decision B.2, 2026-09-15): summarize_r3.py ─────────────────────────
import sys
sys.path.insert(0, str(BASE / 'phase3b'))
import summarize_r3 as r3  # noqa: E402

r3_manifest = r3.r3_manifest
r3_deploy_files = r3.r3_deploy_files
r3_migrations_recorded = r3.r3_migrations_recorded
r3_function_signed_harness = r3.r3_function_signed_harness
r3_acl_certified = r3.r3_acl_certified
r3_rollback_rehearsed = r3.r3_rollback_rehearsed
r3_d1_positive = r3.r3_d1_positive
r3_tooling_tests = counts(EVID / 'r3-tooling-tests.txt')
r3_rehearsal = latest('r3-offline-rehearsal-*.json')
r3_pf_failed = latest('r3-preflight-failed-*.json')
d1_positive = latest('d1-positive-*.json')


hybrid = {
    # R1 — executed by the operator (2026-09-15): Core staging identified, Production denylisted.
    'r1_remote_inventory_written_by_operator': inv is not None and inv.get('read_only') is True,
    'r1_production_classified_and_not_targeted': inv is not None and inv.get('projects', {}).get('production_present') is True and all(i.get('ref') != 'rcyuuoaqfwcembdajcss' for i in inv.get('inventories', [])),
    # R2-LOCAL — the isolated Torneos stack.
    'r2_local_bootstrap_hash_pinned_verified': lboot is not None and lboot.get('ok') is True and lboot.get('image_id') == CERTIFIED['image_id']
        and lboot.get('baseline_sha256') == CERTIFIED['baseline'] and lboot.get('gate_sha256') == CERTIFIED['gate']
        and lboot.get('verify_sql_sha256') == CERTIFIED['verify_sql_rendered'] and lboot.get('expect_sha256') == CERTIFIED['expect'] == expect_sha
        and lboot.get('expectations_passed') == lboot.get('expectations_total') == 16 and lboot.get('install', {}).get('installer') == 'supabase_admin'
        and lboot.get('isolation_preflight', {}).get('findings') == [] and lboot.get('target', {}).get('remote_requests') == 0,
    'r2_local_catalog_16_16_shared_contract': lcert_section('A') and lcert is not None and len([r for r in lcert['catalog']['expectations'] if r['ok']]) == 16
        and lcert['verify_sql_sha256'] == CERTIFIED['verify_sql_rendered'] and lcert['expect_sha256'] == CERTIFIED['expect'],
    'r2_local_acl_equivalent_479_objects_0_mismatches': lcert_section('B') and lcert is not None and lcert['equivalence']['compared'] == 479 and lcert['equivalence']['mismatches'] == [],
    'r2_local_data_api_33_gated_denied_p0_reaches_body_forged_401': lcert_section('C') and lcert is not None
        and len([r for r in lcert['data_api']['gated_sweep'] if r['verdict'] == 'DENIED_BEFORE_BODY']) == 66
        and lcert['data_api']['p0']['authenticated']['reached_body'] is True and all(r['ok'] for r in lcert['data_api']['forged_bearers'])
        and lcert['data_api']['identity_rows'] == 0 and lcert['data_api']['allowlist']['size'] == 43,
    'r2_local_isolation_no_core_no_egress_no_network_extensions': lcert_section('D') and lcert is not None
        and lcert['isolation']['database']['foreign_servers'] == 0 and lcert['isolation']['database']['fk_leaving_torneos'] == 0
        and lcert['isolation']['egress_from_db']['default_routes'] == 0,
    'r2_local_reset_reproducible_run1_eq_run2': reset_reproducible(),
    'r2_local_offline_tests_pass': local_tests[1] == 0 and local_tests[0] >= 7,
    'r2_local_zero_remote_requests': lcert is not None and lcert['http_requests']['remote'] == 0 and lcert['http_requests']['hosts'] == ['127.0.0.1:58430'],
    # R3 — Core contract v1 + v1.1 on Core staging (remote, operator-run). STRICT: a dry-run, a
    # 503/404 answer, a missing ledger row or a mismatching ACL is never "deployed".
    'r3_tooling_offline_tests_pass': r3_tooling_tests[1] == 0 and r3_tooling_tests[0] >= 20 and inventory_tests[1] == 0 and inventory_tests[0] >= 20,
    'r3_rollback_prepared_and_rehearsed_offline': r3_rollback_rehearsed(r3_rehearsal),
    'r3_core_contract_migrations_and_ledger_rows_on_core_staging': r3_migrations_recorded(core),
    'r3_core_contract_function_signed_harness_9_exact_answers': r3_function_signed_harness(core),
    'r3_core_contract_acl_anon_authenticated_service_role_certified': r3_acl_certified(core),
    'r3_d1_positive_login_session_200_logout_403_session_gone': r3_d1_positive(d1_positive),
    # R4 — the Edge gateway on the local stack against the REMOTE Core contract (evidence not yet defined: local-torneos-gateway-*.json).
    'r4_torneos_gateway_local_against_core_remote': False,
    # R5 — hybrid E2E: Core staging remote ↔ Torneos local (evidence not yet defined: local-torneos-e2e-*.json).
    'r5_hybrid_e2e_core_remote_torneos_local_pass': False,
    'r5_review_tournament_team_entry_certified_hybrid': False,
    # B04 — frontend dual-backend for the staging v1 scope (not started).
    'b04_frontend_dual_backend_build_certified': False,
}

remote_to_remote = {
    'torneos_nonprod_project_created': created is not None and created['project']['classification'] == 'NON_PRODUCTION',
    'torneos_remote_bootstrap_verified_shared_contract': boot is not None and boot['verification']['public_functions'] == 359 and boot['verification']['gated_authenticated_execute'] == 0 and boot['verification']['anon_execute'] == 12
        and boot.get('verify_sql_sha256') == CERTIFIED['verify_sql_rendered'] and boot.get('expect_sha256') == CERTIFIED['expect'],
    'torneos_gateway_deployed_hosted': gw is not None and gw.get('mode') != '--dry-run' and gw.get('probes', {}).get('health') == '200',
    'remote_sso_exchange_pass': cert_check('exchange (Core session', lambda c: c['status'] == 200),
    'remote_allowlisted_rpc_pass_B03_closed': cert_check('allowlisted RPC via gateway', lambda c: c['status'] == 200),
    'remote_32_off_plus_parent_deny': cert_check('gateway sweep', lambda c: c['status'] == 200 and c['body'].get('all_403_rpc_not_enabled') is True),
    'remote_direct_postgrest_deny': cert_check('direct PostgREST: anon key only', lambda c: c['status'] == 200),
    'remote_logout_revocation_pass': cert_check('after logout', lambda c: c['status'] in (401, 403)),
    'remote_review_tournament_team_entry_certified': False,   # requires the remote fixture run, not yet written
    'remote_core_contracts_e2e_pass': False,                  # requires the remote E2E fixture run
}

failed_local = [k for k, v in local.items() if not v]
failed_hybrid = [k for k, v in hybrid.items() if not v]
pending_r2r = [k for k, v in remote_to_remote.items() if not v]
conclusion = 'HYBRID_REMOTE_LOCAL_CERTIFIED' if not failed_local and not failed_hybrid else 'HYBRID_BLOCKED'
drift = ({'status': 'NOT_RUN', 'blocking': False} if not ldrift else {
    'status': ldrift.get('status'), 'blocking': False, 'informative': True, 'image': ldrift.get('image'), 'image_id': ldrift.get('image_id'),
    'server_version': ldrift.get('server_version'), 'compared': (ldrift.get('equivalence_vs_certified') or {}).get('compared'),
    'mismatches': len((ldrift.get('equivalence_vs_certified') or {}).get('mismatches', [])), 'expectations_passed': ldrift.get('expectations_passed'),
    'material_difference': ldrift.get('material_difference'), 'generated_at': ldrift.get('generated_at')})
results = {
    'phase': '3B',
    'base': '2058da03 (Phase 2D)',
    'architecture': 'HYBRID non-production: Core staging REMOTE (hhyvmhgpapyuzjgxfnqv) ↔ Torneos ISOLATED LOCAL (arma2-torneos-isolated-local); remote-to-remote deferred to the final pre-launch gate',
    'conclusion': conclusion,
    'local_conditions': local,
    'hybrid_conditions': hybrid,
    'remote_to_remote_conditions': remote_to_remote,
    'remote_to_remote': {'status': 'REMOTE_TO_REMOTE_PENDING_PRELAUNCH', 'blocking': False, 'pending': pending_r2r,
                         'note': 'Creating the remote Torneos project (R2 remote) and certifying remote-to-remote is the FINAL PRE-LAUNCH GATE; it does not block development or the functional/architectural certification.'},
    'blocking_conditions': failed_local + failed_hybrid,
    'drift_informative': drift,
    'documented_differences': equiv['differences'],
    'd1_review': {
        'status': ('ACCEPTED — known availability trade-off, not a security regression (operator decision %s)' % d1_decision.get('decided_at')) if d1_accepted
                  else ('STALE — evidence changed since the operator decision; re-confirm' if d1_decision and not d1_decision_current
                  else 'STOP — incompatibility documented, operator decision pending'),
        'decision': d1_decision,
        'conclusion': d1['conclusion'] if d1 else None, 'summary': d1['summary'] if d1 else None},
    'evidence': {
        'e2e_node': f"{e2e_node['pass']}/{e2e_node['pass'] + e2e_node['fail']}",
        'e2e_edge': f"{e2e_edge['pass']}/{e2e_edge['pass'] + e2e_edge['fail']}",
        'exposure_node': f"{exp_node['pass']}/{exp_node['pass'] + exp_node['fail']}",
        'exposure_edge': f"{exp_edge['pass']}/{exp_edge['pass'] + exp_edge['fail']}",
        'equivalence': f"{equiv['equivalent']}/{equiv['compared']} identical, {len(equiv['differences'])} instances of the single justified difference D1",
        'd1_counterpart': f"{d1_tests[0]}/{d1_tests[0] + max(d1_tests[1], 0)}" if d1 else None,
        'baseline_sha256': baseline_sha,
        'gate_sha256': gate_sha,
        'verify_sql_sha256_rendered': CERTIFIED['verify_sql_rendered'],
        'expect_sha256': expect_sha,
        'remote_inventory': (inv or {}).get('generated_at'),
        'local_torneos_bootstrap': (lboot or {}).get('generated_at'),
        'local_torneos_certify_runs': [{'generated_at': c.get('generated_at'), 'bootstrap_stamp': c['bootstrap_run']['stamp'], 'checks': f"{c.get('checks_passed')}/{c.get('checks_total')}", 'catalog_hash': c.get('catalog_hash'), 'api_view_sha256': c.get('api_view_sha256'), 'http_requests': c['http_requests']['total']} for c in lcerts],
        'local_torneos_tests': f"{local_tests[0]}/{local_tests[0] + max(local_tests[1], 0)}",
        'local_torneos_drift': (ldrift or {}).get('generated_at'),
        'project_create': (created or {}).get('generated_at'),
        'bootstrap': (boot or {}).get('generated_at'),
        'core_contract': (core or {}).get('generated_at'),
        # the PASS preflight and the fail-closed STOPs are different file families; a plain glob would
        # sort r3-preflight-failed-* after r3-preflight-<stamp> and report the STOP as the latest preflight
        'r3_preflight': (latest('r3-preflight-[0-9]*.json') or {}).get('generated_at'),
        'r3_preflight_failed': {'generated_at': r3_pf_failed.get('generated_at'), 'stop': r3_pf_failed.get('stop')} if r3_pf_failed else None,
        'r3_offline_rehearsal': (r3_rehearsal or {}).get('generated_at'),
        'r3_tooling_tests': f"{r3_tooling_tests[0]}/{r3_tooling_tests[0] + max(r3_tooling_tests[1], 0)}",
        'r3_pins': {'migrations': {m['version']: {'sha256': m['sha256'], 'apply_sql_sha256': m['apply_sql_sha256'], 'ledger_digest': m['ledger_digest']} for m in r3_manifest['migrations']}, 'rollback_sql_sha256': r3_manifest['rollback_sql_sha256'], 'cli_parser_sha256': r3_manifest['cli_parser_sha256'], 'deploy_files': r3_deploy_files},
        'd1_positive': (d1_positive or {}).get('generated_at'),
        'gateway_deploy': (gw or {}).get('generated_at'),
        'remote_certify': (cert or {}).get('generated_at'),
    },
}
(BASE / 'phase3b/results.json').write_text(json.dumps(results, indent=2, ensure_ascii=False) + '\n')
print(conclusion)
for k in failed_local:
    print('  LOCAL    FAIL   ', k)
for k in failed_hybrid:
    print('  HYBRID   PENDING', k)
print('  REMOTE_TO_REMOTE_PENDING_PRELAUNCH (deferred, non-blocking):', len(pending_r2r), 'pending')
print('  DRIFT informative:', drift['status'])
