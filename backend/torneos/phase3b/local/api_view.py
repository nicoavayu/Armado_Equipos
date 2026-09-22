"""Phase 3B R2-local bridge to the Phase 2C/2D comparison code — the SAME `api_view` function
(phase2c/real_image_acl.py) that produced the certified 0-mismatch result, so the live isolated
stack is compared object by object with the certified after-real inventory using identical
semantics. stdin: {"live": <acl-inventory.sql document>, "certified_path": <after-real json>}.
stdout: comparison summary (never the inventories themselves). Local files only."""
import hashlib
import json
import pathlib
import sys

BASE = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BASE / 'tools'))
sys.path.insert(0, str(BASE / 'phase2c'))
from real_image_acl import API, api_view  # noqa: E402


def canonical_sha(view):
    return hashlib.sha256(json.dumps(view, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def main():
    req = json.load(sys.stdin)
    live = req['live']
    certified_doc = json.loads(pathlib.Path(req['certified_path']).read_text())
    certified = certified_doc['inventory']
    a, b = api_view(live), api_view(certified)
    mismatches = [{'object': k, 'live': a.get(k), 'certified': b.get(k)} for k in sorted(a.keys() | b.keys()) if a.get(k) != b.get(k)]
    public_functions = [f for f in live['functions'] if f['schema'] == 'public']
    out = {
        'compared': len(a.keys() | b.keys()),
        'live_objects': len(a), 'certified_objects': len(b),
        'mismatches': mismatches,
        'live_view_sha256': canonical_sha(a), 'certified_view_sha256': canonical_sha(b),
        'counts': {'functions': len(live['functions']), 'sequences': len(live['sequences']), 'relations': len(live['relations'])},
        'certified_label': certified_doc['summary'].get('label'), 'certified_image': certified_doc['summary'].get('image'),
        'live_summary': {
            'public_functions': len(public_functions),
            'security_definer_total': sum(f['security_definer'] for f in live['functions']),
            'security_definer_public': sum(f['security_definer'] for f in public_functions),
            'execute': {role: {'public_functions': sum(f[role] for f in public_functions), 'private_functions': sum(f[role] for f in live['functions'] if f['schema'] == 'private')} for role in API},
            'public_execute_functions': sum(f['public'] for f in live['functions']),
            'sequence_privilege': {role: sum(bool(s[role]) for s in live['sequences']) for role in API},
            'relation_privilege': {role: sum(bool(r[role]) for r in live['relations']) for role in API},
            'anon_write_privilege_relations': sum(any(p != 'SELECT' for p in r['anon']) for r in live['relations']),
        },
    }
    print(json.dumps(out, sort_keys=True))


if __name__ == '__main__':
    main()
