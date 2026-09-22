import test from 'node:test';
import assert from 'node:assert/strict';
import {CORE,allowedRequest,allowedResponse,publicIPv4} from './proxy.mjs';
test('exact authority; no absolute URL, wildcard, CONNECT or upgrade tunnel',()=>{
 assert.equal(allowedRequest(CORE,'/auth/v1/health','GET'),true);
 for(const host of ['google.com','rcyuuoaqfwcembdajcss.supabase.co','other.supabase.co',CORE+'.',CORE+':444','1.1.1.1'])assert.equal(allowedRequest(host,'/','GET'),false);
 for(const url of ['https://google.com/','//google.com/','/\\google.com'])assert.equal(allowedRequest(CORE,url,'GET'),false);
 assert.equal(allowedRequest(CORE,'/','CONNECT'),false);
});
test('all redirects fail closed including Location on a non-3xx response',()=>{
 for(const status of [301,302,303,307,308])for(const location of ['https://google.com/','//github.com/','/relative',`https://${CORE}/next`])assert.equal(allowedResponse(status,{location}),false);
 assert.equal(allowedResponse(200,{location:'https://google.com'}),false);
 assert.equal(allowedResponse(200,{}),true);
});

test('DNS rebinding cannot select local, reserved or IPv6 addresses',()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.27.0.1','192.168.1.1','100.64.0.1','198.18.0.1','192.0.2.1','198.51.100.1','203.0.113.1','224.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(publicIPv4(ip),false);
 assert.equal(publicIPv4('1.1.1.1'),true);
});

import http from 'node:http';
import {forwardIngress,faultMatches} from './proxy.mjs';
const listen = server => new Promise(resolve => server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const close = server => new Promise(resolve => {server.closeAllConnections();server.close(resolve);});
const request = (port,path='/torneos-gateway/health',host='127.0.0.1:58431') => new Promise((resolve,reject)=>{
  http.get({hostname:'127.0.0.1',port,path,headers:{host}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));}).on('error',reject);
});
test('ingress no-store covers success, passthrough 401/403/503, and proxy-owned denial/unavailability',async()=>{
  let status=200;
  const upstream=http.createServer((_req,res)=>{res.writeHead(status,{'cache-control':'public, max-age=3600'});res.end('upstream');});
  const upstreamPort=await listen(upstream);
  const ingress=http.createServer((req,res)=>forwardIngress(req,res,'127.0.0.1',upstreamPort));
  const port=await listen(ingress);
  try {
    for(const code of [200,401,403,503]) {
      status=code;const r=await request(port);
      assert.equal(r.status,code);assert.equal(r.body,'upstream');assert.equal(r.headers['cache-control'],'no-store');
    }
    const denied=await request(port,'/forbidden');assert.equal(denied.status,403);assert.equal(denied.headers['cache-control'],'no-store');
    await close(upstream);
    const unavailable=await request(port);assert.equal(unavailable.status,503);assert.equal(unavailable.body,'UNAVAILABLE');assert.equal(unavailable.headers['cache-control'],'no-store');
  } finally {if(upstream.listening)await close(upstream);await close(ingress);}
});
test('fault scopes separate Core Auth from contract; empty control preserves all traffic',()=>{
  for(const mode of ['', 'auth','contract']) {
    assert.equal(faultMatches(mode,'/auth/v1/health'),mode==='auth');
    assert.equal(faultMatches(mode,'/auth/v1/user'),mode==='auth');
    assert.equal(faultMatches(mode,'/functions/v1/torneos-core-contract/v1/session'),mode==='contract');
    assert.equal(faultMatches(mode,'/torneos-gateway/health'),false);
  }
  assert.equal(faultMatches('invalid','/auth/v1/health'),true);
});
