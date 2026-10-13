import assert from 'node:assert/strict';
import test from 'node:test';
import { createVpsnetServer } from '../build/index.js';

const KEY = 'fixture-order-' + '1'.repeat(16);
const TOKEN = 'a'.repeat(64);
const BASE = { plan: 7, os: 3, period: 1, resources: [901], idempotencyKey: KEY,
  payment: { payment: 1, successUrl: '', cancelUrl: '' } };
const payload = result => JSON.parse(result.content[0].text);
async function harness(t, responder = () => ({ success: true, orderno: 'VP12345' })) {
  const original = globalThis.fetch;
  const oldUrl = process.env.VPSNET_API_URL;
  const oldKey = process.env.VPSNET_API_KEY;
  process.env.VPSNET_API_URL = 'http://127.0.0.1:9';
  process.env.VPSNET_API_KEY = 'fixture-only';
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const request = { method: options.method, url: new URL(url), body: options.body ? JSON.parse(options.body) : null };
    requests.push(request);
    const body = request.url.pathname.endsWith('/quote')
      ? { success: true, amount_eur: '12.1000', quoteToken: TOKEN, quoteExpiresAt: '2026-10-13T20:00:00Z',
        private_key: 'must-not-leak', prices: { card: 'must-not-leak' } }
      : await responder(request);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => {
    globalThis.fetch = original;
    if (oldUrl === undefined) delete process.env.VPSNET_API_URL; else process.env.VPSNET_API_URL = oldUrl;
    if (oldKey === undefined) delete process.env.VPSNET_API_KEY; else process.env.VPSNET_API_KEY = oldKey;
  });
  const server = createVpsnetServer();
  const call = (name, args = {}) => {
    const tool = server._registeredTools[name];
    return tool.handler(tool.inputSchema.parse(args));
  };
  const order = args => call('order_service', { ...BASE, ...args });
  const approval = { quoteToken: TOKEN, expected_total_eur: '12.1000', acknowledge_charge: true };
  return { server, requests, call, order, approval };
}

test('a quote never confirms; approval binds exact amount, token, key and configuration; retries do not charge again', async t => {
  const { requests, order, approval } = await harness(t);
  const first = payload(await order({ rootPassword: 'FakePass123' }));
  assert.equal(first.confirmationRequired, true);
  assert.equal(first.amount_eur, '12.1000');
  assert.equal(first.amount_includes_vat, true);
  assert.equal(first.period, BASE.period);
  assert.doesNotMatch(JSON.stringify(first), /must-not-leak|FakePass123|private_key|card/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.pathname, '/order/configuration/quote');
  assert.equal(payload(await order({ rootPassword: 'FakePass123' })).quoteToken, TOKEN);
  assert.equal(requests.length, 1, 'repeated quote keeps the original token');
  for (const changes of [
    { expected_total_eur: 12.11 }, { quoteToken: 'b'.repeat(64) }, { resources: [902] },
    { plan: 8 }, { period: 2 }, { payment: { ...BASE.payment, payment: 2 } },
  ]) {
    assert.equal((await order({ rootPassword: 'FakePass123', ...approval, ...changes })).isError, true);
    assert.equal(requests.length, 1, 'mismatch sends no confirmation');
  }
  assert.equal((await order({ rootPassword: 'FakePass123', quoteToken: TOKEN })).isError, true);
  assert.equal(requests.length, 1);
  const confirmed = await order({ rootPassword: 'FakePass123', ...approval });
  assert.equal(payload(confirmed).orderno, 'VP12345');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.idempotencyKey, KEY);
  assert.equal(requests[1].body.quoteToken, TOKEN);
  assert.equal(requests[1].url.pathname, '/order/configuration/confirm');
  assert.deepEqual(await order({ rootPassword: 'FakePass123', ...approval, expected_total_eur: 12.1 }), confirmed);
  assert.equal(requests.length, 2, 'same-key replay returns the original result');
});

test('approval without the original quote and malformed decimal totals cannot trigger a request', async t => {
  const { requests, order, approval } = await harness(t);
  assert.equal(payload(await order(approval)).error, 'orderQuoteUnavailable');
  for (const total of [-1, Infinity, '12.10001', 'NaN', '1e2', '12.1 card']) {
    assert.throws(() => order({ ...approval, expected_total_eur: total }));
  }
  assert.equal(requests.length, 0);
});

test('stdio ordering requires an explicit billing period before any quote request', async t => {
  const { requests, order } = await harness(t);
  assert.throws(() => order({ period: undefined }));
  assert.equal(requests.length, 0);
});

test('retained attempts are bounded without evicting original quotes or unknown outcomes', async t => {
  const { requests, order, approval } = await harness(t, () => { throw new Error('fixture transport interruption'); });
  await order({});
  const unknown = await order(approval);
  assert.equal(payload(unknown).error, 'purchaseOutcomeUnknown');
  const attempts = await Promise.all(Array.from({ length: 1000 }, (_, index) =>
    order({ idempotencyKey: `fixture-capacity-${String(index + 1).padStart(16, '0')}` })));
  assert.equal(attempts.filter(result => payload(result).quoteToken === TOKEN).length, 999);
  assert.equal(attempts.filter(result => payload(result).error === 'orderAttemptCapacityReached').length, 1);
  assert.equal(requests.length, 1001, 'in-flight quotes also count towards capacity');
  const count = requests.length;
  const full = await order({ idempotencyKey: 'fixture-capacity-overflow' });
  assert.equal(payload(full).error, 'orderAttemptCapacityReached');
  assert.equal(requests.length, count, 'capacity refusal sends no new quote');
  assert.deepEqual(await order(approval), unknown, 'unknown outcome remains retained');
  const retained = payload(await order({ idempotencyKey: `fixture-capacity-${String(1).padStart(16, '0')}` }));
  assert.equal(retained.quoteToken, TOKEN);
  assert.equal(requests.length, count, 'existing attempt reads remain available without resubmission');
});

test('uncertain confirmation keeps the original key and never sends another confirmation', async t => {
  const { requests, order, approval } = await harness(t, () => { throw new Error('fixture transport interruption'); });
  await order({});
  const unknown = await order(approval);
  assert.equal(payload(unknown).error, 'purchaseOutcomeUnknown');
  assert.match(payload(unknown).message, /Do not submit another order or use a new key/);
  assert.deepEqual(await order(approval), unknown);
  assert.equal(requests.length, 2);
});

test('backend price/configuration refusal is retained without a replacement quote or payment retry', async t => {
  const { requests, order, approval } = await harness(t, () => ({ success: false, quoteMismatch: true }));
  await order({});
  assert.equal(payload(await order(approval)).quoteMismatch, true);
  assert.equal(payload(await order(approval)).quoteMismatch, true);
  assert.equal(requests.length, 2);
});

test('history forwards pagination and exact backend filters; invalid subject combinations fail before HTTP', async t => {
  const { requests, call, server } = await harness(t);
  await call('get_login_history', { page: 2 });
  assert.equal(requests.at(-1).url.pathname, '/account/history/login');
  assert.equal(requests.at(-1).url.searchParams.get('page'), '2');
  const args = { page: 3, orderNo: 'VP12345', subject_kind: 'network', subject_key: 'fixture / + & value' };
  await call('get_management_history', args);
  assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), { ...args, page: '3' });
  await call('get_management_history', { subject_kind: 'network,vpn_gateway' });
  const count = requests.length;
  for (const args of [{ subject_key: 'fixture' }, { subject_kind: 'network,vpn_gateway', subject_key: 'fixture' }]) {
    assert.equal((await call('get_management_history', args)).isError, true);
  }
  assert.equal(requests.length, count);
  for (const page of [0, -1, 1.5, 1000001]) assert.equal(server._registeredTools.get_login_history.inputSchema.safeParse({ page }).success, false);
});

test('contacts return the full list and remote domain purchase keys match receipt boundaries without narrowing stdio', async t => {
  const { server, call, requests } = await harness(t);
  await call('list_domain_contacts', { page: 2, snapshot: 'f'.repeat(64) });
  assert.equal(requests.at(-1).url.pathname, '/account/domains/contacts');
  assert.equal(requests.at(-1).url.search, '');
  assert.deepEqual(Object.keys(server._registeredTools.list_domain_contacts.inputSchema.shape), []);
  assert.match(server._registeredTools.list_domain_contacts.description, /all.*one response/);
  const remote = createVpsnetServer({ remoteProfile: 'orders', remoteScopes: ['orders:domains', 'orders:servers', 'domains:read'] });
  for (const length of [8, 15, 16, 128, 129, 190]) {
    for (const name of ['quote_domain_register', 'confirm_domain_register']) {
      const args = { domain: 'example.com', idempotencyKey: 'x'.repeat(length), quoteToken: TOKEN,
        expected_total_eur: 12.1, acknowledge_charge: true, acknowledge_non_refundable: true };
      assert.equal(remote._registeredTools[name].inputSchema.safeParse(args).success, length >= 16 && length <= 128, `${name} length ${length}`);
    }
  }
  for (const key of ['x'.repeat(8), 'x'.repeat(190)]) assert.equal(server._registeredTools.quote_domain_register.inputSchema.safeParse({ domain: 'example.com', idempotencyKey: key }).success, true);
  assert.equal(remote._registeredTools.quote_domain_register.inputSchema.safeParse({ domain: 'example.com', idempotencyKey: '.'.repeat(16) }).success, true);
  assert.match(remote._registeredTools.confirm_service_order.description, /get_service.*requires services:read/);
});
