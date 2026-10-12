#!/usr/bin/env node
import { createRemoteServer } from "./http-server.js";

const resource = process.env.VPSNET_MCP_RESOURCE || "https://mcp.vpsnet.com/mcp";
const server = createRemoteServer({
  resource,
  ordersResource: process.env.VPSNET_MCP_ORDERS_ENABLED === "true" ? resource + "/orders" : undefined,
  issuer: process.env.VPSNET_MCP_ISSUER || "https://api.vpsnet.com/oauth/mcp",
  allowedOrigins: (process.env.VPSNET_MCP_ALLOWED_ORIGINS || "").split(",").filter(Boolean),
});
const port = Number(process.env.PORT || 3100);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT.");
server.listen(port, "127.0.0.1", () => console.error(`VPSnet remote MCP listening on loopback port ${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
