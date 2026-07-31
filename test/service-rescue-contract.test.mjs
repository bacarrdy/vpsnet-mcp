import assert from "node:assert/strict";
import test from "node:test";
import {
  parseServiceRescueStatus,
  safeServiceRescuePayload,
  serviceRescueEnterRequestBody,
} from "../build/service-rescue-contract.js";

const session = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  platform: "firecracker",
  image: "ubuntu-24.04",
  state: "active",
  active: true,
  desiredState: "active",
  operation: "enter",
  progressPercent: 100,
  progressStage: "active",
  originalRunning: true,
  errorCode: null,
  activatedAt: "2026-07-31 12:00:00",
  completedAt: null,
  createdAt: "2026-07-31 11:59:00",
  updatedAt: "2026-07-31 12:00:00",
};

test("keeps only the customer rescue contract", () => {
  const payload = {
    success: true,
    rescue: {
      capability: {
        supported: true,
        enabled: true,
        platform: "firecracker",
        images: [{
          id: "ubuntu-24.04",
          family: "linux",
          console: "serial",
          mountPath: "/mnt/customer",
          device: "/dev/vdb",
        }],
      },
      session,
    },
  };

  assert.deepEqual(parseServiceRescueStatus(payload), payload);
  assert.deepEqual(safeServiceRescuePayload(200, payload), payload);
});

test("rejects provider and operation binding leakage", () => {
  const payload = {
    success: true,
    rescue: {
      capability: {
        supported: true,
        enabled: true,
        platform: "firecracker",
        images: [],
      },
      session: {
        ...session,
        provider_node: "fc100",
        operation_nonce: "secret",
      },
    },
  };

  assert.equal(parseServiceRescueStatus(payload), null);
  assert.deepEqual(safeServiceRescuePayload(200, payload), {
    success: false,
    http_status: 200,
    error_codes: [],
  });
});

test("builds only the acknowledged rescue entry body", () => {
  assert.deepEqual(serviceRescueEnterRequestBody("ubuntu-24.04"), {
    image: "ubuntu-24.04",
    acknowledgeReboot: true,
  });
});
