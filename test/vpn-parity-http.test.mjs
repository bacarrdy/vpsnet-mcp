import assert from 'node:assert/strict';
import {createServer, request} from 'node:http';
import {once} from 'node:events';
import test from 'node:test';

const gateway_id = '2f186a34-88a3-49fc-93e8-71931b212867';
const peer_id = 'a22093d5-985a-443c-9a93-e0dcf6609d84';
const base = `/account/networking/appliances/vpn-gateways/${gateway_id}`;
const idempotencyKey = 'vpn-parity-contract-0001';
const services = [{service: 'wireguard', allow_from: ['203.0.113.0/24']}, {service: 'ipsec', allow_from: ['2001:db8::/32']}];
const added = ['update_network_vpn_gateway_image', 'check_network_vpn_public_access', 'set_network_vpn_public_access', 'set_network_vpn_ipsec_tuning'];
const missingInOldProduction = ['add_network_vpn_site_line', 'create_network_vpn_site_health_webhook',
  'delete_network_vpn_site_health_webhook', 'get_network_vpn_tunnel_test', 'list_network_vpn_site_health_webhooks',
  'rebuild_network_vpn_gateway', 'remove_network_vpn_site_second_line', 'rename_network_vpn_gateway',
  'restart_network_vpn_gateway', 'rotate_network_vpn_ipsec_key', 'save_network_vpn_router_setup',
  'set_network_vpn_internet_exit', 'set_network_vpn_site_bgp', 'set_network_vpn_site_main_line',
  'set_network_vpn_site_reach', 'start_network_vpn_tunnel_test', 'take_network_vpn_site_line_config'];

async function harness(t) {
  const resource = 'https://mcp.vpsnet.com/mcp', issuer = 'https://api.vpsnet.com/oauth/mcp';
  const calls = [];
  const tokens = {read: 'vpsnet_' + 'a'.repeat(43), manage: 'vpsnet_' + 'b'.repeat(43)};
  const backend = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    res.setHeader('content-type', 'application/json');
    if (req.url === '/oauth/mcp/introspect') {
      res.end(JSON.stringify({active: true, aud: resource, iss: issuer, exp: Date.now()/1000+300,
        sub: 'fixture', grant_id: 'fixture', services: [],
        scope: req.headers.authorization === `Bearer ${tokens.manage}` ? 'networking:manage' : 'networking:read'}));
    } else {
      calls.push({method: req.method, path: req.url, body: raw ? JSON.parse(raw) : undefined, key: req.headers['idempotency-key']});
      res.end(JSON.stringify({accepted: true, psk: 'synthetic-must-be-redacted', reason_code: 'fixture'}));
    }
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  const previous = process.env.VPSNET_API_URL;
  process.env.VPSNET_API_URL = `http://127.0.0.1:${backend.address().port}`;
  const {createRemoteServer} = await import('../build/http-server.js');
  const remote = createRemoteServer({resource, issuer});
  remote.listen(0, '127.0.0.1'); await once(remote, 'listening');
  t.after(() => { if (previous === undefined) delete process.env.VPSNET_API_URL; else process.env.VPSNET_API_URL = previous;
    remote.closeAllConnections(); remote.close(); backend.closeAllConnections(); backend.close(); });
  const rpc = (grant, method, params) => new Promise((resolve, reject) => {
    const req = request({hostname: '127.0.0.1', port: remote.address().port, path: '/mcp', method: 'POST', headers: {
      host: 'mcp.vpsnet.com', ...(grant ? {authorization: `Bearer ${tokens[grant]}`} : {}),
      'content-type': 'application/json', accept: 'application/json, text/event-stream'}}, res => {
      let raw = ''; res.on('data', chunk => raw += chunk); res.on('end', () => resolve({status: res.statusCode, raw, body: JSON.parse(raw)}));
    }); req.on('error', reject); req.end(JSON.stringify({jsonrpc: '2.0', id: 1, method, params}));
  });
  return {calls, rpc, call: (grant, name, args) => rpc(grant, 'tools/call', {name, arguments: args})};
}

test('real HTTP VPN catalogue includes the 17 delivery-gap tools and new parity with exact scope/schema', async t => {
  const {rpc, calls} = await harness(t);
  assert.equal((await rpc(null, 'tools/list')).status, 401);
  for (const grant of ['read', 'manage']) {
    const response = await rpc(grant, 'tools/list'); assert.equal(response.status, 200);
    const tools = new Map(response.body.result.tools.map(tool => [tool.name, tool]));
    for (const name of [...missingInOldProduction, ...added]) {
      const tool = tools.get(name); assert.ok(tool, name);
      assert.equal(tool.inputSchema.additionalProperties, false, name);
      const scope = tool.annotations.readOnlyHint ? 'networking:read' : 'networking:manage';
      assert.deepEqual(tool._meta.securitySchemes[0].scopes, [scope], name);
      assert.deepEqual(tool.securitySchemes, tool._meta.securitySchemes, name);
    }
    assert.equal(tools.get('check_network_vpn_public_access').annotations.readOnlyHint, true);
    assert.ok(tools.get('set_network_vpn_public_access').inputSchema.required.includes('expected_generation'));
    assert.ok(tools.get('set_network_vpn_ipsec_tuning').inputSchema.required.includes('tuning'));
    assert.equal(tools.has('quote_network_vpn_traffic_pack'), false, 'paid networking is not exposed by the existing OAuth profile');
  }
  assert.equal(calls.length, 0, 'discovery contacts introspection only');
});

test('HTTP VPN parity forwards exact requests and rejects scope, secrets and stale-shape inputs before API calls', async t => {
  const {calls, call} = await harness(t);
  const tuning = {nat_traversal: 'forced', ke_groups: [19, 31], suites: ['aes256gcm'], pfs: 'on', ike_lifetime_seconds: 28800, esp_lifetime_seconds: 3600};
  const cases = [
    ['check_network_vpn_public_access', {gateway_id, services}, 'POST', `${base}/public-access/check`, {services}, 'read'],
    ['set_network_vpn_public_access', {gateway_id, services, expected_generation: 8, acknowledge_disconnect: true, idempotencyKey}, 'PUT', `${base}/public-access`, {services, expected_generation: 8, acknowledge_disconnect: true}],
    ['update_network_vpn_gateway_image', {gateway_id, idempotencyKey}, 'POST', `${base}/image-update`, {}],
    ['set_network_vpn_ipsec_tuning', {gateway_id, peer_id, expected_generation: 9, tuning, idempotencyKey}, 'PUT', `${base}/peers/${peer_id}/ipsec-tuning`, {expected_generation: 9, tuning}],
    ['set_network_vpn_ipsec_tuning', {gateway_id, peer_id, expected_generation: 10, tuning: null, idempotencyKey}, 'PUT', `${base}/peers/${peer_id}/ipsec-tuning`, {expected_generation: 10, tuning: null}],
  ];
  for (const [name, args, method, path, body, grant = 'manage'] of cases) {
    const result = await call(grant, name, args); assert.equal(result.status, 200); assert.notEqual(result.body.result?.isError, true, result.raw);
    assert.deepEqual(calls.at(-1), {method, path, body, key: args.idempotencyKey}, name);
    assert.doesNotMatch(result.raw, /synthetic-must-be-redacted/);
  }
  for (const [name, args] of cases.filter(([name]) => name !== 'check_network_vpn_public_access')) {
    assert.match((await call('read', name, args)).raw, /insufficient_scope/);
  }
  const invalid = [
    ['set_network_vpn_public_access', {gateway_id, services, idempotencyKey}],
    ['set_network_vpn_public_access', {gateway_id, services: [{service: 'wireguard', allow_from: ['0.0.0.0/0']}], expected_generation: 1, idempotencyKey}],
    ['check_network_vpn_public_access', {gateway_id, services: [services[0], services[0]]}],
    ['set_network_vpn_ipsec_tuning', {gateway_id, peer_id, expected_generation: 1, tuning: {psk: 'synthetic'}, idempotencyKey}],
    ['set_network_vpn_ipsec_tuning', {gateway_id, peer_id, expected_generation: 1, tuning: {ke_groups: [1]}, idempotencyKey}],
    ['set_network_vpn_ipsec_tuning', {gateway_id, peer_id, expected_generation: 1, tuning: {esp_lifetime_seconds: 299}, idempotencyKey}],
    ['update_network_vpn_gateway_image', {gateway_id, idempotencyKey, image_id: 'unreviewed'}],
  ];
  for (const [name, args] of invalid) assert.equal((await call('manage', name, args)).body.result?.isError, true, name);
  assert.equal(calls.length, cases.length);
});
