import assert from "node:assert/strict";
import test from "node:test";
import { validateApiPath } from "../build/api-path.js";

test("route validation rejects normalization, origin changes and oversized paths", () => {
  for (const path of [
    "https://example.com/account/session", "//example.com/account/session",
    "/account/services/../session", "/account/services/%2e%2e/session",
    "/account/services/%252e%252e/session", "/account/services/VP1%2fstart",
    "/account/services/VP1%3fstart", "/account/services/VP1#start",
    "/account/services/VP1\\start", "/account/services/VP1\nstart",
    "/account//services", "/account/services/%", "/" + "a".repeat(8192),
  ]) assert.throws(() => validateApiPath(path), /Invalid VPSnet API route/, path);

  for (const path of [
    "/account/session", "/account/services/vp88903-1/start",
    "/account/services/VD12345/graphs?m=net&p=1d&f=rx%2Ctx",
    "/account/domains/check?domain=example.com",
  ]) assert.doesNotThrow(() => validateApiPath(path));
});

test("invalid routes are rejected before API transport", async (t) => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.VPSNET_API_KEY;
  const oldUrl = process.env.VPSNET_API_URL;
  process.env.VPSNET_API_KEY = "contract-test-key";
  process.env.VPSNET_API_URL = "http://127.0.0.1:1";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('{"success":true}', { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.VPSNET_API_KEY;
    else process.env.VPSNET_API_KEY = oldKey;
    if (oldUrl === undefined) delete process.env.VPSNET_API_URL;
    else process.env.VPSNET_API_URL = oldUrl;
  });
  const { apiRequest } = await import("../build/api.js");
  await assert.rejects(apiRequest("POST", "/account/services/../session"), /Invalid/);
  await assert.rejects(apiRequest("CONNECT", "/account/session"), /Invalid/);
  assert.equal(calls, 0);
  await apiRequest("GET", "/account/session");
  assert.equal(calls, 1);
});
