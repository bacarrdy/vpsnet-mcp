# Remote awesome-list drafts

For [punkpeye/awesome-remote-mcp-servers](https://github.com/punkpeye/awesome-remote-mcp-servers),
a submission needs a public endpoint that completes MCP initialize, public
sign-up, and a real Glama connector badge. Its documented process also requires
the submitting account to star the repository. Do this only as a separate,
authorized publisher action. Do not claim these requirements are satisfied
until checked.

Insert this entry under Cloud Platforms, in alphabetic order, only after
replacing both `GLAMA_CONNECTOR_PATH` placeholders with the path assigned by
Glama. The placeholder is intentionally not a fabricated listing URL.

```markdown
- [VPSnet](https://www.vpsnet.com) `https://mcp.vpsnet.com/mcp`
  [![VPSnet MCP connector](https://glama.ai/mcp/connectors/GLAMA_CONNECTOR_PATH/badges/score.svg)](https://glama.ai/mcp/connectors/GLAMA_CONNECTOR_PATH)
  🔐 - Manage authorized VPSnet servers, applications, DNS, private networks and Functions.
```

Its current CI sends an unauthenticated initialize probe and accepts an OAuth
challenge (`401` with a Bearer or resource-metadata `WWW-Authenticate` header).
It does not require exposing customer tools anonymously. Confirm the production
endpoint returns that expected challenge and that the real Glama badge resolves
before submitting. Do not relax authentication for a directory check.

PR title: Add VPSnet remote connector

PR description: Adds the VPSnet hosted Streamable HTTP connector. Customers
sign in with OAuth and select services and permissions. Include the actual
Glama listing URL and only the handshake validation that was completed.

A second independent target,
[jaw9c/awesome-remote-mcp-servers](https://github.com/jaw9c/awesome-remote-mcp-servers),
uses a table. Its README emphasizes production readiness and reliable public
service. Proposed row:

```markdown
| VPSnet | Cloud / DevOps | `https://mcp.vpsnet.com/mcp` | OAuth 2.1 | [VPSnet](https://www.vpsnet.com) |
```

Sources: [punkpeye contribution requirements](https://github.com/punkpeye/awesome-remote-mcp-servers/blob/main/CONTRIBUTING.md),
[unauthenticated CI probe](https://github.com/punkpeye/awesome-remote-mcp-servers/blob/main/.github/workflows/check-submission.yml),
[jaw9c README and quality criteria](https://github.com/jaw9c/awesome-remote-mcp-servers).
