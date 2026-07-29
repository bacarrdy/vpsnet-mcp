import assert from "node:assert/strict";
import test from "node:test";

import {
  applicationAccessConfigurationRequestBody,
  applicationAccessSchema,
  applicationActionCancellationIsAdvertised,
  applicationActionCancellationRequestBody,
  applicationActionIdSchema,
  applicationActionSchema,
  applicationUpdateCandidateMatches,
  applicationInstallRequestBody,
  applicationLifecycleRequestBody,
  applicationLogMaxBytesSchema,
  applicationLogTailLinesSchema,
  applicationExpectedVersionSchema,
  safeApplicationInspectionPayload,
  safeApplicationMutationPayload,
  safeApplicationRegistryCredentialPayload,
} from "../build/application-contract.js";

const ACTION_ID = "1f3502fc-1177-4e3f-b867-b3f6d7b9846e";

test("managed application log inspection limits match the backend contract", () => {
  assert.equal(applicationLogTailLinesSchema.parse(1), 1);
  assert.equal(applicationLogTailLinesSchema.parse(500), 500);
  assert.equal(applicationLogTailLinesSchema.safeParse(501).success, false);

  assert.equal(applicationLogMaxBytesSchema.parse(1024), 1024);
  assert.equal(applicationLogMaxBytesSchema.parse(131072), 131072);
  assert.equal(applicationLogMaxBytesSchema.safeParse(131073).success, false);
});

test("managed application lifecycle supports immutable update only", () => {
  assert.equal(applicationActionSchema.parse("update"), "update");
  assert.equal(applicationActionSchema.safeParse("backup").success, false);
  assert.equal(applicationActionSchema.safeParse("restore").success, false);
});

test("managed application cancellation requires an exact action UUID and empty body", () => {
  assert.equal(applicationActionIdSchema.parse(ACTION_ID), ACTION_ID);
  assert.equal(applicationActionIdSchema.safeParse("latest-action").success, false);
  assert.deepEqual(applicationActionCancellationRequestBody(), {});
});

test("managed application cancellation matches only the advertised cancellable latest action", () => {
  const detail = {
    success: true,
    installation: {
      latest_action: {
        id: ACTION_ID,
        state: "queued",
        cancellable: true,
      },
    },
  };

  assert.equal(applicationActionCancellationIsAdvertised(detail, ACTION_ID), true);
  assert.equal(
    applicationActionCancellationIsAdvertised(
      detail,
      "935d7a11-e755-4da6-9194-2c065a2b69ce"
    ),
    false
  );
  assert.equal(
    applicationActionCancellationIsAdvertised({
      installation: {
        latest_action: { id: ACTION_ID, cancellable: false },
      },
    }, ACTION_ID),
    false
  );
  assert.equal(
    applicationActionCancellationIsAdvertised({ installation: {} }, ACTION_ID),
    false
  );
});

test("immutable update binds the lifecycle request to the approved release", () => {
  assert.deepEqual(applicationLifecycleRequestBody("update", false, {
    blueprintVersion: "2026.07.3",
    upstreamVersion: "1.2.3",
  }), {
    action: "update",
    expected_blueprint_version: "2026.07.3",
    expected_upstream_version: "1.2.3",
  });
  assert.throws(
    () => applicationLifecycleRequestBody("update", false),
    /exact advertised update release/i,
  );
  assert.deepEqual(applicationLifecycleRequestBody("restart", false), {
    action: "restart",
  });
  assert.deepEqual(applicationLifecycleRequestBody("uninstall", true), {
    action: "uninstall",
    acknowledgeDataLoss: true,
  });
});

test("immutable update expectation matches only the advertised release", () => {
  const detail = {
    success: true,
    installation: {
      available_actions: [{
        type: "update",
        release: {
          blueprint_version: "2026.07.3",
          upstream_version: "1.2.3",
        },
      }],
    },
  };
  assert.equal(applicationUpdateCandidateMatches(detail, {
    blueprintVersion: "2026.07.3",
    upstreamVersion: "1.2.3",
  }), true);
  assert.equal(applicationUpdateCandidateMatches(detail, {
    blueprintVersion: "2026.07.4",
    upstreamVersion: "1.2.3",
  }), false);
});

test("managed application install preserves explicit access and restart consent", () => {
  const access = applicationAccessSchema.parse({
    mode: "managed_https",
    zone_id: 42,
    subdomain: "chat",
    approve_dns: true,
  });
  assert.deepEqual(
    applicationInstallRequestBody({
      application: "open-webui",
      releaseChannel: "stable",
      variables: {},
      acknowledgeRuntimeRestart: true,
      access,
    }),
    {
      application: "open-webui",
      releaseChannel: "stable",
      variables: {},
      acknowledgeRuntimeRestart: true,
      access,
    }
  );
  assert.deepEqual(
    applicationInstallRequestBody({
      application: "open-webui",
      releaseChannel: "stable",
      variables: {},
      acknowledgeRuntimeRestart: false,
    }),
    {
      application: "open-webui",
      releaseChannel: "stable",
      variables: {},
    }
  );
  assert.equal(
    applicationAccessSchema.safeParse({
      mode: "external_https",
      url: "https://user:pass@example.test/",
    }).success,
    false
  );
  assert.equal(
    applicationAccessSchema.safeParse({
      mode: "external_https",
      url: "https://app.example.test/path/",
    }).success,
    false
  );
  assert.equal(
    applicationAccessSchema.safeParse({
      mode: "external_https",
      url: "https://app.example.test/path/../admin",
    }).success,
    false
  );
  assert.equal(
    applicationAccessSchema.safeParse({
      mode: "external_https",
      url: "https://127.0.0.1/app",
    }).success,
    false
  );
  assert.deepEqual(
    applicationAccessSchema.parse({
      mode: "external_https",
      url: "https://app.example.test/open-webui",
    }),
    {
      mode: "external_https",
      url: "https://app.example.test/open-webui",
    }
  );
  assert.deepEqual(applicationAccessSchema.parse({ mode: "public_http" }), {
    mode: "public_http",
  });
  assert.deepEqual(applicationAccessSchema.parse({ mode: "platform_https" }), {
    mode: "platform_https",
  });
});

test("registry metadata output allowlists fields and drops every secret representation", () => {
  assert.deepEqual(
    safeApplicationRegistryCredentialPayload(200, {
      success: true,
      credentials: [{
        id: "550e8400-e29b-41d4-a716-446655440040",
        registry: "ghcr.io",
        username: "customer",
        created_at: "2026-07-29 10:00:00",
        updated_at: "2026-07-29 11:00:00",
        rotated_at: "2026-07-29 11:00:00",
        token_present: true,
        token: "ghp_must_never_reach_the_model",
        ciphertext: "encrypted-secret",
        fingerprint: "secret-fingerprint",
        key_version: 7,
      }],
    }),
    {
      success: true,
      credentials: [{
        id: "550e8400-e29b-41d4-a716-446655440040",
        registry: "ghcr.io",
        username: "customer",
        created_at: "2026-07-29 10:00:00",
        updated_at: "2026-07-29 11:00:00",
        rotated_at: "2026-07-29 11:00:00",
        token_present: true,
      }],
    }
  );
  assert.deepEqual(
    safeApplicationRegistryCredentialPayload(403, {
      success: false,
      apiKeyScopeMissing: true,
      requiredScope: "applications:read",
      token: "must-not-leak",
    }),
    {
      success: false,
      status: 403,
      error_codes: ["apiKeyScopeMissing"],
    }
  );
});

test("managed application update versions match the backend printable ASCII contract", () => {
  assert.equal(applicationExpectedVersionSchema.safeParse("v0.10.2+vpsnet.1").success, true);
  assert.equal(applicationExpectedVersionSchema.safeParse("version with spaces").success, false);
  assert.equal(applicationExpectedVersionSchema.safeParse("x".repeat(97)).success, false);
});

test("managed application access configuration preserves the exact optimistic revision", () => {
  assert.deepEqual(
    applicationAccessConfigurationRequestBody(
      { mode: "public_http" },
      7
    ),
    {
      access: { mode: "public_http" },
      expectedRevision: 7,
    }
  );
});

test("generated-secret mutation output contains only a portal handoff", () => {
  const secret = "plaintext-must-never-reach-mcp";
  const projected = safeApplicationMutationPayload(
    202,
    {
      success: true,
      replayed: false,
      installation: { id: "installation-1", state: "queued", application: "open-webui" },
      action: { id: "action-1", type: "install", state: "queued" },
      secret_reveal: {
        handle: "opaque-handle-must-not-reach-mcp",
        values: { ADMIN_PASSWORD: secret },
      },
    },
    "/management/service/VP123/applications"
  );

  assert.deepEqual(projected.portal_handoff, {
    required: true,
    reason: "generated_credentials",
    access_path: "/management/service/VP123/applications",
  });
  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("opaque-handle"), false);
  assert.equal(serialized.includes("secret_reveal"), false);
});

test("inspection output preserves the backend logs result envelope", () => {
  const secret = "super-secret-value-123";
  const relayToken = `vpsnet_mi_42_abcdefgh_${"A".repeat(48)}`;
  const projected = safeApplicationInspectionPayload(200, {
    success: true,
    inspection: {
      id: "inspection-1",
      installation_id: "installation-1",
      kind: "logs",
      state: "succeeded",
      result: {
        logs: {
          content: `service ready\npassword=${secret}\nrelay=${relayToken}`,
          line_count: 2,
          byte_count: 48,
          arbitrary_internal_field: secret,
        },
        worker_node: "worker-1",
        worker_release: "runner-1.2.3",
        internal_capability: secret,
      },
      internal_request: secret,
    },
  }, "logs");

  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes(relayToken), false);
  assert.equal(serialized.includes("arbitrary_internal_field"), false);
  assert.equal(serialized.includes("internal_capability"), false);
  assert.equal(serialized.includes("internal_request"), false);
  assert.match(projected.inspection.result.logs.content, /password=\[redacted\]/);
  assert.equal(projected.inspection.result.worker_node, "worker-1");
  assert.equal(projected.inspection.result.worker_release, "runner-1.2.3");
  assert.equal(projected.inspection.worker_node, undefined);
  assert.equal(projected.inspection.worker_release, undefined);
});

test("inspection output preserves the backend health result envelope", () => {
  const projected = safeApplicationInspectionPayload(200, {
    success: true,
    inspection: {
      id: "inspection-1",
      installation_id: "installation-1",
      kind: "health",
      state: "succeeded",
      result: {
        health: {
          protocol_version: 1,
          installation_id: "installation-1",
          checked_at: "2026-07-15T12:00:00Z",
          status: "healthy",
          unexpected_containers: 0,
          services: [{
            name: "web",
            status: "healthy",
            health: "healthy",
            containers: 1,
            running: 1,
            healthy: 1,
            unhealthy: 0,
            starting: 0,
            restarting: 0,
            exited: 0,
          }],
        },
        worker_node: "worker-2",
        worker_release: "runner-1.2.3",
      },
    },
  }, "health");

  assert.deepEqual(Object.keys(projected.inspection.result).sort(), [
    "health",
    "worker_node",
    "worker_release",
  ]);
  assert.equal(projected.inspection.result.health.status, "healthy");
  assert.equal(projected.inspection.result.worker_node, "worker-2");
  assert.equal(projected.inspection.worker_node, undefined);
});

test("inspection output redacts private keys with truncated PEM boundaries", () => {
  const fragments = [
    {
      material: `MII${"A".repeat(80)}`,
      content: `before\n-----BEGIN PRIVATE KEY-----\nMII${"A".repeat(80)}`,
    },
    {
      material: `MII${"B".repeat(80)}`,
      content: `MII${"B".repeat(80)}\n-----END RSA PRIVATE KEY-----\nafter`,
    },
  ];

  for (const { content, material } of fragments) {
    const projected = safeApplicationInspectionPayload(200, {
      success: true,
      inspection: {
        kind: "logs",
        result: {
          logs: { content },
          worker_node: "worker-1",
          worker_release: "runner-1.2.3",
        },
      },
    }, "logs");
    const redacted = projected.inspection.result.logs.content;

    assert.match(redacted, /\[redacted\]/);
    assert.equal(redacted.includes(material), false);
    assert.doesNotMatch(redacted, /-----BEGIN .*PRIVATE KEY|-----END .*PRIVATE KEY/);
  }
});
