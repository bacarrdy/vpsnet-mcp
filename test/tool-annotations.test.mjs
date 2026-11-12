import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// Every tool of every profile (local, hosted directory, hosted orders) serves four explicit boolean hints taken from one
// reviewed table, each with the sentence that justifies it; a hint that contradicts the tool's effect or world fails.
process.env.VPSNET_API_KEY ||= 'contract-test-key';
const { discoverTools, profiles } = await import('../scripts/tool-contracts.mjs');
const { reviewedAnnotations } = await import('../build/tool-annotations.js');
const { networkingTools } = await import('../build/networking-tools.js');
const scopes = JSON.parse(readFileSync(new URL('../scripts/tool-scopes.json', import.meta.url), 'utf8'));
const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];
const fullOrders = { remoteScopes: ['services:read', 'services:manage', 'applications:read', 'applications:manage', 'networking:read', 'networking:manage', 'functions:read', 'functions:manage', 'functions:invoke', 'vm:diagnostics', 'vm:files:read', 'vm:files:write', 'vm:exec', 'services:reinstall', 'services:restore', 'services:rescue', 'dns:read', 'dns:write', 'dnssec:manage', 'domains:read', 'domains:manage', 'certificates:read', 'certificates:manage', 'ssh_keys:read', 'ssh_keys:manage', 'orders:read', 'orders:servers', 'orders:domains'], remoteProfile: 'orders' };
const served = {};
for (const [name, options] of Object.entries({ ...profiles, fullOrders })) served[name] = await discoverTools(options);

test('every served tool carries the four hints as explicit booleans, exactly as reviewed, with a justification', () => {
  const seen = new Set();
  for (const [profile, tools] of Object.entries(served)) {
    for (const tool of tools) {
      seen.add(tool.name);
      const reviewed = reviewedAnnotations[tool.name];
      assert.ok(reviewed, `${profile}.${tool.name}: no reviewed annotations`);
      for (const hint of HINTS) {
        assert.equal(typeof tool.annotations?.[hint], 'boolean', `${profile}.${tool.name}.${hint} must be true or false`);
        assert.equal(tool.annotations[hint], reviewed[hint], `${profile}.${tool.name}.${hint} differs from the reviewed table`);
      }
      assert.ok(typeof tool.annotations.title === 'string' && tool.annotations.title.trim(), `${profile}.${tool.name}: title`);
      assert.ok(reviewed.why.length > 60 && /\.$/.test(reviewed.why), `${tool.name}: justification sentence`);
    }
  }
  assert.deepEqual(Object.keys(reviewedAnnotations).filter(name => !seen.has(name)), [], 'reviewed entries for tools no profile serves');
});

test('hints follow the tool\'s effect and world', () => {
  const rules = {
    read: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    additive: { readOnlyHint: false, destructiveHint: false },
    change: { readOnlyHint: false, destructiveHint: true },
    quote: { readOnlyHint: false, destructiveHint: false },
    paid: { readOnlyHint: false, destructiveHint: true },
  };
  for (const [name, reviewed] of Object.entries(reviewedAnnotations)) {
    for (const [hint, value] of Object.entries(rules[reviewed.effect])) assert.equal(reviewed[hint], value, `${name}: ${reviewed.effect} needs ${hint}=${value}`);
    assert.equal(reviewed.openWorldHint, reviewed.world !== 'account', `${name}: world ${reviewed.world}`);
    assert.match(reviewed.why, reviewed.effect === 'read' ? /Read-only/ : reviewed.destructiveHint ? /Destructive/ : /Not destructive|not destructive/, name);
    assert.match(reviewed.why, reviewed.openWorldHint ? /Open world/ : /Closed world/, name);
  }
});

test('the effect matches what the tool does: its route, its price and its verb', () => {
  for (const tool of networkingTools) {
    const effect = reviewedAnnotations[tool.name].effect;
    if (tool.options.paid) assert.equal(effect, 'paid', tool.name);
    else if (tool.options.quote) assert.equal(effect, 'quote', tool.name);
    else assert.equal(effect === 'read', tool.options.readOnly === true, `${tool.name}: ${tool.method} ${tool.path} is ${effect}`);
    if (tool.options.destructive) assert.equal(reviewedAnnotations[tool.name].destructiveHint, true, `${tool.name} is declared destructive`);
  }
  for (const [name, meta] of Object.entries(scopes)) {
    if (/^(Paid|Billed)/.test(meta.paid ?? '') && reviewedAnnotations[name]) assert.equal(reviewedAnnotations[name].effect, 'paid', `${name} spends money`);
  }
  for (const [name, reviewed] of Object.entries(reviewedAnnotations)) {
    if (/^(delete|remove|revoke|uninstall|reinstall|rollback|suspend|stop|restart|flush|exit|enter|detach|retire|cancel|abort|reset|clear|move|rebuild|rotate)_/.test(name)) {
      assert.equal(reviewed.destructiveHint, true, `${name} removes, replaces or interrupts`);
    }
    if (/^(get|list)_/.test(name) && reviewed.effect !== 'read') {
      assert.ok(['list_snapshots', 'get_hostname', 'list_functions', 'get_function', 'get_application_health', 'get_application_logs', 'take_network_vpn_peer_config', 'take_network_vpn_site_line_config', 'list_application_restore_points', 'get_restore_status'].includes(name) || reviewed.effect !== 'read',
        `${name}: a read name with a ${reviewed.effect} effect must be listed with its reason`);
    }
  }
  // Reaches systems outside VPSnet: public DNS, registries, certificate authorities, arbitrary code.
  for (const name of ['upsert_dns_record', 'set_domain_nameservers', 'create_free_certificate', 'run_vm_command', 'invoke_function', 'set_public_ip_rdns', 'get_registrar_lock']) {
    assert.equal(reviewedAnnotations[name].openWorldHint, true, name);
  }
  for (const name of ['list_private_networks', 'set_service_public_firewall', 'list_service_files', 'get_service']) {
    assert.equal(reviewedAnnotations[name].openWorldHint, false, name);
  }
});
