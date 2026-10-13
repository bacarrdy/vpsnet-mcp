# Connect VPSnet to Cline or another MCP client

Use the hosted VPSnet connector for customer-authorized operations. The public
endpoint is `https://mcp.vpsnet.com/mcp` and uses Streamable HTTP with OAuth.
An existing VPSnet account and a client with browser OAuth support are required.
No local package, model API key or VPSnet account API key is needed for this
connection.

## Cline setup

1. Open Cline's MCP Servers panel and select Remote Servers.
2. Add a server named `vpsnet` with URL `https://mcp.vpsnet.com/mcp` and transport
   **Streamable HTTP**.
3. Start the server's OAuth authorization in Cline. For the Cline CLI, the
   `cline mcp` wizard has an **Authorize OAuth** action.
4. In the VPSnet browser flow, sign in and select only the services and
   permissions required for the task. Approve the connection there.
5. Verify `get_connected_account` returns the intended connected account and
   grants. Inspect the available tools before making a change.

For direct Cline JSON configuration, merge this entry under the existing
`mcpServers` object; preserve unrelated servers:

```json
{
  "mcpServers": {
    "vpsnet": {
      "type": "streamableHttp",
      "url": "https://mcp.vpsnet.com/mcp",
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Cline uses `streamableHttp` in its JSON format. Do not replace it with the
registry transport spelling `streamable-http` or leave it out, because older
configurations default to SSE. Let Cline manage OAuth tokens securely; do not
paste an Authorization header, customer token or password into shared config.

## Permissions and safe use

Tools depend on the customer's grant. Start with inspection and diagnostics;
request the needed permissions through OAuth when a task requires more.
Reconnect if a client cannot request incremental consent. Services are limited
to the selected services; account-wide networking and Functions permissions are
disclosed during consent. Customers can revoke the connection in the VPSnet
account's AI connections page.

Keep tool approvals enabled. Linux shell commands run as root when explicitly
authorized; file reading, file changes and commands have separate permissions.
The hosted directory profile excludes purchases, billing and account API-key
management. Follow the user's authorized task and obtain confirmation when a
change would expand its scope or destroy unrelated data.

If connection fails, verify the URL, Streamable HTTP selection and client OAuth
support. A `401` without a token is an OAuth challenge; use the authorization
flow. Do not substitute the local stdio package's API-key configuration to work
around a remote OAuth failure. If authorization cannot complete, report the
client version and redacted error, keeping credentials out of the report.

[Remote permissions and operations](docs/REMOTE_MCP.md) describe the connector's
behavior. Other clients have their own configuration schemas; use their native
remote OAuth setup with the same endpoint.

Sources: [Cline MCP setup and OAuth wizard](https://docs.cline.bot/mcp/mcp-overview),
[Cline marketplace installation documentation](https://github.com/cline/mcp-marketplace#making-your-mcp-server-one-click-installable).
