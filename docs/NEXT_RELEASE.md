# MCP server 2.7.3

Not published yet. The connector stays at 1.0.1 (no connector or ZIP change). Publish after the backend release that adds `vpn.site_router_models` and `vpn.recipe_languages` to the capability answer: the tool texts name those fields.

## Release notes

MCP server **2.7.3**:

- Every router the VPN offers can be used: the router vendor, a WireGuard office's router model and the recipe language are checked by VPSnet against the list `get_network_appliance_capabilities` returns, so Cisco ASA (route-based), VyOS and other IKEv2 routers, and recipes in Latvian and Estonian, are no longer refused by the MCP.
- Domain registration and transfer can answer what the registry asks about the holder (`registrant_extra`).
- The AI key usage tool is removed (no API key can read an AI key's usage; it is shown in the VPSnet panel). Local package: 370 tools. Publish on the same day as the panel's API reference that says the MCP has no such tool (panel !440).
- Firecracker snapshots: `create_firecracker_snapshot`, `rollback_firecracker_snapshot` and `delete_firecracker_snapshot` say that while an administrator's move of the server to another node is open they answer 409 `actionInProgress` with `moveInProgress: true` and change nothing; retry after the move (live with backend r100).
- `quote_account_vpn` and the bundled skills describe the VPN as it is sold: its own price; devices on WireGuard or, where offered, the built-in IKEv2 client.

Hosted connector: the same changes reach it when the gateway runs 2.7.3 (registration only; transfer is not offered there). See [CHANGELOG](../CHANGELOG.md).

## Required release checks

- `npm ci`, `npm test` (Node 20 and 22) and `npm run docs:tools:check` pass on the exact commit.
- `python3 scripts/release.py build --component mcp` passes, including **the packed tarball answers through its bin** (`node_modules/.bin/vpsnet-mcp`, `npx --no-install vpsnet-mcp`, `npx -y --package=<tarball> vpsnet-mcp`, `vpsnet-mcp-http`).
- Publish exactly the tarball that check ran on; compare its sha256 with the registry download afterwards.
