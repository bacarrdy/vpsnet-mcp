import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';

const resource = 'https://mcp.vpsnet.com/mcp';
const issuer = 'https://api.vpsnet.com/oauth/mcp';
const token = 'vpsnet_' + 'a'.repeat(43);
function rpc(port, method, params) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, method: 'POST', path: '/mcp',
      headers: { host: 'mcp.vpsnet.com', accept: 'application/json, text/event-stream',
        'content-type': 'application/json', authorization: `Bearer ${token}` } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject); req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
  });
}

test('HTTP account inspection retains grant details and validates its own schema without claiming strict OpenAI profile identity', async t => {
  let payload;
  const paths = [];
  const backend = createServer((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    paths.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/oauth/mcp/introspect') {
      res.end(JSON.stringify({ active: true, aud: resource, iss: issuer, exp: Date.now() / 1000 + 300,
        sub: 'account-a', grant_id: 'grant-a', scope: 'services:read', services: ['vp-a'] }));
    } else {
      assert.equal(req.url, '/account/mcp/profile');
      assert.equal(req.method, 'GET');
      res.end(JSON.stringify(payload));
    }
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  process.env.VPSNET_API_URL = `http://127.0.0.1:${backend.address().port}`;
  const { createRemoteServer } = await import('../build/http-server.js');
  const remote = createRemoteServer({ resource, issuer });
  remote.listen(0, '127.0.0.1'); await once(remote, 'listening');
  t.after(() => { remote.closeAllConnections(); remote.close(); backend.closeAllConnections(); backend.close(); });
  const port = remote.address().port;
  const list = await rpc(port, 'tools/list');
  assert.equal(list.status, 200);
  // Exercise the SDK's client-side result schema, not only raw JSON serialization.
  const tools = list.body.result.tools;
  const parsedTools = ListToolsResultSchema.parse(list.body.result).tools;
  // Older SDK clients strip unknown canonical extension fields but retain the
  // compatibility declaration. Both paths must describe identical authority.
  for (const tool of parsedTools) {
    assert.deepEqual(tool._meta.securitySchemes, tools.find(raw => raw.name === tool.name).securitySchemes);
  }
  const account = tools.find(tool => tool.name === 'get_connected_account');
  assert.equal(account._meta['openai/profile'], undefined);
  assert.equal(account.outputSchema.type, 'object');
  for (const required of ['id', 'name', 'scopes', 'services']) assert.ok(account.outputSchema.required.includes(required));
  assert.ok(account.outputSchema.properties.function_monthly_limit_eur, 'monthly Functions cap is a typed field, not an unvalidated extension');
  assert.ok(!account.outputSchema.required.includes('function_monthly_limit_eur'), 'legacy backends may omit the field');
  assert.match(account.outputSchema.properties.function_monthly_limit_eur.description, /not unlimited|account limits still apply/);
  for (const tool of tools) assert.deepEqual(tool.securitySchemes, tool._meta.securitySchemes, tool.name);
  assert.deepEqual(account.securitySchemes, [{ type: 'oauth2', scopes: [] }]);
  assert.deepEqual(tools.find(tool => tool.name === 'run_vm_command').securitySchemes,
    [{ type: 'oauth2', scopes: ['vm:exec'] }]);

  const base = { id: 'vpsnet:42', name: 'VPSnet account 42', scopes: ['services:read'], services: ['vp-a'] };
  for (payload of [
    { ...base, function_daily_limit_eur: null, function_monthly_limit_eur: null, order_daily_limit_eur: null, order_monthly_limit_eur: null },
    { ...base, function_daily_limit_eur: '12.50', function_monthly_limit_eur: '100.00', order_daily_limit_eur: 10, order_monthly_limit_eur: '40.00' },
    { ...base, function_monthly_limit_eur: 100 },
    base,
  ]) {
    const response = await rpc(port, 'tools/call', { name: 'get_connected_account', arguments: {} });
    assert.equal(response.status, 200);
    assert.notEqual(response.body.result.isError, true, JSON.stringify(response.body));
    assert.deepEqual(response.body.result.structuredContent, payload);
    assert.deepEqual(JSON.parse(response.body.result.content[0].text), payload);
    assert.deepEqual(response.body.result.structuredContent.scopes, ['services:read'], 'a reported spending limit grants no paid Functions scope');
    assert.deepEqual(response.body.result.structuredContent.services, ['vp-a'], 'reading limits does not expand service selection');
    if (!Object.hasOwn(payload, 'function_monthly_limit_eur')) {
      assert.equal(Object.hasOwn(response.body.result.structuredContent, 'function_monthly_limit_eur'), false, 'do not backfill a legacy response with a default');
    }
  }
  for (payload of [
    { ...base, scopes: 'services:read' },
    { ...base, services: 42 },
    { ...base, function_daily_limit_eur: { amount: 10 } },
    { ...base, function_monthly_limit_eur: { amount: 100 } },
    { ...base, function_monthly_limit_eur: -1 },
    { ...base, function_monthly_limit_eur: '-1.00' },
    { ...base, function_monthly_limit_eur: '1e2' },
    { ...base, id: '' },
  ]) {
    const response = await rpc(port, 'tools/call', { name: 'get_connected_account', arguments: {} });
    assert.equal(response.body.result.isError, true, 'the SDK must reject malformed structured output');
    assert.match(response.body.result.content[0].text, /output|structured/i);
  }
  const before = paths.length;
  const denied = await rpc(port, 'tools/call', { name: 'run_vm_command', arguments: {
    orderNo: 'vp-a', sessionBinding: 'a'.repeat(32), sessionId: '11111111-1111-4111-8111-111111111111',
    idempotencyKey: 'readonly-proof-key-01', command: 'id',
  } });
  assert.equal(denied.body.result.isError, true);
  assert.match(denied.body.result._meta['mcp/www_authenticate'][0], /vm:exec/);
  assert.deepEqual(paths.slice(before), ['POST /oauth/mcp/introspect'], 'canonical discovery does not grant execution authority');
});
