# Changelog

## 0.6.13 connector — prepared, not published

- Clarify that Functions execution follows the connection's granted daily and any reported monthly spending limits; legacy missing or null monthly values never authorize unlimited usage. Update shared skills and review expectations without changing MCP tools, schemas, annotations, scopes or handlers.
- Correct the tool-contract publication reference and distinguish a provider's further-review hold from a specific technical rejection. The MCP server stays 2.4.0; this bundle does not claim a provider approval or backend rollout.

## 0.6.12 connector / 2.4.0 MCP server — 2026-10-18

- Add the service file manager (backend `/account/services/{orderNo}/files/*`): `get_service_file_capabilities`, `list_service_files`, `stat_service_file`, `read_service_file`, `search_service_files`, `get_service_file_operation`, `create_service_directory`, `move_service_file`, `delete_service_files`, `write_service_file` (compare-and-swap), `list_service_file_uploads`, `abort_service_file_upload` and `extract_service_file_archive` (Firecracker). API keys need the explicit `files:read` / `files:manage` grants; the hosted connector maps them to `vm:files:read` / `vm:files:write`.
- Add three stdio-only transfer tools: `upload_service_file` (local path or base64; create, chunked transfer to the API chunk route or the Firecracker data plane, commit, SHA-256 check), `download_service_file` (mint, fetch without the API key, atomic local write) and `get_service_file_download_url`. They are never registered on the hosted connector, whose downloads would be bound to the gateway's address.
- Slow-guest 202 answers are polled inside the file tools; a still-running operation returns its `operationId` and the `get_service_file_operation` follow-up. Unavailable answers carry the API's reason verbatim (Firecracker `agent_update_required` / `node_update_required`, Cloud VPS `feature_disabled` while the VDS file-manager switch is off).
- VPN site-to-site: `create_network_vpn_peer` accepts `kind=site_to_site` with `site.remote_prefixes`, optional `endpoint` / keepalive and `site_down_alert`; new `set_network_vpn_site_options` (hub-and-spoke), `set_network_vpn_site_alert` (office-down e-mail), `set_network_site_route_mode` (DHCP routes or internal router) and `get_network_vpn_peer_history` (24 h raw, 7 d, 30 d, 13 months). `get_network_vpn_gateway` documents live peer statistics including `current_endpoint`. An ordinary device request is unchanged.
- Skills, resources and server instructions describe the file manager and the VPN additions. Tool counts: stdio 311 → 331, directory 235 → 252, orders 242 → 259; no tool is removed or renamed.

## 0.6.11 connector / 2.3.16 MCP server — 2026-10-14

- Add static MCP guidance resources, a canonical catalog of 28 nonlegacy OAuth scopes, and four user-invoked diagnostic prompts without expanding account access.
- Include an explicit empty Smithery URL-publishing configuration schema; OAuth remains required and catalog approval is a separate step.
- Add structured continuation guidance to service and server-purchase results: retain the original order/key, distinguish financial outcome from provisioning, and report pending progress after bounded polling without another purchase or a promised callback.
- Separate running-VM evidence from guest-agent availability and application health, including Firecracker, KVM and Windows cases; polling intervals are not completion estimates.
- Accept a reported monthly Functions limit in connected-account results, including legacy null/omitted values, without inventing a default or changing grants. Backend activation remains a separate release.
- Correct hosted impact hints for snapshot/hostname reconciliation, Functions billing-anchor repair and default-contact replacement. No names, schemas, scopes or handlers change. After deployment, request a publisher rescan where supported and inspect live versus held metadata; this source change does not establish a new approval or client refresh.
- Complete legacy stdio tool titles and missing impact hints with reviewed explicit classifications. Persisted quote/session jobs and side-effecting reads are labelled as writes; pure plan-price calculation remains read-only. This stdio-only completion preserves authored annotations and hosted descriptors; the separate hosted correction above is intentional. Tool names, handlers and permissions are unchanged.
- Pin emitted tool contracts and an independently reviewed impact policy in CI. Intentional snapshot updates require an explicit review reason and cannot run in CI.

## 0.6.10 connector / 2.3.15 MCP server

- Declare the connected-account result schema and expose matching OAuth security metadata without changing granted permissions.
- Add native OpenAI marketplace setup and explicit refresh/update guidance across clients.
- Include canonical skills in Gemini Git installs and four self-contained single-skill exports.
- Add independent release preparation, explicit read-only update checks and a verified published-artifact feed.
- Offer one advisory update check on first use in clients that load the tool and skill instructions, using the installed skill's bundled version reference.
- Document dated distribution routes and review requirements separately from live deployments and catalog approval.

## 0.6.9 connector

- Include requested-scope consent and permission-effect guidance in packaged skills and the plugin README.
- Clarify that Functions execution uses the VPSnet balance, separately from the AI subscription, and that live metadata never grants access.

## 2.3.14 MCP server

- Describe the permissions, included access and billing effects of each advertised OAuth scope using the shared backend catalog.
- Add the optional VPSnet `scope_descriptions` metadata extension, filtered to the active gateway profile; authorization enforcement is unchanged.

## 2.3.13 MCP server

- Poll network and appliance operations using `in_progress` and `next_check_seconds`; treat waiting reasons as progress.
- Include explicit progress hints in networking tool results and preserve port activation follow-up identifiers.

## 0.6.8 connector

- Explain OAuth reconnect after expired or revoked authorization, including local and remote CLI callbacks.
- Clarify that consent presets can grant only requested permissions and additional scopes need a new authorization request.
- Include the reconnect guidance in shared client skills.

## 2.3.12 MCP server

- Provide human-readable annotation titles for every tool across hosted and local connections.
- Expand local input-schema references so guest DNS resolvers and other shared parameters expose their types directly without changing validation.
- Preserve complete networking parameter schemas and their strict validation in hosted connections.
- Link VM file tools to the public API reference.

## 0.6.7 connector / 2.3.11 MCP server

- Mark `browse_restore_files` as non-read-only because it starts asynchronous browse work, while retaining `services:read`; functionality and authorization scopes are unchanged.

## 0.6.6 connector / 2.3.10 MCP server

- Correct native private-network setup for existing servers and polling of network changes.
- Preserve application action retries and expose rollback, inspection and recipe-validation follow-up tools.
- Preserve SSL processing states, certificate failure explanations and DNS record identity.
- Expose guest DNS resolver settings and retrying failed DNS zone publication.
- Add Firecracker backup and Functions history reads, pagination, and partial Function updates.
- Require stable backup request keys and explicit dedicated-server reinstall consent.
- Quote API-key server orders before charging and require approval of the exact total and billing period.

## 2.3.9 MCP server

- Describe VM inspection and file reading as persisted operations with non-destructive write annotations.
- Preserve diagnostic and file-read permissions and read-only result polling.

## 2.3.8 MCP server

- Mark private network DNS replacement as destructive because resolver changes can interrupt guest name resolution.

## 2.3.7 MCP server

- Describe public DNS and registrar effects with accurate tool annotations.
- Clarify nameserver glue creation and replacement while preserving its write permissions.
- Align external-effect hints for application access, notifications, container adoption and Function deletion.

## 2.3.6 MCP server

- Expose individual application and certificate lifecycle actions with dedicated schemas and permissions.
- Correct destructive and external-effect annotations for network, application, Function and DNS tools.
- Preserve existing client calls and the hosted domain-verification endpoint across deployments.

## 0.6.5 connector

- Clarify directory descriptions and Functions permission requirements.
- Keep existing execution safeguards and MCP server behavior.

## 0.6.4 connector / 2.3.5 MCP server

- Use illustrative service identifiers in tool descriptions and examples.
- Simplify public documentation and local configuration exclusions.
- Omit the proxy version from response headers.

## 0.6.3 connector / 2.3.4 MCP server

- Show purchase tools only when both the connected application policy and granted order permissions allow them.
- Preserve management capability discovery and explain the exact permission needed for a requested action.
- Request additional consent through the existing VPSnet connection.

## 0.6.2 connector / 2.3.3 MCP server

- SSH key installation requires VM execution permission.

## 0.6.1 connector / 2.3.2 MCP server

- Add native Gemini CLI and Cursor packaging, alongside the portable plugin and Claude connector.
- Share task skills and one OAuth endpoint across distribution formats.
- Add scoped Kiro setup and registry submission metadata for broader discovery.
- Make release artifacts reproducible and validate their metadata, referenced files and credential boundaries.
- Route managed SSH key deployment through the delegated runtime session.
- Keep directory instructions focused on existing services and reject purchase workflows in bundled client guidance.
- Configure non-production runtime pairing explicitly without bundling internal deployment addresses.

Package preparation does not imply publication or approval in a provider directory.

## 0.5.1 connector / 2.3.1 MCP server

- Manage services and approve purchases through one VPSnet connection.
- Change purchase permissions in the VPSnet panel without reconnecting the AI.
- Purchase tools follow the connected application’s capabilities and the customer’s explicit spending approval.

## 0.5.0 connector / 2.3.0 MCP server

- Optional custom OAuth connection for server and domain orders paid from account balance.
- Separate purchase consent, daily and monthly spending limits, exact-price confirmation and persistent purchase receipts.
- The directory connector continues to manage existing services without purchase tools.

## 0.4.0 connector / 2.2.0 MCP server

- Separate diagnostic, file reading, file editing and administrator permissions.
- Fixed VM inventory, exclusive file creation, bounded log reads and recovery copies.
- Clearer authorization challenges and permissions for recovery operations.
- Directory profile excludes pricing, upgrade and purchasing discovery tools.
- Consistent plugin, marketplace and registry versions; updated Windows provisioning guidance.

The npm CLI version is independent of the connector package version.
