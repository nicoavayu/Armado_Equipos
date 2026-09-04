import net from 'node:net';
import { spawn } from 'node:child_process';
import { docker, container } from './production-upgrade-local.mjs';
// Loopback-only wire relay into the network=none container. No real credentials,
// TCP listeners inside the container, API servers or remote services are used.
const python = `import os,socket,select
s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
s.connect('/tmp/.s.PGSQL.5432')
while True:
 r,_,_=select.select([0,s],[],[])
 if 0 in r:
  data=os.read(0,65536)
  if not data: break
  s.sendall(data)
 if s in r:
  data=s.recv(65536)
  if not data: break
  os.write(1,data)
`;
net.createServer(socket=>{
  const child=spawn(docker,['exec','-i',container,'python3','-c',python],{stdio:['pipe','pipe','pipe']});
  socket.pipe(child.stdin);child.stdout.pipe(socket);
  socket.on('error',()=>child.kill());child.stdin.on('error',()=>socket.destroy());
  socket.on('close',()=>child.kill());child.on('exit',()=>socket.end());
}).listen(58332,'127.0.0.1',()=>console.log('LOCAL relay 127.0.0.1:58332 -> '+container+' UNIX socket'));
