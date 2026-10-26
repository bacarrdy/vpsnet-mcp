import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request } from 'node:http';
import { once } from 'node:events';

const resource = 'https://mcp.vpsnet.com/mcp';
const issuer = 'https://api.vpsnet.com/oauth/mcp';
const tokens = { directory: 'vpsnet_' + 'd'.repeat(43), orders: 'vpsnet_' + 'o'.repeat(43), denied: 'vpsnet_' + 'n'.repeat(43) };
function rpc(port, profile, method, params, userAgent = 'OpenAI-contract-fixture') {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, method: 'POST', path: '/mcp', headers: {
      host: 'mcp.vpsnet.com', authorization: `Bearer ${tokens[profile]}`, 'user-agent': userAgent,
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
    } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => text += chunk);
      res.on('end', () => resolve(JSON.parse(text)));
    });
    req.on('error', reject); req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }));
  });
}

test('directory reinstall avoids password collection, preserves consent, scopes and safe credential choices over real HTTP', async t => {
  let dedicated = true; let snapshots = 0; let pending = false;
  const mutations = []; const serviceRequests = [];
  const backend = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    const profile = Object.keys(tokens).find(key => req.headers.authorization === `Bearer ${tokens[key]}`);
    assert.ok(profile, 'Only synthetic fixture credentials may reach this local backend');
    if (req.url === '/oauth/mcp/introspect') {
      return res.end(JSON.stringify({ active: true, aud: resource, iss: issuer, exp: Date.now() / 1000 + 300,
        sub: 'fixture', grant_id: profile, services: ['VP12345'], orders_available: profile === 'orders',
        scope: profile === 'denied' ? 'services:read' : `services:reinstall services:read ssh_keys:read${profile === 'orders' ? ' orders:read' : ''}` }));
    }
    assert.equal(req.url, '/account/services/VP12345/change-os');
    serviceRequests.push(req.method);
    if (req.method === 'GET') return res.end(JSON.stringify({ success: true, dedicated, confirmRequired: dedicated,
      snapshotDeletion: { active_count: snapshots, pending_count: pending ? 1 : 0, will_delete: snapshots > 0 } }));
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (dedicated && body.confirmReinstall !== true) { res.statusCode = 422; return res.end(JSON.stringify({ success: false, baremetalReinstallConfirmationRequired: true })); }
    if (pending || (snapshots > 0 && body.confirmSnapshotDelete !== true)) {
      res.statusCode = 409; return res.end(JSON.stringify({ success: false, [pending ? 'snapshotActionInProgress' : 'snapshotsWillBeDeleted']: true }));
    }
    mutations.push(body);
    return res.end(JSON.stringify(dedicated ? { success: true, reinstall: '11111111-1111-4111-8111-111111111111' }
      : { success: true, noty: '22222222-2222-4222-8222-222222222222' }));
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  process.env.VPSNET_API_URL = `http://127.0.0.1:${backend.address().port}`;
  const { createRemoteServer } = await import('../build/http-server.js');
  const remote = createRemoteServer({ resource, issuer, ordersEnabled: true });
  remote.listen(0, '127.0.0.1'); await once(remote, 'listening');
  t.after(() => { remote.closeAllConnections(); remote.close(); backend.closeAllConnections(); backend.close(); });
  const port = remote.address().port;
  const call = async (args, profile = 'directory') => (await rpc(port, profile, 'tools/call', { name: 'reinstall_os', arguments: { orderNo: 'VP12345', osVersion: 28, ...args } })).result;
  const listed = async (profile, userAgent) => (await rpc(port, profile, 'tools/list', undefined, userAgent)).result.tools.find(tool => tool.name === 'reinstall_os');
  const directory = await listed('directory', 'OpenAI-contract-fixture');
  assert.deepEqual(directory, await listed('directory', 'Claude-contract-fixture'), 'No forged host profile or client-specific OAuth behavior');
  assert.equal(directory.inputSchema.properties.rootPassword, undefined);
  assert.equal(directory.inputSchema.additionalProperties, false);
  assert.match(directory.inputSchema.properties.sshKey.description, /public SSH key ID/);
  assert.match(directory.description, /Do not ask for or pass passwords/);
  assert.deepEqual(directory.annotations, { title: 'Reinstall OS', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
  assert.deepEqual(directory.securitySchemes, [{ type: 'oauth2', scopes: ['services:reinstall'] }]);
  assert.ok((await listed('orders')).inputSchema.properties.rootPassword, 'Existing explicitly authorized orders transport keeps its credential contract');
  for (const rootPassword of ['Synthetic123', '', null]) {
    const before = serviceRequests.length;
    assert.equal((await call({ confirmReinstall: true, rootPassword })).isError, true);
    assert.equal(serviceRequests.length, before, 'Cached secret input fails before service reads or mutations');
  }
  assert.equal((await call({})).isError, true);
  assert.equal((await call({ confirmReinstall: false })).isError, true);
  assert.equal(mutations.length, 0);
  for (const args of [{ confirmReinstall: true, sshKey: 12 }, { confirmReinstall: true }]) {
    const response = await call(args);
    assert.notEqual(response.isError, true);
    assert.deepEqual(mutations.at(-1), { osVersion: 28, ...args });
    assert.doesNotMatch(JSON.stringify(response), /password|Synthetic123/i, 'No generated credentials are returned by this acceptance endpoint');
  }
  const beforeDenied = serviceRequests.length;
  assert.equal((await call({ confirmReinstall: true }, 'denied')).isError, true);
  assert.equal(serviceRequests.length, beforeDenied);
  assert.notEqual((await call({ confirmReinstall: true, rootPassword: 'Synthetic123' }, 'orders')).isError, true);
  assert.equal(mutations.at(-1).rootPassword, 'Synthetic123');
  dedicated = false;
  assert.notEqual((await call({ sshKey: 12 })).isError, true);
  assert.deepEqual(mutations.at(-1), { osVersion: 28, sshKey: 12 });
  snapshots = 1;
  const beforeSnapshot = mutations.length;
  for (const args of [{}, { confirmSnapshotDelete: false }]) assert.equal((await call(args)).isError, true);
  assert.equal(mutations.length, beforeSnapshot);
  assert.notEqual((await call({ confirmSnapshotDelete: true, sshKey: 12 })).isError, true);
  assert.deepEqual(mutations.at(-1), { osVersion: 28, confirmSnapshotDelete: true, sshKey: 12 });
  pending = true;
  const beforePending = mutations.length;
  assert.equal((await call({ confirmSnapshotDelete: true })).isError, true);
  assert.equal(mutations.length, beforePending);
});
