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
const test_id = '550e8400-e29b-41d4-a716-446655440000';
const reveal_public_key = Buffer.alloc(32, 1).toString('base64');
const idempotencyKey = 'vpn-completion-test-0001';
const base = `/account/networking/appliances/vpn-gateways/${gateway_id}`;
const peer = `${base}/peers/${peer_id}`;

async function harness(t, respond = () => ({status: 200, body: {accepted: true}})) {
  const requests = [];
  const api = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const item = {method: req.method, path: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined};
    requests.push(item);
    const answer = respond(item);
    res.writeHead(answer.status, {'content-type': 'application/json'});
    res.end(JSON.stringify(answer.body));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(async () => { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); });
  const client = new Client({name: 'vpn-completion', version: '1'});
  await client.connect(new StdioClientTransport({command: process.execPath, args: ['build/index.js'],
    env: {PATH: process.env.PATH, VPSNET_API_KEY: 'test-key', VPSNET_API_URL: `http://127.0.0.1:${api.address().port}`}}));
  t.after(() => client.close());
  return {client, requests, call: (name, args) => client.callTool({name, arguments: args})};
}
const data = result => JSON.parse(result.content[0].text);

async function discover(scopes) {
  const server = createVpsnetServer({remoteScopes: scopes});
  const client = new Client({name: 'scope-test', version: '1'});
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(right); await client.connect(left);
  try { return (await client.listTools()).tools; }
  finally { await client.close(); await server.close(); }
}

test('remote VPN descriptors declare exact scopes and HTTP denies read-only grants before mutation', async t => {
  const read = await discover(['networking:read']);
  const manage = await discover(['networking:manage']);
  const names = list => new Map(list.map(item => [item.name, item]));
  for (const name of ['get_network_vpn_gateway', 'get_network_vpn_peer_recipe', 'get_network_vpn_tunnel_test']) {
    assert.deepEqual(names(read).get(name)._meta.securitySchemes[0].scopes, ['networking:read']);
    assert.equal(names(manage).get(name).annotations.readOnlyHint, true);
  }
  for (const name of ['rotate_network_vpn_ipsec_key', 'take_network_vpn_site_line_config', 'set_network_vpn_site_bgp', 'start_network_vpn_tunnel_test', 'set_network_vpn_site_reach']) {
    assert.deepEqual(names(read).get(name)._meta.securitySchemes[0].scopes, ['networking:manage']);
    assert.deepEqual(names(manage).get(name)._meta.securitySchemes[0].scopes, ['networking:manage']);
  }
  for (const name of ['rotate_network_vpn_ipsec_key', 'take_network_vpn_site_line_config', 'remove_network_vpn_site_second_line', 'rebuild_network_vpn_gateway']) {
    const tool = names(manage).get(name);
    assert.equal(tool.annotations.readOnlyHint, false); assert.equal(tool.annotations.destructiveHint, true);
  }
  const resource = 'https://mcp.vpsnet.com/mcp', issuer = 'https://api.vpsnet.com/oauth/mcp', token = 'vpsnet_' + 'a'.repeat(43);
  let operations = 0;
  const backend = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/oauth/mcp/introspect') res.end(JSON.stringify({active: true, aud: resource, iss: issuer,
      exp: Date.now()/1000+300, sub: 'tenant-1', grant_id: 'grant-1', scope: 'networking:read', services: []}));
    else { operations++; res.end('{"accepted":true}'); }
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  const previous = process.env.VPSNET_API_URL;
  process.env.VPSNET_API_URL = `http://127.0.0.1:${backend.address().port}`;
  const {createRemoteServer} = await import('../build/http-server.js');
  const remote = createRemoteServer({resource, issuer});
  remote.listen(0, '127.0.0.1'); await once(remote, 'listening');
  t.after(() => { if (previous === undefined) delete process.env.VPSNET_API_URL; else process.env.VPSNET_API_URL = previous;
    remote.closeAllConnections(); remote.close(); backend.closeAllConnections(); backend.close(); });
  const response = await new Promise((resolve, reject) => {
    const req = request({hostname: '127.0.0.1', port: remote.address().port, path: '/mcp', method: 'POST', headers: {
      host: 'mcp.vpsnet.com', authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream'}}, res => {
      let raw = ''; res.on('data', chunk => raw += chunk); res.on('end', () => resolve({status: res.statusCode, raw}));
    }); req.on('error', reject); req.end(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'rotate_network_vpn_ipsec_key', arguments: {gateway_id, peer_id, reveal_public_key, idempotencyKey}}}));
  });
  assert.match(response.raw, /insufficient_scope/);
  assert.equal(operations, 0);
});

test('VPN completion forwards exact methods, paths, bodies, generations and idempotency keys', async t => {
  const {call, requests} = await harness(t);
  const cases = [
    ['rename_network_vpn_gateway', {gateway_id, name: 'Office VPN'}, 'PUT', `${base}/name`, {name: 'Office VPN'}],
    ['restart_network_vpn_gateway', {gateway_id, idempotencyKey}, 'POST', `${base}/restart`, {}],
    ['rebuild_network_vpn_gateway', {gateway_id, idempotencyKey}, 'POST', `${base}/rebuild`, {}],
    ['set_network_vpn_internet_exit', {gateway_id, mode: 'network_nat', idempotencyKey}, 'PUT', `${base}/internet-exit`, {mode: 'network_nat'}],
    ['rotate_network_vpn_ipsec_key', {gateway_id, peer_id, reveal_public_key, idempotencyKey}, 'POST', `${peer}/rotate-key`, {reveal_public_key}],
    ['set_network_vpn_site_bgp', {gateway_id, peer_id, expected_generation: 9, peer_asn: 65001, local_asn: 64512, accept: 'listed', inner: '169.254.100.0', keepalive_seconds: 10, hold_seconds: 30}, 'PUT', `${peer}/bgp`, {expected_generation: 9, peer_asn: 65001, local_asn: 64512, accept: 'listed', inner: '169.254.100.0', keepalive_seconds: 10, hold_seconds: 30}],
    ['set_network_vpn_site_bgp', {gateway_id, peer_id, expected_generation: 10, enabled: false, remote_prefixes: ['192.168.10.0/24']}, 'PUT', `${peer}/bgp`, {expected_generation: 10, enabled: false, remote_prefixes: ['192.168.10.0/24']}],
    ['add_network_vpn_site_line', {gateway_id, peer_id, expected_generation: 11, reveal_public_key, remote_address: '91.211.244.53', vendor: 'fortigate', dpd_seconds: 30, idempotencyKey}, 'POST', `${peer}/lines`, {expected_generation: 11, reveal_public_key, remote_address: '91.211.244.53', vendor: 'fortigate', dpd_seconds: 30}],
    ['set_network_vpn_site_main_line', {gateway_id, peer_id, line: 2, expected_generation: 12, idempotencyKey}, 'PUT', `${peer}/lines/main`, {line: 2, expected_generation: 12}],
    ['remove_network_vpn_site_second_line', {gateway_id, peer_id, expected_generation: 13, idempotencyKey}, 'DELETE', `${peer}/lines/2`, {expected_generation: 13}],
    ['start_network_vpn_tunnel_test', {gateway_id, peer_id, line: 2, idempotencyKey}, 'POST', `${peer}/tests`, {line: 2}],
    ['get_network_vpn_tunnel_test', {gateway_id, peer_id, test_id}, 'GET', `${peer}/tests/${test_id}`, undefined],
    ['set_network_vpn_site_reach', {gateway_id, peer_id, reach: {load_balancers: true, floating_ips: false}}, 'PUT', `${peer}/site-reach`, {reach: {load_balancers: true, floating_ips: false}}],
    ['set_network_vpn_site_options', {gateway_id, site_reach: {load_balancers: false, floating_ips: true}, device_mesh: true}, 'PUT', `${base}/site-options`, {site_reach: {load_balancers: false, floating_ips: true}, device_mesh: true}],
    ['save_network_vpn_router_setup', {gateway_id, peer_id, vendor: 'fortigate', version: '7.4', inputs: {interface_name: 'wan1'}, line: 2}, 'PUT', `${peer}/router-setup`, {vendor: 'fortigate', version: '7.4', inputs: {interface_name: 'wan1'}, line: 2}],
  ];
  for (const [name, args, method, path, body] of cases) {
    assert.notEqual((await call(name, args)).isError, true, name);
    const sent = requests.at(-1);
    assert.deepEqual([sent.method, sent.path, sent.body], [method, path, body], name);
    assert.equal(sent.headers['idempotency-key'], 'idempotencyKey' in args ? idempotencyKey : undefined, name);
    assert.equal(sent.headers['x-api-key'], 'test-key', name);
  }
  await call('get_network_vpn_peer_recipe', {gateway_id, peer_id, lines: '2', vendor: 'fortigate', version: '7.4', inputs: {interface_name: 'wan1'}});
  assert.equal(requests.at(-1).path, `${peer}/recipe?vendor=fortigate&lines=2&version=7.4&inputs=%7B%22interface_name%22%3A%22wan1%22%7D`);
});

test('invalid tenant identity, secret fields and mutation prerequisites stop before HTTP', async t => {
  const {call, requests} = await harness(t);
  const bad = [
    ['rotate_network_vpn_ipsec_key', {gateway_id, peer_id, reveal_public_key, idempotencyKey, tenant_id: 2}],
    ['rotate_network_vpn_ipsec_key', {gateway_id, peer_id, reveal_public_key, idempotencyKey, psk: 'synthetic'}],
    ['add_network_vpn_site_line', {gateway_id, peer_id, expected_generation: 1, idempotencyKey, remote_address: null}],
    ['add_network_vpn_site_line', {gateway_id, peer_id, expected_generation: 1, idempotencyKey, reveal_public_key, vendor: 'fortigate', independent_setup: true}],
    ['set_network_vpn_site_bgp', {gateway_id, peer_id, peer_asn: 65001}],
    ['set_network_vpn_site_bgp', {gateway_id, peer_id, expected_generation: 1, enabled: false, peer_asn: 65001}],
    ['set_network_vpn_site_options', {gateway_id}],
    ['set_network_vpn_site_reach', {gateway_id, peer_id, reach: {load_balancers: true, floating_ips: false, tenant_id: 2}}],
    ['rename_network_vpn_gateway', {gateway_id, name: 'bad/name'}],
    ['save_network_vpn_router_setup', {gateway_id, peer_id, vendor: 'fortigate', inputs: {private_key: 'synthetic'}}],
    ['take_network_vpn_site_line_config', {gateway_id, peer_id}],
  ];
  for (const [name, args] of bad) assert.equal((await call(name, args)).isError, true, name);
  assert.equal(requests.length, 0);
});

test('rotation and second-line pickup deliver sealed material once without plaintext or unsafe retry', async t => {
  const secret = 'synthetic-psk-must-stay-hidden';
  const {call, requests} = await harness(t, req => req.path.endsWith('/config?line=2')
    ? {status: 200, body: {sealed: {ephemeral_public_key: 'public', nonce: 'nonce', ciphertext: 'opaque'}, nested: {psk: secret}, note: `psk=${secret}`}}
    : req.path.endsWith('/config?line=1') ? {status: 410, body: {reason_code: 'vpn_peer_config_consumed', message: secret}}
    : {status: 202, body: {peer: {id: peer_id, config_available: true, private_key: secret}, operation: {id: test_id, in_progress: true, reason_code: 'waiting_dependency'}}});
  const rotated = await call('rotate_network_vpn_ipsec_key', {gateway_id, peer_id, reveal_public_key, idempotencyKey});
  assert.equal(rotated.isError, undefined); assert.doesNotMatch(JSON.stringify(rotated), /synthetic-psk/);
  assert.equal(data(rotated).peer.config_available, true);
  assert.equal((await call('take_network_vpn_site_line_config', {gateway_id, peer_id})).isError, true);
  const taken = await call('take_network_vpn_site_line_config', {gateway_id, peer_id, acknowledge_one_time_pickup: true});
  assert.deepEqual(data(taken).sealed, {ephemeral_public_key: 'public', nonce: 'nonce', ciphertext: 'opaque'});
  assert.doesNotMatch(JSON.stringify(taken), /synthetic-psk/);
  assert.equal(requests.at(-1).path, `${peer}/config?line=2`);
  assert.equal(requests.at(-1).body, undefined);
  const consumed = await call('take_network_vpn_peer_config', {gateway_id, peer_id, line: 1, acknowledge_one_time_pickup: true});
  assert.equal(requests.at(-1).path, `${peer}/config?line=1`);
  assert.equal(consumed.isError, true);
  assert.deepEqual(data(consumed), {http_status: 410, reason_code: 'vpn_peer_config_consumed'});
  assert.equal(requests.length, 3);
});

test('typed dual-line BGP refusal and tunnel test facts survive without fallback', async t => {
  const {call, requests} = await harness(t, req => req.path.endsWith('/bgp')
    ? {status: 409, body: {reason_code: 'vpn_ipsec_lines_bgp', message: 'synthetic-secret'}}
    : {status: 200, body: {test: {id: test_id, state: 'running', steps: [{state: 'pending'}], next_check_seconds: 1}}});
  const bgp = await call('set_network_vpn_site_bgp', {gateway_id, peer_id, expected_generation: 4});
  assert.equal(bgp.isError, true);
  assert.deepEqual(data(bgp), {http_status: 409, reason_code: 'vpn_ipsec_lines_bgp'});
  const probe = await call('get_network_vpn_tunnel_test', {gateway_id, peer_id, test_id});
  assert.equal(data(probe).test.next_check_seconds, 1);
  assert.equal(requests.length, 2);
});

test('gateway read preserves exact per-line HA and route facts without inferring active forwarding', async t => {
  const route = (state, reason, selected, installed) => ({
    state, reason, observer: 'vpsnet_gateway_frr', observed_at: '2026-11-02T19:00:00Z',
    generation: 17, afi: 'ipv4_unicast', vrf: 'default',
    accepted: selected, advertised: state === 'observed' ? ['10.80.0.0/24'] : [], selected,
    installed: {state: installed, reason: installed === 'observed' ? null : 'kernel_readback_not_proved'},
  });
  const line1Routes = [{prefix: '192.168.10.0/24', next_hop: '169.254.100.1'}];
  const line2Routes = [{prefix: '192.168.20.0/24', next_hop: '169.254.101.1'}];
  const response = {vpn_gateway: {id: gateway_id, generation: 17,
    capabilities: {site_ipsec_bgp_lines: {available: true, reason_code: null}},
    peers: [{id: peer_id, site: {
      bgp: {session: 'established', route_visibility: route('observed', null, line1Routes, 'observed')},
      main_line: 2, lines: [
        {line: 1, main: false, active: false, bgp: {session: 'established', route_visibility: route('observed', null, line1Routes, 'observed')}},
        {line: 2, main: true, active: true, bgp: {session: 'established', route_visibility: route('observed', null, line2Routes, 'unknown')}},
      ],
    }}],
  }};
  const {call, requests} = await harness(t, () => ({status: 200, body: response}));
  const result = data(await call('get_network_vpn_gateway', {gateway_id}));
  assert.deepEqual(result, response);
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].path, base);
  const site = result.vpn_gateway.peers[0].site;
  assert.equal(site.lines[0].active, false, 'line 1 is not active even when FRR selected and installed its local route');
  assert.equal(site.lines[1].active, true, 'line 2 active is the backend route-ownership fact');
  assert.deepEqual(site.lines[1].bgp.route_visibility.selected, line2Routes);
  assert.notDeepEqual(site.lines[1].bgp.route_visibility.selected, site.bgp.route_visibility.selected);
  assert.equal(site.lines[1].bgp.route_visibility.installed.state, 'unknown');
});

test('gateway read preserves old-agent omission and distinct unknown or stale line evidence', async t => {
  const {call} = await harness(t, req => ({status: 200, body: {vpn_gateway: {id: gateway_id,
    peers: [{id: peer_id, site: {bgp: {session: 'idle'}, lines: [
      {line: 1, active: null, bgp: {session: null, route_visibility: {state: 'unknown', reason: 'no_agent_snapshot', accepted: [], selected: [], advertised: []}}},
      {line: 2, active: false, bgp: {session: 'idle', route_visibility: {state: 'stale', reason: 'observation_expired', accepted: [], selected: [], advertised: []}}},
    ]}}],
  }}}));
  const result = data(await call('get_network_vpn_gateway', {gateway_id}));
  assert.equal(Object.hasOwn(result.vpn_gateway, 'capabilities'), false);
  const [first, second] = result.vpn_gateway.peers[0].site.lines;
  assert.equal(first.bgp.route_visibility.state, 'unknown');
  assert.equal(second.bgp.route_visibility.state, 'stale');
  assert.notDeepEqual(first.bgp.route_visibility, second.bgp.route_visibility);
  assert.equal(second.active, false);
  assert.equal(Object.hasOwn(second.bgp, 'accepted'), false, 'legacy aggregate is not copied into a line');
});

test('VPN renewal quote token remains usable while secret-bearing fields are hidden', async t => {
  const {call} = await harness(t, () => ({status: 200, body: {quote_id: test_id, quote_token: 'quote-fixture-token', gross_amount: '18.15', currency: 'EUR', nested: {privateKey: 'synthetic-private', psk_lost_hint: 'Rotate if the key is lost'}}}));
  const quote = await call('quote_vpn_period_renewal', {gateway_id, idempotencyKey});
  assert.equal(data(quote).quote_token, 'quote-fixture-token');
  assert.equal(data(quote).gross_amount, '18.15');
  assert.equal(data(quote).nested.privateKey, '[redacted]');
  assert.equal(data(quote).nested.psk_lost_hint, 'Rotate if the key is lost');
});
