import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const network_id = '2f186a34-88a3-49fc-93e8-71931b212867';
const resource = 'a22093d5-985a-443c-9a93-e0dcf6609d84';
const idempotencyKey = 'release-1110-contract-0001';

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
  const client = new Client({ name: 'release-1110', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['build/index.js'],
    env: { PATH: process.env.PATH, VPSNET_API_KEY: 'contract-test-key', VPSNET_API_URL: `http://127.0.0.1:${api.address().port}` } }));
  t.after(() => client.close());
  return { requests, client, call: (name, args) => client.callTool({ name, arguments: args }) };
}

test('security-group default modes: network creation, default policy change and group egress policy keep the explicit choice', async t => {
  const { requests, call } = await harness(t);
  const project_id = resource;
  await call('create_private_network', { name: 'fixture', default_policy: 'ingress_rules', idempotencyKey });
  assert.deepEqual(requests.at(-1).body, { name: 'fixture', default_policy: 'ingress_rules' });
  for (const extra of [{}, { egress_policy: 'rules_only' }, { egress_policy: 'allow' }]) {
    assert.notEqual((await call('create_network_security_group', { project_id, name: 'fixture', rules: [], idempotencyKey, ...extra })).isError, true);
    assert.deepEqual(requests.at(-1).body, { name: 'fixture', rules: [], ...extra });
  }
  await call('set_network_default_security_policy', { project_id, network_id, expected_generation: 4, expected_default_revision: 5, default_policy: 'ingress_rules', idempotencyKey });
  assert.deepEqual(requests.at(-1).body, { expected_generation: 4, expected_default_revision: 5, default_policy: 'ingress_rules' });
  const before = requests.length;
  assert.equal((await call('create_network_security_group', { project_id, name: 'fixture', rules: [], idempotencyKey, egress_policy: null })).isError, true);
  assert.equal((await call('update_network_security_group', { project_id, group_id: resource, name: 'fixture', rules: [], expected_revision: 1, idempotencyKey, egress_policy: 'allow' })).isError, true);
  assert.equal((await call('set_network_default_security_policy', { project_id, network_id, expected_generation: 4, expected_default_revision: 5, default_policy: 'allow_all', idempotencyKey })).isError, true);
  assert.equal(requests.length, before);
});

test('product periods: resource_id narrows the read, and the incomplete flag reaches the client', async t => {
  const { requests, call } = await harness(t, () => ({ products: [], incomplete: true }));
  const result = await call('list_network_product_periods', {});
  assert.deepEqual(requests.at(-1), { method: 'GET', path: '/account/networking/product-periods', body: undefined, key: undefined });
  assert.equal(JSON.parse(result.content[0].text).incomplete, true);
  await call('list_network_product_periods', { resource_id: resource });
  assert.equal(requests.at(-1).path, `/account/networking/product-periods?resource_id=${resource}`);
  assert.equal((await call('list_network_product_periods', { resource_id: 'not-a-uuid' })).isError, true);
  assert.equal(requests.length, 2);
});

test('one VPN product: the sellable catalogue hides the retired alias, the quote needs no tier, legacy recovery keeps its body', async t => {
  const canonical = { product: 'vpn_gateway', tier: 'standard', periods: [{ months: 12, gross_amount: '24.20' }] };
  const alias = { ...canonical, tier: 'full_exit', deprecated_alias: true, alias_of: 'standard' };
  const lb = { product: 'load_balancer', tier: 'alb_proxy_3' };
  const { requests, call } = await harness(t, req => req.method === 'GET' ? { products: [canonical, alias, lb], currency: 'EUR' } : { quote: { quote_id: resource, asked_tier: req.body.tier } });
  assert.deepEqual(JSON.parse((await call('list_network_products', {})).content[0].text), { products: [canonical, lb], currency: 'EUR' });
  await call('quote_account_vpn', { network_id, period_months: 12, idempotencyKey });
  assert.deepEqual(requests.at(-1).body, { network_id, period_months: 12, prepare_after_payment: true });
  const legacy = { network_id, tier: 'full_exit', period_months: 12, idempotencyKey: `${idempotencyKey}-legacy` };
  await call('quote_account_vpn', legacy);
  assert.deepEqual(requests.at(-1).body, { network_id, tier: 'full_exit', period_months: 12, prepare_after_payment: true });
  await call('quote_network_vpn_traffic_pack', { gateway_id: resource, tier: '5tb', idempotencyKey });
  assert.deepEqual(requests.at(-1), { method: 'POST', path: `/account/networking/appliances/vpn-gateways/${resource}/traffic-packs/quote`, body: { tier: '5tb' }, key: idempotencyKey });
});

test('attaching an owned address moves it only on an explicit move=true', async t => {
  const { requests, call } = await harness(t);
  const path = `/account/networking/public-addresses/${resource}/attach`;
  await call('attach_public_address_to_server', { address_id: resource, private_port_id: network_id });
  assert.deepEqual(requests.at(-1), { method: 'POST', path, body: { private_port_id: network_id }, key: undefined });
  await call('attach_public_address_to_server', { address_id: resource, private_port_id: network_id, move: true });
  assert.deepEqual(requests.at(-1).body, { private_port_id: network_id, move: true });
  await call('attach_public_address_to_network', { address_id: resource, network_id, expected_generation: 3, move: true });
  assert.deepEqual(requests.at(-1).body, { network_id, expected_generation: 3, move: true });
  const before = requests.length;
  assert.equal((await call('attach_public_address_to_server', { address_id: resource, service_id: 'VP12345' })).isError, true);
  assert.equal(requests.length, before);
});

test('a service two-factor lock refusal keeps its typed reason, including the transfer refusal', async t => {
  const { requests, call } = await harness(t, () => ({ code: 'serviceTwoFactorLocked', reason: 'transferNeedsLockOff', unlockAvailable: false, orderNo: 'VP12345', message: 'free text must not pass' }), 423);
  const result = await call('rename_network_vpn_gateway', { gateway_id: resource, name: 'office' });
  assert.equal(result.isError, true);
  const body = JSON.parse(result.content[0].text);
  assert.deepEqual([body.code, body.reason, body.unlockAvailable, body.orderNo], ['serviceTwoFactorLocked', 'transferNeedsLockOff', false, 'VP12345']);
  assert.doesNotMatch(result.content[0].text, /free text/);
  assert.equal(requests.length, 1);
});

test('NAT port forwarding: read, complete replacement with the router generation, spec-shaped rules and key', async t => {
  const rule = { protocol: 'tcp', external_port: 8080, private_port_id: resource, internal_port: 80 };
  const { requests, call } = await harness(t, () => ({ network_id, generation: 4, applied_generation: 3, state: 'pending', rules: [rule] }));
  const base = `/account/networking/networks/${network_id}/port-forwards`;
  await call('get_network_port_forwards', { network_id });
  assert.deepEqual(requests.at(-1), { method: 'GET', path: base, body: undefined, key: undefined });
  const put = await call('set_network_port_forwards', { network_id, expected_generation: 3, rules: [rule], idempotencyKey });
  assert.deepEqual(requests.at(-1), { method: 'PUT', path: base, body: { expected_generation: 3, rules: [rule] }, key: idempotencyKey });
  assert.ok(put.content.some(item => item.text.includes('"tool":"get_network_port_forwards"')), 'the accepted change is followed on the rules resource');
  await call('set_network_port_forwards', { network_id, expected_generation: 4, rules: [], idempotencyKey });
  assert.deepEqual(requests.at(-1).body, { expected_generation: 4, rules: [] });
  const before = requests.length;
  for (const bad of [
    { rules: [{ ...rule, external_port: 0 }] }, { rules: [{ ...rule, protocol: 'sctp' }] }, { rules: [{ ...rule, extra: 1 }] },
    { rules: [{ protocol: 'tcp', external_port: 80 }] }, { rules: Array(65).fill(rule) }, { rules: [rule], idempotencyKey: 'short' },
    { rules: [rule], expected_generation: 0 }, { rules: [rule], network_generation: 2 },
  ]) assert.equal((await call('set_network_port_forwards', { network_id, expected_generation: 3, idempotencyKey, ...bad })).isError, true);
  assert.equal(requests.length, before);
  const tools = (await (await import('../build/networking-tools.js')).networkingTools);
  const description = tools.find(tool => tool.name === 'set_network_port_forwards').description;
  assert.match(description, /25, 465, 587 and 2525/);
  assert.match(description, /Cloud VPS servers are not accepted/);
});

test('address on a server public interface: read from the capability before any change, backend verdict for targets', async t => {
  const capabilities = { value: { enabled: true } };
  const { requests, call } = await harness(t, req => req.path === '/account/networking/capabilities' ? capabilities.value : { public_address: { id: resource } });
  const args = { address_id: resource, service_id: 'VP12345' };
  for (const value of [{ enabled: true }, { enabled: true, public_address_server_public: false }, { enabled: true, public_address_server_public: 'true' }]) {
    capabilities.value = value;
    const refused = await call('attach_public_address_to_server_interface', args);
    assert.equal(refused.isError, true);
    assert.equal(JSON.parse(refused.content[0].text).changed, false);
  }
  assert.ok(requests.every(request => request.method === 'GET' && request.path === '/account/networking/capabilities'), 'no attach was sent while the capability is not true');
  capabilities.value = { enabled: true, public_address_server_public: true };
  const attached = await call('attach_public_address_to_server_interface', args);
  assert.notEqual(attached.isError, true);
  assert.deepEqual(requests.at(-1), { method: 'POST', path: `/account/networking/public-addresses/${resource}/attach`, body: { service_id: 'VP12345' }, key: undefined });
  await call('attach_public_address_to_server_interface', { ...args, move: true });
  assert.deepEqual(requests.at(-1).body, { service_id: 'VP12345', move: true });
  const before = requests.length;
  for (const bad of [{ ...args, private_port_id: network_id }, { ...args, network_id }, { address_id: resource }, { ...args, service_id: '../x' }]) {
    assert.equal((await call('attach_public_address_to_server_interface', bad)).isError, true);
  }
  assert.equal(requests.length, before);
  await call('list_public_address_server_targets', { search: 'web', cursor: 'abc', limit: 25 });
  assert.equal(requests.at(-1).path, '/account/networking/public-addresses/server-targets?search=web&cursor=abc&limit=25');
  await call('list_public_address_server_targets', { service_id: 'VP12345' });
  assert.equal(requests.at(-1).path, '/account/networking/public-addresses/server-targets?service_id=VP12345');
  assert.equal((await call('list_public_address_server_targets', { limit: 101 })).isError, true);
  await call('check_network_public_address_reach', { address_id: resource });
  assert.deepEqual(requests.at(-1), { method: 'POST', path: `/account/networking/public-addresses/${resource}/reach-check`, body: {}, key: undefined });
});

test('the capability read failing refuses the server-interface attach without a change', async t => {
  const { requests, call } = await harness(t, () => ({ code: 'unavailable' }), 503);
  const result = await call('attach_public_address_to_server_interface', { address_id: resource, service_id: 'VP12345' });
  assert.equal(result.isError, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/account/networking/capabilities');
});

test('IPsec tuning keeps the outer limits and null or an empty object restores Automatic', async t => {
  const { requests, call } = await harness(t);
  const gateway_id = resource; const peer_id = network_id; const base = `/account/networking/appliances/vpn-gateways/${gateway_id}/peers/${peer_id}/ipsec-tuning`;
  for (const tuning of [null, {}]) {
    await call('set_network_vpn_ipsec_tuning', { gateway_id, peer_id, expected_generation: 2, tuning, idempotencyKey });
    assert.deepEqual(requests.at(-1), { method: 'PUT', path: base, body: { expected_generation: 2, tuning }, key: idempotencyKey });
  }
  const before = requests.length;
  for (const tuning of [{ ke_groups: [5] }, { ike_lifetime_seconds: 899 }, { ike_lifetime_seconds: 172801 }, { esp_lifetime_seconds: 299 }, { esp_lifetime_seconds: 86401 }]) {
    assert.equal((await call('set_network_vpn_ipsec_tuning', { gateway_id, peer_id, expected_generation: 2, tuning, idempotencyKey })).isError, true);
  }
  assert.equal(requests.length, before);
  const { networkingTools } = await import('../build/networking-tools.js');
  const tool = networkingTools.find(item => item.name === 'set_network_vpn_ipsec_tuning');
  assert.match(tool.description, /vpn_ipsec_tuning_not_allowed/);
  assert.match(JSON.stringify(tool.schema.shape.tuning.toJSONSchema?.() ?? ''), /ipsec_tuning/);
});
