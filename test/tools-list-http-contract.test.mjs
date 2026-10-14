import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { descriptorsByName, profiles, readSnapshots, validateDescriptors } from '../scripts/tool-contracts.mjs';

const resource='https://mcp.vpsnet.com/mcp';
const issuer='https://api.vpsnet.com/oauth/mcp';
function rpc(port,token,userAgent) {
  return new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port,path:'/mcp',method:'POST',headers:{host:'mcp.vpsnet.com',
      authorization:`Bearer ${token}`,'user-agent':userAgent,'content-type':'application/json',accept:'application/json, text/event-stream'}},res=>{
      let data='';res.setEncoding('utf8');res.on('data',chunk=>data+=chunk);
      res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}));
    });req.on('error',reject);req.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'}));
  });
}
test('real HTTP tools/list preserves reviewed profiles and canonical security declarations',async t=>{
  const requests=[];
  const tokens={directory:'vpsnet_'+'a'.repeat(43),orders:'vpsnet_'+'b'.repeat(43)};
  const backend=createServer((req,res)=>{
    requests.push(req.url);
    assert.equal(req.method,'POST');assert.equal(req.url,'/oauth/mcp/introspect','Discovery must never invoke a customer operation');
    const profile=req.headers.authorization===`Bearer ${tokens.orders}`?'orders':'directory';
    assert.equal(req.headers.authorization,`Bearer ${tokens[profile]}`);
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({active:true,aud:resource,iss:issuer,exp:Date.now()/1000+300,sub:'fixture',grant_id:`fixture-${profile}`,
      services:['vp-fixture'],scope:profiles[profile].remoteScopes.join(' '),orders_available:profile==='orders'}));
  });
  backend.listen(0,'127.0.0.1');await once(backend,'listening');
  process.env.VPSNET_API_URL=`http://127.0.0.1:${backend.address().port}`;
  const {createRemoteServer}=await import('../build/http-server.js');
  const remote=createRemoteServer({resource,issuer,ordersEnabled:true});
  remote.listen(0,'127.0.0.1');await once(remote,'listening');
  t.after(()=>{remote.closeAllConnections();remote.close();backend.closeAllConnections();backend.close();});
  const expected=readSnapshots();
  for (const profile of ['directory','orders']) {
    let previous;
    for (const userAgent of ['OpenAI-contract-fixture','Claude-contract-fixture']) {
      const response=await rpc(remote.address().port,tokens[profile],userAgent);
      assert.equal(response.status,200);assert.equal(response.body.error,undefined);
      const tools=response.body.result.tools;
      assert.deepEqual(validateDescriptors(profile,tools),[]);
      assert.deepEqual(descriptorsByName(tools),expected[profile].tools,`${profile}: raw HTTP descriptor drift`);
      if (previous) assert.deepEqual(tools,previous,'Host identity does not invent another profile');
      previous=tools;
    }
  }
  assert.equal(requests.length,4);
});
