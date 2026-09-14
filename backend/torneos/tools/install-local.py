"""Recreate ONLY this task's fixed, network-disabled baseline database."""
from lab import start,sql,docker,NAME,BASE
import json,hashlib
start()
info=json.loads(docker('inspect',NAME))[0]
assert info['HostConfig']['NetworkMode']=='none'
assert info['Config']['Labels'].get('arma2.phase')=='local-baseline-2'
sql('postgres','DROP DATABASE IF EXISTS baseline; DROP ROLE IF EXISTS torneos_identity_writer; CREATE DATABASE baseline TEMPLATE template0;')
source=(BASE/'supabase/migrations/00000000000000_torneos_baseline_v1.sql').read_text()
assert sql('baseline',"select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'").strip()=='0'
sql('baseline',source)
(BASE/'evidence/install.json').write_text(json.dumps({'empty_public_schema':True,'only_migration':'00000000000000_torneos_baseline_v1.sql','sha256':hashlib.sha256(source.encode()).hexdigest(),'installed':True,'image':info['Config']['Image'],'image_id':info['Image'],'network':'none','database':'baseline'},indent=2)+'\n')
print('Baseline installed from empty template0 database; network=none')
