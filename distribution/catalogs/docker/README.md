# Docker MCP Catalog remote submission

Copy `servers/vpsnet-remote/` from this directory into a fork of
[docker/mcp-registry](https://github.com/docker/mcp-registry). This is a hosted
remote entry and requires no Docker image or Dockerfile.

The entry follows Docker's actual remote OAuth schema: `type: remote`,
`dynamic.tools: true`, a Streamable HTTP remote, and `oauth` provider/secret/env
identifiers. Docker's current remote wizard uses the suffix
`.personal_access_token` for the OAuth token storage slot. This is an upstream
identifier convention; it does not ask customers to create a VPSnet API key or
provide full account access. No credential value or fabricated OAuth client ID
is included.

`tools.json` is intentionally `[]`, as Docker's remote submission instructions
require: authorized tools are discovered at runtime. A static customer-specific
list would misrepresent permissions. Current Gateway code supports DCR with
PKCE and resource binding; Desktop and Community modes can differ, so an actual
Docker OAuth flow remains required before claiming client compatibility.

In the upstream checkout, run:

```sh
task validate -- --name vpsnet-remote
task build -- --tools vpsnet-remote
task catalog -- vpsnet-remote
```

Then import the generated catalog into Docker MCP Toolkit, authorize
`vpsnet-remote` through VPSnet, and verify the connected account and discovered
tools using a limited test grant. Use Docker's documented remote testing steps.
Do not widen customer permissions to make indexing pass. If the installed
Docker release cannot discover/register VPSnet OAuth, report the exact error
and ask Docker which provider onboarding is required; do not invent a static
provider registration or switch authentication to an API key.

PR title: Add VPSnet remote MCP connector

PR body draft:

> Adds VPSnet as a hosted Streamable HTTP connector with customer OAuth and
> dynamic tool discovery. Customers select services and permissions during
> consent. The directory profile manages existing services, applications,
> DNS, private networks and Functions; it excludes purchase and billing actions.
>
> Documentation: https://github.com/bacarrdy/vpsnet-mcp/blob/main/docs/REMOTE_MCP.md

Append only checks actually run, including the Docker version and OAuth/tool
verification result. Use Docker's live PR template at submission time. Review
credentials belong only in Docker's designated private credential form, if
requested; never in the PR, catalog entry or source repository.

Sources: [Remote submission guide](https://github.com/docker/mcp-registry/blob/main/CONTRIBUTING.md#-adding-a-remote-mcp-server),
[remote OAuth example](https://github.com/docker/mcp-registry/blob/main/servers/notion-remote/server.yaml),
[catalog types](https://github.com/docker/mcp-registry/blob/main/pkg/servers/types.go),
[Gateway DCR implementation](https://github.com/docker/mcp-gateway/blob/main/pkg/oauth/provider.go),
[Gateway authorization modes](https://github.com/docker/mcp-gateway/blob/main/cmd/docker-mcp/oauth/auth.go).
