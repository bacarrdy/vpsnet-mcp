import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createVpsnetServer } from '../build/index.js';

const gateway_id = '2f186a34-88a3-49fc-93e8-71931b212867';
const peer_id = 'a22093d5-985a-443c-9a93-e0dcf6609d84';
const subscription_id = '550e8400-e29b-41d4-a716-446655440000';
const reveal_public_key = Buffer.alloc(32, 1).toString('base64');
const sealed_secret = {
  ephemeral_public_key: Buffer.alloc(32, 2).toString('base64'),
  nonce: Buffer.alloc(24, 3).toString('base64'),
  ciphertext: Buffer.alloc(64, 4).toString('base64'),
};
const path = `/account/networking/appliances/vpn-gateways/${gateway_id}/peers/${peer_id}/health-webhooks`;
const destination = 'https://hooks.example.com/private/integration-token';
const args = { gateway_id, peer_id };
const content = result => JSON.parse(result.content[0].text);

async function harness(t, respond) {
  const requests = [];
  const backend = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const item = { method: req.method, path: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
    requests.push(item);
    const reply = respond(item);
    res.writeHead(reply.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(async () => { backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve)); });
  const client = new Client({ name: 'vpn-health-webhook-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['build/index.js'],
    env: { PATH: process.env.PATH, VPSNET_API_KEY: 'test-key', VPSNET_API_URL: `http://127.0.0.1:${backend.address().port}` } }));
  t.after(() => client.close());
  return { requests, call: (name, arguments_) => client.callTool({ name, arguments: arguments_ }) };
}

test('webhook tools expose read/manage scopes and a read-only OAuth grant cannot write to backend', async t => {
  for (const scopes of [['networking:read'], ['networking:manage']]) {
    const server = createVpsnetServer({ remoteScopes: scopes });
    const client = new Client({ name: 'webhook-scope', version: '1' });
    const [left, right] = InMemoryTransport.createLinkedPair();
    await server.connect(right); await client.connect(left);
    const tools = new Map((await client.listTools()).tools.map(tool => [tool.name, tool]));
    for (const [name, required, readOnly] of [
      ['list_network_vpn_site_health_webhooks', 'networking:read', true],
      ['create_network_vpn_site_health_webhook', 'networking:manage', false],
      ['delete_network_vpn_site_health_webhook', 'networking:manage', false],
    ]) {
      assert.deepEqual(tools.get(name)._meta.securitySchemes[0].scopes, [required]);
      assert.equal(tools.get(name).annotations.readOnlyHint, readOnly);
    }
    await client.close(); await server.close();
  }
  const resource = 'https://mcp.vpsnet.com/mcp', issuer = 'https://api.vpsnet.com/oauth/mcp';
  let writes = 0;
  const backend = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/oauth/mcp/introspect') res.end(JSON.stringify({ active: true, aud: resource, iss: issuer,
      exp: Date.now() / 1000 + 300, sub: 'tenant-1', grant_id: 'grant-1', scope: 'networking:read', services: [] }));
    else { writes++; res.end('{"accepted":true}'); }
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  const previous = process.env.VPSNET_API_URL;
  process.env.VPSNET_API_URL = `http://127.0.0.1:${backend.address().port}`;
  const { createRemoteServer } = await import('../build/http-server.js');
  const remote = createRemoteServer({ resource, issuer });
  remote.listen(0, '127.0.0.1'); await once(remote, 'listening');
  t.after(() => { if (previous === undefined) delete process.env.VPSNET_API_URL; else process.env.VPSNET_API_URL = previous;
    remote.closeAllConnections(); remote.close(); backend.closeAllConnections(); backend.close(); });
  for (const [name, arguments_] of [
    ['create_network_vpn_site_health_webhook', { ...args, url: destination, reveal_public_key }],
    ['delete_network_vpn_site_health_webhook', { ...args, subscription_id }],
  ]) {
    const response = await new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: remote.address().port, path: '/mcp', method: 'POST', headers: {
        host: 'mcp.vpsnet.com', authorization: `Bearer vpsnet_${'a'.repeat(43)}`,
        'content-type': 'application/json', accept: 'application/json, text/event-stream' } }, res => {
        let raw = ''; res.on('data', chunk => raw += chunk); res.on('end', () => resolve(raw));
      }); req.on('error', reject); req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: arguments_ } }));
    });
    assert.match(response, /insufficient_scope/);
  }
  assert.equal(writes, 0);
});

test('subscribe, list and delete forward exact API contract and keep sealed secret and host-only display', async t => {
  const subscription = { id: subscription_id, url: destination, enabled: true, created_at: '2026-11-02 10:00:00', last_delivery: null,
    private_url: destination };
  const { call, requests } = await harness(t, req => req.method === 'POST'
    ? { status: 201, body: { subscription, sealed_secret, secret: 'raw-fixture-secret', nested: { signing_secret: 'raw-fixture-secret' } } }
    : req.method === 'GET' ? { status: 200, body: { subscriptions: [subscription], secret: 'raw-fixture-secret' } }
      : { status: 200, body: { removed: true } });
  const created = await call('create_network_vpn_site_health_webhook', { ...args, url: destination, reveal_public_key });
  assert.equal(created.isError, undefined);
  assert.equal(requests[0].method, 'POST'); assert.equal(requests[0].path, path);
  assert.deepEqual(requests[0].body, { url: destination, reveal_public_key });
  assert.equal(requests[0].headers['idempotency-key'], undefined);
  assert.deepEqual(content(created).sealed_secret, sealed_secret);
  assert.equal(content(created).subscription.url, 'https://hooks.example.com');
  assert.equal(content(created).secret, undefined);
  assert.equal(content(created).nested, undefined);
  assert.equal(created.content.length, 1, 'immediate subscription has no fabricated operation follow-up');
  const listed = await call('list_network_vpn_site_health_webhooks', args);
  assert.equal(requests[1].method, 'GET'); assert.equal(requests[1].path, path);
  assert.equal(content(listed).subscriptions[0].url, 'https://hooks.example.com');
  assert.doesNotMatch(JSON.stringify(listed), /private\/integration-token|raw-fixture-secret/);
  const deleted = await call('delete_network_vpn_site_health_webhook', { ...args, subscription_id });
  assert.deepEqual([requests[2].method, requests[2].path, requests[2].body], ['DELETE', `${path}/${subscription_id}`, undefined]);
  assert.deepEqual(content(deleted), { removed: true });
  assert.equal(deleted.content.length, 1, 'immediate removal has no fabricated operation follow-up');
});

test('invalid webhook inputs stop before HTTP; typed backend refusals stay typed without secret or URL echo', async t => {
  let createCalls = 0;
  const { call, requests } = await harness(t, req => {
    if (req.method === 'POST') createCalls++;
    return { status: req.method === 'POST' ? createCalls === 1 ? 409 : 422 : 404,
      body: { reason_code: req.method === 'POST' ? createCalls === 1 ? 'vpn_site_webhook_limit' : 'vpn_site_webhook_invalid' : 'vpn_site_webhook_not_found',
        message: destination, detail: 'raw-fixture-secret' } };
  });
  const invalid = [
    ['create_network_vpn_site_health_webhook', { ...args, url: destination }],
    ['create_network_vpn_site_health_webhook', { ...args, url: 'https://hooks.example.com/?token=credential', reveal_public_key }],
    ['create_network_vpn_site_health_webhook', { ...args, url: destination, reveal_public_key: reveal_public_key.slice(0, -2) + 'F=' }],
    ['create_network_vpn_site_health_webhook', { ...args, url: destination, reveal_public_key, customer_id: 7 }],
    ['create_network_vpn_site_health_webhook', { ...args, url: destination, reveal_public_key, reveal_private_key: 'raw-fixture-secret' }],
    ['list_network_vpn_site_health_webhooks', { gateway_id: gateway_id.toUpperCase(), peer_id }],
    ['delete_network_vpn_site_health_webhook', { ...args, subscription_id: '../other' }],
  ];
  for (const [name, arguments_] of invalid) assert.equal((await call(name, arguments_)).isError, true);
  assert.equal(requests.length, 0);
  const conflict = await call('create_network_vpn_site_health_webhook', { ...args, url: destination, reveal_public_key });
  assert.deepEqual(content(conflict), { http_status: 409, reason_code: 'vpn_site_webhook_limit' });
  const missing = await call('delete_network_vpn_site_health_webhook', { ...args, subscription_id });
  assert.deepEqual(content(missing), { http_status: 404, reason_code: 'vpn_site_webhook_not_found' });
  const refused = await call('create_network_vpn_site_health_webhook', { ...args, url: destination, reveal_public_key });
  assert.deepEqual(content(refused), { http_status: 422, reason_code: 'vpn_site_webhook_invalid' });
  assert.equal(requests.length, 3, 'no retries');
  for (const result of [conflict, missing, refused]) assert.doesNotMatch(JSON.stringify(result), /private\/integration-token|raw-fixture-secret/);
});

test('malformed sealed_secret cannot smuggle extra plaintext fields', async t => {
  const { call } = await harness(t, () => ({ status: 201, body: {
    subscription: { id: subscription_id, url: destination, enabled: true, created_at: '2026-11-02 10:00:00', last_delivery: null },
    sealed_secret: { ...sealed_secret, secret: 'raw-fixture-secret' }, private_url: destination,
  } }));
  const result = await call('create_network_vpn_site_health_webhook', { ...args, url: destination, reveal_public_key });
  assert.equal(content(result).sealed_secret, '[invalid sealed material]');
  assert.equal(content(result).private_url, undefined);
  assert.doesNotMatch(JSON.stringify(result), /raw-fixture-secret|private\/integration-token/);
});
