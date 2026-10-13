import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createVpsnetServer } from '../build/index.js';
import { remoteScope } from '../build/remote-policy.js';

const PATH = '/account/services/VP12345/change-ns';
const EVENT = '11111111-1111-4111-8111-111111111111';
async function harness(t, reply = { success: true, noty: EVENT }, status = 200) {
  const requests = [];
  const nsData = { type: 'custom', ns1: '192.0.2.53', ns2: '2001:db8::53', ns3: null, ns4: null };
  const api = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    requests.push({ method: req.method, path: req.url, body: raw ? JSON.parse(raw) : null });
    res.setHeader('content-type', 'application/json');
    res.statusCode = req.method === 'GET' ? 200 : status;
    res.end(JSON.stringify(req.method === 'GET' ? { success: true, nsData } : reply));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(() => { api.closeAllConnections(); api.close(); });
  const client = new Client({ name: 'guest-nameservers-contract', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['build/index.js'], env: {
    PATH: process.env.PATH, VPSNET_API_KEY: 'contract-test-key', VPSNET_API_URL: `http://127.0.0.1:${api.address().port}`,
  } }));
  t.after(() => client.close());
  return { client, requests, nsData, call: (name, args = {}) => client.callTool({ name, arguments: { orderNo: 'VP12345', ...args } }) };
}

test('guest resolver GET returns exact saved nsData and custom POST preserves resolver order', async t => {
  const { call, requests, nsData } = await harness(t);
  const result = await call('get_guest_nameservers');
  assert.deepEqual(JSON.parse(result.content[0].text), { success: true, nsData });
  assert.deepEqual(requests[0], { method: 'GET', path: PATH, body: null });
  const custom = { type: 'custom', ns1: '192.0.2.53', ns2: '2001:db8::53', ns3: '198.51.100.53', ns4: '203.0.113.53' };
  const accepted = await call('set_guest_nameservers', custom);
  assert.deepEqual(requests[1], { method: 'POST', path: PATH, body: custom });
  assert.deepEqual(JSON.parse(accepted.content[0].text), { success: true, noty: EVENT });
  await call('set_guest_nameservers', { type: 'custom', ns1: custom.ns1, ns2: custom.ns2 });
  assert.deepEqual(requests[2].body, { type: 'custom', ns1: custom.ns1, ns2: custom.ns2 });
});

test('own resolver reset sends only own and preserves unchanged response', async t => {
  const { call, requests } = await harness(t, { success: true, unchanged: true });
  const result = await call('set_guest_nameservers', { type: 'own' });
  assert.deepEqual(requests, [{ method: 'POST', path: PATH, body: { type: 'own' } }]);
  assert.deepEqual(JSON.parse(result.content[0].text), { success: true, unchanged: true });
});

test('custom resolver validation requires both primary IPs and refuses hostnames before HTTP', async t => {
  const { call, requests } = await harness(t);
  for (const args of [
    { type: 'custom' }, { type: 'custom', ns1: '192.0.2.53' },
    { type: 'custom', ns1: 'resolver.example.com', ns2: '2001:db8::53' },
    { type: 'custom', ns1: '192.0.2.53', ns2: '2001:db8::53', ns4: '999.1.1.1' },
    { type: 'other' }, { type: 'own', orderNo: '../VP12345' },
  ]) assert.equal((await call('set_guest_nameservers', args)).isError, true);
  assert.equal(requests.length, 0);
});

test('VM lock and service guard refusals propagate without retrying', async t => {
  const refusal = { success: false, serviceTwoFactorLocked: true };
  const { call, requests } = await harness(t, refusal, 423);
  const result = await call('set_guest_nameservers', { type: 'own' });
  assert.equal(result.isError, true);
  assert.equal(JSON.parse(result.content[0].text).serviceTwoFactorLocked, true);
  assert.equal(requests.length, 1);
});

test('directory discovery exposes resolver reads/manage with exact scopes and effect hints', async t => {
  const server = createVpsnetServer({ remoteScopes: ['services:read'] });
  const client = new Client({ name: 'guest-resolver-directory', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const tools = (await client.listTools()).tools;
  for (const [name, scope, readOnly] of [['get_guest_nameservers', 'services:read', true], ['set_guest_nameservers', 'services:manage', false]]) {
    assert.equal(remoteScope(name), scope);
    const tool = tools.find(tool => tool.name === name);
    assert.ok(tool, name);
    assert.deepEqual(tool._meta.securitySchemes[0].scopes, [scope]);
    assert.equal(tool.annotations.readOnlyHint, readOnly);
    assert.equal(tool.annotations.destructiveHint, !readOnly);
    assert.equal(tool.annotations.openWorldHint, !readOnly);
  }
  assert.equal(tools.find(tool => tool.name === 'set_guest_nameservers').annotations.idempotentHint, false);
  for (const name of ['create_backup', 'console_service']) assert.equal(remoteScope(name), undefined);
});
