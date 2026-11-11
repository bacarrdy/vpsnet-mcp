import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// The fixture is generated from the backend's spec/*.yml (scripts/sync-backend-spec-routes.py).
// A registered networking tool must name a route the backend spec has, with the scope the route
// enforces and only query parameters it declares.
process.env.VPSNET_API_KEY = 'contract-test-key';
const { networkingTools } = await import('../build/networking-tools.js');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/backend-spec-routes.json', import.meta.url), 'utf8'));
const operation = tool => `${tool.method} ${tool.path.replace(/\{[^}]+\}/g, '{}')}`;
const customer = networkingTools.filter(tool => tool.path.startsWith('/account/networking'));

test('every registered networking tool names a route of the pinned backend spec', () => {
  assert.match(fixture.backend_commit, /^[0-9a-f]{40}$/);
  assert.ok(customer.length > 100);
  for (const tool of customer) assert.ok(fixture.routes[operation(tool)], `${tool.name}: ${operation(tool)} is not in the backend spec`);
});

test('tool scope, access level and query parameters match what the spec route enforces', () => {
  for (const tool of customer) {
    const route = fixture.routes[operation(tool)];
    assert.ok(route.scopes.includes(tool.options.readOnly ? 'networking:read' : 'networking:manage'), `${tool.name}: spec scopes ${route.scopes}`);
    if (tool.options.paid) assert.ok(route.scopes.includes('networking:order'), `${tool.name}: a paid tool needs networking:order`);
    if (!tool.options.readOnly) assert.ok(route.access.includes('full'), `${tool.name}: a changing tool needs a full-access key; spec says ${route.access}`);
    for (const field of [...(tool.options.query ?? []), ...Object.keys(tool.options.fixedQuery ?? {})]) {
      assert.ok(route.query.includes(field), `${tool.name}: query parameter ${field} is not in the spec`);
    }
  }
});

test('request body fields of every changing tool are properties of the spec route body', () => {
  const sent = new Set(['idempotencyKey', 'quoteToken', 'acknowledge_charge', 'acknowledge_one_time_pickup']);
  // Fields the backend accepts (checked in its source) that its spec does not list yet: listed here so a new gap cannot hide.
  const specGaps = { create_private_network: ['subnet_prefix_length'] };
  for (const tool of customer.filter(tool => tool.method !== 'GET' && !tool.options.bodyless)) {
    const route = fixture.routes[operation(tool)];
    if (!route.body.length) continue;
    const fields = Object.keys(tool.schema.shape).filter(field => !tool.pathFields.includes(field) && !(tool.options.query ?? []).includes(field) && !sent.has(field));
    for (const field of [...fields, ...Object.keys(tool.options.fixedBody ?? {})]) {
      assert.ok(route.body.includes(field) || (specGaps[tool.name] ?? []).includes(field), `${tool.name}: body field ${field} is not in the spec (${route.body})`);
    }
  }
});

test('features that are live in production are registered with the spec shape', () => {
  const names = new Set(networkingTools.map(tool => tool.name));
  for (const name of ['get_network_port_forwards', 'set_network_port_forwards', 'list_public_address_server_targets',
    'attach_public_address_to_server_interface', 'check_network_public_address_reach']) assert.ok(names.has(name), name);
  const attach = networkingTools.find(tool => tool.name === 'attach_public_address_to_server_interface');
  assert.equal(attach.options.requiresCapability, 'public_address_server_public');
});

test('features that are switched off in production are not registered or described', () => {
  const names = new Set(networkingTools.map(tool => tool.name));
  for (const name of ['get_service_public_firewall', 'set_service_public_firewall', 'retry_service_public_firewall', 'create_service_public_firewall_group']) {
    assert.ok(!names.has(name), `${name} must stay out until its feature is on in production`);
  }
  for (const tool of networkingTools) {
    assert.doesNotMatch(tool.path, /public-firewall|\/rdns/, tool.name);
    assert.doesNotMatch(tool.name, /rdns|public_firewall/, tool.name);
  }
  const field = (name, key) => networkingTools.find(tool => tool.name === name).schema.shape[key];
  assert.equal(field('add_network_load_balancer_listener', 'tls'), undefined, 'managed TLS is not live');
  assert.equal(field('attach_public_address_to_server', 'service_id'), undefined, 'the private-port attach keeps its own shape');
  assert.equal(field('update_network_security_group', 'public_impact_ack'), undefined, 'shared public edit impact is not live');
  assert.match(networkingTools.find(tool => tool.name === 'add_network_load_balancer_listener').description, /does not terminate TLS/);
});
