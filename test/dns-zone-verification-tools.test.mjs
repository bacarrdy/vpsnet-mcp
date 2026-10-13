import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// DNS-175 (GitLab vpsnet_frontend #175): an assistant must be able to replace
// a lost verification value and must see WHY a verification was refused and
// what to do next - including "keep the nameservers, add the TXT at the
// previous provider" and "contact support" - never a bare 409.
test("DNS verification and registrar glue tools retain their public mutation contracts", async (t) => {
  const requests = [];
  const api = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });

    let status = 200;
    let response;
    if (req.url === "/account/dns/zones/41/verification/reissue" && req.method === "POST") {
      response = {
        success: true,
        zone: { id: 41, status: "pending_verification", verification: { next_step: "add_txt_at_previous_provider" } },
        verificationRecord: {
          type: "TXT",
          name: "_vpsnet-dns.garazubendrija.lt",
          value: "vpsnet-dns-verification=" + "a".repeat(64),
        },
      };
    } else if (req.url === "/account/dns/zones/41/verify" && req.method === "POST") {
      status = 409;
      response = {
        success: false,
        verificationMissing: true,
        verification: {
          record: { type: "TXT", name: "_vpsnet-dns.garazubendrija.lt" },
          previous_nameservers: ["ns1.dns-parking.com", "ns2.dns-parking.com"],
          delegated_to_platform: true,
          held: false,
          expires_at: null,
          next_step: "add_txt_at_previous_provider",
          checks: [
            { source: "public", host: null, status: "unresolvable", found: [] },
            { source: "previous_nameserver", host: "ns1.dns-parking.com", status: "not_found", found: [] },
          ],
        },
      };
    } else if (req.url === "/account/domains/17/glue" && req.method === "POST") {
      response = { success: true, action: { status: "queued" } };
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

  const client = new Client({ name: "dns-zone-verification", version: "1.0.0" });
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
  t.after(() => client.close());

  const { tools } = await client.listTools();
  const reissue = tools.find((tool) => tool.name === "reissue_dns_zone_verification");
  const verify = tools.find((tool) => tool.name === "verify_dns_zone");
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  for (const name of [
    "change_rdns", "clear_rdns", "set_domain_nameservers", "create_domain_glue_record",
    "delete_domain_glue_record", "add_domain_parent_ds", "delete_domain_parent_ds",
    "attach_service_dns_record", "import_dns_zone", "apply_dns_template", "delete_dns_zone", "verify_dns_zone",
    "set_dnssec", "upsert_dns_record", "update_dns_record", "delete_dns_record",
  ]) assert.equal(byName.get(name)?.annotations?.openWorldHint, true, name);
  const glue = byName.get("create_domain_glue_record");
  assert.equal(glue.annotations.readOnlyHint, false);
  assert.equal(glue.annotations.destructiveHint, true);
  assert.match(glue.description, /public parent-zone glue/);
  for (const name of ["add_domain_parent_ds", "set_dnssec", "update_dns_record"]) {
    assert.equal(byName.get(name).annotations.destructiveHint, true, name);
  }
  assert.ok(reissue, "reissue_dns_zone_verification is registered");
  assert.deepEqual(reissue.inputSchema.required, ["zone_id"]);
  assert.match(reissue.description, /previous value stops being accepted/);
  assert.match(verify.description, /previous DNS provider/);
  assert.match(verify.description, /Delegation to VPSnet nameservers alone is never proof/);
  assert.match(verify.description, /never by moving the nameservers back/);
  assert.doesNotMatch(
    tools.map((tool) => tool.description).join("\n"),
    /(revert|switch back|restore (?:the )?(?:old|previous) (?:dns|nameservers))/i,
    "No tool tells an assistant to point a domain back at its old provider."
  );

  const reissued = await client.callTool({ name: "reissue_dns_zone_verification", arguments: { zone_id: 41 } });
  const reissuedBody = JSON.parse(reissued.content[0].text);
  assert.equal(reissuedBody.verificationRecord.name, "_vpsnet-dns.garazubendrija.lt");
  assert.match(reissuedBody.verificationRecord.value, /^vpsnet-dns-verification=/);

  const refused = await client.callTool({ name: "verify_dns_zone", arguments: { zone_id: 41 } });
  const refusedBody = JSON.parse(refused.content[0].text);
  assert.equal(refusedBody.verificationMissing, true);
  assert.equal(refusedBody.verification.next_step, "add_txt_at_previous_provider");
  assert.equal(refusedBody.verification.checks.length, 2);

  const queuedGlue = await client.callTool({ name: "create_domain_glue_record", arguments: {
    domain_id: 17, hostname: "ns1.example.com", addresses: ["1.1.1.1"], idempotencyKey: "glue-test-key-20261013",
  } });
  assert.equal(JSON.parse(queuedGlue.content[0].text).action.status, "queued");

  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.url}`),
    ["POST /account/dns/zones/41/verification/reissue", "POST /account/dns/zones/41/verify", "POST /account/domains/17/glue"]
  );
  assert.deepEqual(JSON.parse(requests[2].body), {
    hostname: "ns1.example.com", addresses: ["1.1.1.1"], idempotencyKey: "glue-test-key-20261013",
  });
  assert.equal(requests[0].headers["x-api-key"], "contract-test-key");
});
