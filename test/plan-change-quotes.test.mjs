import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CALCULATE = "/account/services/VP77/plans-options/calculate";
const CONFIRM = "/account/services/VP77/plans-options";

const sameQuote = (a, b) => {
  const sort = (value) => JSON.stringify(Object.fromEntries(Object.entries(value ?? {}).sort(([x], [y]) => x.localeCompare(y))));
  return a !== undefined && a !== null && sort(a) === sort(b);
};

/**
 * A mocked API that applies the confirmation rule of the real one: when a
 * quote needs acceptance, the exact object must come back, otherwise HTTP 409
 * and nothing is applied.
 */
async function start(t, scenario) {
  const requests = [];
  const api = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ method: req.method, url: req.url, body });
    const send = (status, payload) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(payload));
    };

    if (req.method === "POST" && req.url === CALCULATE) {
      return send(200, {
        success: true,
        expirationDate: "2026-12-20",
        currentExpirationDate: "2026-12-30",
        expirationChangeDays: -10,
        paymentRequired: false,
        ...(scenario.windowsLicense ? { windowsLicense: scenario.windowsLicense } : {}),
        ...(scenario.ipv4 ? { ipv4: scenario.ipv4 } : {}),
      });
    }

    if (req.method === "POST" && req.url === CONFIRM) {
      if (scenario.otherConflict) return send(409, scenario.otherConflict);
      if (scenario.ipv4Needed && !sameQuote(body.acceptedIpv4, scenario.ipv4)) {
        return send(409, { success: false, ipv4QuoteChanged: true, ipv4: scenario.ipv4 });
      }
      if (!scenario.ipv4Needed && body.acceptedIpv4 !== undefined) {
        return send(409, { success: false, ipv4QuoteChanged: true });
      }
      // Like the API: the Windows quote is asked for when the charge changes, or when a value was sent at all.
      const windows = scenario.windowsLicense;
      const windowsChanges = windows !== undefined
        && (windows.currentMonthlyCents ?? windows.currentCombinedMonthlyCents) !== (windows.newMonthlyCents ?? windows.newCombinedMonthlyCents);
      if ((windowsChanges || body.acceptedWindowsLicense !== undefined) && !sameQuote(body.acceptedWindowsLicense, windows)) {
        return send(409, { success: false, windowsLicenseQuoteChanged: true, ...(windows ? { windowsLicense: windows } : {}) });
      }
      return send(200, { success: true, expirationDate: "2026-12-20", noty: "11111111-1111-4111-8111-111111111111" });
    }

    return send(404, { notFound: true });
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());

  const client = new Client({ name: "plan-change-quotes", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    env: {
      ...process.env,
      VPSNET_API_KEY: "contract-test-key",
      VPSNET_API_URL: `http://127.0.0.1:${api.address().port}`,
    },
  });
  await client.connect(transport);
  t.after(async () => client.close());
  return { client, requests };
}

const payload = (result) => JSON.parse(result.content[0].text);
const call = (client, name, args) => client.callTool({ name, arguments: { orderNo: "VP77", plan: 5, resources: [11, 12], ...args } });

const WINDOWS = { currentMonthlyCents: 1098, newMonthlyCents: 1996 };
const COMBINED = { currentMonthlyCents: null, newMonthlyCents: null, currentCombinedMonthlyCents: 1500, newCombinedMonthlyCents: 2600 };
const IPV4 = { quantity: 3, currentMonthlyCents: null, newMonthlyCents: 400, renewalPriceVersion: "v7" };

test("a plan change without special charges sends the old body and passes the answer through", async (t) => {
  const { client, requests } = await start(t, {});
  const preview = payload(await call(client, "calculate_plan_change", {}));
  assert.equal(preview.quote_acceptance, undefined);
  assert.equal(preview.expirationChangeDays, -10);

  const result = await call(client, "change_plan", {});
  assert.notEqual(result.isError, true);
  assert.deepEqual(requests.at(-1).body, { plan: 5, resources: [11, 12] });
  assert.equal(payload(result).success, true);
});

test("calculate_plan_change states the Windows monthly charge in euros and the exact value to send back", async (t) => {
  const { client } = await start(t, { windowsLicense: WINDOWS });
  const preview = payload(await call(client, "calculate_plan_change", {}));
  assert.deepEqual(preview.windowsLicense, WINDOWS);
  const review = preview.quote_acceptance;
  assert.equal(review.acceptance_required, true);
  assert.equal(review.windowsLicense.requires_acceptance, true);
  assert.match(review.windowsLicense.summary, /10\.98 EUR per month now, 19\.96 EUR per month after/);
  assert.deepEqual(review.windowsLicense.pass_to_change_plan_as, { acceptedWindowsLicense: WINDOWS });
  assert.equal(review.ipv4, undefined);
  assert.match(review.next_step, /only after they agree/i);
});

test("calculate_plan_change: an unchanged Windows charge and an IPv4 charge with a price on record need no acceptance", async (t) => {
  const priced = { quantity: 2, currentMonthlyCents: 200, newMonthlyCents: 200, renewalPriceVersion: "v7" };
  const { client } = await start(t, { windowsLicense: { currentMonthlyCents: 499, newMonthlyCents: 499 }, ipv4: priced });
  const review = payload(await call(client, "calculate_plan_change", {})).quote_acceptance;
  assert.equal(review.acceptance_required, false);
  assert.equal(review.windowsLicense.requires_acceptance, false);
  assert.equal(review.windowsLicense.pass_to_change_plan_as, undefined);
  assert.equal(review.ipv4.requires_acceptance, false);
  assert.equal(review.ipv4.pass_to_change_plan_as, undefined);
  assert.match(review.ipv4.note, /do not send acceptedIpv4/);
});

test("calculate_plan_change: IPv4 with no earlier price and the combined Windows line", async (t) => {
  const { client } = await start(t, { windowsLicense: COMBINED, ipv4: IPV4, ipv4Needed: true });
  const review = payload(await call(client, "calculate_plan_change", {})).quote_acceptance;
  assert.equal(review.ipv4.requires_acceptance, true);
  assert.match(review.ipv4.summary, /3 attached in total.*no IPv4 charge on record so far.*4\.00 EUR per month after/);
  assert.deepEqual(review.ipv4.pass_to_change_plan_as, { acceptedIpv4: IPV4 });
  assert.match(review.windowsLicense.summary, /15\.00 EUR per month now, 26\.00 EUR per month after/);
  assert.deepEqual(review.windowsLicense.pass_to_change_plan_as, { acceptedWindowsLicense: COMBINED });
  assert.match(review.next_step, /acceptedWindowsLicense and acceptedIpv4/);
});

test("an accepted Windows quote is sent exactly and the change succeeds", async (t) => {
  const { client, requests } = await start(t, { windowsLicense: WINDOWS });
  const result = await call(client, "change_plan", { acceptedWindowsLicense: WINDOWS });
  assert.notEqual(result.isError, true);
  assert.equal(payload(result).success, true);
  assert.deepEqual(requests.at(-1).body, { plan: 5, resources: [11, 12], acceptedWindowsLicense: WINDOWS });
});

test("a missing acceptance becomes a structured quote-changed result, not an error", async (t) => {
  const { client, requests } = await start(t, { windowsLicense: WINDOWS });
  const result = await call(client, "change_plan", {});
  assert.notEqual(result.isError, true);
  const body = payload(result);
  assert.equal(body.quote_changed, true);
  assert.equal(body.plan_changed, false);
  assert.equal(body.charged, false);
  assert.equal(body.windowsLicenseQuoteChanged, true);
  assert.equal(body.success, undefined);
  assert.equal(body.error, undefined);
  assert.equal(body.http_status, undefined);
  assert.match(body.message, /NOT changed and nothing was charged/);
  assert.match(body.message, /must be confirmed first/);
  assert.deepEqual(body.monthly_charges, ["Windows licence: 10.98 EUR per month now, 19.96 EUR per month after the change (before VAT)."]);
  assert.deepEqual(body.accept_with, { acceptedWindowsLicense: WINDOWS });
  assert.match(body.next_step, /ask whether they agree/);
  assert.match(body.next_step, /Do not agree to a price on the user's behalf/);
  assert.equal(requests.filter((r) => r.url === CONFIRM).length, 1, "the tool never retries by itself");
});

test("a stale acceptance gets the new quote back and is not accepted by the tool", async (t) => {
  const { client, requests } = await start(t, { windowsLicense: WINDOWS });
  const stale = { currentMonthlyCents: 1098, newMonthlyCents: 1500 };
  const result = await call(client, "change_plan", { acceptedWindowsLicense: stale });
  assert.notEqual(result.isError, true);
  const body = payload(result);
  assert.equal(body.quote_changed, true);
  assert.equal(body.plan_changed, false);
  assert.match(body.message, /you confirmed no longer matches/);
  assert.deepEqual(body.windowsLicense, WINDOWS);
  assert.deepEqual(body.accept_with.acceptedWindowsLicense, WINDOWS);
  assert.deepEqual(requests.at(-1).body.acceptedWindowsLicense, stale);
  assert.equal(requests.filter((r) => r.url === CONFIRM).length, 1);
});

test("the IPv4 charge: accepted succeeds, missing or stale returns the new IPv4 quote", async (t) => {
  const { client, requests } = await start(t, { ipv4: IPV4, ipv4Needed: true });
  const ok = await call(client, "change_plan", { acceptedIpv4: IPV4 });
  assert.notEqual(ok.isError, true);
  assert.equal(payload(ok).success, true);
  assert.deepEqual(requests.at(-1).body, { plan: 5, resources: [11, 12], acceptedIpv4: IPV4 });

  for (const args of [{}, { acceptedIpv4: { ...IPV4, newMonthlyCents: 300 } }]) {
    const result = await call(client, "change_plan", args);
    assert.notEqual(result.isError, true);
    const body = payload(result);
    assert.equal(body.quote_changed, true);
    assert.equal(body.ipv4QuoteChanged, true);
    assert.equal(body.plan_changed, false);
    assert.equal(body.charged, false);
    assert.deepEqual(body.ipv4, IPV4);
    assert.deepEqual(body.accept_with, { acceptedIpv4: IPV4 });
    assert.match(body.monthly_charges[0], /3 attached in total.*4\.00 EUR per month after/);
  }
});

test("an IPv4 acceptance the API no longer needs says so and offers nothing to accept", async (t) => {
  const { client } = await start(t, {});
  const body = payload(await call(client, "change_plan", { acceptedIpv4: IPV4 }));
  assert.equal(body.quote_changed, true);
  assert.equal(body.plan_changed, false);
  assert.equal(body.accept_with, undefined);
  assert.match(body.note, /Call change_plan again without it/);
  assert.match(body.message, /No confirmation is needed for this change/);
  assert.doesNotMatch(body.message, /no longer matches/);
});

test("an unchanged Windows charge needs no value: the change succeeds without one", async (t) => {
  const unchanged = { currentMonthlyCents: 499, newMonthlyCents: 499 };
  const { client, requests } = await start(t, { windowsLicense: unchanged });
  const result = await call(client, "change_plan", {});
  assert.notEqual(result.isError, true);
  assert.equal(payload(result).success, true);
  assert.deepEqual(requests.at(-1).body, { plan: 5, resources: [11, 12] });
});

test("a Windows value sent for a server without a Windows quote says no confirmation is needed", async (t) => {
  const { client } = await start(t, {});
  const result = await call(client, "change_plan", { acceptedWindowsLicense: WINDOWS });
  assert.notEqual(result.isError, true);
  const body = payload(result);
  assert.equal(body.quote_changed, true);
  assert.equal(body.windowsLicenseQuoteChanged, true);
  assert.equal(body.plan_changed, false);
  assert.equal(body.charged, false);
  assert.deepEqual(body.monthly_charges, []);
  assert.equal(body.accept_with, undefined);
  assert.doesNotMatch(body.message, /no longer matches/);
  assert.match(body.message, /No confirmation is needed for this change; call change_plan again without it/);
  assert.match(body.note, /windowsLicense/);
});

test("the IPv4 current amount may be left out (sent as null) and a long price version is accepted", async (t) => {
  const longVersion = "v".repeat(255);
  const quote = { ...IPV4, renewalPriceVersion: longVersion };
  const { client, requests } = await start(t, { ipv4: quote, ipv4Needed: true });
  const result = await call(client, "change_plan", {
    acceptedIpv4: { quantity: 3, newMonthlyCents: 400, renewalPriceVersion: longVersion },
  });
  assert.equal(payload(result).success, true);
  assert.deepEqual(requests.at(-1).body.acceptedIpv4, quote);

  let refused = false;
  try {
    refused = (await call(client, "change_plan", {
      acceptedIpv4: { quantity: 3, newMonthlyCents: 400, renewalPriceVersion: "v".repeat(256) },
    })).isError === true;
  } catch {
    refused = true;
  }
  assert.ok(refused);
});

test("the combined Windows line is sent with both licence amounts as null, also when they are left out", async (t) => {
  const { client, requests } = await start(t, { windowsLicense: COMBINED });
  const full = await call(client, "change_plan", { acceptedWindowsLicense: COMBINED });
  assert.equal(payload(full).success, true);
  assert.deepEqual(requests.at(-1).body.acceptedWindowsLicense, COMBINED);

  const short = await call(client, "change_plan", {
    acceptedWindowsLicense: { currentCombinedMonthlyCents: 1500, newCombinedMonthlyCents: 2600 },
  });
  assert.equal(payload(short).success, true);
  assert.deepEqual(requests.at(-1).body.acceptedWindowsLicense, COMBINED);

  const missing = payload(await call(client, "change_plan", {}));
  assert.equal(missing.quote_changed, true);
  assert.match(missing.monthly_charges[0], /15\.00 EUR per month now, 26\.00 EUR per month after/);
  assert.match(missing.monthly_charges[0], /other recurring extras/);
  assert.deepEqual(missing.accept_with.acceptedWindowsLicense, COMBINED);
});

test("both quotes missing: the IPv4 answer comes first, then the Windows one, each without charging", async (t) => {
  const { client } = await start(t, { windowsLicense: WINDOWS, ipv4: IPV4, ipv4Needed: true });
  const first = payload(await call(client, "change_plan", {}));
  assert.equal(first.ipv4QuoteChanged, true);
  assert.equal(first.windowsLicenseQuoteChanged, undefined);
  const second = payload(await call(client, "change_plan", { acceptedIpv4: IPV4 }));
  assert.equal(second.windowsLicenseQuoteChanged, true);
  assert.equal(second.plan_changed, false);
  const done = payload(await call(client, "change_plan", { acceptedIpv4: IPV4, acceptedWindowsLicense: WINDOWS }));
  assert.equal(done.success, true);
});

test("other HTTP 409 answers stay errors", async (t) => {
  const { client } = await start(t, { otherConflict: { success: false, diskDecreaseNotAllowed: true } });
  const result = await call(client, "change_plan", {});
  assert.equal(result.isError, true);
  const body = payload(result);
  assert.equal(body.diskDecreaseNotAllowed, true);
  assert.equal(body.http_status, 409);
  assert.equal(body.quote_changed, undefined);
});

test("accepted quote inputs are validated before any request is sent", async (t) => {
  const { client, requests } = await start(t, { windowsLicense: WINDOWS, ipv4: IPV4, ipv4Needed: true });
  const bad = [
    { acceptedWindowsLicense: {} },
    { acceptedWindowsLicense: { currentMonthlyCents: 1098 } },
    { acceptedWindowsLicense: { currentMonthlyCents: -1, newMonthlyCents: 1996 } },
    { acceptedWindowsLicense: { currentMonthlyCents: 10.5, newMonthlyCents: 1996 } },
    { acceptedWindowsLicense: { currentMonthlyCents: "1098", newMonthlyCents: 1996 } },
    { acceptedWindowsLicense: { currentMonthlyCents: 1098, newMonthlyCents: 1996, extra: 1 } },
    { acceptedWindowsLicense: { currentMonthlyCents: 1098, newMonthlyCents: 1996, currentCombinedMonthlyCents: 1, newCombinedMonthlyCents: 2 } },
    { acceptedWindowsLicense: { currentCombinedMonthlyCents: 1500 } },
    { acceptedIpv4: { quantity: 1, currentMonthlyCents: null, newMonthlyCents: 400, renewalPriceVersion: "v7" } },
    { acceptedIpv4: { quantity: 3, currentMonthlyCents: 1.5, newMonthlyCents: 400, renewalPriceVersion: "v7" } },
    { acceptedIpv4: { quantity: 3, currentMonthlyCents: null, newMonthlyCents: -4, renewalPriceVersion: "v7" } },
    { acceptedIpv4: { quantity: 3, currentMonthlyCents: null, newMonthlyCents: 400, renewalPriceVersion: "" } },
    { acceptedIpv4: { quantity: 3, currentMonthlyCents: null, newMonthlyCents: 400, renewalPriceVersion: "v7", note: "x" } },
  ];
  for (const args of bad) {
    let refused = false;
    try {
      refused = (await call(client, "change_plan", args)).isError === true;
    } catch {
      refused = true;
    }
    assert.ok(refused, JSON.stringify(args));
  }
  assert.equal(requests.length, 0, "no refused input reaches the API");
});

test("the tool texts say the price is put to the user first", async (t) => {
  const { client } = await start(t, {});
  const { tools } = await client.listTools();
  const change = tools.find((tool) => tool.name === "change_plan");
  assert.match(change.description, /after the user has seen and agreed to the new monthly charges/);
  assert.match(change.description, /Never accept a changed price on the user's behalf/);
  assert.ok(change.inputSchema.properties.acceptedWindowsLicense);
  assert.ok(change.inputSchema.properties.acceptedIpv4);
  assert.deepEqual(change.inputSchema.required.sort(), ["orderNo", "plan", "resources"]);
  const calculate = tools.find((tool) => tool.name === "calculate_plan_change");
  assert.match(calculate.description, /quote_acceptance/);
  assert.equal(calculate.inputSchema.properties.acceptedIpv4, undefined);
});
