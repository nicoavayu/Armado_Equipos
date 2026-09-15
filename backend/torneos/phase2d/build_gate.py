"""Phase 2D: generate the staging v1 RPC exposure gate (manifest + migration) from evidence.

Inputs (never edited by hand):
  * phase3a/inconclusive-ledger.json — the 33 SECURITY DEFINER RPCs that stayed INCONCLUSIVE /
    NOT_EXERCISED through Phase 2B/3A/2C; review_tournament_team_entry is certified in Phase 2D
    and stays client-executable, the other 32 belong to features that are OFF in staging v1.
  * the committed baseline SQL — call graph over every public function, so any RPC that a
    client can execute and that reaches one of the 32 internally (a SECURITY DEFINER parent runs
    as the owner, so a REVOKE on the child alone would not stop that path) is gated too.

Output: phase2d/staging-v1-rpc-gate.json and supabase/migrations/00000000000001_staging_v1_rpc_exposure.sql
(REVOKE EXECUTE FROM anon, authenticated; service_role keeps its grant; idempotent; fail-closed
pre/postconditions). Re-enabling any gated function requires its fixture/test certification and an
explicit GRANT migration after this one.
"""
import json
import pathlib
import re

BASE = pathlib.Path(__file__).resolve().parents[1]
CERTIFIED = {'review_tournament_team_entry'}
CLIENT_ROLES = {'anon', 'authenticated'}


def functions(sql):
    """name -> {'signatures': [identity args...], 'bodies': [...]} for every public function."""
    out = {}
    for m in re.finditer(r'CREATE FUNCTION public\.(\w+)\(([^)]*)\)[\s\S]*?AS (\$[^$]*\$)([\s\S]*?)\3;', sql):
        out.setdefault(m.group(1), {'bodies': []})['bodies'].append(m.group(4))
    return out


def grants(sql):
    out = {}
    for m in re.finditer(r'^GRANT ALL ON FUNCTION public\.(\w+)\([^)]*\) TO (\w+);$', sql, re.M):
        out.setdefault(m.group(1), set()).add(m.group(2))
    return out


def main():
    sql = (BASE / 'supabase/migrations/00000000000000_torneos_baseline_v1.sql').read_text()
    ledger = json.loads((BASE / 'phase3a/inconclusive-ledger.json').read_text())
    assert ledger['count'] == 33 and len(ledger['functions']) == 33
    fns, acl = functions(sql), grants(sql)
    off = [f for f in ledger['functions'] if f['function'].split('(')[0] not in CERTIFIED]
    assert len(off) == 32
    off_names = {f['function'].split('(')[0] for f in off}
    # Call graph: caller -> callees (public functions referenced as public.<name>( in the body).
    callees = {}
    for name, info in fns.items():
        refs = set()
        for body in info['bodies']:
            refs |= {c for c in re.findall(r'public\.(\w+)\(', body) if c in fns and c != name}
        callees[name] = refs

    def reaches(start):
        seen, stack, paths = set(), [(start, [start])], []
        while stack:
            node, path = stack.pop()
            for nxt in sorted(callees.get(node, ())):
                if nxt in off_names:
                    paths.append(path + [nxt])
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append((nxt, path + [nxt]))
        return paths
    parents = []
    for name in sorted(fns):
        if name in off_names or not (acl.get(name, set()) & CLIENT_ROLES):
            continue
        paths = reaches(name)
        if paths:
            parents.append({'function': name, 'grantees': sorted(acl[name]), 'paths': [' -> '.join(p) for p in paths]})
    # Identity signatures come from the baseline's own GRANT statements (pg_dump identity arguments).
    identity = {}
    for m in re.finditer(r'^GRANT ALL ON FUNCTION public\.(\w+)\(([^)]*)\) TO authenticated;$', sql, re.M):
        identity[m.group(1)] = m.group(2)
    gated = []
    for f in off:
        name = f['function'].split('(')[0]
        assert 'authenticated' in acl.get(name, set()), name
        gated.append({'function': f['function'], 'name': name, 'identity_arguments': identity[name], 'area': f['area'],
                      'reason': 'INCONCLUSIVE in Phase 2B / NOT_EXERCISED in Phase 3A; its feature is OFF in staging v1',
                      'baseline_grantees': sorted(acl[name])})
    for p in parents:
        name = p['function']
        types = ','.join(a.split(' ', 1)[1] for a in identity[name].split(', '))  # 'p_x timestamp with time zone' -> type only
        gated.append({'function': f'{name}({types})', 'name': name, 'identity_arguments': identity[name], 'area': 'parent path',
                      'reason': 'client-executable RPC that reaches a gated function internally: ' + '; '.join(p['paths']),
                      'baseline_grantees': p['grantees']})
    manifest = {
        'phase': '2D', 'purpose': 'staging v1 RPC exposure gate: client roles lose EXECUTE on RPCs whose feature is OFF and that were never functionally certified',
        'source_ledger': 'backend/torneos/phase3a/inconclusive-ledger.json (33 INCONCLUSIVE / NOT_EXERCISED)',
        'certified_in_phase2d_and_kept_executable': sorted(CERTIFIED),
        'gated_count': len(gated), 'off_functions': len(off), 'parent_paths': len(parents),
        'revoked_from': ['anon', 'authenticated'], 'kept_for': ['service_role'],
        're_enable_rule': 'A gated function returns to clients only through a later GRANT migration, after its own fixture/test certification (residual ledger).',
        'functions': gated,
    }
    (BASE / 'phase2d/staging-v1-rpc-gate.json').write_text(json.dumps(manifest, indent=2) + '\n')
    lines = [
        '-- Arma2 Torneos — staging v1 RPC exposure gate (Phase 2D). Generated by backend/torneos/phase2d/build_gate.py;',
        '-- do not edit by hand. Applies after 00000000000000_torneos_baseline_v1.sql.',
        '--',
        f'-- {len(off)} SECURITY DEFINER RPCs stayed INCONCLUSIVE (Phase 2B) / NOT_EXERCISED (Phase 3A) and belong to features',
        '-- that are OFF in staging v1; ' + str(len(parents)) + ' client-executable RPC reaches one of them internally (a SECURITY DEFINER',
        '-- parent runs as the owner, so gating the child alone would not close that path). Client roles lose EXECUTE;',
        '-- service_role keeps it (server-side use only). Re-enabling any of them requires its fixture/test',
        '-- certification and an explicit GRANT migration after this one. Idempotent; fails closed if a function is missing.',
        'BEGIN;',
        'DO $$ BEGIN',
    ]
    for g in gated:
        lines.append(f"  IF to_regprocedure('public.{g['function']}') IS NULL THEN RAISE EXCEPTION 'TORNEOS_GATE_FUNCTION_MISSING: {g['function']}'; END IF;")
    lines.append('END $$;')
    for g in gated:
        lines.append(f"REVOKE EXECUTE ON FUNCTION public.{g['name']}({g['identity_arguments']}) FROM anon, authenticated;")
    lines += ['DO $$ BEGIN']
    for g in gated:
        lines.append(f"  IF has_function_privilege('anon', 'public.{g['function']}', 'EXECUTE') OR has_function_privilege('authenticated', 'public.{g['function']}', 'EXECUTE') OR NOT has_function_privilege('service_role', 'public.{g['function']}', 'EXECUTE') THEN RAISE EXCEPTION 'TORNEOS_GATE_POSTCONDITION_FAILED: {g['function']}'; END IF;")
    lines += ['END $$;', 'COMMIT;']
    (BASE / 'supabase/migrations/00000000000001_staging_v1_rpc_exposure.sql').write_text('\n'.join(lines) + '\n')
    print(json.dumps({'gated': len(gated), 'off': len(off), 'parents': [p['function'] for p in parents]}))


if __name__ == '__main__':
    main()
