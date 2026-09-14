"""Reproduce isolated evidence. Never invokes build.py, remote CLIs, or project configuration."""
import hashlib,json,pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[3]
BASE=ROOT/'backend/torneos'
sys.path.insert(0,str(BASE/'tools'))
from lab import docker,NAME,start

def run(script,output=None,args=()):
    result=subprocess.run([sys.executable,str(BASE/script),*args],cwd=ROOT,text=True,capture_output=True)
    report=result.stdout+result.stderr
    if output:(BASE/output).write_text(report)
    print(script+': '+('PASS' if result.returncode==0 else 'FAIL'),flush=True)
    if result.returncode:
        print(report);raise SystemExit(result.returncode)
try:
    run('tools/install-local.py')
    run('tools/test.py','evidence/tests.txt')
    run('phase2a/test_contracts.py','phase2a/tests.txt')
    run('phase2a/test_season_boundary.py')
    run('phase2a/inventory.py')
    run('tools/compare.py','evidence/equivalence.txt')
    run('tools/compare-seeds.py')
    # This analyzer reports diagnostics, not certification, even when its command succeeds.
    run('tools/check-functions.py','evidence/function-analysis.txt')
    report={'baseline_checks':len(json.loads((BASE/'evidence/tests.json').read_text())),
       'baseline_all_pass':all(x['pass'] for x in json.loads((BASE/'evidence/tests.json').read_text())),
       'contracts_suite_pass':True,'season_denial_pass':True,
       'inventory':json.loads((BASE/'phase2a/inventory-results.json').read_text()),
       'conclusion':'B) BLOCKED','historical_core_paths_unblocked':0}
    (BASE/'phase2a/results.json').write_text(json.dumps(report,indent=2)+'\n')
finally:
    # start checks label/network identity before any lifecycle operation.
    start();docker('stop',NAME)
