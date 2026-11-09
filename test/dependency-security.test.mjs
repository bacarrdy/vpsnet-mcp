import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { z } from 'zod';
import { networkingTools } from '../build/networking-tools.js';
import { applicationActionIdSchema, applicationAdditionalAddressSchema } from '../build/application-contract.js';
import { unboundedInteger, inlineToolInputSchema } from '../build/tool-schema.js';
import { createVpsnetServer } from '../build/index.js';

test('all registered tool validators use patched v4, including cached aliases', async () => {
  for (const profile of ['stdio', 'directory', 'orders']) {
    const server = createVpsnetServer(profile === 'stdio' ? {} : { remoteProfile: profile,
      remoteScopes: ['services:read', 'networking:manage', 'orders:read', 'orders:servers', 'orders:domains'] });
    try {
      for (const [name, tool] of Object.entries(server._registeredTools)) {
        for (const kind of ['inputSchema', 'outputSchema']) {
          if (tool[kind]) assert.ok(tool[kind]._zod, `${profile}.${name}.${kind} must not select the SDK v3 parser`);
        }
      }
    } finally { await server.close(); }
  }
});

test('registered default catalogue preserves all nested payment integer ranges', async () => {
  const server = createVpsnetServer();
  try {
    const tools = Object.entries(server._registeredTools)
      .filter(([, tool]) => tool.inputSchema?.shape?.payment);
    assert.deepEqual(tools.map(([name]) => name).sort(), [
      'confirm_domain_register', 'confirm_domain_renew', 'confirm_domain_restore', 'confirm_domain_transfer',
      'create_backup', 'order_automatic_ssl_domain', 'order_automatic_ssl_subscription',
      'order_certificate', 'order_network_product', 'order_service', 'renew_service',
    ]);
    const positiveIntegerTools = new Set([
      'order_automatic_ssl_domain', 'order_automatic_ssl_subscription', 'order_certificate', 'order_network_product',
    ]);
    for (const [name, tool] of tools) {
      const payment = tool.inputSchema.shape.payment;
      const fields = payment.shape;
      const valid = { payment: 1, ...(fields.successUrl ? { successUrl: '', cancelUrl: '' } : {}) };
      assert.equal(payment.safeParse(valid).success, true, name);
      for (const key of ['payment', 'paymentid'].filter(key => fields[key])) {
        for (const value of [1, Number.MAX_SAFE_INTEGER, 2 ** 54]) {
          const result = payment.safeParse({ ...valid, [key]: value });
          assert.equal(result.success, true, `${name}.${key} accepts ${value}`);
          assert.equal(result.data[key], value);
        }
        // The older service/domain payment schemas deliberately declare number,
        // so do not introduce positive-integer constraints on those tools here.
        for (const value of [0, -1, 1.5]) {
          assert.equal(payment.safeParse({ ...valid, [key]: value }).success, !positiveIntegerTools.has(name),
            `${name}.${key} retains its existing numeric constraints for ${value}`);
        }
        for (const value of ['1', null]) {
          assert.equal(payment.safeParse({ ...valid, [key]: value }).success, false,
            `${name}.${key} rejects ${String(value)}`);
        }
        const schema = z.toJSONSchema(fields[key], { target: 'draft-7', io: 'input' });
        assert.equal(schema.type, positiveIntegerTools.has(name) ? 'integer' : 'number', `${name}.${key}`);
        assert.equal(schema.maximum, undefined, `${name}.${key} must not advertise a new upper bound`);
      }
      if (fields.paymentid) assert.equal(payment.safeParse({ payment: 2 ** 54 }).success, true,
        `${name}.paymentid remains optional`);
    }
  } finally { await server.close(); }
});

test('oversized constrained collections stop before validating elements', () => {
  let visits = 0;
  const schema = z.array(z.string().refine(() => { visits++; return true; })).max(16);
  const result = schema.safeParse(Array(10_000).fill('invalid'));
  assert.equal(result.success, false);
  assert.equal(visits, 0, 'the security fix must run before the element walk');
  assert.equal(result.error.issues.length, 1);
  const grants = networkingTools.find(tool => tool.name === 'create_network_vpn_peer').schema.shape.grants;
  const rejected = grants.safeParse(Array(10_000).fill(0));
  assert.equal(rejected.success, false);
  assert.deepEqual(rejected.error.issues.map(issue => issue.code), ['too_big']);
  assert.equal(grants.safeParse(['203.0.113.1']).success, true);
});

test('migration preserves UUID syntax, integer ranges and published object closure', () => {
  // v3 uuid() checked the UUID layout, without restricting version or variant.
  for (const value of ['00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-ffff-ffff-ffffffffffff', '12345678-1234-0234-0234-123456789abc']) {
    assert.equal(applicationActionIdSchema.safeParse(value).success, true, value);
  }
  assert.equal(applicationActionIdSchema.safeParse('not-a-uuid').success, false);
  for (const value of [1, 2 ** 54]) assert.equal(unboundedInteger().min(1).safeParse(value).success, true);
  assert.equal(unboundedInteger().safeParse(1.5).success, false);
  assert.equal(unboundedInteger().safeParse(Infinity).success, false);
  const address = { zone_id: 2 ** 54, name: '@', approve_dns: true };
  assert.equal(applicationAdditionalAddressSchema.safeParse(address).success, true);
  const sources = networkingTools.find(tool => tool.name === 'check_network_vpn_public_access').schema.shape.services;
  for (const source of ['203.0.113.1', '2001:db8::1', 'fe80::1%eth0']) {
    assert.equal(sources.safeParse([{ service: 'wireguard', allow_from: [source] }]).success, true, source);
  }
  const generation = networkingTools.find(tool => tool.name === 'set_network_vpn_site_bgp').schema.shape.expected_generation;
  assert.equal(generation.safeParse(2 ** 54).success, false, 'explicit safe() bounds remain');
  assert.deepEqual(inlineToolInputSchema({ type: 'object', properties: { value: { type: 'string' } } }, true),
    { type: 'object', properties: { value: { type: 'string' } }, additionalProperties: false });
  assert.deepEqual(inlineToolInputSchema({ type: 'object', properties: {} }, true), { type: 'object', properties: {} });
  assert.deepEqual(inlineToolInputSchema({ type: 'object', properties: { value: {} }, additionalProperties: {} }, true).additionalProperties, {});
});

test('hosted HTTP rejects compressed trailing data and oversized tool collections, then remains usable', async t => {
  const resource = 'https://mcp.example.com/mcp', issuer = 'https://api.example.com/oauth/mcp';
  const token = 'vpsnet_' + 'a'.repeat(43);
  let customerCalls = 0;
  const backend = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url !== '/oauth/mcp/introspect') { customerCalls++; res.end('{}'); return; }
    res.end(JSON.stringify({ active: true, aud: resource, iss: issuer, exp: Date.now()/1000 + 300,
      sub: 'fixture', grant_id: 'fixture', scope: 'networking:manage', services: [] }));
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  const previous = process.env.VPSNET_API_URL;
  process.env.VPSNET_API_URL = `http://127.0.0.1:${backend.address().port}`;
  const { createRemoteServer } = await import('../build/http-server.js');
  const remote = createRemoteServer({ resource, issuer });
  remote.listen(0, '127.0.0.1'); await once(remote, 'listening');
  t.after(() => {
    if (previous === undefined) delete process.env.VPSNET_API_URL; else process.env.VPSNET_API_URL = previous;
    remote.closeAllConnections(); remote.close(); backend.closeAllConnections(); backend.close();
  });
  const send = (body, authenticated = true, extra = {}) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: remote.address().port, path: '/mcp', method: 'POST', headers: {
      host: 'mcp.example.com', 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      ...(authenticated ? { authorization: `Bearer ${token}` } : {}), ...extra,
    } }, res => { let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) })); });
    req.on('error', reject); req.end(body);
  });
  const compressed = Buffer.concat([gzipSync(Buffer.from('{"jsonrpc":"2.0","id":1,"method":"tools/list"}')), Buffer.from('trailing')]);
  assert.equal((await send(compressed, false, { 'content-encoding': 'gzip' })).status, 401);
  assert.equal((await send(compressed, true, { 'content-encoding': 'gzip' })).status, 400);
  const oversized = await send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
    name: 'create_network_vpn_peer', arguments: { gateway_id: '00000000-0000-0000-0000-000000000000', name: 'fixture',
      grants: Array(10_000).fill(0), reveal_public_key: 'a'.repeat(43) + '=', idempotencyKey: 'dependency-security-fixture' },
  } }));
  assert.equal(oversized.status, 200);
  assert.equal(oversized.body.result.isError, true);
  const healthy = await send('{"jsonrpc":"2.0","id":3,"method":"tools/list"}');
  assert.equal(healthy.status, 200);
  assert.equal(healthy.body.result.tools.length, 283);
  assert.equal(customerCalls, 0);
});
