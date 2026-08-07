import assert from "node:assert/strict";
import test from "node:test";
import {
  annotateAuthFailure,
  explainAuthFailure,
} from "../build/auth-failure.js";

test("an AI-scoped key is explained instead of reported as Unauthorized", () => {
  const failure = explainAuthFailure(403, {
    success: false,
    auth: "error",
    message: "API key is restricted to VPSnet AI inference",
  });

  assert.equal(failure.code, "aiScopedApiKeyCannotManageAccount");
  assert.match(failure.reason, /AI-scoped key/);
  assert.match(failure.reason, /walled off/);
  assert.match(failure.fix, /management API key/);
  // The user must not be told to add scopes, which cannot fix a key type.
  assert.match(failure.reason, /Adding scopes to it will not help/);
});

test("a bare 401 is not misreported as the AI-scope case", () => {
  const failure = explainAuthFailure(401, {
    success: false,
    auth: "error",
    message: "Unauthorized!",
  });

  assert.equal(failure.code, "apiKeyRejected");
  assert.match(failure.reason, /revoked/);
  assert.match(failure.reason, /IP allowlist/);
  assert.match(failure.reason, /NOT the/);
});

test("read-only and missing-scope rejections are distinguished", () => {
  assert.equal(
    explainAuthFailure(401, { message: "API key scope is read-only" }).code,
    "readOnlyApiKeyCannotWrite"
  );
  assert.equal(
    explainAuthFailure(403, { readOnlyApiKeyForbidden: true }).code,
    "readOnlyApiKeyForbidden"
  );

  const missing = explainAuthFailure(403, {
    apiKeyScopeMissing: true,
    requiredScope: "services:read",
  });
  assert.equal(missing.code, "apiKeyScopeMissing");
  assert.match(missing.reason, /services:read/);
  assert.match(missing.fix, /services:read/);
});

test("api-key-forbidden routes are never presented as fixable with scopes", () => {
  const failure = explainAuthFailure(403, { apiKeyForbidden: true });
  assert.equal(failure.code, "apiKeyForbidden");
  assert.match(failure.reason, /never grant admin access/);
});

test("successful and non-auth statuses are left alone", () => {
  assert.equal(explainAuthFailure(200, { success: true }), null);
  assert.equal(explainAuthFailure(404, { notFound: true }), null);
  assert.equal(explainAuthFailure(422, { invalid: true }), null);

  const untouched = { success: true, services: [] };
  assert.equal(annotateAuthFailure(200, untouched), untouched);
});

test("the annotation keeps the original body and adds a boolean code", () => {
  const annotated = annotateAuthFailure(403, {
    success: false,
    auth: "error",
    message: "API key is restricted to VPSnet AI inference",
  });

  assert.equal(annotated.message, "API key is restricted to VPSnet AI inference");
  // Boolean flag so the strict per-feature sanitisers still carry the signal.
  assert.equal(annotated.aiScopedApiKeyCannotManageAccount, true);
  assert.equal(annotated.auth_problem.http_status, 403);
  assert.equal(
    annotated.auth_problem.code,
    "aiScopedApiKeyCannotManageAccount"
  );
});

test("no explanation names an AI host or an upstream model provider", () => {
  const samples = [
    explainAuthFailure(403, {
      message: "API key is restricted to VPSnet AI inference",
    }),
    explainAuthFailure(401, { message: "Unauthorized!" }),
  ];

  for (const failure of samples) {
    const text = `${failure.reason} ${failure.fix}`;
    assert.equal(/ai\.vpsnet/i.test(text), false);
    assert.equal(/openai|anthropic|claude|gpt|gemini|mistral/i.test(text), false);
  }
});
