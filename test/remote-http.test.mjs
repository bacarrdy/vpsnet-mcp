import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';

const resource = 'https://mcp.vpsnet.com/mcp';
const issuer = 'https://api.vpsnet.com/oauth/mcp';
const tokens = { a: 'vpsnet_' + 'a'.repeat(43), b: 'vpsnet_' + 'b'.repeat(43) };
function call(port, method = 'POST', path = '/mcp', token, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, method, path, headers: { host: 'mcp.vpsnet.com', accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', c => text += c); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null }));
    }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
test('HTTP OAuth discovery, tenant isolation, scoped catalogue, revocation and no credential fallback', async t => {
  let revoked = false; let backendPermissionDenied = false; const received = [];
  const backend = createServer(async (req, res) => {
    const token = req.headers.authorization?.slice(7); const tenant = token === tokens.a ? 'a' : token === tokens.b ? 'b' : null;
    received.push({ path: req.url, token, key: req.headers['x-api-key'] });
    res.setHeader('content-type', 'application/json');
    if (!tenant || revoked) { res.writeHead(401); res.end('{"active":false}'); return; }
    if (req.url === '/oauth/mcp/introspect') {
      res.end(JSON.stringify({ active: true, aud: resource, iss: issuer, exp: Date.now() / 1000 + 300, sub: tenant, grant_id: tenant, scope: tenant === 'a' ? 'services:read' : 'services:read networking:manage', services: ['vp-' + tenant] })); return;
    }
    if (backendPermissionDenied) { res.writeHead(403); res.end(JSON.stringify({error:'insufficient_scope',required_scope:'services:manage'})); return; }
    await new Promise(resolve => setTimeout(resolve, tenant === 'a' ? 30 : 5));
    res.end(JSON.stringify({ success: true, tenant, services: ['vp-' + tenant] }));
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  process.env.VPSNET_API_URL = 'http://127.0.0.1:' + backend.address().port;
  process.env.VPSNET_API_KEY = 'vpsnet_process_secret_should_never_be_used';
  const { createRemoteServer } = await import('../build/http-server.js');
  const remote = createRemoteServer({ resource, issuer }); remote.listen(0, '127.0.0.1'); await once(remote, 'listening');
  t.after(() => { remote.closeAllConnections(); remote.close(); backend.closeAllConnections(); backend.close(); });
  const port = remote.address().port;
  assert.equal((await call(port, 'GET')).status, 401);
  const metadata = await call(port, 'GET', '/.well-known/oauth-protected-resource/mcp');
  assert.equal(metadata.body.resource, resource); assert.deepEqual(metadata.body.authorization_servers, [issuer]);
  assert.match((await call(port)).headers['www-authenticate'], /resource_metadata/);
  assert.equal((await call(port, 'POST', '/mcp', tokens.a, {}, { host: 'attacker.example' })).status, 421);
  assert.equal((await call(port, 'POST', '/mcp', tokens.a, {}, { origin: 'https://attacker.example' })).status, 403);
  const list = await call(port, 'POST', '/mcp', tokens.a, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(list.status, 200);
  const names = list.body.result.tools.map(t => t.name);
  assert.ok(names.includes('list_services')); assert.ok(names.includes('get_connected_account'));
  assert.ok(names.includes('restart_service')); assert.ok(names.includes('open_vm_session'));
  assert.ok(!names.some(n => /^(?:order_|quote_|create_ddns_token|.*(?:invoice|payment|api_key|billing|auto_renew))/.test(n)));
  for (const tool of list.body.result.tools) {
    assert.ok(tool.title?.trim(), `${tool.name} requires a human-readable title`);
    assert.ok(tool.name.length <= 64, tool.name);
    for (const hint of ['readOnlyHint', 'destructiveHint', 'openWorldHint']) assert.equal(typeof tool.annotations[hint], 'boolean', `${tool.name}.${hint}`);
    if (tool.annotations.readOnlyHint) assert.equal(tool.annotations.destructiveHint, false, tool.name);
    assert.equal(tool._meta.securitySchemes[0].type, 'oauth2');
  }
  assert.equal(list.body.result.tools.find(t => t.name === 'open_vm_session').annotations.destructiveHint, false, 'Opening a session does not replace existing access');
  assert.equal(list.body.result.tools.find(t => t.name === 'list_services').annotations.readOnlyHint, true);
  assert.deepEqual(list.body.result.tools.find(t => t.name === 'restart_service')._meta.securitySchemes[0].scopes, ['services:manage']);
  for (const [name, scope] of [['upsert_dns_record', 'dns:write'], ['set_dnssec', 'dnssec:manage'], ['set_domain_nameservers', 'domains:manage'], ['create_free_certificate', 'certificates:manage'], ['enter_service_rescue', 'services:rescue'], ['create_ssh_key', 'ssh_keys:manage'], ['reinstall_os', 'services:reinstall'], ['read_vm_file', 'vm:files:read'], ['write_vm_file', 'vm:files:write'], ['inspect_vm', 'vm:diagnostics'], ['create_vm_file', 'vm:files:write']]) {
    assert.deepEqual(list.body.result.tools.find(t => t.name === name)?._meta.securitySchemes[0].scopes, [scope], name);
  }
  assert.ok(!names.includes('create_ddns_token'));
  for (const name of ['create_vm_file','create_ssh_key','start_service']) assert.equal(list.body.result.tools.find(t => t.name === name).annotations.destructiveHint, false);
  assert.equal(list.body.result.tools.find(t => t.name === 'validate_application_recipe').annotations.readOnlyHint, true);
  assert.equal(list.body.result.tools.find(t => t.name === 'run_vm_command').annotations.openWorldHint, true);
  assert.ok(list.body.result.tools.find(t => t.name === 'list_services').inputSchema.properties.page);
  assert.ok(list.body.result.tools.find(t => t.name === 'list_dns_zones').inputSchema.properties.snapshot);
  for (const name of ['get_pricing', 'get_plan_options', 'get_plan_resources', 'calculate_plan_change', 'get_period_options', 'list_certificate_catalog', 'get_certificate_catalog_product', 'list_domain_tlds', 'check_domain_availability', 'get_domain_ordering_status']) assert.ok(!names.includes(name), name);
  const denied = await call(port, 'POST', '/mcp', tokens.a, { jsonrpc: '2.0', id: 91, method: 'tools/call', params: { name: 'restart_service', arguments: { orderNo: 'vp-a' } } });
  assert.equal(denied.body.result.isError, true);
  assert.match(denied.body.result._meta['mcp/www_authenticate'][0], /services:manage/);
  assert.match(denied.body.result._meta['mcp/www_authenticate'][0], /error_description="[^"]+"/);
  assert.ok(!received.some(r => r.path.includes('restart')));
  const deniedDns = await call(port, 'POST', '/mcp', tokens.a, { jsonrpc: '2.0', id: 92, method: 'tools/call', params: { name: 'list_dns_zones', arguments: {} } });
  assert.equal(deniedDns.body.result.isError, true);
  assert.match(deniedDns.body.result._meta['mcp/www_authenticate'][0], /dns:read/);
  assert.ok(!received.some(r => r.path.includes('/dns/')));
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => call(port, 'POST', '/mcp', tokens[i % 2 ? 'b' : 'a'], { jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: { name: 'list_services', arguments: {} } })));
  results.forEach((r, i) => assert.equal(JSON.parse(r.body.result.content[0].text).tenant, i % 2 ? 'b' : 'a'));
  assert.ok(received.every(r => r.key === undefined));
  assert.ok(received.every(r => r.token === tokens.a || r.token === tokens.b));
  backendPermissionDenied = true;
  const liveDenial = await call(port, 'POST', '/mcp', tokens.a, { jsonrpc: '2.0', id: 93, method: 'tools/call', params: { name: 'list_services', arguments: {} } });
  assert.equal(liveDenial.body.result.isError, true);
  assert.match(liveDenial.body.result._meta['mcp/www_authenticate'][0], /error_description=/);
  assert.match(liveDenial.body.result._meta['mcp/www_authenticate'][0], /scope="services:manage"/);
  revoked = true;
  assert.equal((await call(port, 'POST', '/mcp', tokens.a, { jsonrpc: '2.0', id: 90, method: 'tools/list' })).status, 401);
  const { apiRequest } = await import('../build/api.js');
  await assert.rejects(() => apiRequest('GET', '/account/services'), /authorization|context/i);
});

test('DNS write authority includes read preflights but neither DNSSEC nor unrelated scopes', async () => {
  const { hasScope, supportedScopes } = await import('../build/remote-policy.js');
  assert.equal(hasScope(['dns:write'], 'dns:read'), true);
  assert.equal(hasScope(['dnssec:manage'], 'dns:read'), true);
  assert.equal(hasScope(['dns:write'], 'dnssec:manage'), false);
  assert.equal(hasScope(['services:manage'], 'dns:write'), false);
  assert.equal(hasScope(['services:rescue'], 'services:read'), true);
  assert.equal(hasScope(['ssh_keys:manage'], 'ssh_keys:read'), true);
  assert.equal(hasScope(['ssh_keys:manage'], 'account:manage'), false);
  assert.ok(supportedScopes.join(' ').length <= 512);
});


test('VM runtime pairing cannot send staging sessions to production or an arbitrary endpoint', async () => {
  const { resolveRuntimeBase } = await import('../build/remote-tools.js');
  assert.equal(resolveRuntimeBase('https://api.vpsnet.com'), 'https://ai.vpsnet.com');
  assert.equal(resolveRuntimeBase('https://api.testweb.vpsnet.com'), 'https://api.testweb.vpsnet.com/ai-control');
  assert.throws(() => resolveRuntimeBase('https://api.testweb.vpsnet.com', 'https://ai.vpsnet.com'));
  assert.throws(() => resolveRuntimeBase('https://api.vpsnet.com', 'https://attacker.example'));
  assert.throws(() => resolveRuntimeBase('https://other.vpsnet.com', 'https://ai.vpsnet.com'));
});

test('VM opening generates a binding, preserves explicit reconnects and explains invalid input before execution', async t => {
  const bindings = []; const runtimeRequests = []; let nativeOpenCalls = 0; let deployments = 0; let resumed = false; let deployment = { status: 200, success: true, eventId: 'test-key-deployment', code: null };
  const backend = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (req.url === '/oauth/mcp/introspect') {
      res.end(JSON.stringify({ active: true, aud: resource, iss: issuer, exp: Date.now() / 1000 + 300, sub: 'a', grant_id: 'a', scope: 'services:read vm:exec', services: ['vp-a'] }));
    } else if (req.url === '/account/services/vp-a/mcp/guest-session') {
      nativeOpenCalls++; res.writeHead(404); res.end('{}');
    } else if (req.url === '/account/services/vp-a/mcp/session') {
      bindings.push(JSON.parse(raw).session_binding);
      res.end(JSON.stringify({ success: true, token: 'test-delegated-session' }));
    } else if (req.url === '/account/services/vp-a/mcp/deploy-key') {
      deployments++;
      res.end(JSON.stringify({ success: true, noty: 'test-key-deployment' }));
    } else { res.writeHead(404); res.end('{}'); }
  });
  const ai = createServer(async (req, res) => {
    runtimeRequests.push(req.url); res.setHeader('content-type', 'application/json');
    if (req.url === '/session/bootstrap') res.end(JSON.stringify({ resumed, session: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expiresAt: Date.now() + 300000 }, keyDeployment: deployment }));
    else res.end(JSON.stringify({ id: 'test-operation', state: 'accepted' }));
  });
  backend.listen(0, '127.0.0.1'); ai.listen(0, '127.0.0.1');
  await Promise.all([once(backend, 'listening'), once(ai, 'listening')]);
  process.env.VPSNET_API_URL = 'http://127.0.0.1:' + backend.address().port;
  process.env.VPSNET_AI_URL = 'http://127.0.0.1:' + ai.address().port;
  const { createRemoteServer } = await import('../build/http-server.js');
  const remote = createRemoteServer({ resource, issuer }); remote.listen(0, '127.0.0.1'); await once(remote, 'listening');
  t.after(() => { for (const server of [remote, backend, ai]) { server.closeAllConnections(); server.close(); } delete process.env.VPSNET_AI_URL; });
  const port = remote.address().port;
  const invoke = (name, args) => call(port, 'POST', '/mcp', tokens.a, { jsonrpc: '2.0', id: 101, method: 'tools/call', params: { name, arguments: args } });
  const list = await call(port, 'POST', '/mcp', tokens.a, { jsonrpc: '2.0', id: 102, method: 'tools/list' });
  const opening = list.body.result.tools.find(tool => tool.name === 'open_vm_session');
  assert.ok(!opening.inputSchema.required.includes('sessionBinding'));
  assert.match(opening.inputSchema.properties.sessionBinding.description, /Omit for a new session/);
  const opened = await invoke('open_vm_session', { orderNo: 'vp-a' });
  assert.ok(!opened.body.result.isError, JSON.stringify(opened.body));
  const data = JSON.parse(opened.body.result.content[0].text);
  assert.match(data.sessionBinding, /^[a-f0-9]{32}$/);
  assert.equal(bindings[0], data.sessionBinding);
  assert.ok(!JSON.stringify(opened.body).includes('test-delegated-session'));
  assert.ok(!JSON.stringify(opened.body).includes('test-public-key'));
  assert.equal(deployments, 0, 'runtime owns installation; public endpoint is never called');
  assert.deepEqual(data.keyDeployment, deployment);
  resumed = true;
  const reconnect = await invoke('open_vm_session', { orderNo: 'vp-a', sessionBinding: data.sessionBinding });
  assert.equal(JSON.parse(reconnect.body.result.content[0].text).keyDeployment.required, false);
  assert.equal(deployments, 0, 'reconnecting must not redeploy a key using a different signed expiry');
  assert.equal(bindings[1], data.sessionBinding);
  const command = await invoke('run_vm_command', { orderNo: 'vp-a', sessionBinding: data.sessionBinding, sessionId: data.sessionId, idempotencyKey: 'os-discovery-test-0001', command: 'cat /etc/os-release' });
  assert.ok(!command.body.result.isError);
  assert.equal(bindings[2], data.sessionBinding);
  assert.match(runtimeRequests.at(-1), /\/operations$/);
  resumed = false;
  deployment = {status: 502, success: false, eventId: null, code: 'session_key_deployment_uncertain'};
  const failed = await invoke('open_vm_session', { orderNo: 'vp-a', connectionMethod: 'ssh' });
  assert.deepEqual(JSON.parse(failed.body.result.content[0].text).keyDeployment, deployment);
  assert.equal(deployments, 0, 'failed runtime installation must not fall back to public key deployment');
  const before = bindings.length;
  for (const invalid of ['friendly-session-name', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A'.repeat(32)]) {
    const denied = await invoke('open_vm_session', { orderNo: 'vp-a', sessionBinding: invalid });
    assert.equal(denied.body.result.isError, true);
    assert.match(denied.body.result.content[0].text, /exactly 32 lowercase hexadecimal/);
  }
  assert.equal(bindings.length, before, 'invalid input must not open or lease a session');
  const guestAttempts = nativeOpenCalls;
  const ssh = await invoke('open_vm_session', { orderNo: 'vp-a', connectionMethod: 'ssh' });
  assert.ok(!ssh.body.result.isError);
  assert.equal(JSON.parse(ssh.body.result.content[0].text).executionChannel, 'ssh');
  assert.equal(nativeOpenCalls, guestAttempts, 'explicit SSH is independent of guest-agent availability');
});

test('guest sessions route operations without SSH and never fall back after denial', async t => {
  const requests = []; let denied = false;
  const sessionId = 'aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa';
  const id = 'guest_' + 'a'.repeat(64);
  const backend = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ path: req.url, body });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/oauth/mcp/introspect') {
      res.end(JSON.stringify({ active: true, aud: resource, iss: issuer, exp: Date.now()/1000 + 300, sub: 'a', grant_id: 'a', scope: 'vm:exec vm:files', services: ['vp-a'] }));
    } else if (req.url.endsWith('/guest-session')) {
      if (denied) { res.writeHead(403); res.end('{"code":"access_denied"}'); return; }
      res.end(JSON.stringify({ success: true, executionChannel: 'guest', sessionId, sessionBinding: body.session_binding, capabilities: { maxFileBytes: 32768 } }));
    } else if (req.url.includes('/guest-operations')) {
      res.end(JSON.stringify({ success: true, operation: { id, state: 'running' } }));
    } else { res.writeHead(500); res.end('{"code":"unexpected_ssh_fallback"}'); }
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  process.env.VPSNET_API_URL = 'http://127.0.0.1:' + backend.address().port;
  const { createRemoteServer } = await import('../build/http-server.js');
  const remote = createRemoteServer({ resource, issuer }); remote.listen(0, '127.0.0.1'); await once(remote, 'listening');
  t.after(() => { for (const server of [remote, backend]) { server.closeAllConnections(); server.close(); } });
  const invoke = async (name, args) => (await call(remote.address().port, 'POST', '/mcp', tokens.a, { jsonrpc: '2.0', id: 201, method: 'tools/call', params: { name, arguments: args } })).body.result;
  const opened = await invoke('open_vm_session', { orderNo: 'vp-a' });
  assert.ok(!opened.isError);
  const sessionBinding = JSON.parse(opened.content[0].text).sessionBinding;
  const common = { orderNo: 'vp-a', sessionBinding, sessionId, idempotencyKey: 'test-1-00000000000000000' };
  for (const [name, fields] of [['run_vm_command', { command: 'cat /etc/os-release' }], ['read_vm_file', { path: '/etc/os-release' }], ['write_vm_file', { path: '/tmp/example', content: 'changed', expectedSha256: 'b'.repeat(64) }]]) {
    assert.ok(!(await invoke(name, { ...common, ...fields })).isError);
    assert.equal(requests.at(-1).path, '/account/services/vp-a/mcp/guest-operations');
    assert.equal(requests.at(-1).body.session_id, sessionId);
  }
  for (const [tool, suffix] of [['get_vm_operation', 'status'], ['cancel_vm_operation', 'cancel']]) {
    assert.ok(!(await invoke(tool, { orderNo: 'vp-a', sessionBinding, operationId: id })).isError);
    assert.equal(requests.at(-1).path, '/account/services/vp-a/mcp/guest-operations/' + 'a'.repeat(64) + '/' + suffix);
  }
  denied = true;
  assert.equal((await invoke('open_vm_session', { orderNo: 'vp-a', sessionBinding })).isError, true);
  assert.ok(!requests.some(r => /\/mcp\/(session|deploy-key)$/.test(r.path)));
});

test('Functions execution requires separate OAuth scope, billing acknowledgment and stable mutation keys', async t => {
  let scope = 'functions:manage';
  const received = [];
  const backend = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (req.url === '/oauth/mcp/introspect') {
      res.end(JSON.stringify({ active: true, aud: resource, iss: issuer, exp: Date.now()/1000+300, sub:'a', grant_id:'a', scope, services:[] }));
    } else {
      received.push({ path:req.url, key:req.headers['idempotency-key'], body:raw ? JSON.parse(raw) : {} });
      res.end(JSON.stringify({ success:true, invocation:{id:42, status:'queued'} }));
    }
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  process.env.VPSNET_API_URL = 'http://127.0.0.1:'+backend.address().port;
  const { createRemoteServer } = await import('../build/http-server.js');
  const remote = createRemoteServer({resource, issuer}); remote.listen(0, '127.0.0.1'); await once(remote, 'listening');
  t.after(() => { for (const server of [remote,backend]) { server.closeAllConnections(); server.close(); } });
  const invoke = async (name, args) => (await call(remote.address().port,'POST','/mcp',tokens.a,{jsonrpc:'2.0',id:301,method:'tools/call',params:{name,arguments:args}})).body.result;
  const args = {function_id:1,input:'hello',idempotency_key:'function-run-test-0001',acknowledge_usage_billing:true};
  const denied = await invoke('invoke_function',args);
  assert.equal(denied.isError,true);
  assert.match(denied._meta['mcp/www_authenticate'][0],/functions:invoke/);
  assert.equal(received.length,0);
  scope = 'functions:invoke';
  for (const invalid of [{...args,acknowledge_usage_billing:undefined},{...args,acknowledge_usage_billing:false},{...args,idempotency_key:undefined}]) {
    assert.equal((await invoke('invoke_function',invalid)).isError,true);
  }
  assert.equal(received.length,0,'invalid requests never reach the API');
  for (let n=0;n<2;n++) assert.ok(!(await invoke('invoke_function',args)).isError);
  assert.deepEqual(received[0],received[1],'retries preserve exact body and key');
  assert.deepEqual(received[0],{path:'/account/firecracker/functions/1/invoke',key:args.idempotency_key,body:{acknowledge_usage_billing:true,input:'hello',wait:true}});
  assert.ok(!(await invoke('list_functions',{})).isError,'execution implies reading results');
  scope = 'functions:manage';
  const creation = {name:'test',runtime_os_id:1,code:'print("hello")'};
  const before = received.length;
  assert.equal((await invoke('create_function',creation)).isError,true);
  assert.equal(received.length,before);
  assert.ok(!(await invoke('create_function',{...creation,idempotency_key:'function-create-test-0001'})).isError);
  assert.equal(received.at(-1).key,'function-create-test-0001');
  assert.equal(received.at(-1).body.idempotency_key,undefined);
});


test('remote application diagnostics omit runtime placement while retaining health evidence', async t => {
  const backend = createServer((req,res) => {
    res.setHeader('content-type','application/json');
    if(req.url==='/oauth/mcp/introspect')res.end(JSON.stringify({active:true,aud:resource,iss:issuer,exp:Date.now()/1000+300,sub:'a',grant_id:'a',scope:'applications:read',services:['vp-a']}));
    else res.end(JSON.stringify({success:true,inspection:{id:'check-1',installation_id:'11111111-1111-4111-8111-111111111111',kind:'health',state:'succeeded',result:{health:{status:'healthy',services:[]},worker_node:'internal-runtime',worker_release:'internal-version'}}}));
  });
  backend.listen(0,'127.0.0.1');await once(backend,'listening');
  process.env.VPSNET_API_URL='http://127.0.0.1:'+backend.address().port;
  const {createRemoteServer}=await import('../build/http-server.js');const remote=createRemoteServer({resource,issuer});remote.listen(0,'127.0.0.1');await once(remote,'listening');
  t.after(()=>{for(const s of [remote,backend]){s.closeAllConnections();s.close();}});
  const r=await call(remote.address().port,'POST','/mcp',tokens.a,{jsonrpc:'2.0',id:401,method:'tools/call',params:{name:'get_application_health',arguments:{orderNo:'vp-a',installation_id:'11111111-1111-4111-8111-111111111111'}}});
  assert.ok(!r.body.result.isError,JSON.stringify(r.body));
  const result=JSON.parse(r.body.result.content[0].text).inspection.result;
  assert.equal(result.health.status,'healthy');
  assert.equal(result.worker_node,undefined);assert.equal(result.worker_release,undefined);
});

test('one connection supports approved purchases while catalog clients retain the directory profile', async t => {
  const received = [];
  const backend = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    const ordering = req.headers.authorization === 'Bearer ' + tokens.b;
    if (req.url === '/oauth/mcp/introspect') {
      res.end(JSON.stringify({active:true,aud:resource,orders_available:ordering,iss:issuer,exp:Date.now()/1000+300,sub:'owner',grant_id:'grant',scope:'orders:read orders:servers orders:domains domains:read',services:[]})); return;
    }
    let body='';for await(const chunk of req)body+=chunk;
    received.push({path:req.url,body:body?JSON.parse(body):null,key:req.headers['idempotency-key']});
    res.end(JSON.stringify({success:true,amount_eur:12.1,total_amount_eur:'12.10',quoteToken:'q'.repeat(43),orderno:'VP123'}));
  });
  backend.listen(0,'127.0.0.1');await once(backend,'listening');
  process.env.VPSNET_API_URL='http://127.0.0.1:'+backend.address().port;
  const {createRemoteServer}=await import('../build/http-server.js');
  const remote=createRemoteServer({resource,issuer,ordersEnabled:true});remote.listen(0,'127.0.0.1');await once(remote,'listening');
  t.after(()=>{for(const s of [remote,backend]){s.closeAllConnections();s.close();}});
  const port=remote.address().port;
  const metadata=await call(port,'GET','/.well-known/oauth-protected-resource/mcp');
  assert.equal(metadata.body.resource,resource);assert.ok(metadata.body.scopes_supported.includes('orders:servers'));
  assert.equal((await call(port,'POST','/mcp/orders',tokens.b,{jsonrpc:'2.0',id:1,method:'tools/list'})).status,404);
  const catalog=(await call(port,'POST','/mcp',tokens.a,{jsonrpc:'2.0',id:1,method:'tools/list'})).body.result.tools;
  assert.ok(!catalog.some(t=>t.name==='confirm_service_order'));
  const list=(await call(port,'POST','/mcp',tokens.b,{jsonrpc:'2.0',id:2,method:'tools/list'})).body.result.tools;
  for(const name of ['get_order_plans','quote_service_order','confirm_service_order','quote_domain_register','confirm_domain_register','get_purchase_result'])assert.ok(list.some(x=>x.name===name),name);
  assert.ok(!list.some(x=>x.name==='order_service'));
  const invoke=async(name,args)=>(await call(port,'POST','/mcp',tokens.b,{jsonrpc:'2.0',id:3,method:'tools/call',params:{name,arguments:args}})).body;
  const input={plan:1,sshKey:2,idempotencyKey:'order-test-key-00000001'};
  assert.ok(!(await invoke('quote_service_order',input)).result.isError);
  assert.equal(received.at(-1).path,'/account/mcp/orders/services/quote');
  const count=received.length;
  const denied=await invoke('confirm_service_order',{...input,quoteToken:'q'.repeat(43),expected_total_eur:12.1});
  assert.ok(denied.error || denied.result.isError);assert.equal(received.length,count);
  assert.ok(!(await invoke('confirm_service_order',{...input,quoteToken:'q'.repeat(43),expected_total_eur:12.1,acknowledge_charge:true})).result.isError);
  assert.equal(received.at(-1).path,'/account/mcp/orders/services/confirm');assert.equal(received.at(-1).body.payment.payment,1);
  assert.ok(!(await invoke('confirm_domain_register',{domain:'example.test',idempotencyKey:'domain-test-key-00000001',quoteToken:'q'.repeat(43),expected_total_eur:12.1,acknowledge_charge:true,acknowledge_non_refundable:true})).result.isError);
  assert.equal(received.at(-1).path,'/account/mcp/orders/domains/confirm');assert.equal(received.at(-1).body.expected_total_eur,12.1);
  const directory=(await call(port,'POST','/mcp',tokens.a,{jsonrpc:'2.0',id:4,method:'tools/list'})).body.result.tools;
  for(const tool of list.filter(x=>x.name.includes('order')||x.name.includes('purchase')))assert.ok(!directory.some(x=>x.name===tool.name),tool.name);
});
