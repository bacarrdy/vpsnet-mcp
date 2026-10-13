# MCP catalog submission kit

Prepared against primary provider sources on 2026-10-13. These are listing
artifacts and publisher instructions; preparing a file does not publish a
listing or establish compatibility with every AI client.

All hosted listings use `https://mcp.vpsnet.com/mcp`, Streamable HTTP and
customer OAuth. Customers choose services and permissions during consent.
Tool availability depends on that grant; do not publish one customer's tool
inventory as a universal tool list. The hosted directory profile does not
perform purchases, billing or account API-key management.

Before submitting, publish the reviewed release to the public repository,
verify production OAuth with the target client, and confirm the public support
and policy links. Keep reviewer accounts, tokens and test results private.
Use the publisher's organizational accounts for submission. Any confirmation
of successful testing must describe a test actually completed.

| Channel | Copyable artifact | Publisher dependency |
| --- | --- | --- |
| Official MCP Registry | [Instructions](official-registry/README.md), root `server.json` | Verify `vpsnet.com` namespace and publish the released version |
| GitHub MCP Registry | [Nomination](github-registry/request.md) | Published official MCP record; GitHub curation |
| Docker MCP Catalog | [Remote catalog entry and PR draft](docker/README.md) | Production OAuth through Docker; upstream checks and review |
| Cline Marketplace | [Issue and 400px icon](cline/issue.md), root `llms-install.md` | Actual Cline installation test and readiness confirmation |
| Smithery | [URL publishing instructions](smithery/README.md) | Namespace ownership, OAuth scan and gateway verification |
| Glama | [Connector and repository listings](glama/listing.md) | Publisher sign-in, OAuth health check and ownership claim |
| PulseMCP | [Listing record](pulsemcp/listing.md) | Official registry publication; verify manual form availability |
| MCP.so | [Issue/form draft](mcp-so/issue.md) | Resolve conflict between issue FAQ and paid form |
| mcpservers.org | [Free form draft](mcpservers-org/listing.md) | Contact address and review |
| Awesome lists | [Community drafts](community/awesome-mcp-servers.md), [remote lists](community/awesome-remote-mcp-servers.md) | Maintainer review; remote list handshake and badge requirements |
| Cursor Directory | [Manual listing draft](community/cursor-directory.md) | Sign-in; confirm nested plugin import support or use manual entry |

[Reusable fields](metadata.json) are a submission aid, not an upstream schema.
Provider-specific instructions link their primary sources and separate actual
requirements from fields that the publisher must supply. Track submission IDs,
review decisions and live listing URLs outside this public package.
