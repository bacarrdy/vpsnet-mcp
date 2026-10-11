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
  let revoked = false; const received = [];
  const backend = createServer(async (req, res) => {
    const token = req.headers.authorization?.slice(7); const tenant = token === tokens.a ? 'a' : token === tokens.b ? 'b' : null;
    received.push({ path: req.url, token, key: req.headers['x-api-key'] });
    res.setHeader('content-type', 'application/json');
    if (!tenant || revoked) { res.writeHead(401); res.end('{"active":false}'); return; }
    if (req.url === '/oauth/mcp/introspect') {
      res.end(JSON.stringify({ active: true, aud: resource, iss: issuer, exp: Date.now() / 1000 + 300, sub: tenant, grant_id: tenant, scope: tenant === 'a' ? 'services:read' : 'services:read networking:manage', services: ['vp-' + tenant] })); return;
    }
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
  assert.ok(!names.some(n => /order|invoice|payment|api_key|billing|auto_renew|product/.test(n)));
  for (const tool of list.body.result.tools) {
    assert.ok(tool.title?.trim(), `${tool.name} requires a human-readable title`);
    assert.ok(tool.name.length <= 64, tool.name);
    for (const hint of ['readOnlyHint', 'destructiveHint', 'openWorldHint']) assert.equal(typeof tool.annotations[hint], 'boolean', `${tool.name}.${hint}`);
    if (tool.annotations.readOnlyHint) assert.equal(tool.annotations.openWorldHint, false, `${tool.name}: reads stay within the account or VPSnet catalog`);
    assert.equal(tool._meta.securitySchemes[0].type, 'oauth2');
  }
  assert.equal(list.body.result.tools.find(t => t.name === 'open_vm_session').annotations.destructiveHint, true, 'Deploying a temporary SSH key modifies VM access');
  assert.equal(list.body.result.tools.find(t => t.name === 'list_services').annotations.readOnlyHint, true);
  assert.deepEqual(list.body.result.tools.find(t => t.name === 'restart_service')._meta.securitySchemes[0].scopes, ['services:manage']);
  const denied = await call(port, 'POST', '/mcp', tokens.a, { jsonrpc: '2.0', id: 91, method: 'tools/call', params: { name: 'restart_service', arguments: { orderNo: 'vp-a' } } });
  assert.equal(denied.body.result.isError, true);
  assert.match(denied.body.result._meta['mcp/www_authenticate'][0], /services:manage/);
  assert.ok(!received.some(r => r.path.includes('restart')));
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => call(port, 'POST', '/mcp', tokens[i % 2 ? 'b' : 'a'], { jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: { name: 'list_services', arguments: {} } })));
  results.forEach((r, i) => assert.equal(JSON.parse(r.body.result.content[0].text).tenant, i % 2 ? 'b' : 'a'));
  assert.ok(received.every(r => r.key === undefined));
  assert.ok(received.every(r => r.token === tokens.a || r.token === tokens.b));
  revoked = true;
  assert.equal((await call(port, 'POST', '/mcp', tokens.a, { jsonrpc: '2.0', id: 90, method: 'tools/list' })).status, 401);
  const { apiRequest } = await import('../build/api.js');
  await assert.rejects(() => apiRequest('GET', '/account/services'), /authorization|context/i);
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
  const bindings = []; const runtimeRequests = []; let nativeOpenCalls = 0; let deployments = 0; let resumed = false;
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
    if (req.url === '/session/bootstrap') res.end(JSON.stringify({ resumed, session: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expiresAt: Date.now() + 300000 }, ssh: { publicKey: 'test-public-key', expiresAt: Date.now() + 300000 } }));
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
  assert.equal(deployments, 1);
  resumed = true;
  const reconnect = await invoke('open_vm_session', { orderNo: 'vp-a', sessionBinding: data.sessionBinding });
  assert.equal(JSON.parse(reconnect.body.result.content[0].text).keyDeployment.required, false);
  assert.equal(deployments, 1, 'reconnecting must not redeploy a key using a different signed expiry');
  assert.equal(bindings[1], data.sessionBinding);
  const command = await invoke('run_vm_command', { orderNo: 'vp-a', sessionBinding: data.sessionBinding, sessionId: data.sessionId, idempotencyKey: 'os-discovery-test-0001', command: 'cat /etc/os-release' });
  assert.ok(!command.body.result.isError);
  assert.equal(bindings[2], data.sessionBinding);
  assert.match(runtimeRequests.at(-1), /\/operations$/);
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
