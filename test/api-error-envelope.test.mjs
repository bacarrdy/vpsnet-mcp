import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

// qa-mcp-api-0930 M1: the staging edge answered 403 with an nginx HTML page
// and the MCP handed that page to the model as {"error":"<html>..."} with no
// status. Every non-2xx answer now carries http_status, and a non-JSON one a
// one-line reason instead of the page.
test("non-2xx answers carry the status and a reason, never a raw HTML page", async (t) => {
  const api = createServer((req, res) => {
    if (req.url === "/edge-403") {
      res.writeHead(403, { "Content-Type": "text/html" });
      res.end("<html><head><title>403 Forbidden</title></head><body><center><h1>403 Forbidden</h1></center><hr><center>nginx/1.24.0 (Ubuntu)</center></body></html>");
      return;
    }
    if (req.url === "/rate") {
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "50" });
      res.end('{"success":false,"rate_limited":true,"message":"API key rate limit exceeded"}');
      return;
    }
    if (req.url === "/graphs") {
      res.writeHead(422, { "Content-Type": "application/json" });
      res.end('{"success":false,"invalidRequest":true,"invalidParameter":"m"}');
      return;
    }
    res.end('{"success":true}');
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
  });

  const names = ["VPSNET_API_KEY", "VPSNET_API_URL"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  });
  process.env.VPSNET_API_KEY = "contract-test-key";
  process.env.VPSNET_API_URL = `http://127.0.0.1:${api.address().port}`;
  const { apiRequest, describeNonApiResponse } = await import("../build/api.js");

  const edge = await apiRequest("GET", "/edge-403");
  assert.equal(edge.status, 403);
  assert.equal(edge.data.http_status, 403);
  assert.equal(edge.data.non_api_response, true);
  assert.match(edge.data.error, /not from the VPSnet API/);
  assert.match(edge.data.error, /IP allowlist/);
  assert.doesNotMatch(JSON.stringify(edge.data), /<html>/);
  // An edge refusal is not an API-key problem; do not send the user to fix the key.
  assert.equal(edge.data.auth_problem, undefined);

  const rate = await apiRequest("GET", "/rate");
  assert.equal(rate.data.http_status, 429);
  assert.equal(rate.data.retry_after, 50);
  assert.equal(rate.data.auth_problem.code, "apiKeyRateLimited");

  const graphs = await apiRequest("GET", "/graphs");
  assert.equal(graphs.data.http_status, 422);
  assert.equal(graphs.data.invalidParameter, "m");

  assert.deepEqual(await apiRequest("GET", "/ok"), { status: 200, data: { success: true } });

  const gateway = describeNonApiResponse(502, "text/html", "<html>502 Bad Gateway</html>", "api.testweb.vpsnet.com");
  assert.match(gateway.error, /^HTTP 502 from the web server in front of api.testweb.vpsnet.com/);
});
