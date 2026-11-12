import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Functions live in production since backend a33981f7 (r97, 2026-11-12): the server's public firewall, the outgoing
// source switch and reverse DNS of additional addresses; the load-balancer rebuild since r96; the server SSH key list.
// Request shapes follow the backend's spec (test/fixtures/backend-spec-routes.json) and its controllers.
const resource = 'a22093d5-985a-443c-9a93-e0dcf6609d84';
const service_id = 'VP12345';
const idempotencyKey = 'release-r97-contract-0001';
const firewallPath = `/account/networking/services/${service_id}/public-firewall`;
const rule = { direction: 'ingress', ether_type: 'IPv4', protocol: 'tcp', port_min: 22, port_max: 22, remote_cidr: '198.51.100.7/32' };
const firewallView = {
  available: true, unavailable_reason: null, manage: true, manage_reason: null, enabled: true, egress_policy: 'allow',
  rules: [{ id: '00000000-0000-4000-8000-000000000001', ...rule }], generation: 3, applied_generation: 2, state: 'applying',
  reason_code: null, limits: { rules: 100 }, client_address: '203.0.113.9', management_ports: [{ protocol: 'tcp', port: 22, name: 'ssh' }],
};

async function harness(t, respond, httpStatus = 200) {
  const requests = [];
  const api = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    requests.push({ method: req.method, path: req.url, body: raw ? JSON.parse(raw) : undefined, key: req.headers['idempotency-key'] });
    res.writeHead(httpStatus, { 'content-type': 'application/json' });
    res.end(JSON.stringify(respond ? respond(requests.at(-1)) : { accepted: true }));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(async () => { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); });
  const client = new Client({ name: 'release-r97', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['build/index.js'],
    env: { PATH: process.env.PATH, VPSNET_API_KEY: 'contract-test-key', VPSNET_API_URL: `http://127.0.0.1:${api.address().port}` } }));
  t.after(() => client.close());
  return { requests, client, call: (name, args) => client.callTool({ name, arguments: args }) };
}

test('public firewall: read, complete replacement with generation and key, apply again; refused shapes send nothing', async t => {
  const { requests, call } = await harness(t, () => firewallView);
  const read = await call('get_service_public_firewall', { service_id });
  assert.deepEqual(requests.at(-1), { method: 'GET', path: firewallPath, body: undefined, key: undefined });
  assert.equal(JSON.parse(read.content[0].text).client_address, '203.0.113.9', 'the local package passes the address the API saw');
  const v6 = { direction: 'ingress', ether_type: 'IPv6', protocol: 'tcp', port_min: 443, port_max: 443, remote_cidr: '::/0' };
  const ping = { direction: 'ingress', ether_type: 'IPv6', protocol: 'icmpv6', icmp_type: 128, remote_cidr: '2001:db8::/32' };
  const put = await call('set_service_public_firewall', { service_id, expected_generation: 2, enabled: true, rules: [rule, v6, ping], idempotencyKey });
  assert.deepEqual(requests.at(-1), { method: 'PUT', path: firewallPath, body: { expected_generation: 2, enabled: true, rules: [rule, v6, ping] }, key: idempotencyKey });
  assert.ok(put.content.some(item => item.text.includes('"tool":"get_service_public_firewall"')), 'the change is followed on the firewall read');
  await call('set_service_public_firewall', { service_id, expected_generation: 3, enabled: true, rules: [], acknowledge_no_incoming: true, idempotencyKey: `${idempotencyKey}-b` });
  assert.deepEqual(requests.at(-1).body, { expected_generation: 3, enabled: true, rules: [], acknowledge_no_incoming: true });
  await call('set_service_public_firewall', { service_id, expected_generation: 0, enabled: false, rules: [], idempotencyKey: `${idempotencyKey}-c` });
  assert.deepEqual(requests.at(-1).body, { expected_generation: 0, enabled: false, rules: [] });
  await call('apply_service_public_firewall', { service_id });
  assert.deepEqual(requests.at(-1), { method: 'POST', path: `${firewallPath}/apply`, body: undefined, key: undefined });
  const before = requests.length;
  for (const bad of [
    { rules: [{ ...rule, direction: 'egress' }] }, { rules: [{ ...rule, remote_cidr: '2001:db8::/32' }] },
    { rules: [{ ...rule, ether_type: 'IPv6', protocol: 'icmp', port_min: undefined, port_max: undefined, remote_cidr: '::/0' }] },
    { rules: [{ ...rule, port_max: undefined }] }, { rules: [{ ...rule, protocol: 'any' }] }, { rules: [{ ...rule, remote_group_id: resource }] },
    { rules: [{ direction: 'ingress', ether_type: 'IPv4', protocol: 'icmp', icmp_code: 0, remote_cidr: '0.0.0.0/0' }] },
    { rules: Array(101).fill(rule) }, { rules: undefined }, { egress_policy: 'rules_only' }, { expected_generation: -1 }, { idempotencyKey: undefined },
  ]) assert.equal((await call('set_service_public_firewall', { service_id, expected_generation: 2, enabled: true, rules: [rule], idempotencyKey, ...bad })).isError, true, JSON.stringify(bad));
  assert.equal((await call('get_service_public_firewall', { service_id: '../x' })).isError, true);
  assert.equal(requests.length, before);
});

test('public firewall over a hosted connection never hands the gateway address on as the customer\'s', async () => {
  const { publicFirewallPayload, networkingTools } = await import('../build/networking-tools.js');
  assert.equal(publicFirewallPayload(firewallView, true).client_address, null);
  assert.deepEqual(Object.keys(publicFirewallPayload(firewallView, true)), Object.keys(firewallView), 'the backend shape is kept');
  assert.equal(publicFirewallPayload(firewallView, false).client_address, '203.0.113.9');
  assert.deepEqual(publicFirewallPayload({ reason_code: 'workload_not_found' }, true), { reason_code: 'workload_not_found' });
  for (const tool of networkingTools.filter(item => item.path.includes('/public-firewall'))) {
    assert.match(tool.description, /never proof of the user's own address/);
  }
});

test('outgoing source: the switch sends exactly {enabled}, the recheck exactly {service_id}', async t => {
  const { requests, call } = await harness(t, req => req.path.endsWith('/recheck') ? { outcome: 'unchanged' } : { outcome: 'accepted', public_address: { id: resource } });
  const result = await call('set_public_address_outgoing_source', { address_id: resource, enabled: true });
  assert.deepEqual(requests.at(-1), { method: 'POST', path: `/account/networking/public-addresses/${resource}/outgoing-source`, body: { enabled: true }, key: undefined });
  assert.ok(result.content.some(item => item.text.includes('"tool":"get_network_public_address"')));
  await call('set_public_address_outgoing_source', { address_id: resource, enabled: false });
  assert.deepEqual(requests.at(-1).body, { enabled: false });
  await call('recheck_public_address_outgoing_source', { service_id });
  assert.deepEqual(requests.at(-1), { method: 'POST', path: '/account/networking/public-addresses/outgoing-source/recheck', body: { service_id }, key: undefined });
  const before = requests.length;
  for (const [name, args] of [['set_public_address_outgoing_source', { address_id: resource }], ['set_public_address_outgoing_source', { address_id: resource, enabled: 'true' }],
    ['set_public_address_outgoing_source', { address_id: 'x', enabled: true }], ['recheck_public_address_outgoing_source', { service_id: '' }],
    ['recheck_public_address_outgoing_source', { service_id, address_id: resource }]]) {
    assert.equal((await call(name, args)).isError, true, name);
  }
  assert.equal(requests.length, before);
});

test('reverse DNS: one target field reaches each of the five routes; target never enters the body', async t => {
  const answer = { rdns: { ip: '192.0.2.10', hostname: 'mail.example.com', applied_hostname: null, state: 'pending', revision: 4, reason_code: null, applied_at: null } };
  const { requests, call } = await harness(t, () => answer);
  const bases = {
    address: `/account/networking/public-addresses/${resource}/rdns`,
    assignment: `/account/networking/public-ip-assignments/${resource}/rdns`,
    binding: `/account/networking/public-bindings/${resource}/rdns`,
    vpn: `/account/networking/appliances/vpn-gateways/${resource}/rdns`,
    load_balancer: `/account/networking/appliances/load-balancers/${resource}/rdns`,
  };
  for (const [target, base] of Object.entries(bases)) {
    const read = await call('get_public_ip_rdns', { target, resource_id: resource });
    assert.deepEqual(requests.at(-1), { method: 'GET', path: base, body: undefined, key: undefined });
    assert.equal(JSON.parse(read.content[0].text).rdns.revision, 4);
    const set = await call('set_public_ip_rdns', { target, resource_id: resource, hostname: 'mail.example.com', expected_revision: 3 });
    assert.deepEqual(requests.at(-1), { method: 'POST', path: base, body: { hostname: 'mail.example.com', expected_revision: 3 }, key: undefined });
    assert.ok(set.content.some(item => item.text.includes(`"tool":"get_public_ip_rdns","arguments":{"target":"${target}","resource_id":"${resource}"}`)));
    await call('reset_public_ip_rdns', { target, resource_id: resource, expected_revision: 4 });
    assert.deepEqual(requests.at(-1), { method: 'POST', path: `${base}/reset`, body: { expected_revision: 4 }, key: undefined });
  }
  const before = requests.length;
  for (const [name, args] of [['get_public_ip_rdns', { target: 'service', resource_id: resource }], ['get_public_ip_rdns', { resource_id: resource }],
    ['set_public_ip_rdns', { target: 'address', resource_id: resource, hostname: 'mail.example.com' }],
    ['set_public_ip_rdns', { target: 'address', resource_id: resource, hostname: '', expected_revision: 0 }],
    ['reset_public_ip_rdns', { target: 'vpn', resource_id: resource, expected_revision: -1 }],
    ['reset_public_ip_rdns', { target: 'vpn', resource_id: resource, expected_revision: 1, hostname: 'x.example.com' }]]) {
    assert.equal((await call(name, args)).isError, true, `${name} ${JSON.stringify(args)}`);
  }
  assert.equal(requests.length, before);
});

test('load balancer rebuild: an empty body with the Idempotency-Key, followed on the appliance operation', async t => {
  const operation = { id: resource, kind: 'load_balancer_proxy_rebuild', state: 'waiting_dependency', reason_code: 'load_balancer_rebuilding', in_progress: true, next_check_seconds: 10 };
  const { requests, call } = await harness(t, () => ({ operation }));
  const result = await call('rebuild_network_load_balancer', { load_balancer_id: resource, idempotencyKey });
  assert.deepEqual(requests.at(-1), { method: 'POST', path: `/account/networking/appliances/load-balancers/${resource}/rebuild`, body: {}, key: idempotencyKey });
  assert.ok(result.content.some(item => item.text.includes('"tool":"get_network_appliance_operation"')));
  assert.ok(result.content.some(item => item.text.includes('this is progress, not an error')));
  assert.equal((await call('rebuild_network_load_balancer', { load_balancer_id: resource })).isError, true, 'the key is required');
  assert.equal(requests.length, 1);
});

test('server SSH keys: the list reads the server, refresh asks again, removal names one account key', async t => {
  const { requests, call } = await harness(t, req => req.method === 'GET'
    ? { success: true, supported: true, unsupportedReason: null, inventory: { source: 'guest', refreshing: false }, keys: [{ id: 381, name: 'laptop', deployed: true, removal: null }] }
    : { success: true, state: 'removed', removed: 1, key: { id: 381, name: 'laptop' }, removal: { id: 9021 } });
  await call('list_service_ssh_keys', { orderNo: service_id });
  assert.deepEqual(requests.at(-1), { method: 'GET', path: `/account/services/${service_id}/ssh-keys`, body: undefined, key: undefined });
  await call('list_service_ssh_keys', { orderNo: service_id, refresh: true });
  assert.equal(requests.at(-1).path, `/account/services/${service_id}/ssh-keys?refresh=1`);
  const removed = await call('remove_service_ssh_key', { orderNo: service_id, ssh_key: 381 });
  assert.deepEqual(requests.at(-1), { method: 'DELETE', path: `/account/services/${service_id}/ssh-keys/381`, body: undefined, key: undefined });
  assert.equal(JSON.parse(removed.content[0].text).state, 'removed');
  const before = requests.length;
  for (const args of [{ orderNo: service_id }, { orderNo: service_id, ssh_key: 0 }, { orderNo: '../x', ssh_key: 1 }]) {
    assert.equal((await call('remove_service_ssh_key', args)).isError, true);
  }
  assert.equal(requests.length, before);
});

test('hosted list: the firewall waits for the backend selected-service check; the other new tools carry networking scopes', async () => {
  const { discoverTools, profiles } = await import('../scripts/tool-contracts.mjs');
  const hosted = new Map((await discoverTools(profiles.directory)).map(tool => [tool.name, tool]));
  for (const name of ['get_service_public_firewall', 'set_service_public_firewall', 'apply_service_public_firewall', 'list_service_ssh_keys', 'remove_service_ssh_key']) {
    assert.ok(!hosted.has(name), `${name} is local-package only for now`);
  }
  for (const [name, scope] of [['get_public_ip_rdns', 'networking:read'], ['set_public_ip_rdns', 'networking:manage'], ['reset_public_ip_rdns', 'networking:manage'],
    ['set_public_address_outgoing_source', 'networking:manage'], ['recheck_public_address_outgoing_source', 'networking:manage'], ['rebuild_network_load_balancer', 'networking:manage']]) {
    assert.deepEqual(hosted.get(name)?.securitySchemes, [{ type: 'oauth2', scopes: [scope] }], name);
  }
});
