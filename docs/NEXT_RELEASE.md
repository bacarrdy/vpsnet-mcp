# MCP server 2.7.2

Not published yet. The connector stays at 1.0.1 (no connector, hosted gateway or ZIP change).

## Release notes

MCP server **2.7.2**:

- The package starts when run through npx or a global install (`npx -y vpsnet-mcp`, `vpsnet-mcp`). Since 2.3.2 those starts exited at once without answering.

No tool changes. See [CHANGELOG](../CHANGELOG.md).

## Required release checks

- `npm ci`, `npm test` (Node 20 and 22) and `npm run docs:tools:check` pass on the exact commit.
- `python3 scripts/release.py build --component mcp` passes, including **the packed tarball answers through its bin** (`node_modules/.bin/vpsnet-mcp`, `npx --no-install vpsnet-mcp`, `npx -y --package=<tarball> vpsnet-mcp`, `vpsnet-mcp-http`).
- Publish exactly the tarball that check ran on; compare its sha256 with the registry download afterwards.
