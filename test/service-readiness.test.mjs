import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import Ajv from 'ajv';
import { serviceReadiness, serviceResultOutput, purchaseReadiness, purchaseResultOutput } from '../build/service-readiness.js';
import { markToolResultError } from '../build/tool-result.js';

const ORDER = 'VP-FIXTURE';
const KEY = 'fixture-order-12345678';
const service = (overrides = {}, extra = {}) => ({ success: true, service: {
  orderNo: ORDER, type: 'firecracker', state: 'creating', finalizing: false,
  stateProcess: { type: 1, percentage: 10 },
  extra: { pendingActivation: true, awaitingCapacity: false, awaitingStock: false,
    guestAgentAvailable: null, ...extra }, ...overrides,
} });
const running = (type = 'firecracker', extra = {}) => service({ type, state: 'running', stateProcess: null }, { pendingActivation: false, ...extra });

test('readiness table preserves actual state and separates provisioning, guest and application evidence', () => {
  const cases = [
    ['FC pending', service(), 'pending', null],
    ['FC capacity', service({}, { awaitingCapacity: true }), 'pending', null],
    ['IP inventory', service({ stateProcess: { type: 1, percentage: 10, waitingReason: 'public_ip_inventory' } }), 'pending', null],
    ['KVM clone', service({ type: 'vds', stateProcess: { type: 1, percentage: 60 } }), 'pending', null],
    ['Windows guest boot', service({ type: 'vds', stateProcess: { type: 1, percentage: 92 } }, { osFamily: 'windows' }), 'pending', null],
    ['KVM finalizing despite running', service({ type: 'vds', state: 'running', finalizing: true, stateProcess: null }, { pendingActivation: false }), 'pending', null],
    ['percentage100 not ready', service({ stateProcess: { type: 1, percentage: 100 } }), 'pending', null],
    ['operator attention', service({ stateProcess: { type: 1, percentage: 15, attention: true } }), 'needs_attention', null],
    ['operator-held fallback', service({ stateProcess: null }, { operatorWaiting: true, pendingActivationRefresh: false }), 'needs_attention', null],
    ['terminal create failure before pending flag', service({ state: 'create_failed', stateProcess: null }, { pendingActivationRefresh: false, createFailure: { code: 'fixture_failure', attention: true } }), 'failed', null],
    ['FC running unknown agent', running(), 'complete', true],
    ['KVM running agent unavailable', running('vds', { guestAgentAvailable: false }), 'complete', true],
    ['Windows running agent available', running('vds', { osFamily: 'windows', guestAgentAvailable: true }), 'complete', true],
    ['stopped', service({ state: 'stopped', stateProcess: null }, { pendingActivation: false }), 'not_running', false],
    ['suspended', service({ state: 'suspended', stateProcess: null }, { pendingActivation: false }), 'not_running', false],
    ['missing progress proof', service({ state: 'running', stateProcess: undefined }, { pendingActivation: false }), 'unknown', null],
  ];
  for (const [name, data, state, vmRunning] of cases) {
    const result = serviceReadiness(data, 200, ORDER);
    serviceResultOutput.parse(result);
    assert.deepEqual(result.service, data.service, `${name}: backend evidence preserved`);
    assert.equal(result.follow_up.provisioning_state, state, name);
    assert.equal(result.follow_up.server_running, vmRunning, name);
    assert.equal(result.follow_up.application_ready, null, name);
    assert.equal(result.follow_up.background_notification, false, name);
    assert.equal(result.follow_up.do_not_reorder, true, name);
    assert.equal(result.follow_up.poll_after_seconds, state === 'pending' ? 10 : null, name);
    if (state === 'pending') assert.match(result.follow_up.message, /not a completion estimate/);
  }
  const wrong = running(); wrong.service.orderNo = 'VP-OTHER';
  for (const data of [null, [], 'bad', { success: true }, wrong,
    service({ state: 'running', stateProcess: 'bad', stateProccess: null }, { pendingActivation: false })]) {
    const result = serviceReadiness(data, 200, ORDER);
    assert.equal(result.follow_up.provisioning_state, 'unknown');
    assert.equal(result.follow_up.server_running, null);
    serviceResultOutput.parse(result);
  }
  const legacy = running(); delete legacy.service.stateProcess; legacy.service.stateProccess = null;
  assert.equal(serviceReadiness(legacy, 200, ORDER).follow_up.provisioning_state, 'complete');
});

test('financial receipt state, missing permission and pending error flag remain distinct', () => {
  const receipt = { success: true, hasPayment: false, paymentid: 123, orderno: ORDER };
  for (const access of [true, false]) {
    const result = purchaseReadiness(receipt, 200, KEY, access);
    purchaseResultOutput.parse(result);
    assert.equal(result.hasPayment, false, 'legacy financial receipt preserved');
    assert.equal(result.follow_up.purchase_state, 'accepted');
    assert.equal(result.follow_up.provisioning_state, 'unknown');
    assert.equal(result.follow_up.permission_required, access ? null : 'services:read');
    assert.deepEqual(result.follow_up.next_check, { tool: 'get_service', arguments: { orderNo: ORDER } });
  }
  const pending = purchaseReadiness({ success: false, state: 'pending', idempotencyKey: KEY }, 202, KEY, true);
  assert.equal(pending.success, false);
  assert.equal(pending.follow_up.purchase_state, 'pending');
  assert.equal(markToolResultError({ content: [], structuredContent: pending }).isError, undefined);
  for (const data of [{ ...pending, error: 'fixture_failure' }, { ...pending, http_status: 403 },
    { ...pending, follow_up: { ...pending.follow_up, idempotency_key: 'different' } },
    { success: false, state: 'pending', idempotencyKey: KEY }]) {
    assert.equal(markToolResultError({ content: [], structuredContent: data }).isError, true);
  }
  const unknown = purchaseReadiness(null, 503, KEY, true);
  assert.equal(unknown.follow_up.purchase_state, 'unknown');
  assert.deepEqual(unknown.follow_up.next_check.arguments, { idempotencyKey: KEY });
  const domain = { success: true, domain_id: 4, state: 'pending' };
  assert.deepEqual(purchaseReadiness(domain, 200, KEY, true), domain, 'registrar result is not a VM');
  const denied = serviceReadiness({ error: 'insufficient_scope', required_scope: 'services:read' }, 403, ORDER);
  assert.equal(denied.follow_up.permission_required, 'services:read');
  assert.match(denied.follow_up.message, /existing connection/);
  assert.equal(serviceReadiness({ error: 'service_locked' }, 403, ORDER).follow_up.permission_required, null);
  const localDenied = serviceReadiness({ apiKeyScopeMissing: true, requiredScope: 'services:read' }, 403, ORDER, false);
  assert.match(localDenied.follow_up.message, /management API key/);
  assert.doesNotMatch(localDenied.follow_up.message, /re-authoriz/);
  const localUnknown = purchaseReadiness({ success: false, paymentError: true }, 503, KEY, true, false);
  assert.equal(localUnknown.follow_up.next_check, null, 'stdio must not suggest an unavailable remote receipt tool');
  assert.match(localUnknown.follow_up.message, /VPSnet panel/);
});

function rpc(port, token, method, params) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: {
      host: 'mcp.vpsnet.com', accept: 'application/json, text/event-stream', 'content-type': 'application/json', authorization: `Bearer ${token}`,
    } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject); req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
  });
}

test('local OAuth MCP protocol follows FC/KVM/Windows progress, schema and original order without extra purchases', async t => {
  const token = 'vpsnet_' + 'a'.repeat(43);
  const resource = 'https://mcp.vpsnet.com/mcp', issuer = 'https://api.vpsnet.com/oauth/mcp';
  const requests = [];
  let scopes = 'orders:servers services:read';
  let responses = [service(), running()];
  let pendingReceipt = false;
  const backend = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, path: req.url, body: body ? JSON.parse(body) : null });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/oauth/mcp/introspect') return res.end(JSON.stringify({ active: true,
      aud: resource, iss: issuer, exp: Date.now()/1000+300, sub: 'fixture-owner', grant_id: 'fixture-grant',
      scope: scopes, services: [ORDER], orders_available: true }));
    if (req.url === '/account/mcp/orders/services/confirm') return res.end(JSON.stringify({ success: true, hasPayment: false, paymentid: 123, orderno: ORDER }));
    if (req.url === `/account/mcp/orders/requests/${KEY}`) {
      if (pendingReceipt) { res.statusCode = 202; return res.end(JSON.stringify({ success: false, state: 'pending', idempotencyKey: KEY })); }
      return res.end(JSON.stringify({ success: true, paymentid: 123, orderno: ORDER }));
    }
    if (req.url === `/account/services/${ORDER}`) return res.end(JSON.stringify(responses.length > 1 ? responses.shift() : responses[0]));
    res.statusCode = 404; res.end('{"error":"fixture_not_found"}');
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  const oldUrl = process.env.VPSNET_API_URL;
  process.env.VPSNET_API_URL = `http://127.0.0.1:${backend.address().port}`;
  const { createRemoteServer } = await import('../build/http-server.js');
  const remote = createRemoteServer({ resource, issuer, ordersEnabled: true });
  remote.listen(0, '127.0.0.1'); await once(remote, 'listening');
  t.after(() => {
    remote.closeAllConnections(); remote.close(); backend.closeAllConnections(); backend.close();
    if (oldUrl === undefined) delete process.env.VPSNET_API_URL; else process.env.VPSNET_API_URL = oldUrl;
  });
  const invoke = async (name, args) => (await rpc(remote.address().port, token, 'tools/call', { name, arguments: args })).result;
  const tools = (await rpc(remote.address().port, token, 'tools/list')).result.tools;
  const validators = new Map(tools.filter(x => ['confirm_service_order', 'get_purchase_result', 'get_service'].includes(x.name))
    .map(x => [x.name, new Ajv({ strict: false }).compile(x.outputSchema)]));
  for (const name of ['confirm_service_order', 'get_purchase_result', 'get_service']) assert.ok(validators.has(name));
  const confirm = { plan: 7, period: 1, idempotencyKey: KEY, quoteToken: 'q'.repeat(43), expected_total_eur: 12.1, acknowledge_charge: true };
  const accepted = await invoke('confirm_service_order', confirm);
  assert.equal(accepted.structuredContent.follow_up.purchase_state, 'accepted');
  assert.equal(accepted.structuredContent.follow_up.provisioning_state, 'unknown');
  assert.ok(validators.get('confirm_service_order')(accepted.structuredContent));
  for (const sequence of [
    [service(), running()],
    [service({ type: 'vds', stateProcess: { type: 1, percentage: 60 } }), service({ type: 'vds', state: 'running', stateProcess: null, finalizing: true }, { pendingActivation: false }), running('vds')],
    [service({ type: 'vds', stateProcess: { type: 1, percentage: 92 } }, { osFamily: 'windows' }), running('vds', { osFamily: 'windows', guestAgentAvailable: true })],
  ]) {
    responses = sequence;
    let last;
    for (let checks = 0; checks < 6; checks++) {
      const result = await invoke('get_service', { orderNo: ORDER });
      assert.equal(result.isError, undefined);
      assert.ok(validators.get('get_service')(result.structuredContent), JSON.stringify(validators.get('get_service').errors));
      assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
      last = result.structuredContent.follow_up;
      if (last.provisioning_state !== 'pending') break;
      assert.equal(last.poll_after_seconds, 10);
    }
    assert.equal(last.provisioning_state, 'complete');
    assert.equal(last.application_ready, null);
  }
  responses = [service({}, { awaitingCapacity: true })];
  for (let i = 0; i < 6; i++) assert.equal((await invoke('get_service', { orderNo: ORDER })).structuredContent.follow_up.provisioning_state, 'pending');
  assert.equal(requests.filter(r => r.path.endsWith('/confirm')).length, 1, 'bounded pending checks never purchase again');
  pendingReceipt = true;
  const pending = await invoke('get_purchase_result', { idempotencyKey: KEY });
  assert.equal(pending.isError, undefined, 'pending financial read is not a failure');
  assert.equal(pending.structuredContent.follow_up.purchase_state, 'pending');
  assert.ok(validators.get('get_purchase_result')(pending.structuredContent));
  scopes = 'orders:servers';
  pendingReceipt = false;
  const noRead = await invoke('get_purchase_result', { idempotencyKey: KEY });
  assert.equal(noRead.structuredContent.follow_up.permission_required, 'services:read');
  const before = requests.filter(r => r.path === `/account/services/${ORDER}`).length;
  const denied = await invoke('get_service', { orderNo: ORDER });
  assert.equal(denied.isError, true);
  assert.match(denied._meta['mcp/www_authenticate'][0], /services:read/);
  assert.equal(requests.filter(r => r.path === `/account/services/${ORDER}`).length, before, 'missing scope neither polls backend nor auto-grants');
  assert.equal(requests.filter(r => r.path.endsWith('/confirm')).length, 1);
});
