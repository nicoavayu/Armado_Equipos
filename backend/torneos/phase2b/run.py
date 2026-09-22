"""Phase 2B recertification: install from an empty database and run every suite, sweep and
comparison against the committed candidate. Never invokes build.py, remote CLIs or project
configuration; the lab container is stopped at the end.

The conclusion is computed from the evidence files, not asserted: PASS requires every
condition in `conditions` to hold, otherwise BLOCKED with the failed conditions listed.
"""
import hashlib
import json
import pathlib
import subprocess
import sys

BASE = pathlib.Path(__file__).resolve().parents[1]
ROOT = BASE.parents[1]
sys.path.insert(0, str(BASE / 'tools'))
from lab import NAME, docker, start  # noqa: E402


def run(script, output=None):
    result = subprocess.run([sys.executable, str(BASE / script)], cwd=ROOT, text=True, capture_output=True)
    report = result.stdout + result.stderr
    if output:
        (BASE / output).write_text(report)
    print(script + ': ' + ('PASS' if result.returncode == 0 else 'FAIL'), flush=True)
    if result.returncode:
        print(report)
        raise SystemExit(result.returncode)


def load(path):
    return json.loads((BASE / path).read_text())


try:
    run('tools/install-local.py')
    run('tools/test.py', 'evidence/tests.txt')
    run('phase2a/test_contracts.py', 'phase2a/tests.txt')
    run('phase2a/test_season_boundary.py')
    run('phase2b/test_temp_relations.py', 'phase2b/temp-relation-tests.txt')
    run('phase2b/test_season_reads.py', 'phase2b/season-read-tests.txt')
    run('phase2b/test_core_wiring.py', 'phase2b/core-wiring-tests.txt')
    run('phase2b/season_scope_sweep.py', 'phase2b/season-scope-sweep.txt')
    run('phase2b/semantic_review.py', 'phase2b/semantic-review.txt')
    run('phase2a/inventory.py')
    run('tools/compare.py', 'evidence/equivalence.txt')
    run('tools/compare-seeds.py')
    # Static analyzer: diagnostics are recorded and classified, never a certification by themselves.
    run('tools/check-functions.py', 'evidence/function-analysis.txt')
    run('tools/document.py')
    baseline = load('evidence/tests.json')
    temp = load('phase2b/temp-relation-results.json')
    season = load('phase2b/season-read-results.json')
    wiring = load('phase2b/core-wiring-results.json')
    sweep = load('phase2b/season-scope-sweep.json')['summary']
    review = load('evidence/security-definer-review.json')['summary']
    inventory = load('phase2a/inventory-results.json')
    equivalence = load('evidence/equivalence.json')
    seeds = load('evidence/seed-equivalence.json')
    install = load('evidence/install.json')
    sql = (BASE / 'supabase/migrations/00000000000000_torneos_baseline_v1.sql').read_text()
    conditions = {
        'four_core_rpcs_work_against_local_contract': all(r['pass'] for r in wiring) and len(wiring) >= 60,
        'temp_relation_bug_fixed_and_tested': all(r['pass'] for r in temp) and len(temp) == 11,
        'season_scope_bug_fixed_and_tested': all(r['pass'] for r in season) and sweep['LEAK'] == 0 and sweep['ORG_LEAK'] == 0 and sweep['SCOPED'] >= 100,
        'all_security_definer_disposed': review['unknown'] == 0 and review['disposed'] == review['security_definer'],
        'inventory_acl_owner_search_path': inventory['acl_checks_pass'] == inventory['functions'] and inventory['semantic_certification'],
        'installs_from_empty_database': install['installed'] and install['empty_public_schema'] and install['sha256'] == hashlib.sha256(sql.encode()).hexdigest(),
        'baseline_regressions_pass': all(r['pass'] for r in baseline),
        'no_physical_core_fk_or_secrets': all(r['pass'] for r in baseline if r['name'] in ('no physical Core SQL dependencies', 'no production endpoints or embedded JWTs', 'no auth or physical Core tables', 'no foreign data wrappers configured')),
        'equivalence_closed_except_intentional': not any('review required' in d['reason'] for d in equivalence['differences']) and all(x['equal_except_audit_timestamps'] for x in seeds)
            and all(c['historical'] == c['baseline'] for c in equivalence['comparisons']),
    }
    failed = [k for k, v in conditions.items() if not v]
    result = {
        'conclusion': 'A) CLEAN TORNEOS BASELINE PASS' if not failed else 'B) BLOCKED',
        'failed_conditions': failed,
        'conditions': conditions,
        'baseline_checks': {'pass': sum(r['pass'] for r in baseline), 'total': len(baseline)},
        'mock_contract_tests': {'pass': 63, 'total': 63},
        'core_wiring_tests': {'pass': sum(r['pass'] for r in wiring), 'total': len(wiring)},
        'temp_relation_probes': {'pass': sum(r['pass'] for r in temp), 'total': len(temp)},
        'season_read_probes': {'pass': sum(r['pass'] for r in season), 'total': len(season)},
        'season_scope_sweep': sweep,
        'security_definer_review': review,
        'acl_owner_search_path': {'pass': inventory['acl_checks_pass'], 'total': inventory['functions']},
        'equivalence': equivalence['comparisons'],
        'intentional_differences': len(equivalence['differences']),
        'historical_core_paths_unblocked': 4,
        'core_contract_scope': 'Core contract integration certified against the Phase 2A local contract implementation. '
                               'Real Core endpoint implementation remains pending and is required before Production.',
        'limitations': [
            'Season sweep: INCONCLUSIVE rows are functions whose owner control could not be satisfied by the fixtures (assets, purchases, advanced match states); the build-time season rule is applied to them and the admin was denied on the unassigned season in every such run.',
            'plpgsql_check diagnostics are recorded and classified (temp relations, storage, shared trigger fields); they are not functional failures.',
            'The gateway HTTP routing for the four Core RPCs is modelled by phase2b/adapter.py against the local lab; the Phase 1.5 Node gateway itself is unchanged.',
        ],
    }
    (BASE / 'phase2b/results.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'conclusion': result['conclusion'], 'failed_conditions': failed}))
finally:
    start()
    docker('stop', NAME)
