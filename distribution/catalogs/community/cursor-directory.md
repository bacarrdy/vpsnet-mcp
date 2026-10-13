# Cursor Directory community listing

[Cursor Directory's submission page](https://cursor.directory/plugins/new)
accepts GitHub import or a manual entry and follows Open Plugins. This
community directory is separate from Cursor's official marketplace.

Use a manual entry if the importer does not support the repository's `plugin`
subdirectory. The repository root intentionally has no shared `.mcp.json`;
do not add credentials or disable the root ignore rule to satisfy an importer.
The public `plugin/.mcp.json` provides a credential-free HTTP connection, but
nested-path import support must be checked in the actual form.

Copyable fields:

- Name: VPSnet
- Repository: https://github.com/bacarrdy/vpsnet-mcp
- Plugin path, if supported: `plugin`
- Description: Manage VPSnet servers, applications, DNS, private networks and
  Functions with customer-selected services and OAuth permissions.
- Website: https://www.vpsnet.com
- Remote endpoint: https://mcp.vpsnet.com/mcp
- Authentication: Customer OAuth with dynamic client registration
- Suggested category: Cloud / DevOps

For a manual MCP connection field, the Cursor configuration shape is:

```json
{
  "mcpServers": {
    "vpsnet": {
      "url": "https://mcp.vpsnet.com/mcp"
    }
  }
}
```

Authorize through the client browser flow. This config is public metadata and
contains no bearer token. Use the actual form's supported fields; do not claim
a successful import or marketplace approval based only on preparing them.

Sources: [Community submission page](https://cursor.directory/plugins/new),
[Cursor MCP configuration](https://cursor.com/docs/context/mcp).
