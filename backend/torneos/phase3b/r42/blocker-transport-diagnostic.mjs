// Bounded negative control. Synthetic HTTP servers, dedicated networks, no Core/R2/credentials.
import {d,inspect,ROUTE_IMAGE,NODE_IMAGE_TAG,writeEvidence,utc} from './lib.mjs';
const stamp=utc(),name='arma2-r42-blocker-'+stamp.toLowerCase(),internal=name+'-internal',external=name+'-egress';
const gw=name+'-gateway',proxy=name+'-proxy';
const containers=[],networks=[],report={stamp,scope:'synthetic servers only; no Core, R2 or credentials',probes:[]};
const helper=code=>d(['run','--rm','--pull','never','--network','container:'+gw,'--cap-drop','ALL','--cap-add','NET_ADMIN','--entrypoint','sh',ROUTE_IMAGE,'-c',code]).stdout.trim();
try {
  for(const [network,args] of [[internal,['--internal']],[external,[]]]) {d(['network','create',...args,'--label','arma2.r4.run='+name,network]);networks.push(network);}
  const start=(container,code,extra=[])=>{d(['run','-d','--pull','never','--name',container,'--label','arma2.r4.run='+name,'--network',internal,'--read-only','--cap-drop','ALL',...extra,NODE_IMAGE_TAG,'node','-e',code]);containers.push(container);};
  start(gw,"require('http').createServer((q,s)=>{console.log('GATEWAY_REQUEST');s.setHeader('cache-control','no-store');s.end('GATEWAY')}).listen(9000,'0.0.0.0')");
  // Exact ingress upstream/error behavior of the failing run, including its missing no-store.
  start(proxy,`const http=require('http');http.createServer((req,res)=>{const upstream=http.request({hostname:'${gw}',port:9000,path:req.url,method:req.method,headers:req.headers,timeout:10000},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res)});upstream.on('timeout',()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end('UNAVAILABLE')});req.pipe(upstream)}).listen(9000,'0.0.0.0')`,['-p','127.0.0.1::9000']);
  d(['network','connect',external,proxy]);
  const proxyIP=inspect(proxy).NetworkSettings.Networks[internal].IPAddress;
  const route=helper('ip -f inet route').split('\n').find(l=>l.includes('scope link'));
  const subnet=route.split(' ')[0],dev=route.match(/dev (\S+)/)[1];
  helper(`ip route replace ${proxyIP}/32 dev ${dev} && ip route del ${subnet} dev ${dev} && ip route replace unreachable default`);
  const port=inspect(proxy).NetworkSettings.Ports['9000/tcp'][0].HostPort;
  async function probe(stage){const at=Date.now();try{const r=await fetch('http://127.0.0.1:'+port+'/torneos-gateway/health',{signal:AbortSignal.timeout(25000)});report.probes.push({stage,httpResponse:true,status:r.status,cacheControl:r.headers.get('cache-control'),body:await r.text(),ms:Date.now()-at});}catch(e){report.probes.push({stage,httpResponse:false,name:e.name,message:e.message,causeCode:e.cause?.code,ms:Date.now()-at});}}
  await probe('route present');
  const logsBefore=d(['logs',gw]).stdout;
  helper(`ip route del ${proxyIP}/32 dev ${dev}`);
  report.routesDuring=helper('ip -f inet route');
  report.returnRoute=d(['run','--rm','--pull','never','--network','container:'+gw,'--entrypoint','sh',ROUTE_IMAGE,'-c',`ip route get ${proxyIP}`],{ok:true}).stderr.trim();
  try {await probe('proxy route removed');report.gatewayReceivedDuringFault=d(['logs',gw]).stdout!==logsBefore;}
  finally {helper(`ip route replace ${proxyIP}/32 dev ${dev}`);}
  await probe('route restored');
} finally {
  for(const c of containers.reverse())d(['rm','-f',c],{ok:true});
  for(const n of networks.reverse())d(['network','rm',n],{ok:true});
  report.cleanup=!d(['ps','-a','--filter','label=arma2.r4.run='+name,'--format','{{.ID}}']).stdout.trim()&&!d(['network','ls','--filter','label=arma2.r4.run='+name,'--format','{{.ID}}']).stdout.trim();
  console.log(writeEvidence('r42-blocker-transport-diagnostic',report,stamp));
  console.log(JSON.stringify(report,null,2));
}
