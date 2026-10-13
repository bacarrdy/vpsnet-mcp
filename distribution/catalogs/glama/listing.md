# Glama listing fields

Prefer the hosted connector route at [Glama connectors](https://glama.ai/mcp/connectors):
Add MCP Server → Connector. The separate [repository directory](https://glama.ai/mcp/servers)
can index the public source project.

| Field | Value |
| --- | --- |
| Name | VPSnet |
| Description | Manage VPSnet servers, applications, DNS, private networks and Functions with customer-selected services and OAuth permissions. |
| Endpoint | https://mcp.vpsnet.com/mcp |
| Transport | Streamable HTTP |
| Authentication | OAuth 2.1 with PKCE and dynamic client registration |
| Repository | https://github.com/bacarrdy/vpsnet-mcp |
| Website | https://www.vpsnet.com |
| Suggested category | Cloud Platforms / CI/CD & DevOps, using the live form's available categories |
| Documentation | https://github.com/bacarrdy/vpsnet-mcp/blob/main/docs/REMOTE_MCP.md |

Glama documents automatic registration for DCR servers and says optional test
credentials can be omitted in that case. Complete a real OAuth connection if
required for the health test; do not supply a broad VPSnet account API key.
Customer-specific tool discovery should be exercised with a limited grant.
Healthy submitted connectors become public; keep test credentials private.

Claim the listing through Glama's displayed domain or GitHub verification flow.
For a `com.vpsnet` registry namespace, the domain proof is for `vpsnet.com`.
Use only the exact TXT record or HTTP claim token issued by Glama; this kit does
not invent one. Set the test profile's auth method to OAuth so the listing
accurately represents authorization.

After Glama assigns the actual connector URL, reuse its real badge in the
remote awesome-list draft. Do not assume its URL will match a proposed name.

If users choose Glama Gateway routing, Glama handles credentials and logs
requests/results as described in its documentation. A direct VPSnet connection
and an optional Glama proxy have different data paths.

Source: [Submission, ownership and gateway details](https://glama.ai/mcp/faq).
