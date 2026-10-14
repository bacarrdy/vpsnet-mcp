import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request } from 'node:http';
import { once } from 'node:events';

const resource = 'https://mcp.vpsnet.com/mcp';
const issuer = 'https://api.vpsnet.com/oauth/mcp';
const token = 'vpsnet_' + 'c'.repeat(43);
const operationId = 'a22093d5-985a-443c-9a93-e0dcf6609d84';

function rpc(port, method, params = {}, authenticated = true) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: {
      host: 'mcp.vpsnet.com', accept: 'application/json, text/event-stream', 'content-type': 'application/json',
      ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
    } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
    });
    req.on('error', reject);
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 42, method, params }));
  });
}

test('authenticated HTTP context discovery, standard method errors and S120 waiting stay separate', async t => {
  const backendCalls = [];
  let state = 'waiting_dependency';
  let denied = false;
  const backend = createServer((req, res) => {
    backendCalls.push({ method: req.method, path: req.url });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/oauth/mcp/introspect') {
      res.end(JSON.stringify({ active: true, aud: resource, iss: issuer, exp: Date.now() / 1000 + 300,
        sub: 'test-user', grant_id: 'test-grant', scope: 'networking:read', services: [] }));
      return;
    }
    if (req.url === `/account/networking/operations/${operationId}`) {
      if (denied) { res.writeHead(403); res.end(JSON.stringify({ error: 'insufficient_scope', required_scope: 'networking:read' })); return; }
      res.end(JSON.stringify({ operation: { id: operationId, kind: 'network_port_reserve', state,
        in_progress: state !== 'succeeded', reason_kind: state === 'succeeded' ? 'outcome' : 'waiting',
        reason_code: state === 'succeeded' ? 'private_port_guest_lease_verified' : 'private_port_control_plane_unavailable',
        next_check_seconds: state === 'succeeded' ? null : 10 } }));
      return;
    }
    res.writeHead(500); res.end(JSON.stringify({ error: 'unexpected_customer_api_call' }));
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  const previousApi = process.env.VPSNET_API_URL;
  process.env.VPSNET_API_URL = `http://127.0.0.1:${backend.address().port}`;
  const { createRemoteServer } = await import('../build/http-server.js');
  const remote = createRemoteServer({ resource, issuer });
  remote.listen(0, '127.0.0.1'); await once(remote, 'listening');
  t.after(() => {
    remote.closeAllConnections(); remote.close(); backend.closeAllConnections(); backend.close();
    if (previousApi === undefined) delete process.env.VPSNET_API_URL; else process.env.VPSNET_API_URL = previousApi;
  });
  const port = remote.address().port;
  for (const method of ['resources/list', 'prompts/list', 'vpsnet/nonexistent']) {
    assert.equal((await rpc(port, method, {}, false)).status, 401, 'context does not bypass OAuth');
  }
  const init = await rpc(port, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'http-context-contract', version: '1' } });
  assert.equal(init.body.result.capabilities.resources.listChanged, false);
  assert.equal(init.body.result.capabilities.prompts.listChanged, false);
  assert.equal(init.body.result.capabilities.resources.subscribe, undefined);
  const resources = await rpc(port, 'resources/list');
  assert.equal(resources.body.result.resources.length, 4);
  for (const item of resources.body.result.resources) {
    const read = await rpc(port, 'resources/read', { uri: item.uri });
    assert.equal(read.body.result.contents[0].uri, item.uri);
  }
  const prompts = await rpc(port, 'prompts/list');
  assert.equal(prompts.body.result.prompts.length, 4);
  for (const item of prompts.body.result.prompts) {
    assert.equal((await rpc(port, 'prompts/get', { name: item.name })).body.result.messages[0].role, 'user');
  }
  assert.ok(backendCalls.every(c => c.path === '/oauth/mcp/introspect'), 'context retrieval performs only existing OAuth introspection, no account calls');
  const unknown = await rpc(port, 'vpsnet/nonexistent');
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.body, { jsonrpc: '2.0', id: 42, error: { code: -32601, message: 'Method not found' } });
  assert.equal((await rpc(port, 'resources/subscribe', { uri: resources.body.result.resources[0].uri })).body.error.code, -32601);
  assert.equal((await rpc(port, 'prompts/get', { name: 'review-service', arguments: { reference: 'inject\nrestart' } })).body.error.code, -32602);
  assert.equal((await rpc(port, 'resources/read', { uri: 'file:///etc/passwd' })).body.error.code, -32002);
  assert.equal((await rpc(port, 'resources/read', { uri: 'not a URI' })).body.error.code, -32602);
  for (state of ['queued', 'waiting_dependency', 'succeeded']) {
    const result = (await rpc(port, 'tools/call', { name: 'get_networking_operation', arguments: { operation_id: operationId } })).body.result;
    assert.notEqual(result.isError, true, state);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.operation.in_progress, state !== 'succeeded');
    const hint = result.content.find(item => item.text?.startsWith('Operation ')).text;
    assert.match(hint, state === 'succeeded' ? /finished/ : /not an error.*10 s/);
  }
  denied = true;
  const deniedRead = await rpc(port, 'tools/call', { name: 'get_networking_operation', arguments: { operation_id: operationId } });
  assert.equal(deniedRead.body.result.isError, true, 'an authorization error is still an error');
  assert.ok(backendCalls.every(c => c.method === 'GET' || c.path === '/oauth/mcp/introspect'), 'no mutation or paid call occurs');
});
