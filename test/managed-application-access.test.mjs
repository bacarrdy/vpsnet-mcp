import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const INSTALLATION_ID = "b7ea0c2a-e6e4-4c25-87ca-c0cdf7e4ca42";

test("configure application access posts every typed publication", async (t) => {
  const requests = [];
  const api = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: body ? JSON.parse(body) : null,
    });
    res.statusCode = 202;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      success: true,
      installation: { id: INSTALLATION_ID, state: "configuring_access" },
      action: { id: "action-1", type: "configure_access", state: "queued" },
    }));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());
  const address = api.address();

  const client = new Client({ name: "managed-access-contract", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    env: {
      ...process.env,
      VPSNET_API_KEY: "contract-test-key",
      VPSNET_API_URL: `http://127.0.0.1:${address.port}`,
    },
  });
  await client.connect(transport);
  t.after(async () => client.close());

  const result = await client.callTool({
    name: "configure_application_access",
    arguments: {
      orderNo: "VP123",
      installation_id: INSTALLATION_ID,
      access: {
        schema_version: 2,
        endpoints: [
          {
            key: "admin-19000-9000-tcp",
            access: { mode: "private" },
          },
          {
            key: "web-18080-8080-tcp",
            access: { mode: "public_http" },
          },
        ],
      },
      expected_revision: 12,
      idempotencyKey: "access-contract-key-0001",
      confirmed: true,
    },
  });

  assert.equal(result.isError, undefined);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.equal(
    requests[0].url,
    `/account/services/VP123/applications/installations/${INSTALLATION_ID}/configure-access`
  );
  assert.deepEqual(requests[0].body, {
    access: {
      schema_version: 2,
      endpoints: [
        {
          key: "admin-19000-9000-tcp",
          access: { mode: "private" },
        },
        {
          key: "web-18080-8080-tcp",
          access: { mode: "public_http" },
        },
      ],
    },
    expectedRevision: 12,
  });
  assert.equal(requests[0].headers["idempotency-key"], "access-contract-key-0001");
});

async function startAccessClient(t) {
  const requests = [];
  const api = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, body: body ? JSON.parse(body) : null });
    res.statusCode = 202;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      success: true,
      installation: { id: INSTALLATION_ID, state: "configuring_access" },
      action: { id: "action-1", type: "configure_access", state: "queued" },
    }));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());
  const client = new Client({ name: "managed-access-additional", version: "1.0.0" });
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

function accessCall(access) {
  return {
    name: "configure_application_access",
    arguments: {
      orderNo: "VP123",
      installation_id: INSTALLATION_ID,
      access,
      expected_revision: 12,
      idempotencyKey: "access-contract-key-0002",
      confirmed: true,
    },
  };
}

const MANAGED = { mode: "managed_https", zone_id: 7, subdomain: "www", approve_dns: true };

test("configure application access sends the bare domain as a redirecting additional address", async (t) => {
  const { client, requests } = await startAccessClient(t);

  const result = await client.callTool(accessCall({
    ...MANAGED,
    additional_addresses: [
      { zone_id: 7, name: "", approve_dns: true },
      { zone_id: 7, name: "@", action: "serve", approve_dns: true },
      { zone_id: 9, name: "blog", action: "redirect", approve_dns: true },
    ],
  }));

  assert.equal(result.isError, undefined);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body.access, {
    ...MANAGED,
    additional_addresses: [
      { zone_id: 7, name: "", action: "redirect", approve_dns: true },
      { zone_id: 7, name: "@", action: "serve", approve_dns: true },
      { zone_id: 9, name: "blog", action: "redirect", approve_dns: true },
    ],
  });
});

test("configure application access leaves the key out when no additional address is given", async (t) => {
  const { client, requests } = await startAccessClient(t);
  const result = await client.callTool(accessCall(MANAGED));
  assert.equal(result.isError, undefined);
  assert.deepEqual(requests[0].body.access, MANAGED);
  assert.equal("additional_addresses" in requests[0].body.access, false);
});

test("configure application access accepts additional addresses on a schema 2 endpoint", async (t) => {
  const { client, requests } = await startAccessClient(t);
  const result = await client.callTool(accessCall({
    schema_version: 2,
    endpoints: [
      {
        key: "web-18080-8080-tcp",
        access: {
          ...MANAGED,
          additional_addresses: [{ zone_id: 7, name: "", approve_dns: true }],
        },
      },
    ],
  }));
  assert.equal(result.isError, undefined);
  assert.deepEqual(
    requests[0].body.access.endpoints[0].access.additional_addresses,
    [{ zone_id: 7, name: "", action: "redirect", approve_dns: true }]
  );
});

test("configure application access refuses malformed additional addresses before any request", async (t) => {
  const { client, requests } = await startAccessClient(t);
  const bad = [
    // wildcard, trailing dot, uppercase-free dns violation
    [{ zone_id: 7, name: "*", approve_dns: true }],
    [{ zone_id: 7, name: "www.", approve_dns: true }],
    [{ zone_id: 7, name: "-bad", approve_dns: true }],
    // bad action, missing approval, bad zone, unknown key
    [{ zone_id: 7, name: "", action: "proxy", approve_dns: true }],
    [{ zone_id: 7, name: "" }],
    [{ zone_id: 7, name: "", approve_dns: false }],
    [{ zone_id: 0, name: "", approve_dns: true }],
    [{ zone_id: 7, name: "", approve_dns: true, extra: 1 }],
    // more than four
    Array.from({ length: 5 }, (_, i) => ({ zone_id: 7, name: `a${i}`, approve_dns: true })),
  ];
  for (const additional_addresses of bad) {
    let refused = false;
    try {
      const result = await client.callTool(accessCall({ ...MANAGED, additional_addresses }));
      refused = result.isError === true;
    } catch {
      refused = true;
    }
    assert.equal(refused, true, JSON.stringify(additional_addresses));
  }
  assert.equal(requests.length, 0);
});

test("configure application access refuses additional addresses on a non-managed mode", async (t) => {
  const { client, requests } = await startAccessClient(t);
  for (const base of [
    { mode: "platform_https" },
    { mode: "private" },
    { mode: "public_http" },
    { mode: "external_https", url: "https://app.example.com" },
  ]) {
    let refused = false;
    try {
      const result = await client.callTool(accessCall({
        ...base,
        additional_addresses: [{ zone_id: 7, name: "", approve_dns: true }],
      }));
      refused = result.isError === true;
    } catch {
      refused = true;
    }
    assert.equal(refused, true, base.mode);
  }
  assert.equal(requests.length, 0);
});

test("configure application access tool description names the additional address rules", async (t) => {
  const { client } = await startAccessClient(t);
  const { tools } = await client.listTools();
  const tool = tools.find((entry) => entry.name === "configure_application_access");
  assert.match(tool.description, /additional_addresses/);
  assert.match(tool.description, /bare domain/);
  assert.match(tool.description, /never changed/);
  assert.match(tool.description, /omits additional_addresses removes the saved ones/);
});
