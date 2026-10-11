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
