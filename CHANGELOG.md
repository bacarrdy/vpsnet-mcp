# Changelog

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
