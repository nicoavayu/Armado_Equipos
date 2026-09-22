import http from 'node:http';
import fs from 'node:fs';
import https from 'node:https';
import tls from 'node:tls';
import { lookup } from 'node:dns';
import { isIP } from 'node:net';
export const CORE = 'hhyvmhgpapyuzjgxfnqv.supabase.co';
export function allowedRequest(host, path, method) {
  return host === CORE && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') && ['GET','POST','HEAD','OPTIONS'].includes(method);
}
export function allowedResponse(status, headers) { return !(status >= 300 && status < 400) && !headers.location; }
// Public IPv4 only; prevent DNS rebinding into local/metadata ranges. Fail closed on IPv6.
export function publicIPv4(ip) {
  if (isIP(ip) !== 4) return false;
  const [a,b,c] = ip.split('.').map(Number);
  return !(a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===100&&b>=64&&b<=127) || (a===198&&(b===18||b===19)) || (a===192&&b===0&&(c===0||c===2)) || (a===192&&b===88&&c===99) || (a===198&&b===51&&c===100) || (a===203&&b===0&&c===113));
}
function exactLookup(host, options, cb) {
  if (host !== CORE) return cb(new Error('DENY'));
  lookup(CORE, {family:4,all:true}, (err, rows) => {
    if (err || !rows.length || rows.some(r=>!publicIPv4(r.address))) return cb(new Error('DNS_DENY'));
    if (options?.all) cb(null,rows); else cb(null,rows[0].address,4);
  });
}
// Only the run operator can write this local tmpfs file; there is no HTTP fault-control endpoint.
export function faultMatches(mode, path) {
  if (mode === 'auth') return path.startsWith('/auth/v1/');
  if (mode === 'contract') return path.startsWith('/functions/v1/torneos-core-contract/');
  return mode !== ''; // malformed control fails closed
}
export function forwardIngress(req,res,gatewayHost,port=9000) {
  res.setHeader('cache-control','no-store');
  if(req.headers.host!=='127.0.0.1:58431'||!(req.url==='/torneos-gateway'||req.url.startsWith('/torneos-gateway/'))){res.writeHead(403);res.end('DENY');return;}
  const headers={...req.headers,host:'127.0.0.1:58431'};
  delete headers['x-forwarded-host'];delete headers.forwarded;delete headers['proxy-authorization'];
  const upstream=http.request({hostname:gatewayHost,port,path:req.url,method:req.method,headers,timeout:10000},response=>{
    res.writeHead(response.statusCode,{...response.headers,'cache-control':'no-store'});response.pipe(res);
  });
  upstream.on('timeout',()=>upstream.destroy());
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end('UNAVAILABLE');});
  req.on('error',()=>upstream.destroy());req.pipe(upstream);
}
export async function main() {
  let raw=''; for await (const chunk of process.stdin) { raw+=chunk; if(raw.length>20000) throw new Error('INPUT'); }
  let doc=JSON.parse(raw); raw='';
  const faultEnabled=Boolean(doc.gatewayHost);
  const context=tls.createSecureContext({key:doc.key,cert:doc.cert});
  const server=https.createServer({key:doc.key,cert:doc.cert,minVersion:'TLSv1.2',
    SNICallback:(name,cb)=>name===CORE?cb(null,context):cb(new Error('SNI_DENY'))}, (req,res)=>{
    if (req.socket.servername!==CORE || !allowedRequest(req.headers.host||'',req.url||'',req.method||'')) {res.writeHead(403);res.end('DENY');return;}
    if(faultEnabled) {
      let mode='';
      try { mode=fs.readFileSync('/fault/mode','utf8'); } catch(e) { if(e.code!=='ENOENT') mode='invalid'; }
      if(faultMatches(mode,req.url)) { console.log('R42_FAULT '+mode);req.socket.destroy();return; }
    }
    const headers={...req.headers,host:CORE};
    for (const k of ['connection','proxy-authorization','proxy-connection','upgrade','forwarded','x-forwarded-host','x-forwarded-proto']) delete headers[k];
    const upstream=https.request({hostname:CORE,servername:CORE,port:443,path:req.url,method:req.method,headers,
      rejectUnauthorized:true,lookup:exactLookup,timeout:6000}, response=>{
      if(!allowedResponse(response.statusCode,response.headers)){response.destroy();res.writeHead(502);res.end('REDIRECT_DENY');return;}
      res.writeHead(response.statusCode,response.headers);response.pipe(res);
    });
    upstream.on('timeout',()=>upstream.destroy());
    upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('UPSTREAM_DENY');});
    req.on('error',()=>upstream.destroy());req.pipe(upstream);
  });
  server.on('secureConnection',socket=>{if(socket.servername!==CORE)socket.destroy();});
  server.on('connect',(_req,socket)=>socket.destroy());
  server.on('upgrade',(_req,socket)=>socket.destroy());
  server.on('tlsClientError',()=>{});
  if(doc.gatewayHost){
    if(!/^arma2-r42-[a-z0-9-]+-gateway$/.test(doc.gatewayHost))throw new Error('INGRESS_TARGET');
    const gatewayHost=doc.gatewayHost;
    http.createServer((req,res)=>forwardIngress(req,res,gatewayHost)).listen(9000,'0.0.0.0');
  }
  doc=null;
  server.listen(443,'0.0.0.0',()=>console.log('PROXY_READY'));
}
if(process.argv[1]===new URL(import.meta.url).pathname)main().catch(()=>{console.error('PROXY_FAIL_CLOSED');process.exit(1);});
