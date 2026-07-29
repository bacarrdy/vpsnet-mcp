import assert from "node:assert/strict";
import test from "node:test";

import {
  customProjectComposeSchema,
  customProjectDefinitionRequestBody,
  customProjectEnvironmentSchema,
  customProjectSecretNamesSchema,
  safeContainerDiscoveryPayload,
  safeCustomProjectInstallPayload,
  safeCustomProjectReceiptPayload,
} from "../build/custom-project-contract.js";

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";
const INSTALLATION_ID = "b7ea0c2a-e6e4-4c25-87ca-c0cdf7e4ca42";

test("customer recipe input limits match the backend contract", () => {
  assert.equal(customProjectComposeSchema.safeParse("services: {}").success, true);
  assert.equal(customProjectComposeSchema.safeParse("x".repeat(262145)).success, false);
  assert.equal(
    customProjectEnvironmentSchema.safeParse({ APP_MODE: "production" }).success,
    true
  );
  assert.equal(
    customProjectEnvironmentSchema.safeParse({ "bad-name": "value" }).success,
    false
  );
  assert.equal(
    customProjectSecretNamesSchema.safeParse(["TOKEN", "TOKEN"]).success,
    false
  );
});

test("customer recipe definition body contains names but never secret values", () => {
  assert.deepEqual(
    customProjectDefinitionRequestBody({
      compose_yaml: "services: {}",
      env: { APP_MODE: "production" },
      secret_names: ["DATABASE_PASSWORD"],
      registry_credential_ids: [PROJECT_ID],
    }),
    {
      compose_yaml: "services: {}",
      env: { APP_MODE: "production" },
      secret_names: ["DATABASE_PASSWORD"],
      registry_credential_ids: [PROJECT_ID],
    }
  );
});

test("customer recipe export accepts only customer-owned receipts", () => {
  const payload = {
    success: true,
    receipt: {
      schema_version: 1,
      source: "customer_project",
      project: {
        id: PROJECT_ID,
        name: "billing-api",
        revision: 2,
        digest: "a".repeat(64),
      },
      recipe: {
        format: "compose-v3",
        compose_yaml: "services: {}",
        env: { APP_MODE: "production" },
        secret_names: ["DATABASE_PASSWORD"],
        registry_credential_ids: [],
        secret_values: { DATABASE_PASSWORD: "must-not-leak" },
      },
    },
  };

  const safe = safeCustomProjectReceiptPayload(200, payload);
  assert.equal(safe.success, true);
  assert.equal(safe.receipt.source, "customer_project");
  assert.deepEqual(safe.receipt.recipe.secret_names, ["DATABASE_PASSWORD"]);
  assert.equal(JSON.stringify(safe).includes("must-not-leak"), false);

  payload.receipt.source = "catalog";
  assert.equal(
    safeCustomProjectReceiptPayload(200, payload).success,
    false
  );
});

test("customer recipe install result never reflects submitted or backend secrets", () => {
  const safe = safeCustomProjectInstallPayload(
    202,
    {
      success: true,
      replayed: false,
      installation: {
        id: INSTALLATION_ID,
        state: "queued",
        source: "customer_project",
        project: PROJECT_ID,
        revision: 2,
        secrets: { DATABASE_PASSWORD: "must-not-leak" },
      },
      action: { id: PROJECT_ID, state: "created" },
    },
    "/management/service/VP123/applications"
  );

  assert.equal(safe.success, true);
  assert.equal(JSON.stringify(safe).includes("must-not-leak"), false);
  assert.equal(
    safe.portal_handoff.access_path,
    "/management/service/VP123/applications"
  );
});

test("container discovery exposes bounded status only", () => {
  const safe = safeContainerDiscoveryPayload(200, {
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
            id: "a".repeat(64),
            name: "customer-web",
            image: "docker.io/library/nginx@sha256:" + "b".repeat(64),
            state: "running",
            health: "healthy",
            ports: [],
            managed: false,
            environment: ["TOKEN=must-not-leak"],
            mounts: ["/host:/guest"],
          }],
        },
      },
      timestamps: {},
    },
  });

  assert.equal(safe.success, true);
  assert.equal(safe.discovery.result.containers[0].name, "customer-web");
  assert.equal(JSON.stringify(safe).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(safe).includes("/host:/guest"), false);
});
