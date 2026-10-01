import assert from "node:assert/strict";
import test from "node:test";
import { installToolResultErrorFlag, markToolResultError, withToolResultErrorFlag } from "../build/tool-result.js";

function result(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

test("returned API and projected failures are MCP tool errors with the original body", () => {
  for (const payload of [
    { success: false, notFound: true },
    { success: false, validate: "error", _errors: { f: ["regex"] } },
    { error: "404 - Page Not Found." },
    { error: true },
    { error: { code: "notFound" } },
    { http_status: 401, auth_problem: { code: "apiKeyRejected" } },
    { success: false, status: 422, error_codes: ["applicationRequestInvalid"] },
    { success: false, status: 502, errors: ["invalidCertificateResponse"] },
    { state: "error", payload: null, message: "The asynchronous action failed" },
  ]) {
    const original = result(payload);
    const marked = markToolResultError(original);
    assert.equal(marked.isError, true, JSON.stringify(payload));
    assert.equal(marked.content, original.content);
    assert.deepEqual(JSON.parse(marked.content[0].text), payload);
    assert.equal(original.isError, undefined, "The handler's result is not mutated");
  }
});

test("ordinary read results and pending work keep their existing success contract", () => {
  for (const payload of [
    { success: true, services: [] },
    { status: false, price: 9.99 },
    { success: true, available: false, searchAvailable: false },
    { success: true, error: null },
    { success: true, error: false },
    { error: "" },
    { error: {} },
    { http_status: 200 },
    { state: "completed", payload: null },
    { state: "proccessing", timed_out: true },
    null,
    [],
  ]) {
    const original = result(payload);
    assert.equal(markToolResultError(original), original, JSON.stringify(payload));
  }
  const plain = { content: [{ type: "text", text: "Read complete" }] };
  assert.equal(markToolResultError(plain), plain);
});

test("structured failures and explicit tool errors preserve all other result fields", () => {
  const structured = {
    content: [],
    structuredContent: { success: false, error_codes: ["notFound"] },
    _meta: { request: "test" },
  };
  const marked = markToolResultError(structured);
  assert.equal(marked.isError, true);
  assert.equal(marked.structuredContent, structured.structuredContent);
  assert.equal(marked._meta, structured._meta);
  const alreadyMarked = { ...result({ success: false }), isError: true };
  assert.equal(markToolResultError(alreadyMarked), alreadyMarked);
});

test("handler wrapping preserves arguments, uncertain outcomes, and a single execution", async () => {
  let calls = 0;
  const context = { request: "original" };
  const payload = {
    success: false,
    http_status: 502,
    outcome_unknown: true,
    retry_guidance: "inspect_state_before_retry",
    error: "Do not automatically repeat this mutation",
  };
  const handler = withToolResultErrorFlag(async (args, extra) => {
    calls += 1;
    assert.deepEqual(args, { id: 1 });
    assert.equal(extra, context);
    return result(payload);
  });
  const marked = await handler({ id: 1 }, context);
  assert.equal(calls, 1);
  assert.equal(marked.isError, true);
  assert.deepEqual(JSON.parse(marked.content[0].text), payload);

  const failure = new Error("Network response was lost");
  const throwing = withToolResultErrorFlag(async () => { throw failure; });
  await assert.rejects(throwing(), (error) => error === failure,
    "Thrown errors remain available to the SDK's tool error handler");
});

test("registration adapter wraps every handler and preserves server binding and configuration", async () => {
  const registrations = [];
  const server = {
    registerTool(name, config, handler) {
      assert.equal(this, server);
      const registration = { name, config, handler };
      registrations.push(registration);
      return registration;
    },
  };
  installToolResultErrorFlag(server);
  for (let i = 0; i < 197; i += 1) {
    const name = `tool-${i}`;
    const config = { inputSchema: {}, annotations: { readOnlyHint: true } };
    const registration = server.registerTool(name, config, async (args, extra) => {
      assert.deepEqual(args, { id: i });
      assert.deepEqual(extra, { request: name });
      return result({ success: false, notFound: true });
    });
    assert.equal(registration, registrations[i]);
    assert.equal(registration.name, name);
    assert.equal(registration.config, config);
    assert.equal((await registration.handler({ id: i }, { request: name })).isError, true);
  }
  assert.equal(registrations.length, 197);
});
