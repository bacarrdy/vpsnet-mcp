import assert from 'node:assert/strict';
import {createServer, request} from 'node:http';
import {once} from 'node:events';
import test from 'node:test';
const service_id='VP12345',group='2f186a34-88a3-49fc-93e8-71931b212867';
const path=`/account/networking/services/${service_id}/public-firewall`;
const idempotencyKey='public-firewall-fixture-0001';
const readNames=['get_service_public_firewall'];
const writeNames=['set_service_public_firewall','retry_service_public_firewall','create_service_public_firewall_group'];
async function harness(t, options={}){
 const resource='https://mcp.vpsnet.com/mcp',issuer='https://api.vpsnet.com/oauth/mcp',calls=[];
 const tokens={read:'vpsnet_'+'a'.repeat(43),manage:'vpsnet_'+'b'.repeat(43)};
 const api=createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString();
  res.setHeader('content-type','application/json');
  if(req.url==='/oauth/mcp/introspect')res.end(JSON.stringify({active:true,aud:resource,iss:issuer,sub:'fixture',grant_id:'fixture',services:[],exp:Date.now()/1000+300,scope:req.headers.authorization===`Bearer ${tokens.manage}`?'networking:manage':'networking:read'}));
  else{calls.push({method:req.method,path:req.url,body:raw?JSON.parse(raw):undefined,key:req.headers['idempotency-key']});
   if(options.lock&&req.method!=='GET'){res.statusCode=423;res.end(JSON.stringify({code:'serviceTwoFactorLocked',serviceTwoFactorLocked:true,reason:'assistantNotAllowed',unlockAvailable:false,orderNo:service_id,error_detail:{message:'synthetic-secret-never-return'}}));return;}
   res.end(JSON.stringify({capability:{available:true,groups_manage:true},policy:{generation:1,protected:false,state:'pending',private_key:'synthetic-never-return'},groups:[{id:group,public_eligible:options.eligible??true,rules:options.rules??[{direction:"ingress"}]}]}));}
 });api.listen(0,'127.0.0.1');await once(api,'listening');
 const prior=process.env.VPSNET_API_URL;process.env.VPSNET_API_URL=`http://127.0.0.1:${api.address().port}`;
 const {createRemoteServer}=await import('../build/http-server.js');const remote=createRemoteServer({resource,issuer});remote.listen(0,'127.0.0.1');await once(remote,'listening');
 t.after(()=>{if(prior===undefined)delete process.env.VPSNET_API_URL;else process.env.VPSNET_API_URL=prior;remote.closeAllConnections();remote.close();api.closeAllConnections();api.close();});
 const rpc=(grant,method,params)=>new Promise((resolve,reject)=>{
  const req=request({hostname:'127.0.0.1',port:remote.address().port,path:'/mcp',method:'POST',headers:{host:'mcp.vpsnet.com',authorization:`Bearer ${tokens[grant]}`,'content-type':'application/json',accept:'application/json, text/event-stream'}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,raw,body:JSON.parse(raw)}));});req.on('error',reject);req.end(JSON.stringify({jsonrpc:'2.0',id:1,method,params}));
 });return{calls,rpc,call:(grant,name,args)=>rpc(grant,'tools/call',{name,arguments:args})};
}
test('public firewall real HTTP discovery declares strict owned-service inputs and exact read/manage scopes without API operations',async t=>{
 const{rpc,calls}=await harness(t);for(const grant of ['read','manage']){
  const result=await rpc(grant,'tools/list');assert.equal(result.status,200);const tools=new Map(result.body.result.tools.map(x=>[x.name,x]));
  for(const name of [...readNames,...writeNames]){const tool=tools.get(name);assert.ok(tool,name);assert.equal(tool.inputSchema.additionalProperties,false);assert.equal(tool.inputSchema.properties.service_id.type,'string');assert.equal(tool.inputSchema.properties.project_id,undefined);assert.deepEqual(tool._meta.securitySchemes[0].scopes,[readNames.includes(name)?'networking:read':'networking:manage']);assert.deepEqual(tool.securitySchemes,tool._meta.securitySchemes);}
  assert.equal(tools.get('retry_service_public_firewall').inputSchema.properties.idempotencyKey,undefined);
  assert.equal(tools.get('set_service_public_firewall').annotations.destructiveHint,true);
 }assert.equal(calls.length,0);
});
test('public firewall exact body/header custody, removal approval, bootstrap and retry resource polling',async t=>{
 const{calls,call}=await harness(t);
 const cases=[
  ['get_service_public_firewall',{service_id},'GET',path,undefined,'read'],
  ['set_service_public_firewall',{service_id,expected_generation:0,group_ids:[group],desired_state:'present',idempotencyKey},'PUT',path,{expected_generation:0,group_ids:[group],desired_state:'present'}],
  ['set_service_public_firewall',{service_id,expected_generation:8,group_ids:[],desired_state:'absent',acknowledge_removal:true,idempotencyKey:'x'.repeat(200)},'PUT',path,{expected_generation:8,group_ids:[],desired_state:'absent'}],
  ['retry_service_public_firewall',{service_id},'POST',path+'/retry',{}],
  ['create_service_public_firewall_group',{service_id,name:'fixture',rules:[],egress_policy:'rules_only',idempotencyKey},'POST',path+'/groups',{name:'fixture',rules:[],egress_policy:'rules_only'}],
 ];
 for(const[name,args,method,url,body,grant='manage']of cases){const result=await call(grant,name,args);assert.notEqual(result.body.result?.isError,true,result.raw);assert.deepEqual(calls.at(-1),{method,path:url,body,key:args.idempotencyKey});assert.doesNotMatch(result.raw,/synthetic-never-return/);assert.equal(JSON.parse(result.body.result.content[0].text).policy.protected,false);if(method!=='GET'){assert.match(result.raw,/get_service_public_firewall/);assert.doesNotMatch(result.raw,/get_networking_operation/);}}
 const before=calls.length;
 for(const[name,args]of cases.filter(([name])=>writeNames.includes(name)))assert.match((await call('read',name,args)).raw,/insufficient_scope/);
 const base={service_id,expected_generation:0,group_ids:[],desired_state:'present',idempotencyKey};
 const bad=[['set_service_public_firewall',{...base,desired_state:'absent'}],['set_service_public_firewall',{...base,desired_state:'absent',group_ids:[group],acknowledge_removal:true}],['set_service_public_firewall',{...base,group_ids:[group,group]}],['set_service_public_firewall',{...base,idempotencyKey:'x'.repeat(201)}],['set_service_public_firewall',{...base,node_id:1}],['retry_service_public_firewall',{service_id,idempotencyKey}],['create_service_public_firewall_group',{service_id,name:'fixture',rules:[],idempotencyKey:'bad:key:0001'}]];
 const rule={direction:'ingress',ether_type:'IPv4',protocol:'icmp',remote_cidr:'203.0.113.0/24'};
 bad.push(['create_service_public_firewall_group',{service_id,name:'fixture',rules:[{...rule,icmp_type:8}],idempotencyKey}],['create_service_public_firewall_group',{service_id,name:'fixture',rules:[{...rule,remote_group_id:group}],idempotencyKey}]);
 for(const[name,args]of bad)assert.equal((await call('manage',name,args)).body.result?.isError,true,name);assert.equal(calls.length,before);
});


test('public assignment preflight rejects ineligible scope and requires deliberate no-inbound acknowledgement from current rules',async t=>{
 const {calls,call}=await harness(t,{rules:[]});
 const args={service_id,expected_generation:0,group_ids:[group],desired_state:'present',idempotencyKey};
 const denied=await call('manage','set_service_public_firewall',args);
 assert.match(denied.raw,/acknowledge_no_inbound/);assert.equal(calls.filter(x=>x.method==='PUT').length,0);
 const accepted=await call('manage','set_service_public_firewall',{...args,acknowledge_no_inbound:true});
 assert.notEqual(accepted.body.result?.isError,true,accepted.raw);
 assert.deepEqual(calls.at(-1).body,{expected_generation:0,group_ids:[group],desired_state:'present'});
});
test('acknowledgement cannot qualify a network-local or default group',async t=>{
 const {calls,call}=await harness(t,{eligible:false});
 const result=await call('manage','set_service_public_firewall',{service_id,expected_generation:0,group_ids:[group],desired_state:'present',idempotencyKey,acknowledge_no_inbound:true});
 assert.match(result.raw,/public-eligible/);assert.equal(calls.filter(x=>x.method==='PUT').length,0);
});

test('typed service 2FA refusals survive secret-safe projection without retry or raw detail',async t=>{
 const {calls,call}=await harness(t,{lock:true});
 const result=await call('manage','retry_service_public_firewall',{service_id});
 assert.equal(result.body.result.isError,true);assert.doesNotMatch(result.raw,/synthetic-secret-never-return/);
 assert.deepEqual(JSON.parse(result.body.result.content[0].text),{http_status:423,code:'serviceTwoFactorLocked',serviceTwoFactorLocked:true,reason:'assistantNotAllowed',unlockAvailable:false,orderNo:service_id});
 assert.equal(calls.length,1);
});
