import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

test("API timeouts cover headers and body, and later requests recover", async (t) => {
  const timeoutMs = 250;
  const stalledResponseMs = 1000;
  const api = createServer((req, res) => {
    if (req.url === "/slow-headers") {
      const timer = setTimeout(() => res.end('{"success":true}'), stalledResponseMs);
      res.once("close", () => clearTimeout(timer));
      return;
    }
    if (req.url === "/slow-body") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write('{"success":');
      const timer = setTimeout(() => res.end("true}"), stalledResponseMs);
      res.once("close", () => clearTimeout(timer));
      return;
    }
    if (req.url === "/plain-error") {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("upstream unavailable");
      return;
    }
    res.end('{"success":true}');
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
  });

  const names = ["VPSNET_API_KEY", "VPSNET_API_URL", "VPSNET_API_TIMEOUT_MS"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  });
  process.env.VPSNET_API_KEY = "contract-test-key";
  process.env.VPSNET_API_URL = `http://127.0.0.1:${api.address().port}`;
  process.env.VPSNET_API_TIMEOUT_MS = String(timeoutMs);
  const { apiRequest } = await import("../build/api.js");

  // Establish a connection before the deadline checks, including on busy test hosts.
  assert.deepEqual(await apiRequest("GET", "/healthy"), {
    status: 200,
    data: { success: true },
  });

  for (const path of ["/slow-headers", "/slow-body"]) {
    await t.test(`${path} times out and the next request succeeds`, async () => {
      await assert.rejects(
        apiRequest("GET", path),
        { message: `VPSnet API request timed out after ${timeoutMs}ms: GET ${path}` },
      );
      assert.deepEqual(await apiRequest("GET", "/healthy"), {
        status: 200,
        data: { success: true },
      });
    });
  }

  assert.deepEqual(await apiRequest("GET", "/plain-error"), {
    status: 502,
    data: { error: "upstream unavailable" },
  });
});
