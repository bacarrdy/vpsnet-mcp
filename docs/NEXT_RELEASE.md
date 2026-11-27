# MCP server 2.8.0

Not published yet. The connector stays at 1.0.1 (no connector or ZIP change).

## Release notes

MCP server **2.8.0**:

- Plan changes that change a monthly charge can be finished through MCP: `calculate_plan_change` returns the Windows licence (`windowsLicense`) and extra IPv4 (`ipv4`) monthly charges and a `quote_acceptance` block with the amounts in euros and the exact value to send back; `change_plan` takes `acceptedWindowsLicense` and `acceptedIpv4`, which are passed unchanged after the user has seen and agreed to the new monthly charges.
- When those values are missing or no longer match, VPSnet changes and charges nothing (HTTP 409); `change_plan` returns `quote_changed: true`, `plan_changed: false`, `charged: false`, the new monthly charges and `accept_with` (always the complete set for the next call, to be passed together after the user agreed) as an ordinary result, and never accepts a price by itself. A confirmation the change does not need is answered with `confirmation_not_needed: true` and `quote_changed: false`. Local package: 370 tools.

Hosted connector: unchanged (it does not offer the plan-change tools). See [CHANGELOG](../CHANGELOG.md).

## Required release checks

- `npm ci`, `npm test` (Node 20 and 22) and `npm run docs:tools:check` pass on the exact commit.
- `python3 scripts/release.py build --component mcp` passes, including **the packed tarball answers through its bin** (`node_modules/.bin/vpsnet-mcp`, `npx --no-install vpsnet-mcp`, `npx -y --package=<tarball> vpsnet-mcp`, `vpsnet-mcp-http`).
- Publish exactly the tarball that check ran on; compare its sha256 with the registry download afterwards.
