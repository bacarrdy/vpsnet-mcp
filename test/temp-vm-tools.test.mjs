import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const IDEMPOTENCY_KEY = "temp-vm-attempt-0001";
const QUOTE_TOKEN = `vpsnet_quote_${"q".repeat(48)}`;

const options = {
  orderable: false,
  availability: "coming_soon",
  profiles: [{
    id: "standard",
    name: "Temp Standard",
    plan_id: 12,
    plan_name: "Firecracker S",
    multiplier: 1.5,
    default_ttl: 60,
    plan_hourly_ex_vat: 0.08,
  }],
  allowed_ttls: [30, 60, 120],
  hard_max_ttl: 360,
  min_bill: 30,
  public_ip: {
    enabled: true,
    smtp_block_forced: true,
    default_on: true,
  },
  convert_to_monthly_allowed: false,
  max_paid_extensions: 0,
  max_concurrent: 2,
};

const session = {
  id: 41,
  profile: "standard",
  plan_id: 12,
  os_id: 7,
  order_id: 900,
  order_no: "FC900",
  order_state: "creating",
  ip: "192.0.2.40",
  ttl_minutes: 60,
  billable_minutes: 60,
  amount_ex_vat: 0.5,
  amount_gross: 0.61,
  public_ip_enabled: true,
  status: "creating",
  starts_at: null,
  expires_at: null,
  destroyed_at: null,
  destroy_reason: null,
  refunded: false,
  created_at: "2026-08-10 20:00:00",
  preferred_server_id: 100,
  credentials: { root_password: "DoNotExpose123" },
};

async function harness(t) {
  const requests = [];
  const api = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const request = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: raw ? JSON.parse(raw) : null,
    };
    requests.push(request);

    let status = 200;
    let response;
    if (req.method === "GET" && req.url === "/account/firecracker/temp-vms/options") {
      response = { success: true, options };
    } else if (req.method === "POST" && req.url === "/account/firecracker/temp-vms/quote") {
      response = {
        success: true,
        profile: request.body.profile ?? "standard",
        plan_id: 12,
        plan_name: "Firecracker S",
        ttl_minutes: request.body.ttl_minutes ?? 60,
        billable_minutes: 60,
        min_bill_minutes: 30,
        hard_max_ttl: 360,
        multiplier: 1.5,
        plan_hourly_ex_vat: 0.08,
        amount_ex_vat: 0.5,
        vat_percent: 21,
        amount_gross: 0.61,
        minimum_charge_applied: true,
        minimum_gross_eur: 0.5,
        currency: "EUR",
        public_ip_default: true,
        public_ip_required: true,
        extensions: 0,
        access: {
          allowed: true,
          reason: null,
          balance: 10,
          usageAccess: { can_use: true, can_use_services: true },
        },
        quoteToken: QUOTE_TOKEN,
        quoteExpiresAt: "2026-08-10 20:15:00",
        preferred_server_id: 100,
      };
    } else if (req.method === "GET" && req.url === "/account/firecracker/temp-vms") {
      response = { success: true, sessions: [session], options };
    } else if (req.method === "POST" && req.url === "/account/firecracker/temp-vms") {
      status = 202;
      response = { success: true, replayed: false, session };
    } else if (req.method === "GET" && req.url === "/account/firecracker/temp-vms/41") {
      response = { success: true, session };
    } else if (req.method === "DELETE" && req.url === "/account/firecracker/temp-vms/41") {
      response = {
        success: true,
        session: { ...session, status: "destroy_pending" },
      };
    } else {
      status = 404;
      response = { notFound: true };
    }

    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(response));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());

  const client = new Client({ name: "temp-vm-tools", version: "1.0.0" });
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

test("Temp VM tools bind every published route and preserve paid replay proof", async (t) => {
  const { client, requests } = await harness(t);
  const { tools } = await client.listTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  for (const name of [
    "get_temp_vm_options",
    "quote_temp_vm",
    "list_temp_vms",
    "create_temp_vm",
    "get_temp_vm",
    "delete_temp_vm",
  ]) {
    assert.equal(byName.has(name), true, `${name} is registered`);
  }
  assert.equal(byName.get("get_temp_vm_options").annotations.readOnlyHint, true);
  assert.equal(byName.get("create_temp_vm").annotations.destructiveHint, true);
  for (const name of ["get_temp_vm_options", "quote_temp_vm", "create_temp_vm"]) {
    assert.match(byName.get(name).description, /coming.soon/i);
  }
  assert.match(byName.get("quote_temp_vm").description, /tempVmComingSoon/);
  assert.match(byName.get("create_temp_vm").description, /tempVmComingSoon/);
  assert.equal(
    byName.get("create_temp_vm").inputSchema.properties.acknowledge_no_backups.const,
    true
  );
  assert.equal(
    byName.get("delete_temp_vm").inputSchema.properties
      .acknowledge_permanent_destruction.const,
    true
  );

  await client.callTool({ name: "get_temp_vm_options", arguments: {} });
  const quoteResult = await client.callTool({
    name: "quote_temp_vm",
    arguments: {
      profile: "standard",
      ttl_minutes: 60,
      idempotency_key: IDEMPOTENCY_KEY,
    },
  });
  const quote = JSON.parse(quoteResult.content[0].text);
  assert.equal(quote.idempotency_key, IDEMPOTENCY_KEY);
  assert.equal(quote.quoteToken, QUOTE_TOKEN);
  assert.doesNotMatch(quoteResult.content[0].text, /preferred_server_id/);

  const quoteRequest = requests.find((request) => request.url.endsWith("/quote"));
  assert.deepEqual(quoteRequest.body, { profile: "standard", ttl_minutes: 60 });
  assert.equal(quoteRequest.headers["idempotency-key"], IDEMPOTENCY_KEY);

  await client.callTool({
    name: "create_temp_vm",
    arguments: {
      profile: "standard",
      ttl_minutes: 60,
      os_id: 7,
      ssh_public_key: "ssh-ed25519 AAAAC3NzaContractKey test@example",
      idempotency_key: IDEMPOTENCY_KEY,
      quote_token: QUOTE_TOKEN,
      acknowledge_price_eur: 0.61,
      acknowledge_no_backups: true,
    },
  });
  const createRequests = requests.filter(
    (request) => request.method === "POST"
      && request.url === "/account/firecracker/temp-vms"
  );
  assert.equal(createRequests.length, 1, "create performs no hidden re-quote");
  assert.deepEqual(createRequests[0].body, {
    public_ip: true,
    idempotencyKey: IDEMPOTENCY_KEY,
    quoteToken: QUOTE_TOKEN,
    profile: "standard",
    ttl_minutes: 60,
    os_id: 7,
    ssh_public_key: "ssh-ed25519 AAAAC3NzaContractKey test@example",
  });
  assert.equal(createRequests[0].headers["idempotency-key"], IDEMPOTENCY_KEY);
  assert.equal(createRequests[0].headers["x-quote-token"], QUOTE_TOKEN);

  const list = await client.callTool({ name: "list_temp_vms", arguments: {} });
  const get = await client.callTool({ name: "get_temp_vm", arguments: { id: 41 } });
  const listedSession = JSON.parse(list.content[0].text).sessions[0];
  const fetchedSession = JSON.parse(get.content[0].text).session;
  for (const projected of [listedSession, fetchedSession]) {
    assert.equal(projected.ip, "192.0.2.40");
    assert.equal(projected.refunded, false);
  }
  for (const result of [list, get]) {
    assert.doesNotMatch(
      result.content[0].text,
      /preferred_server_id|credentials|DoNotExpose/
    );
  }

  await client.callTool({
    name: "delete_temp_vm",
    arguments: { id: 41, acknowledge_permanent_destruction: true },
  });
  assert.equal(
    requests.some(
      (request) => request.method === "DELETE"
        && request.url === "/account/firecracker/temp-vms/41"
    ),
    true
  );
});

test("Temp VM tools reject conflicting credentials before reaching the API", async (t) => {
  const { client, requests } = await harness(t);
  const result = await client.callTool({
    name: "create_temp_vm",
    arguments: {
      root_password: "ValidPass123",
      ssh_public_key: "ssh-ed25519 AAAAC3NzaConflict",
      idempotency_key: IDEMPOTENCY_KEY,
      quote_token: QUOTE_TOKEN,
      acknowledge_price_eur: 0.61,
      acknowledge_no_backups: true,
    },
  });

  assert.equal(result.isError, true);
  assert.equal(requests.length, 0);
});
