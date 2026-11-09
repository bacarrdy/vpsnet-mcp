import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import test from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const network_id = '2f186a34-88a3-49fc-93e8-71931b212867';
const resource = 'a22093d5-985a-443c-9a93-e0dcf6609d84';
const idempotencyKey = 'sdn-parity-contract-0001';
async function harness(t) {
  const requests = [];
  const api = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    requests.push({method: req.method, path: req.url, body: raw ? JSON.parse(raw) : undefined, key: req.headers['idempotency-key']});
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify(req.url.endsWith('/port-forwards')
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
