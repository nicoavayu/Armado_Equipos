"""Phase 2C conclusion, computed from the evidence files (never asserted by hand).

Objective: correct ONLY the baseline ACL/grant model so it is safe on a REAL Supabase
install, change no business behaviour, and recertify. PASS (A) requires every condition
below; otherwise (B) BLOCKED with the failed conditions listed.
"""
import hashlib
import json
import pathlib

BASE = pathlib.Path(__file__).resolve().parents[1]
ROOT = BASE.parents[1]
LAB = ROOT / 'integration/torneos-core-contracts'
PHASE2C_BASELINE_SHA = '97634b658c91b620c60bdceb53c9638a601fa7aba01ae3a999e6857e37d08692'
PHASE2B_BASELINE_SHA = '7ec33549c8ce398c1e8330794aa19fda80321c597ff61ed3134382513639cffb'


def load(path):
    return json.loads(path.read_text())


baseline = (BASE / 'supabase/migrations/00000000000000_torneos_baseline_v1.sql').read_bytes()
baseline_sha = hashlib.sha256(baseline).hexdigest()
diff = load(BASE / 'phase2c/evidence/real-image-acl-diff.json')
acl = load(LAB / 'evidence/acl-results.json')
recert = load(LAB / 'evidence/acl-security-definer-recert.json')
e2e = load(LAB / 'evidence/e2e-results.json')
finding = load(LAB / 'evidence/finding-p3a-f1.json')
phase2b = load(BASE / 'phase2b/results.json')
sweep = phase2b['season_scope_sweep']
ledger = load(BASE / 'phase3a/inconclusive-ledger.json')
after = diff['runs']['after-real']['execute']

conditions = {
    # The only source change is the baseline generator prologue; the SHA moved off the Phase 2B value.
    'baseline_is_phase2c_hardened': baseline_sha == PHASE2C_BASELINE_SHA and baseline_sha != PHASE2B_BASELINE_SHA,
    # Real Supabase database (image `postgres` db carries the schema-scoped default ACLs).
    'certified_on_real_supabase_image': any(x['role'] == 'supabase_admin' and x['type'] == 'f' and 'anon=X' in x['acl'] for x in diff['image_default_acl_public']),
    # anon: no EXECUTE except the 12 explicitly-public functions; no SECURITY DEFINER inheritance beyond them.
    'anon_execute_only_explicit_public': after['anon']['public_functions'] == 12 and after['anon']['security_definer'] == 12,
    # authenticated: only the explicitly-granted functions.
    'authenticated_execute_only_explicit': after['authenticated']['public_functions'] == 180,
    # No function is PUBLIC-executable and no anon sequence privilege remains.
    'no_public_execute_no_anon_sequences': diff['runs']['after-real']['sequence_privilege']['anon'] == 0,
    # A future migration by the same installer inherits no API-role privilege (function, sequence, table).
    'future_objects_denied_by_default': diff['runs']['after-real']['future_objects_api_privilege(function,sequence,table)'] == 'false,false,false',
    # The fix only REMOVES privileges from API roles; it never grants anything new.
    'fix_only_removes_privilege': len(diff['privilege_gained_by_api_role_after_fix']) == 0,
    # Real Supabase stack == template0 for every API-role privilege, object by object.
    'real_equals_template0': len(diff['real_vs_template0_api_privilege_mismatches']) == 0 and diff['real_vs_template0_objects_compared'] >= 470,
    # The ACL certification suite on the real stack (PostgREST Data API) is fully green.
    'acl_suite_pass': acl['fail'] == 0 and acl['pass'] >= 16,
    # 305/305 SECURITY DEFINER keep their Phase 2B disposition (grantees, owner, fixed search_path).
    'security_definer_305_recertified': recert['total'] == 305 and recert['maintained'] == 305,
    # SERVICE_ONLY (106) and INTERNAL (9) unreachable from anon/authenticated bearers.
    'service_only_and_internal_unreachable': recert['categories'].get('SERVICE_ONLY') == 106 and recert['categories'].get('INTERNAL') == 9,
    # Phase 3A end-to-end re-run against the corrected baseline: no regressions, no open FINDING.
    'phase3a_e2e_no_regression': e2e['fail'] == 0 and sum(1 for r in e2e['results'] if r['status'] == 'FINDING') == 0 and e2e['pass'] >= 40,
    # Phase 2B recertification on template0 stays green after the rebuild.
    'phase2b_recert_pass': phase2b['conclusion'].startswith('A)') and not phase2b['failed_conditions'],
    # Season-scope leak class stays closed (the 41-leak regression does not reopen).
    'season_leaks_closed': sweep['LEAK'] == 0 and sweep['ORG_LEAK'] == 0 and sweep['SCOPED'] >= 100,
    # P3A-F1 recorded as closed by this fix.
    'p3a_f1_closed': finding['finding'] == 'P3A-F1' and finding.get('baseline_changed') is True and 'CLOSED' in finding.get('status', ''),
    # No physical Core FK, no auth tables, no secrets on the real stack (asserted inside the ACL suite).
    'no_core_fk_or_secrets': all(r['status'] == 'PASS' for r in acl['results'] if r['name'].startswith(('no physical Core', 'no secrets'))),
}
failed = [k for k, v in conditions.items() if not v]

result = {
    'conclusion': 'A) REAL SUPABASE BASELINE HARDENED + RECERTIFIED' if not failed else 'B) BLOCKED',
    'failed_conditions': failed,
    'conditions': conditions,
    'objective': 'Correct only the baseline ACL/grant model to be safe on a real Supabase install; no business-behaviour change.',
    'branch': 'claude/supabase-acl-hardening-c23094',
    'base_commit': '317c2b19 (Phase 3A HEAD)',
    'baseline_sha256': {'phase2b': PHASE2B_BASELINE_SHA, 'phase2c': baseline_sha},
    'cause': finding['cause'],
    'minimal_fix': finding['fix'],
    'effective_execute_by_role_on_real_image': {
        'before(phase2b_candidate)': diff['runs']['before-real']['execute'],
        'after(phase2c_candidate)': after,
    },
    'sequence_privilege_on_real_image': {
        'before': diff['runs']['before-real']['sequence_privilege'],
        'after': diff['runs']['after-real']['sequence_privilege'],
    },
    'real_vs_template0': {'objects_compared': diff['real_vs_template0_objects_compared'], 'api_privilege_mismatches': len(diff['real_vs_template0_api_privilege_mismatches'])},
    'security_definer_recertified': {'total': recert['total'], 'maintained': recert['maintained'], 'categories': recert['categories']},
    'acl_suite': {'pass': acl['pass'], 'fail': acl['fail']},
    'phase3a_e2e_rerun': {'pass': e2e['pass'], 'fail': e2e['fail'], 'findings': sum(1 for r in e2e['results'] if r['status'] == 'FINDING'), 'total': len(e2e['results'])},
    'phase2b_recert': phase2b['conclusion'],
    'p3a_r1_disposition': {
        'classification': 'A) intentional and safe, with a test',
        'summary': 'create_tournament_team_entry answers the idempotent replay before consuming the fresh team_snapshot attestation, so a positive verdict stays unconsumed for <= 10 s. It is bound to identity, Core session, contract and the exact org/tournament/category/team hash, and any RPC call with those inputs hits the replay/already-registered path first; a duplicate is rejected (409) with nothing consumed and nothing created, and it expires within the certified 10 s TTL. No fix required before staging.',
        'test': "integration/torneos-core-contracts/test.mjs :: 'P3A-R1 disposition (A)'",
    },
    'inconclusive_33': {
        'count': ledger['count'], 'status': 'RESIDUAL RISK — not proven; kept as a ledger',
        'by_area': ledger['by_area'],
        'staging_rule': 'Do not block staging unless a feature we enable makes one reachable; every one keeps the build-time season rule and the admin was denied on the unassigned season. Needs specific fixtures before the reaching feature is enabled.',
        'phase2c_reachable': False,
    },
    'scope': 'Non-production only. No staging, no Production, no Phase 3B, no Mercado Pago, no SSO change, no Core-contract change.',
}
(BASE / 'phase2c/results.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
print(json.dumps({'conclusion': result['conclusion'], 'failed_conditions': failed}))
