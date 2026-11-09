import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import test from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const network_id = '2f186a34-88a3-49fc-93e8-71931b212867';
const resource = 'a22093d5-985a-443c-9a93-e0dcf6609d84';
const idempotencyKey = 'sdn-parity-contract-0001';
async function harness(t, respond, httpStatus = 200) {
  const requests = [];
  const api = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    requests.push({method: req.method, path: req.url, body: raw ? JSON.parse(raw) : undefined, key: req.headers['idempotency-key']});
    res.writeHead(httpStatus, {'content-type': 'application/json'});
    res.end(JSON.stringify(respond ? respond(requests.at(-1)) : req.url.endsWith('/port-forwards')
      ? req.method === 'PUT' ? {operation: {id: resource, action: 'port_forward'}}
        : {targets: [{private_port_id: resource, eligible: true, unavailable_reason_code: null},
          {private_port_id: network_id, eligible: false, unavailable_reason_code: 'nat_port_forward_private_primary_required'}]}
      : {accepted: true}));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(async () => {api.closeAllConnections(); await new Promise(resolve => api.close(resolve));});
  const client = new Client({name: 'sdn-parity', version: '1'});
  await client.connect(new StdioClientTransport({command: process.execPath, args: ['build/index.js'],
    env: {PATH: process.env.PATH, VPSNET_API_KEY: 'contract-test-key', VPSNET_API_URL: `http://127.0.0.1:${api.address().port}`}}));
  t.after(() => client.close());
  return {requests, client, call: (name, args) => client.callTool({name, arguments: args})};
}

test('public address server selection, explicit movement and management reach check preserve the API contract', async t => {
  const {requests, client, call} = await harness(t);
  const tools = new Map((await client.listTools()).tools.map(tool => [tool.name, tool]));
  assert.equal(tools.get('list_public_address_server_targets').annotations.readOnlyHint, true);
  assert.equal(tools.get('check_network_public_address_reach').annotations.readOnlyHint, false);
  await call('list_public_address_server_targets', {search: 'fixture', cursor: 'opaque+/=', limit: 20, service_id: 'VP12345'});
  assert.deepEqual(requests.at(-1), {method: 'GET', path: '/account/networking/public-addresses/server-targets?search=fixture&cursor=opaque%2B%2F%3D&limit=20&service_id=VP12345', body: undefined, key: undefined});
  const path = `/account/networking/public-addresses/${resource}/attach`;
  for (const body of [{private_port_id: network_id}, {service_id: 'VP12345'}, {service_id: 'VP12345', move: true}, {private_port_id: network_id, move: false}]) {
    assert.notEqual((await call('attach_public_address_to_server', {address_id: resource, ...body})).isError, true);
    assert.deepEqual(requests.at(-1), {method: 'POST', path, body, key: undefined});
  }
  await call('attach_public_address_to_network', {address_id: resource, network_id, expected_generation: 3, move: true});
  assert.deepEqual(requests.at(-1).body, {network_id, expected_generation: 3, move: true});
  await call('check_network_public_address_reach', {address_id: resource});
  assert.deepEqual(requests.at(-1), {method: 'POST', path: `/account/networking/public-addresses/${resource}/reach-check`, body: {}, key: undefined});
  const before = requests.length;
  for (const args of [{address_id: resource}, {address_id: resource, private_port_id: network_id, service_id: 'VP12345'}, {address_id: resource, service_id: 'VP12345', tenant_id: 1}]) {
    assert.equal((await call('attach_public_address_to_server', args)).isError, true);
  }
  assert.equal((await call('list_public_address_server_targets', {limit: 101})).isError, true);
  assert.equal(requests.length, before);
});

test('SG defaults and complete NAT forward replacement keep explicit choice, distinct fences and fail closed input', async t => {
  const {requests, call} = await harness(t);
  const project_id = resource;
  await call('create_private_network', {name: 'fixture', default_policy: 'ingress_rules', idempotencyKey});
  assert.deepEqual(requests.at(-1).body, {name: 'fixture', default_policy: 'ingress_rules'});
  for (const extra of [{}, {egress_policy: 'rules_only'}, {egress_policy: 'allow'}]) {
    assert.notEqual((await call('create_network_security_group', {project_id, name: 'fixture', rules: [], idempotencyKey, ...extra})).isError, true);
    assert.deepEqual(requests.at(-1).body, {name: 'fixture', rules: [], ...extra});
  }
  await call('set_network_default_security_policy', {project_id, network_id, expected_generation: 4, expected_default_revision: 5, default_policy: 'ingress_rules', idempotencyKey});
  assert.deepEqual(requests.at(-1).body, {expected_generation: 4, expected_default_revision: 5, default_policy: 'ingress_rules'});
  const candidates = JSON.parse((await call('get_network_port_forwards', {network_id})).content[0].text).targets;
  assert.deepEqual(candidates, [{private_port_id: resource, eligible: true, unavailable_reason_code: null},
    {private_port_id: network_id, eligible: false, unavailable_reason_code: 'nat_port_forward_private_primary_required'}]);
  assert.deepEqual(requests.at(-1), {method: 'GET', path: `/account/networking/networks/${network_id}/port-forwards`, body: undefined, key: undefined});
  const rule = {protocol: 'tcp', external_port: 2222, private_port_id: resource, internal_port: 22};
  const args = {network_id, expected_generation: 7, rules: [rule], idempotencyKey};
  for (const rules of [[rule], []]) {
    const result = await call('set_network_port_forwards', {...args, rules});
    assert.notEqual(result.isError, true);
    const followUp = result.content.find(item => item.text?.startsWith('Follow-up reads'));
    assert.match(followUp.text, /get_network_port_forwards/);
    assert.doesNotMatch(followUp.text, /get_networking_operation/);
    assert.deepEqual(requests.at(-1), {method: 'PUT', path: `/account/networking/networks/${network_id}/port-forwards`, body: {expected_generation: 7, rules}, key: idempotencyKey});
  }
  const before = requests.length;
  for (const bad of [{...args, idempotencyKey: '.invalid-first'}, {...args, rules: [rule, rule]}, {...args, rules: [{...rule, internal_port: 25}]}, {...args, rules: [{...rule, external_port: 587}]}, {...args, rules: [{...rule, ipv4: '100.64.0.10'}]}, {...args, expected_generation: undefined}]) {
    assert.equal((await call('set_network_port_forwards', bad)).isError, true);
  }
  assert.equal((await call('create_network_security_group', {project_id, name: 'fixture', rules: [], idempotencyKey, egress_policy: null})).isError, true);
  assert.equal((await call('update_network_security_group', {project_id, group_id: resource, name: 'fixture', rules: [], expected_revision: 1, idempotencyKey, egress_policy: 'allow'})).isError, true);
  assert.equal(requests.length, before);
});


test('managed LB TLS stays on existing listener API, preserves lifecycle facts and never accepts or returns private material', async t => {
  const operation = {id: network_id, state: 'succeeded', in_progress: false};
  const tls = {hostname: 'app.example.com', status: 'pending', reason_code: null, expires_at: null, fingerprint_sha256: null, backend_protocol: 'http'};
  const {requests, call} = await harness(t, () => ({operation, load_balancer: {id: resource, managed_tls: {available: true, reason_code: null}, listeners: [{tls: {...tls, private_key: 'synthetic-never-display'}}]}}));
  const args = {load_balancer_id: resource, protocol: 'https', port: 443, members: [{address: '100.64.0.10', port: 8080}], tls: {hostname: 'app.example.com'}, idempotencyKey};
  const result = await call('add_network_load_balancer_listener', args);
  assert.notEqual(result.isError, true);
  assert.deepEqual(requests[0], {method: 'POST', path: `/account/networking/appliances/load-balancers/${resource}/listeners`, body: {protocol: 'https', port: 443, members: args.members, tls: args.tls}, key: idempotencyKey});
  assert.match(JSON.stringify(result), /get_network_load_balancer/);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-never-display/);
  assert.equal(JSON.parse(result.content[0].text).load_balancer.listeners[0].tls.status, 'pending', 'terminal registration operation does not make certificate ready');
  for (const status of ['ready', 'renewal_failed', 'expired']) {
    tls.status = status; tls.fingerprint_sha256 = 'a'.repeat(64);
    const value = JSON.parse((await call('get_network_load_balancer', {load_balancer_id: resource})).content[0].text);
    assert.equal(value.load_balancer.listeners[0].tls.status, status);
    assert.equal(value.load_balancer.listeners[0].tls.fingerprint_sha256, tls.fingerprint_sha256);
  }
  const before = requests.length;
  for (const hostname of ['App.example.com', '*.example.com', '203.0.113.1', 'https://app.example.com', 'app.example.com.', 'localhost', 'a'.repeat(64)+'.example.com']) assert.equal((await call('add_network_load_balancer_listener', {...args, tls: {hostname}})).isError, true);
  for (const bad of [{...args, protocol: 'http'}, {...args, tls: {...args.tls, private_key: 'synthetic'}}, {...args, expected_generation: 1}]) assert.equal((await call('add_network_load_balancer_listener', bad)).isError, true);
  assert.equal(requests.length, before);
});

test('one canonical VPN catalogue, omitted quote code, legacy proof recovery and separate traffic top-up keep backend prices', async t => {
  const canonical = {product: 'vpn_gateway', tier: 'standard', periods: [{months: 12, gross_amount: '24.20'}], renew_periods: [{months: 12, gross_amount: '20.00'}]};
  const alias = {...canonical, tier: 'full_exit', deprecated_alias: true, alias_of: 'standard'};
  const lb = {product: 'load_balancer', tier: 'alb_proxy_3'};
  const {requests, call} = await harness(t, req => req.method === 'GET'
    ? {products: [canonical, alias, lb], currency: 'EUR'}
    : {quote: {quote_id: resource, quote_token: 'fixture-quote', asked_tier: req.body.tier, gross_amount: '20.00'}});
  const list = JSON.parse((await call('list_network_products', {})).content[0].text);
  assert.deepEqual(list, {products: [canonical, lb], currency: 'EUR'});
  await call('quote_account_vpn', {network_id, period_months: 12, idempotencyKey});
  assert.deepEqual(requests.at(-1).body, {network_id, period_months: 12, prepare_after_payment: true});
  const legacy = {network_id, tier: 'full_exit', period_months: 12, idempotencyKey: idempotencyKey+'-legacy'};
  const receipt = JSON.parse((await call('quote_account_vpn', legacy)).content[0].text);
  assert.equal(receipt.quote.asked_tier, 'full_exit', 'proof-chain evidence is not rewritten');
  const original = requests.at(-1); await call('quote_account_vpn', legacy);
  assert.deepEqual(requests.at(-1), original, 'legacy recovery retains exact original key and body');
  await call('quote_network_vpn_traffic_pack', {gateway_id: resource, tier: '5tb', idempotencyKey});
  assert.deepEqual(requests.at(-1), {method: 'POST', path: `/account/networking/appliances/vpn-gateways/${resource}/traffic-packs/quote`, body: {tier: '5tb'}, key: idempotencyKey});
});

test('shared SG impact acknowledgement is forwarded unchanged and never fabricated on private/name-only updates', async t => {
  const {requests, call} = await harness(t);
  const args = {project_id: network_id, group_id: resource, name: 'fixture', rules: [], expected_revision: 3, idempotencyKey};
  await call('update_network_security_group', args);
  assert.deepEqual(requests.at(-1).body, {name: 'fixture', rules: [], expected_revision: 3});
  const ack = 'a'.repeat(64);
  await call('update_network_security_group', {...args, public_impact_ack: ack});
  assert.deepEqual(requests.at(-1).body, {name: 'fixture', rules: [], expected_revision: 3, public_impact_ack: ack});
  const original = requests.at(-1); await call('update_network_security_group', {...args, public_impact_ack: ack});
  assert.deepEqual(requests.at(-1), original, 'request-hash input and original key remain unchanged on recovery');
  const before = requests.length;
  assert.equal((await call('update_network_security_group', {...args, public_impact_ack: 'stale-not-a-token'})).isError, true);
  assert.equal(requests.length, before);
});


test('stale shared-impact conflicts remain exact errors with no acknowledgement refresh or automatic retry', async t => {
  const {requests, call} = await harness(t, () => ({reason_code: 'security_group_public_impact_conflict'}), 409);
  const ack = 'c'.repeat(64);
  const result = await call('update_network_security_group', {project_id: network_id, group_id: resource, name: 'fixture', rules: [], expected_revision: 2, public_impact_ack: ack, idempotencyKey});
  assert.equal(result.isError, true);
  assert.equal(JSON.parse(result.content[0].text).reason_code, 'security_group_public_impact_conflict');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].key, idempotencyKey);
  assert.equal(requests[0].body.public_impact_ack, ack);
});

test('pending unissued TLS cancellation keeps existing DELETE fences and reads current LB state before a corrected add', async t => {
  const {requests, call} = await harness(t, () => ({operation: {id: network_id, state: 'succeeded', in_progress: false}, load_balancer: {id: resource, generation: 3, managed_tls: {available: true, reason_code: null}, listeners: []}}));
  const args = {load_balancer_id: resource, listener_id: network_id, expected_generation: 2, idempotencyKey};
  const result = await call('remove_network_load_balancer_listener', args);
  assert.notEqual(result.isError, true);
  assert.deepEqual(requests[0], {method: 'DELETE', path: `/account/networking/appliances/load-balancers/${resource}/listeners/${network_id}`, body: {expected_generation: 2}, key: idempotencyKey});
  assert.match(JSON.stringify(result), /get_network_load_balancer/);
  assert.equal(JSON.parse(result.content[0].text).load_balancer.generation, 3);
  const original = requests[0]; await call('remove_network_load_balancer_listener', args);
  assert.deepEqual(requests[1], original, 'cancellation recovery never changes its key or generation input');
});
