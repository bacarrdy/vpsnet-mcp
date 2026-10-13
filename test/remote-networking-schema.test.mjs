import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createVpsnetServer } from '../build/index.js';
import { networkingTools } from '../build/networking-tools.js';

async function discover(options) {
  const server = createVpsnetServer(options);
  const client = new Client({ name: 'network-schema-contract', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return new Map((await client.listTools()).tools.map(tool => [tool.name, tool])); }
  finally { await client.close(); await server.close(); }
}

test('directory and orders retain every exposed networking input constraint from stdio', async () => {
  const stdio = await discover({});
  const scopes = ['services:read', 'networking:read', 'networking:manage'];
  for (const [profile, options] of [
    ['directory', { remoteScopes: scopes }],
    ['orders', { remoteScopes: [...scopes, 'orders:servers', 'orders:domains'], remoteProfile: 'orders' }],
  ]) {
    const remote = await discover(options);
    let exposed = 0;
    for (const definition of networkingTools) {
      const tool = remote.get(definition.name);
      if (!tool) continue;
      exposed++;
      assert.deepEqual(tool.inputSchema, stdio.get(definition.name).inputSchema,
        `${profile}: ${definition.name} must keep fields, requiredness, types and strictness`);
    }
    assert.ok(exposed > 60, `${profile} includes the existing-service networking family`);
    const detach = remote.get('detach_private_network_port');
    assert.deepEqual(detach.inputSchema.required,
      ['network_id', 'port_id', 'expected_generation', 'idempotencyKey']);
    assert.equal(detach.inputSchema.additionalProperties, false);
    assert.equal(detach.inputSchema.properties.network_id.type, 'string');
    assert.ok(detach.inputSchema.properties.port_id);
    assert.deepEqual(detach._meta.securitySchemes[0].scopes, ['networking:manage']);
  }
});

test('remote strict networking validation rejects unknown input before a backend mutation', async t => {
  const resource = 'https://mcp.vpsnet.com/mcp';
  const issuer = 'https://api.vpsnet.com/oauth/mcp';
  const token = 'vpsnet_' + 'a'.repeat(43);
  let backendMutations = 0;
  const backend = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/oauth/mcp/introspect') {
      res.end(JSON.stringify({ active: true, aud: resource, iss: issuer, exp: Date.now() / 1000 + 300,
        sub: '1', grant_id: 'test', scope: 'networking:read networking:manage', services: [] }));
    } else {
      backendMutations++;
      res.end('{"success":true}');
    }
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const priorApiUrl = process.env.VPSNET_API_URL;
  process.env.VPSNET_API_URL = `http://127.0.0.1:${backend.address().port}`;
  const { createRemoteServer } = await import('../build/http-server.js');
  const remote = createRemoteServer({ resource, issuer });
  remote.listen(0, '127.0.0.1');
  await once(remote, 'listening');
  t.after(() => {
    if (priorApiUrl === undefined) delete process.env.VPSNET_API_URL;
    else process.env.VPSNET_API_URL = priorApiUrl;
    remote.closeAllConnections(); remote.close();
    backend.closeAllConnections(); backend.close();
  });

  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: 'detach_private_network_port', arguments: {
      network_id: '2f186a34-88a3-49fc-93e8-71931b212867',
      port_id: 'a22093d5-985a-443c-9a93-e0dcf6609d84',
      expected_generation: 1, idempotencyKey: 'network-schema-test-0001', unexpected: true,
    },
  } };
  const response = await new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: remote.address().port, path: '/mcp', method: 'POST',
      headers: { host: 'mcp.vpsnet.com', accept: 'application/json, text/event-stream',
        'content-type': 'application/json', authorization: `Bearer ${token}` } }, res => {
      let text = '';
      res.on('data', chunk => text += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.result.isError, true);
  assert.match(response.body.result.content[0].text, /Unrecognized key\(s\).*unexpected/);
  assert.equal(backendMutations, 0);
});
