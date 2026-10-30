import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const resource = 'https://mcp.vpsnet.com/mcp';
const issuer = 'https://api.vpsnet.com/oauth/mcp';
const token = 'vpsnet_' + 'd'.repeat(43);
const secret = Buffer.alloc(32, 7).toString('base64'); // Synthetic; never a customer credential.

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
function close(server) { server.closeAllConnections(); server.close(); }

test('hosted DNS discovery and dispatch exclude TSIG, preserve native results and enforce dns:write', async t => {
  let scope = 'dns:write';
  const requests = [];
  const backend = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/oauth/mcp/introspect') {
      res.end(JSON.stringify({ active: true, aud: resource, iss: issuer, exp: Date.now() / 1000 + 300,
        sub: 'dns-owner', grant_id: 'dns-grant', scope, services: [], orders_available: true }));
      return;
    }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ method: req.method, path: req.url, body, authorization: req.headers.authorization });
    const restored = body.zone_name === 'restored.example.test';
    res.end(JSON.stringify({ success: true, zone: { id: 41, status: restored ? 'published' : 'pending_verification',
      apply_state: restored ? 'queued' : 'clean',
      ...(!restored ? { verification: { next_step: 'add_txt_at_previous_provider' } } : {}) },
      ...(!restored ? { verificationRecord: { name: '_vpsnet-dns.' + body.zone_name, type: 'TXT', value: 'synthetic-public-ownership-proof' } } : {}) }));
  });
  process.env.VPSNET_API_URL = 'http://127.0.0.1:' + await listen(backend);
  t.after(() => close(backend));
  const { createRemoteServer } = await import('../build/http-server.js');

  for (const profile of ['directory', 'orders']) {
    await t.test(profile, async t => {
      scope = profile === 'orders' ? 'dns:write orders:read' : 'dns:write';
      const remote = createRemoteServer({ resource, issuer, ordersEnabled: profile === 'orders' });
      const port = await listen(remote);
      t.after(() => close(remote));
      const rpc = (method, params) => new Promise((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: {
          host: 'mcp.vpsnet.com', accept: 'application/json, text/event-stream',
          'content-type': 'application/json', authorization: `Bearer ${token}`,
        } }, res => {
          let raw = ''; res.setEncoding('utf8'); res.on('data', chunk => raw += chunk);
          res.on('end', () => {
            try { assert.equal(res.statusCode, 200); resolve(JSON.parse(raw)); }
            catch (error) { reject(error); }
          });
        });
        req.on('error', reject);
        req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
      });
      const tools = (await rpc('tools/list')).result.tools;
      assert.equal(tools.some(tool => tool.name === 'get_order_plans'), profile === 'orders');
      const create = tools.find(tool => tool.name === 'create_dns_zone');
      assert.deepEqual(Object.keys(create.inputSchema.properties).sort(), ['kind', 'zone']);
      assert.equal(create.inputSchema.additionalProperties, false);
      assert.equal(create.inputSchema.properties.kind.const, 'native');
      assert.deepEqual(create.inputSchema.required, ['zone']);
      assert.equal(create.annotations.readOnlyHint, false);
      assert.equal(create.annotations.destructiveHint, true);
      assert.equal(create.annotations.openWorldHint, true);
      assert.deepEqual(create.securitySchemes, [{ type: 'oauth2', scopes: ['dns:write'] }]);
      assert.match(create.description, /restore a recently deleted zone/);
      assert.match(create.description, /delete stale zone candidates/);
      assert.match(create.description, /control panel/);

      const invoke = args => rpc('tools/call', { name: 'create_dns_zone', arguments: args });
      const before = requests.length;
      for (const args of [
        { kind: 'secondary' },
        { secondary_tsig_secret: secret },
        { kind: 'native', secondary_tsig_secret: secret },
        { secondary_masters: ['1.1.1.1'] },
        { secondary_tsig_key_name: 'transfer.example.test' },
        { secondary_tsig_algorithm: 'hmac-sha256' },
      ]) {
        const refused = await invoke({ zone: 'example.test', ...args });
        assert.ok(refused.error || refused.result?.isError, JSON.stringify(Object.keys(args)));
        assert.equal(requests.length, before, 'invalid cached calls must never become native creates');
        assert.ok(!JSON.stringify(refused).includes(secret), 'validation errors must not echo credential values');
      }
      scope = 'dns:read';
      const denied = await invoke({ zone: 'example.test' });
      assert.equal(denied.result.isError, true);
      assert.match(JSON.stringify(denied.result._meta), /dns:write/);
      assert.equal(requests.length, before);
      scope = profile === 'orders' ? 'dns:write orders:read' : 'dns:write';
      for (const args of [{ zone: 'example.test' }, { zone: 'restored.example.test', kind: 'native' }]) {
        const result = (await invoke(args)).result;
        assert.notEqual(result.isError, true);
        const value = JSON.parse(result.content[0].text);
        assert.equal(value.zone.status, args.kind ? 'published' : 'pending_verification');
        assert.equal(value.zone.apply_state, args.kind ? 'queued' : 'clean');
        if (args.kind) assert.equal(value.verificationRecord, undefined, 'restored publication has no TXT challenge');
        else assert.equal(value.verificationRecord.value, 'synthetic-public-ownership-proof');
        assert.deepEqual(requests.at(-1).body, { zone_name: args.zone, ...(args.kind ? { kind: args.kind } : {}) });
        assert.equal(requests.at(-1).method, 'POST');
        assert.equal(requests.at(-1).path, '/account/dns/zones');
        assert.equal(requests.at(-1).authorization, `Bearer ${token}`);
      }
    });
  }
});

test('local stdio keeps the existing secondary-zone API contract', async t => {
  const requests = [];
  const backend = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    requests.push({ method: req.method, path: req.url, body: JSON.parse(raw), key: req.headers['x-api-key'] });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ success: true, zone: { id: 42, kind: 'secondary', status: 'pending_verification' } }));
  });
  const port = await listen(backend);
  t.after(() => close(backend));
  const client = new Client({ name: 'dns-secondary-compatibility', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['build/index.js'],
    env: { ...process.env, VPSNET_API_URL: `http://127.0.0.1:${port}`, VPSNET_API_KEY: 'synthetic-dns-api-key' } }));
  t.after(() => client.close());
  const create = (await client.listTools()).tools.find(tool => tool.name === 'create_dns_zone');
  assert.deepEqual(create.inputSchema.properties.kind.enum, ['native', 'secondary']);
  assert.ok(create.inputSchema.properties.secondary_tsig_secret);
  assert.equal(create.annotations.destructiveHint, true);
  const args = { zone: 'example.test', kind: 'secondary', secondary_masters: ['1.1.1.1'],
    secondary_tsig_key_name: 'transfer.example.test', secondary_tsig_algorithm: 'hmac-sha256', secondary_tsig_secret: secret };
  const result = await client.callTool({ name: 'create_dns_zone', arguments: args });
  assert.notEqual(result.isError, true);
  const { zone, ...rest } = args;
  assert.deepEqual(requests, [{ method: 'POST', path: '/account/dns/zones', body: { zone_name: zone, ...rest }, key: 'synthetic-dns-api-key' }]);
});
