"""Local rollback probes for inherited DEFINER execution and hostile temp relations.

Ranking runs its actual complete body with an empty revision. Discipline probes
execute the exact work-table initialization extracted from rebuild's body; they
are not a complete standings lifecycle test. All test functions/objects roll back.
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'tools'))
from lab import BASE, sql

results = []

def check(name, condition):
    results.append({'name': name, 'pass': bool(condition)})
    print(('PASS ' if condition else 'FAIL ') + name)


def definition(name):
    return sql('baseline', "select pg_get_functiondef('public." + name + "'::regproc)")


def probe(relation, body, attack='table'):
    # Harness is owner-created and transactional. Only the adversarial objects
    # are made by authenticated. The wrapper models rebuild's elevated caller.
    setup = f"""BEGIN;
    CREATE FUNCTION private.phase2b_nested_probe() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $probe$
    BEGIN {body} END $probe$;
    REVOKE ALL ON FUNCTION private.phase2b_nested_probe() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION private.phase2b_nested_probe() TO authenticated;
    SET LOCAL ROLE authenticated;
    """
    if attack == 'table':
        setup += f"""
        CREATE TEMPORARY TABLE {relation}(participant_id uuid);
        CREATE FUNCTION pg_temp.phase2b_trap() RETURNS trigger
        LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $trap$
        BEGIN RAISE EXCEPTION 'PHASE2B_TRAP_EXECUTED_AS_%',current_user; END $trap$;
        CREATE TRIGGER phase2b_trap BEFORE TRUNCATE ON pg_temp.{relation}
        FOR EACH STATEMENT EXECUTE FUNCTION pg_temp.phase2b_trap();
        """
    elif attack == 'view':
        setup += f'CREATE TEMPORARY VIEW {relation} AS SELECT 1 AS participant_id;'
    setup += 'SELECT private.phase2b_nested_probe(); SELECT private.phase2b_nested_probe(); RESET ROLE;'
    setup += f"SELECT 'OWNER=' || pg_get_userbyid(relowner) FROM pg_class WHERE oid='pg_temp.{relation}'::regclass; ROLLBACK;"
    try:
        return True, sql('baseline', setup)
    except RuntimeError as error:
        return False, str(error)


def main():
    rank = definition('rank_tournament_standings')
    rebuild = definition('rebuild_tournament_standings')
    old_catalog = json.loads((BASE / 'evidence/history-catalog.json').read_text())
    old_rank = next(f['definition'] for f in old_catalog['functions'] if f['name'] == 'public.rank_tournament_standings')
    # Reproduce the old vulnerable body under the same wrapper/role, without
    # replacing the installed baseline function or retaining privileged objects.
    old_body = old_rank.split('AS $function$', 1)[1].rsplit('$function$', 1)[0]
    ok, out = probe('tournament_rank_work', old_body)
    check('historical ranking executes caller trigger as owner (vulnerability reproduced)',
          not ok and 'PHASE2B_TRAP_EXECUTED_AS_supabase_admin' in out)
    body = "PERFORM public.rank_tournament_standings('00000000-0000-0000-0000-000000000000');"
    for attack in ('table', 'none', 'view'):
        ok, out = probe('tournament_rank_work', body, attack)
        check('actual ranking nested execution: ' + attack,
              (ok and 'OWNER=supabase_admin' in out) if attack != 'view'
              else not ok and 'is not a table' in out and 'PHASE2B_TRAP' not in out)
    start = rebuild.index("  if pg_catalog.to_regclass('pg_temp.tournament_discipline_event_work') is not null then")
    end = rebuild.index('  truncate pg_temp.tournament_discipline_event_work;', start) + len('  truncate pg_temp.tournament_discipline_event_work;')
    body = rebuild[start:end]
    for attack in ('table', 'none', 'view'):
        ok, out = probe('tournament_discipline_event_work', body, attack)
        check('exact discipline initialization nested execution: ' + attack,
              (ok and 'OWNER=supabase_admin' in out) if attack != 'view'
              else not ok and 'is not a table' in out and 'PHASE2B_TRAP' not in out)
    for role in ('anon', 'authenticated'):
        check(role + ' cannot directly execute internal ranking',
              sql('baseline', f"select has_function_privilege('{role}','public.rank_tournament_standings(uuid)','EXECUTE')").strip() == 'f')
    check('no test wrappers retained', sql('baseline', "select to_regprocedure('private.phase2b_nested_probe()') is null").strip() == 't')
    check('no temporary relation reuse remains in candidate',
          not re.search(r'create temporary table if not exists', rank + rebuild, re.I))

if __name__ == '__main__':
    try:
        main()
    finally:
        (BASE / 'phase2b/temp-relation-results.json').write_text(json.dumps(results, indent=2) + '\n')
    assert results and all(r['pass'] for r in results)
