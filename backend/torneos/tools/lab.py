"""Local-only catalog laboratory. No URL/environment-selected database targets."""
import subprocess, pathlib, json, hashlib, sys, re, time
ROOT=pathlib.Path(__file__).resolve().parents[3]
BASE=ROOT/'backend/torneos'
DOCKER='/Applications/Docker.app/Contents/Resources/bin/docker'
NAME='arma2-torneos-baseline-phase2'
def docker(*args,input=None):
 p=subprocess.run([DOCKER,'--host','unix:///var/run/docker.sock',*args],input=input,text=True,capture_output=True)
 if p.returncode: raise RuntimeError(p.stderr)
 return p.stdout

def sql(db,q):
 assert db in ('postgres','history','baseline')
 return docker('exec','-i',NAME,'psql','-X','-U','supabase_admin','-d',db,'-At','-v','ON_ERROR_STOP=1',input=q)
def start():
 names=docker('ps','-a','--format','{{.Names}}').splitlines()
 if NAME not in names:
  docker('run','-d','--name',NAME,'--network','none','--label','arma2.phase=local-baseline-2','-e','POSTGRES_HOST_AUTH_METHOD=trust','public.ecr.aws/supabase/postgres:17.6.1.143','postgres','-D','/etc/postgresql','-c','log_statement=none')
 info=json.loads(docker('inspect',NAME))[0]
 assert info['HostConfig']['NetworkMode']=='none'
 assert info['Config']['Labels'].get('arma2.phase')=='local-baseline-2'
 if not info['State']['Running']: docker('start',NAME)
 for _ in range(40):
  try:
   if 'PostgreSQL init process complete' not in docker('logs',NAME): time.sleep(1); continue
   sql('postgres','select 1'); return
  except RuntimeError: time.sleep(1)
 raise RuntimeError('local database not ready')
def main():
 start()
 if sys.argv[1]=='history':
  sql('postgres','CREATE DATABASE history TEMPLATE template0;')
  sql('history',(BASE/'tools/history-prerequisites.sql').read_text())
  records=[];transitions=[]
  def objects():
   c=json.loads(sql('history',(BASE/'tools/catalog.sql').read_text())); result={}
   for kind in ('types','tables','indexes','views','functions','triggers','policies'):
    for obj in c[kind] or []:
     name=obj.get('table','')+'.'+obj['name']+'('+obj.get('signature','')+')'
     result[kind+':'+name]=hashlib.sha256(json.dumps(obj,sort_keys=True).encode()).hexdigest()
   return result
  previous=objects()
  for s in json.loads((BASE/'contracts/history-manifest.json').read_text()):
   if s['order']==12: sql('history',(BASE/'tools/history-acl.sql').read_text())
   source=(ROOT/s['file']).read_bytes()
   assert hashlib.sha256(source).hexdigest()==s['sha256']
   try: sql('history',source.decode())
   except Exception as e: print('FAILED',s['order'],s['file'],e); raise
   current=objects()
   for key in sorted(previous.keys()|current.keys()):
    if previous.get(key)!=current.get(key): transitions.append({'step':s['order'],'source':s['file'],'object':key,'event':'created' if key not in previous else 'removed' if key not in current else 'changed','before_sha256':previous.get(key),'after_sha256':current.get(key)})
   previous=current
   print('APPLIED reference',s['order'],flush=True); records.append(s)
  (BASE/'evidence/history-transitions.json').write_text(json.dumps(transitions,indent=2)+'\n')
  (BASE/'evidence/history-applied.json').write_text(json.dumps(records,indent=2)+'\n')
 elif sys.argv[1]=='sql': print(sql(sys.argv[2],sys.stdin.read()))
if __name__=='__main__': main()
