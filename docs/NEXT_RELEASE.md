# Prepared connector 0.6.12 / MCP server 2.4.0

Prepared on 2026-10-18 from `df1b6c7` (connector 0.6.11 / MCP 2.3.16, both
published). Version files identify the local candidate 0.6.12 / 2.4.0; the
publication feed remains at the verified 0.6.11 / 2.3.16. No publication, remote
deployment, catalog propagation, authenticated OpenAI rescan or Smithery scan is
implied by these source changes or local test results.

## Integrated changes

Source of truth: vpsnet_backend `268ca39ab958d222df1337e0e3eb7d69c4d3848f`
(`spec/api-description-v1.yml` service-file routes, `spec/appliances-v1.yml` VPN
site routes, `routes.php`).

| Area | Added or changed |
| --- | --- |
| Service files (API key `files:read` / `files:manage`, hosted `vm:files:read` / `vm:files:write`) | 13 tools on both transports: capabilities, list, stat, read, search, operation, mkdir, move, delete, write (CAS), list/abort uploads, extract |
| Service files, stdio only | `upload_service_file`, `download_service_file`, `get_service_file_download_url` |
| VPN (`networking:read` / `networking:manage`) | `get_network_vpn_peer_history`, `set_network_vpn_site_options`, `set_network_vpn_site_alert`, `set_network_site_route_mode`; `create_network_vpn_peer` site-to-site fields; gateway description lists live peer statistics |

## Tool contract changes

| Local fixture profile | Before / after count |
| --- | --- |
| stdio | 311 / 331 |
| directory (`services:read`) | 235 / 252 |
| orders (`services:read orders:read orders:servers orders:domains`) | 242 / 259 |

Changed existing descriptors: `create_network_vpn_peer` (description and three
optional input fields; the device request body is unchanged), `get_network_vpn_gateway`
and `get_network_vpn_summary` (descriptions). No tool is removed or renamed. The
impact policy records the new file tools' effects; snapshots were refreshed with an
explicit review reason.

## Backend and release boundaries

The file manager is gated on the backend (`SERVICE_FILES_ENABLED`, plus
`SERVICE_FILES_VDS_ENABLED` for Cloud VPS and `SERVICE_FILES_FC_ENABLED` plus the
guest agent capability for Firecracker); while off the tools answer
`filesUnavailable` with the reason. VPN site routes answer 503
`vpn_site_routing_unavailable` while `APPLIANCE_VPN_SITE_TO_SITE_ENABLED` is off.
Hosted exposure needs the gateway deployment and directory rescans as separate steps.

## Validation

`npm test`, `npm run docs:tools:check`, `node scripts/tool-contracts.mjs --check`
and `python3 scripts/release.py validate` pass locally; wait for the contract CI
on Node 20 and 22 at the exact commit before publication.
