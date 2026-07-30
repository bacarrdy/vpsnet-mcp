import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";
const INSTALLATION_ID = "b7ea0c2a-e6e4-4c25-87ca-c0cdf7e4ca42";
const ADOPTION_ID = "650e8400-e29b-41d4-a716-446655440000";
const COMPOSE = "services:\n  web:\n    image: docker.io/library/nginx@sha256:" + "a".repeat(64);

test("customer recipe tools preserve exact HTTP contracts and redact results", async (t) => {
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

    let status = 200;
    let response;
    if (req.url.endsWith("/custom-projects/validate")) {
      response = {
        success: true,
        validation: {
          id: PROJECT_ID,
          state: "succeeded",
          valid: true,
          errors: [],
        },
      };
    } else if (req.url.endsWith("/custom-projects") && req.method === "POST") {
      status = 201;
      response = {
        success: true,
        project: {
          id: PROJECT_ID,
          name: "billing-api",
          state: "draft",
          current_revision: {
            revision: 1,
            digest: "b".repeat(64),
            compose_yaml: COMPOSE,
            env: { APP_MODE: "production" },
            secret_names: ["DATABASE_PASSWORD"],
            registry_credential_ids: [],
          },
        },
      };
    } else if (req.url.endsWith(`/${PROJECT_ID}/install`)) {
      status = 202;
      response = {
        success: true,
        replayed: false,
        installation: {
          id: INSTALLATION_ID,
          state: "queued",
          source: "customer_project",
          project: PROJECT_ID,
          revision: 1,
          secrets: { DATABASE_PASSWORD: "must-not-leak" },
        },
        action: { id: PROJECT_ID, state: "created" },
      };
    } else if (req.url.includes(`/${PROJECT_ID}/export`)) {
      response = {
        success: true,
        receipt: {
          schema_version: 1,
          source: "customer_project",
          project: {
            id: PROJECT_ID,
            name: "billing-api",
            revision: 1,
            digest: "b".repeat(64),
          },
          recipe: {
            format: "compose-v3",
            compose_yaml: COMPOSE,
            env: { APP_MODE: "production" },
            secret_names: ["DATABASE_PASSWORD"],
            registry_credential_ids: [],
            secret_values: { DATABASE_PASSWORD: "must-not-leak" },
          },
        },
      };
    } else if (
      req.url.endsWith(`/container-discoveries/${PROJECT_ID}/adoptions`)
    ) {
      status = 202;
      response = {
        success: true,
        replayed: false,
        adoption: {
          id: ADOPTION_ID,
          state: "succeeded",
          compose_project: "customer-stack",
          eligible: true,
          candidate: {
            digest: "d".repeat(64),
            compose_yaml: COMPOSE,
            services: [{
              name: "web",
              environment_names: ["APP_MODE", "DATABASE_PASSWORD"],
              environment_values: {
                DATABASE_PASSWORD: "must-not-leak",
              },
            }],
            container_count: 1,
            volume_count: 1,
          },
          error_codes: [],
          error_code: null,
          confirmed: null,
          timestamps: {},
        },
      };
    } else if (
      req.url.endsWith(`/compose-adoptions/${ADOPTION_ID}/confirm`)
    ) {
      status = 202;
      response = {
        success: true,
        replayed: false,
        adoption: { id: ADOPTION_ID, state: "confirmed" },
        project: { id: PROJECT_ID },
        installation: {
          id: INSTALLATION_ID,
          state: "queued",
          secrets: { DATABASE_PASSWORD: "must-not-leak" },
        },
        action: { id: PROJECT_ID, state: "created" },
      };
    } else if (req.url.endsWith(`/compose-adoptions/${ADOPTION_ID}`)) {
      response = {
        success: true,
        adoption: {
          id: ADOPTION_ID,
          state: "succeeded",
          compose_project: "customer-stack",
          eligible: true,
          candidate: {
            digest: "d".repeat(64),
            compose_yaml: COMPOSE,
            services: [{
              name: "web",
              environment_names: ["APP_MODE", "DATABASE_PASSWORD"],
            }],
            container_count: 1,
            volume_count: 1,
          },
          error_codes: [],
          error_code: null,
          confirmed: null,
          timestamps: {},
        },
      };
    } else if (req.url.endsWith("/container-discoveries")) {
      status = 202;
      response = {
        success: true,
        discovery: {
          id: PROJECT_ID,
          state: "succeeded",
          result: {
            discovery: {
              protocol_version: 1,
              available: true,
              truncated: false,
              containers: [{
                id: "c".repeat(64),
                name: "manual-web",
                image: "docker.io/library/nginx:latest",
                state: "running",
                ports: [],
                managed: false,
                environment: ["TOKEN=must-not-leak"],
              }],
            },
          },
          timestamps: {},
        },
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
  const address = api.address();

  const client = new Client({ name: "custom-project-http", version: "1.0.0" });
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

  await client.callTool({
    name: "create_application_recipe",
    arguments: {
      orderNo: "VP123",
      name: "billing-api",
      compose_yaml: COMPOSE,
      env: { APP_MODE: "production" },
      secret_names: ["DATABASE_PASSWORD"],
      registry_credential_ids: [],
      idempotencyKey: "recipe-create-key-0001",
      confirmed: true,
    },
  });

  assert.equal(requests.length, 2);
  assert.equal(
    requests[0].url,
    "/account/services/VP123/applications/custom-projects/validate"
  );
  assert.deepEqual(requests[0].body, { compose_yaml: COMPOSE });
  assert.equal(
    requests[1].url,
    "/account/services/VP123/applications/custom-projects"
  );
  assert.deepEqual(requests[1].body, {
    name: "billing-api",
    compose_yaml: COMPOSE,
    env: { APP_MODE: "production" },
    secret_names: ["DATABASE_PASSWORD"],
    registry_credential_ids: [],
  });
  assert.equal(
    requests[1].headers["idempotency-key"],
    "recipe-create-key-0001"
  );

  const installed = await client.callTool({
    name: "install_application_recipe",
    arguments: {
      orderNo: "VP123",
      project_id: PROJECT_ID,
      revision: 1,
      secrets: { DATABASE_PASSWORD: "secret-from-user" },
      acknowledge_recipe_risks: true,
      idempotencyKey: "recipe-install-key-0001",
      confirmed: true,
    },
  });
  assert.deepEqual(requests[2].body, {
    revision: 1,
    secrets: { DATABASE_PASSWORD: "secret-from-user" },
    acknowledgeCustomRecipeRisks: true,
    acknowledgeRuntimeRestart: false,
  });
  assert.equal(installed.content[0].text.includes("secret-from-user"), false);
  assert.equal(installed.content[0].text.includes("must-not-leak"), false);

  const exported = await client.callTool({
    name: "export_application_recipe",
    arguments: {
      orderNo: "VP123",
      project_id: PROJECT_ID,
      revision: 1,
    },
  });
  assert.equal(
    requests[3].url,
    `/account/services/VP123/applications/custom-projects/${PROJECT_ID}/export?revision=1`
  );
  assert.equal(exported.content[0].text.includes("must-not-leak"), false);
  assert.match(exported.content[0].text, /customer_project/);

  const discovered = await client.callTool({
    name: "discover_service_containers",
    arguments: { orderNo: "VP123" },
  });
  assert.equal(
    requests[4].url,
    "/account/services/VP123/applications/container-discoveries"
  );
  assert.equal(discovered.content[0].text.includes("must-not-leak"), false);
  assert.match(discovered.content[0].text, /manual-web/);

  const prepared = await client.callTool({
    name: "prepare_application_compose_adoption",
    arguments: {
      orderNo: "VP123",
      discovery_id: PROJECT_ID,
      compose_project: "customer-stack",
    },
  });
  assert.equal(
    requests[5].url,
    `/account/services/VP123/applications/container-discoveries/${PROJECT_ID}/adoptions`
  );
  assert.deepEqual(requests[5].body, {
    compose_project: "customer-stack",
  });
  assert.equal(prepared.content[0].text.includes("must-not-leak"), false);
  assert.match(prepared.content[0].text, /DATABASE_PASSWORD/);

  const polled = await client.callTool({
    name: "get_application_compose_adoption",
    arguments: {
      orderNo: "VP123",
      adoption_id: ADOPTION_ID,
    },
  });
  assert.equal(
    requests[6].url,
    `/account/services/VP123/applications/compose-adoptions/${ADOPTION_ID}`
  );
  assert.match(polled.content[0].text, /customer-stack/);

  const confirmed = await client.callTool({
    name: "confirm_application_compose_adoption",
    arguments: {
      orderNo: "VP123",
      adoption_id: ADOPTION_ID,
      name: "managed-stack",
      env: { APP_MODE: "production" },
      secrets: { DATABASE_PASSWORD: "secret-from-user" },
      registry_credential_ids: [],
      acknowledge_source_stop: true,
      acknowledge_recipe_risks: true,
      idempotencyKey: "compose-adoption-key-0001",
      confirmed: true,
    },
  });
  assert.equal(
    requests[7].url,
    `/account/services/VP123/applications/compose-adoptions/${ADOPTION_ID}/confirm`
  );
  assert.deepEqual(requests[7].body, {
    name: "managed-stack",
    env: { APP_MODE: "production" },
    secrets: { DATABASE_PASSWORD: "secret-from-user" },
    registry_credential_ids: [],
    acknowledgeSourceStop: true,
    acknowledgeCustomRecipeRisks: true,
    acknowledgeRuntimeRestart: false,
  });
  assert.equal(
    requests[7].headers["idempotency-key"],
    "compose-adoption-key-0001"
  );
  assert.equal(confirmed.content[0].text.includes("secret-from-user"), false);
  assert.equal(confirmed.content[0].text.includes("must-not-leak"), false);
});
