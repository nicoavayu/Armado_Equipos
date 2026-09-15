"""Phase 3A conclusion, computed from the evidence files (never asserted by hand).

PASS requires every condition below; otherwise BLOCKED with the failed conditions listed.
Findings that do not block the Phase 3A objective (real Core contracts + Torneos E2E) but
DO block any Production step are carried as `blockers_before_production`.
"""
import hashlib
import json
import pathlib
import re

BASE = pathlib.Path(__file__).resolve().parents[1]
ROOT = BASE.parents[1]
LAB = ROOT / 'integration/torneos-core-contracts'


def load(path):
    return json.loads(path.read_text())


e2e = load(LAB / 'evidence/e2e-results.json')
finding = load(LAB / 'evidence/finding-p3a-f1.json')
install = load(LAB / 'evidence/install.json')
unit = (LAB / 'evidence/core-unit-tests.txt').read_text()
baseline = (BASE / 'supabase/migrations/00000000000000_torneos_baseline_v1.sql').read_bytes()
phase2b = load(BASE / 'phase2b/results.json')
ledger = load(BASE / 'phase3a/inconclusive-ledger.json')
migration = (ROOT / 'supabase/migrations/20260914120000_torneos_core_contract_v1.sql').read_text()

names = {r['name']: r['status'] for r in e2e['results']}


def passed(prefix):
    rows = [s for n, s in names.items() if n.startswith(prefix)]
    return bool(rows) and all(s == 'PASS' for s in rows)


unit_pass = re.search(r'ℹ pass (\d+)', unit)
unit_fail = re.search(r'ℹ fail (\d+)', unit)
conditions = {
    'core_endpoint_implemented_in_core_repo': (ROOT / 'supabase/functions/torneos-core-contract/index.ts').exists()
        and 'torneos_contract_execute' in migration and '[functions.torneos-core-contract]' in (ROOT / 'supabase/config.toml').read_text(),
    'core_unit_tests_pass': bool(unit_pass) and int(unit_fail.group(1)) == 0 and int(unit_pass.group(1)) >= 15,
    'lab_runs_real_core_schema_and_certified_baseline': install['torneos']['sha256'] == install['torneos']['certified_sha256']
        and any(m['file'].endswith('20260914120000_torneos_core_contract_v1.sql') for m in install['core_migrations_applied']),
    'verified_email_contract_e2e': passed('verified email:'),
    'directory_contract_e2e': passed('directory'),
    'team_import_contract_e2e': passed('import:'),
    'binding_replay_ttl_e2e': passed('binding:'),
    'security_e2e': passed('security:'),
    'scope_e2e': passed('e2e:'),
    'no_failed_checks': e2e['fail'] == 0,
    'baseline_acl_hardened_phase2c': hashlib.sha256(baseline).hexdigest() == '97634b658c91b620c60bdceb53c9638a601fa7aba01ae3a999e6857e37d08692',
    'no_secrets_in_lab_evidence': not re.search(r'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.', (LAB / 'evidence/e2e-tests.txt').read_text()),
}
failed = [k for k, v in conditions.items() if not v]
result = {
    'conclusion': 'A) REAL CORE CONTRACTS + TORNEOS E2E PASS' if not failed else 'B) BLOCKED',
    'failed_conditions': failed,
    'conditions': conditions,
    'core_repo': 'nicoavayu/Armado_Equipos (this repository): supabase/migrations + supabase/functions',
    'branch': 'claude/torneos-phase3a-core-contracts-ac1d84',
    'base_commit': 'b5c5d4af (Phase 2B)',
    'core_migration_sha256': hashlib.sha256(migration.encode()).hexdigest(),
    'torneos_baseline_sha256': hashlib.sha256(baseline).hexdigest(),
    'baseline_changes': '1 line (Phase 2C ACL hardening); see backend/torneos/phase2c/',
    'core_unit_tests': {'pass': int(unit_pass.group(1)) if unit_pass else 0, 'fail': int(unit_fail.group(1)) if unit_fail else 1},
    'e2e_checks': {'pass': e2e['pass'], 'fail': e2e['fail'], 'findings': sum(1 for r in e2e['results'] if r['status'] == 'FINDING'), 'total': len(e2e['results'])},
    'phase2b_reference': phase2b['conclusion'],
    'inconclusive_functions': {'count': ledger['count'], 'status': 'NOT_EXERCISED / residual risk', 'by_area': ledger['by_area']},
    'blockers_before_production': [
        {'id': finding['finding'], 'summary': 'CLOSED in Phase 2C: the baseline generator now revokes the Supabase image schema-scoped default ACLs '
                                          'for functions and sequences, so anon/authenticated EXECUTE and sequence privilege are explicit-grant only. '
                                          'Recertified on a real Supabase stack and template0; see backend/torneos/phase2c/.',
         'baseline_changed': finding['baseline_changed'], 'status': finding.get('status'), 'evidence': 'integration/torneos-core-contracts/evidence/finding-p3a-f1.json'},
        {'id': 'P3A-R1', 'summary': 'Idempotent replay of create_tournament_team_entry returns before consuming the fresh team_snapshot attestation (positive verdict alive ≤ 10 s, fully bound).', 'baseline_changed': False},
        {'id': 'P3A-R2', 'summary': '33 SECURITY DEFINER functions remain INCONCLUSIVE from the Phase 2B season sweep (see inconclusive-ledger.json).', 'baseline_changed': False},
        {'id': 'P3A-R3', 'summary': 'Core service credential custody/rotation, TLS/mTLS outside loopback and hosted deployment of the Edge Function are not part of this lab.', 'baseline_changed': False},
    ],
    'scope': 'Non-production only. No Supabase Production Torneos project, no deploy, no Mercado Pago, no Phase 3B.',
}
(BASE / 'phase3a/results.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
print(json.dumps({'conclusion': result['conclusion'], 'failed_conditions': failed}))
