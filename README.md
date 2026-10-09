# vpsnet-mcp

[Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for managing [VPSnet.com](https://www.vpsnet.com) services. Gives AI assistants access to VPS lifecycle operations, managed applications, DNS zones, domain registration and contacts, billing, API-key metadata, SSH-key provisioning, and related account tooling through the VPSNet API.

## Features

- **280+ tools** covering VPSNet service management, managed applications, free and paid TLS certificates, Automatic SSL subscriptions, DNS, domains, billing, API keys, and account operations
- Account & profile management
- VPS lifecycle (start, stop, restart, reinstall OS)
- Plan changes (free upgrades/downgrades; KVM/Firecracker disks cannot shrink)
- Service reverse DNS (rDNS/PTR records)
- Forward DNS zones, records, DNSSEC, templates, import/export, and DDNS tokens
- Domain availability, contacts, register/transfer/renew/restore quotes, and paid confirmations
- Publication-gated managed applications with install, health, events, and typed lifecycle actions
- SSH key management — deploy keys and gain direct server access
- API-key metadata inspection (key creation, changes, and revocation remain session-only)
- Backups, billing, invoices
- Ordering new VPS instances
- System status & pricing

## Prerequisites

Before installing, ensure you have:

1. **Node.js 20 or newer**
   - Check: `node --version`
   - Linux/macOS: [nodejs.org](https://nodejs.org) or your package manager
   - Windows: `winget install OpenJS.NodeJS.LTS` or download from [nodejs.org](https://nodejs.org)
   - After installing Node.js, **restart your terminal/editor**

2. **For Claude Code (CLI or VS Code extension) users:**
   - Claude Code CLI installed globally: `npm install -g @anthropic-ai/claude-code`
   - Check: `claude --version`

3. **Active [VPSnet.com](https://www.vpsnet.com) account** with an API key (see [Getting an API key](#getting-an-api-key))

## Credential configuration paths

`VPSNET_API_KEY` is the preferred per-launch credential and takes precedence over files.
For file-based configuration, set `VPSNET_CONFIG_DIR` to the absolute directory
containing `.vpsnet-mcp-key` or `.mcp.json`. The key file takes precedence over
`mcpServers.vpsnet.env.VPSNET_API_KEY` in that JSON file. Alternatively,
`VPSNET_API_KEY_FILE` selects one absolute key-file path; an unreadable or invalid
explicit file fails startup instead of choosing another account.

Without `VPSNET_CONFIG_DIR`, files are read only from the process's launch directory
(`cwd`). This is the same for `node /path/to/vpsnet-mcp/build/index.js` and `npx
vpsnet-mcp`: the package installation/cache directory and parent directories are
never searched. Set the directory explicitly when an editor or MCP client launches
from a different working directory. Keep credential files out of version control.
`VPSNET_API_URL` takes precedence over the URL in that same `.mcp.json`; the existing
trusted-host and HTTPS checks apply to either source.

## Managed applications

Managed Applications, manual SSH, DNS, APIs, and other deployment surfaces are
peer capabilities. Their order in this document and in the tool list is not a
recommendation. Choose the path that best matches the user's requested outcome,
target support, existing state, and explicit constraints. A catalog entry is one
available managed path, not a reason to override a valid manual or custom
deployment request. Catalog applications run as Docker containers in the
customer's server and use typed installation and lifecycle tools.

Application reads require `applications:read`. Installation and lifecycle
changes require `applications:manage` and an idempotency key; ordinary
application lifecycle changes are not paid
API-key operations. CPU, RAM, and disk figures are sizing recommendations, not
installation gates: a supported application remains selectable during ordering
and installable below those figures. Product, OS, architecture, and runtime
compatibility remain hard requirements. Changes are asynchronous, so verify them
with `get_application_installation` and `get_application_events`. Use
`get_application_health` for a fresh container-health inspection and
`get_application_logs` for recent size-bounded troubleshooting logs, optionally
limited to one exact Compose service. Log inspections accept at most 500 lines
and 131,072 bytes. These two read-scoped inspections create short-lived
inspection jobs, so the API key must permit POST requests.

Installation detail includes bounded application and per-container CPU, memory,
network, restart, and storage history when the worker reports it. Containers are
identified only by Compose service and ordinal. Use
`configure_application_resource_thresholds` after explicit confirmation to
replace optional display thresholds. Omitted values clear a threshold; the
thresholds only highlight measurements and do not enforce resources, trigger
server actions, or affect billing. Set `email_enabled` after explicit
confirmation to send one account email when a threshold is reached and one when
it recovers; repeated measurements above the same threshold do not resend.

Use `configure_application_access` to change how an installed application is
reached. Read the installation first and pass its current revision with a new
idempotency key. `platform_https` allocates an opaque VPSnet hostname with
automatic DNS and HTTPS, `private` has no public listener, `public_http` uses
the server's public IP over HTTP, and `managed_https` uses an eligible
VPSnet-managed DNS zone. `external_https` records an existing customer-managed
HTTPS address; VPSnet does not configure or validate its DNS, TLS certificate,
or reverse proxy.

A `managed_https` access may also list `additional_addresses` (up to 4 per
endpoint, 8 per application): other names in the customer's own VPSnet DNS
zones, each with `zone_id`, `name`, `action` and `approve_dns: true`. An empty
`name` or `"@"` is the zone's bare domain, so `example.com` can sit next to
`www.example.com`. `action` is `redirect` (default; a 301 to the main address
that keeps the path and query) or `serve` (opens the same application). Adding
or removing an additional address never changes the main address. The list is
the complete wanted set: an access change that omits `additional_addresses`
removes the saved ones, so pass them again to keep them. Additional
addresses are refused on every other access mode, and VPSnet charges nothing
for them.

`list_application_registry_credentials` exposes only private registry credential
metadata. Registry token creation and rotation are intentionally not MCP tools:
use the VPSnet panel or direct REST API so a token never enters a model prompt or
tool argument. Metadata can identify Docker Hub, GHCR, or an exact custom HTTPS
registry hostname.

Customer recipes are customer-owned Compose definitions, separate from VPSnet
catalog blueprints. They can be validated on the target worker, saved as
immutable revisions, installed through the managed lifecycle, and exported
without secret values. VPSnet catalog recipes are never exportable. Container
discovery is bounded and read-only: it reports customer and managed containers
without returning environment values or mounts, and it never adopts or modifies
detected containers. Controlled adoption is a separate prepare, inspect, and
explicit-confirm flow for an eligible Compose project. The initial takeover is
one-time, but its exact external-volume binding remains signed into later
lifecycle actions. Recovery restarts the source only after the managed
replacement is conclusively contained; uncertain outcomes fail closed.

An immutable update is available only when `get_application_installation`
returns an `available_actions` entry with `type: "update"`. After explicit user
confirmation, call `manage_application` with `action: "update"`, the exact
advertised `expected_blueprint_version` and `expected_upstream_version`, and a
new idempotency key. Keys are client-global: reuse a key only to replay the
exact same request, never for another service or operation. The
backend selects and freezes the eligible published release; the caller does not
submit an image, tag, or target version.

No separate application backup is created. On supported Firecracker services,
`list_application_restore_points` returns opaque application-consistent nightly
whole-VM points for the exact current installation revision.
Viewing points is free, but API keys require `applications:manage`, paid
operations enabled, `applications:restore` paid scope, and full access because
the response includes the account balance.
`quote_application_data_restore` freezes the exact
charge without debiting the account. `restore_application_data` requires the
returned quote token, the same idempotency key, and explicit confirmation of
both payment and data replacement. Paid API keys also require
`applications:restore`, paid operations enabled, and daily/monthly spend caps.
It replaces only
worker-derived declared application data, excludes secrets and unrelated
Docker/server data, and requires rollback capacity. Poll
`get_application_data_restore`; `needs_attention` remains locked and must not
be treated as success. These tools never accept or expose PBS credentials,
archive names, devices, or filesystem paths.

Installation list and detail responses carry a per-platform `capabilities`
block — `data_restore`, `console`, `compose_adoption`, `custom_projects` and
`log_service_filter` — plus a separate `access.capabilities.can_configure`
flag. Treat those flags as the authority on what an installation supports
rather than attempting an action and reading the failure.

Uninstall permanently deletes the managed containers, configuration, saved
credentials, and application data; existing server backups are retained. The
`manage_application` call requires `acknowledge_data_loss=true` for uninstall,
and it must only be set after explicit user confirmation.

The MCP surface is task-oriented rather than a one-to-one mirror of every REST
route. Legacy SMS micro-payment and macro-payment callback integrations remain
available through the documented REST API and control panel, but are
intentionally not exposed as MCP tools. Public pre-login order and domain-search
routes likewise have authenticated MCP equivalents where an account operation
needs them.

## TLS certificates and Automatic SSL

Certificate products are not limited to managed applications. Portable DV, OV,
and EV orders can be installed on customer-controlled web servers, proxies,
mail servers, load balancers, APIs, or other TLS-capable systems. Automatic SSL
subscriptions instead connect a compatible ACME client on VPSnet or another
provider and keep short-lived certificates current during the paid term.

Eligible accounts can also request no-cost portable DV certificates through
`get_free_certificate_eligibility` → `preflight_free_certificate` →
`create_free_certificate`. For API or assistant deployment, create a CSR on the
destination and keep its private key there; MCP accepts only the public CSR and
later returns only the public certificate chain. VPSnet-managed keys support
unattended early renewal, but their export remains portal-only behind two-factor
verification. Free certificates, paid certificate files, paid Automatic SSL,
and application Managed HTTPS are separate products and lifecycle surfaces.

Use `list_certificate_catalog` to distinguish `portable_certificate` from
`acme_subscription` offers. Automatic SSL follows
`quote_automatic_ssl_subscription` → `order_automatic_ssl_subscription`, with
the exact unchanged request, quote token, idempotency key, and explicit payment
approval. Read state with `list_automatic_ssl_subscriptions` and
`get_automatic_ssl_subscription`. Additional names use
`quote_automatic_ssl_domain` → `order_automatic_ssl_domain`; the API prevents
paying twice for names already covered by base/www or wildcard/base rules.
During the final 30 days, an eligible next term uses
`quote_automatic_ssl_renewal` → `order_automatic_ssl_renewal` and is prepaid
from account balance only after the exact EUR total is approved. Cancellation,
domain removal, and same-type correction use `manage_automatic_ssl_subscription`;
ambiguous state is reconciled with `refresh_automatic_ssl_subscription`, never
by inventing a second mutation. Private ACME server and EAB credentials stay
in the two-factor-protected customer portal and are intentionally unavailable
to API keys and MCP, so they cannot enter model context.
## Restoring a whole service

`request_restore` is paid and destructive: it charges the restore price from the
account balance and overwrites the **whole** service disk with the backup point,
losing everything written since. It is a confirmation call, not a price
enquiry — the API refuses a body that does not carry an explicit confirmation,
and refuses the charge outright if the price has moved since it was disclosed.

There is no dialog on this surface to collect that confirmation, so the tool
does not manufacture it. `acknowledge_data_replacement` and
`acknowledge_restore_charge` must each be `true`, and are only to be set after
the user has actually approved the disk replacement and the charge — the same
rule as `acknowledge_data_loss` on `manage_application`. Omitting either is a
schema error, so an unattended caller cannot fall through to a charge: nothing
is even quoted.

`expected_total_charged` is the VAT-inclusive `total_charged` you read from
`get_restore_status` and showed the user, passed back **unchanged**. Do not
re-read it just before the call: it is meant to be the figure the customer
agreed to, and a freshly fetched number would agree with whatever the price has
become and defeat the check entirely. If the price has moved, the restore is
refused as `restoreQuoteChanged` with the current total and nothing is charged;
disclose the new figure, get approval again, and retry.

## Browsing inside a backup

Looking inside a backup is free and completely separate from paying to restore
one. `list_restore_file_points`, `browse_restore_files` and
`get_restore_file_browse` only read a backup's directory listing: they never
charge the account, never overwrite the disk, and never put a file back on the
server. Initially supported on Firecracker VPS.

Browsing is asynchronous. `browse_restore_files` returns a browse id in a
pending state; poll `get_restore_file_browse` until `state` is `succeeded`.
Entries exist only in that state — a `failed` browse carries an `errorCode` and
no listing, and must not be presented as an empty directory.

Directories can hold an enormous number of files, so the server selects pages
of 200 or 1,000 entries according to the worker capability. When
`result.nextOffset` is non-null, call again with the same `sourceBrowseId` and
`directoryEntryId` and set `offset` to that cursor. Use `result.pageSize`
rather than assuming 200 when moving backwards. Subdirectories are entered
with the opaque `id` of a
`type: "directory"` entry; filesystem paths are never accepted. Entry types are
`file`, `directory`, `symlink` and `unsupported`.

Folder search (the `filter` argument) matches entry **names** in the one
directory being listed — case-insensitive substring, never a path, never
recursive. It depends on a worker capability that older nodes do not report, so
`list_restore_file_points` returns `searchAvailable`. `browse_restore_files`
checks that flag before sending a filter and **fails with
`serviceFileBrowseSearchUnavailable` when search is unsupported**, rather than
quietly returning an unfiltered listing that would be mistaken for search
results. Plain browsing keeps working on those nodes.

Restoring selected files back onto the server is a paid operation and is
deliberately **not** exposed here; use the VPSnet panel for it.

## SSH access workflow

This MCP server manages your VPS infrastructure through the VPSnet.com API, including SSH key provisioning. Once an SSH key is deployed to a VPS, the AI assistant can connect directly using its environment's terminal (e.g. Claude Code's Bash tool, Cline's terminal).

**Typical flow:**

1. AI reads the local machine's public key (`~/.ssh/id_rsa.pub`)
2. Uploads it to VPSnet.com via `create_ssh_key`
3. Deploys it to a VPS via `deploy_ssh_key` (or passes it when ordering with `order_service`)
4. Connects directly: `ssh root@<vps_ip>`

Most AI coding environments (Claude Code, Cline, Cursor, Codex) have built-in terminal access, so the AI can SSH into your VPS immediately after deploying a key — no extra tools needed.

For environments without native SSH access, pair this with [mcp-server-ssh](https://github.com/bacarrdy/mcp-server-ssh) for direct server connectivity via MCP tools.

**Combined config:**

```json
{
  "mcpServers": {
    "vpsnet": {
      "command": "npx",
      "args": ["-y", "vpsnet-mcp"],
      "env": {
        "VPSNET_API_KEY": "your_api_key_here"
      }
    },
    "ssh": {
      "command": "npx",
      "args": ["-y", "mcp-server-ssh"]
    }
  }
}
```

## Getting started

Choose your environment:

- [Claude Code (CLI)](#claude-code) — Terminal-based AI coding
- [Claude Code for VS Code](#claude-code-for-vs-code-extension) — VS Code extension
- [Claude Desktop](#claude-desktop) — Desktop app
- [VS Code with GitHub Copilot](#vs-code-with-github-copilot) — Copilot agent mode
- [Cline](#cline) / [Cursor](#cursor) / [Windsurf](#windsurf) / [Roo Code](#roo-code) / [Codex](#codex) — Other clients

The standard config works across most MCP clients:

```json
{
  "mcpServers": {
    "vpsnet": {
      "command": "npx",
      "args": ["-y", "vpsnet-mcp"],
      "env": {
        "VPSNET_API_KEY": "your_api_key_here",
        "VPSNET_API_TIMEOUT_MS": "45000"
      }
    }
  }
}
```

<details>
<summary>Claude Code</summary>

```bash
claude mcp add vpsnet -- npx -y vpsnet-mcp
```

Set the environment variable before running:

```bash
export VPSNET_API_KEY="your_api_key_here"
export VPSNET_API_TIMEOUT_MS="45000"
```

</details>

<details>
<summary>Claude Code for VS Code Extension</summary>

> This section is for the **Claude Code VS Code extension**, not GitHub Copilot. If you use VS Code with GitHub Copilot, see the [VS Code with GitHub Copilot](#vs-code-with-github-copilot) section instead.

**Step 1:** Install Claude Code CLI globally (required for the extension):

```bash
npm install -g @anthropic-ai/claude-code
```

**Step 2:** Add the MCP server via CLI:

```bash
claude mcp add vpsnet -- npx -y vpsnet-mcp
```

**Step 3:** Add your API key. Edit `~/.claude.json` (or `C:\Users\<username>\.claude.json` on Windows), find the `vpsnet` server section and add the `env` block:

```json
"vpsnet": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "vpsnet-mcp"],
    "env": {
        "VPSNET_API_KEY": "your_api_key_here",
        "VPSNET_API_URL": "https://api.vpsnet.com"
    }
}
```

**Step 4:** Restart VS Code completely (Ctrl+Shift+P > "Reload Window" or close and reopen).

**Step 5:** Verify by asking Claude: *"Get my VPSnet account info"*

> **Windows users:** Use PowerShell or CMD (not Git Bash) when running `claude mcp add` commands.

> The `code --add-mcp` command does **NOT** work with Claude Code extension — that's for VS Code Copilot only.

</details>

<details>
<summary>Claude Desktop</summary>

Follow the [MCP install guide](https://modelcontextprotocol.io/quickstart/user), use the standard config above.

</details>

<details>
<summary>Cline</summary>

Open Cline MCP settings and add to your `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "vpsnet": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "vpsnet-mcp"],
      "env": {
        "VPSNET_API_KEY": "your_api_key_here"
      },
      "disabled": false
    }
  }
}
```

</details>

<details>
<summary>Codex</summary>

Use the Codex CLI:

```bash
codex mcp add vpsnet --env VPSNET_API_KEY=your_api_key_here -- npx -y vpsnet-mcp
```

Or edit `~/.codex/config.toml`:

```toml
[mcp_servers.vpsnet]
command = "npx"
args = ["-y", "vpsnet-mcp"]

[mcp_servers.vpsnet.env]
VPSNET_API_KEY = "your_api_key_here"
```

**If your system's default Node.js is older than 20** (common with nvm — check with `node --version`), wrap the command so nvm loads the right version:

```bash
codex mcp add vpsnet --env VPSNET_API_KEY=your_api_key_here -- bash -lc 'source ~/.nvm/nvm.sh >/dev/null 2>&1 && nvm use --silent 20 && npx -y vpsnet-mcp'
```

> **Note:** Codex requires network access to install packages via npx. If you run Codex in a restricted sandbox without network, npx installs will fail.

</details>

<details>
<summary>Cursor</summary>

Go to **Cursor Settings** > **MCP** > **Add new MCP Server**. Use command type with the command `npx -y vpsnet-mcp`. Or add manually to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "vpsnet": {
      "command": "npx",
      "args": ["-y", "vpsnet-mcp"],
      "env": {
        "VPSNET_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

</details>

<details>
<summary>Roo Code</summary>

Open Roo Code MCP settings and add to `roo_mcp_settings.json`:

```json
{
  "mcpServers": {
    "vpsnet": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "vpsnet-mcp"],
      "env": {
        "VPSNET_API_KEY": "your_api_key_here"
      },
      "disabled": false
    }
  }
}
```

</details>

<details>
<summary>VS Code with GitHub Copilot</summary>

Install using the VS Code CLI:

```bash
code --add-mcp '{"name":"vpsnet","command":"npx","args":["-y","vpsnet-mcp"],"env":{"VPSNET_API_KEY":"your_api_key_here"}}'
```

Or add to your VS Code MCP config manually using the standard config above.

> This is for **GitHub Copilot** agent mode in VS Code. For the **Claude Code** extension, see the [Claude Code for VS Code Extension](#claude-code-for-vs-code-extension) section.

</details>

<details>
<summary>Windsurf</summary>

Follow the [Windsurf MCP documentation](https://docs.windsurf.com/windsurf/mcp). Use the standard config above.

</details>

## Windows Users

- Use **PowerShell or CMD** (not Git Bash) for `claude mcp add` commands
- Config file location: `C:\Users\<YourUsername>\.claude.json`
- Install Node.js: `winget install OpenJS.NodeJS.LTS` or download from [nodejs.org](https://nodejs.org)
- After installing Node.js, **restart your terminal and VS Code**
- Environment variables in Claude Code extension must be in the `env` object within `.claude.json`, NOT system environment variables

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VPSNET_API_KEY` | Yes | Your VPSnet.com API key |
| `VPSNET_API_URL` | No | API base URL (defaults to `https://api.vpsnet.com`); any `https://*.vpsnet.com` host, e.g. a staging API |
| `VPSNET_API_TIMEOUT_MS` | No | Per-request timeout (default 45000) |

Requests go out from the machine that runs this server, not from your browser. A
host that admits only listed addresses (a staging API does) answers such a
request with an HTML `403` page from its web server; the tool result then says
so (`non_api_response: true`, `http_status: 403`) instead of passing the page on.
Every error result carries `http_status`; a `429` also carries `retry_after`.

## Authentication, scopes and paid operations

Every request is sent with the `X-API-KEY` header (`VPSNET_API_KEY`).

- **Use a management key.** Its access level is `full` (reads and changes) or
  `read` (GET only). An **AI-scoped key** is issued only for VPSnet AI assistant
  inference and is refused on every account route, so no tool here works with one;
  the error result carries `auth_problem` with the reason and the fix.
- **Granular scopes only narrow a key.** A key with an empty scope list keeps
  everything its access level allows; listing scopes (for example `dns:read`,
  `services:manage`) restricts it. `X:manage` includes `X:read`. Networking is the
  exception: `networking:read` / `networking:manage` / `networking:order` are never
  implied by `full` or `read` and must be granted explicitly.
- **Paid operations are a separate gate.** A tool marked `Paid` or `Quote` in the
  tables below needs a `full`-access key, `paid_operations_enabled`, the named paid
  scope (`vps:order`, `vds:order`, `ds:order`, `fc:order`, `domains:order`,
  `domains:renew`, `domains:transfer`, `certificates:order`, `applications:restore`,
  `services:restore`, `fn:invoke`, `networking:order`), configured daily and
  monthly spend caps, and a stable `idempotencyKey` (reuse the same key to replay
  an uncertain attempt, never a new one). Orders run quote, then confirm with the
  returned `quoteToken`; disclose the exact EUR total to the user before confirming.
  Use `list_api_keys` to see your key's scopes, paid scopes, caps and rate limit.
- **Rate limits.** Requests are rate-limited per key (`rate_limit` in
  `list_api_keys`, requests per minute). On HTTP `429` back off and retry after
  `retry_after` seconds instead of retrying immediately.
- API keys can never create, change or revoke API keys, and never receive admin
  access.

## Tools

The tables below are generated: edit `scripts/tool-scopes.json` (or the tool
registration) and run `npm run docs:tools`; `npm test` fails when they drift.

**Scope** is the granular API-key scope the tool needs (`none` = any management
key; `a + b` = both; `a or b` = either, depending on the object). **Paid**:
`Paid: x` spends account balance and needs the paid scope `x` plus the gates
above; `Quote: x` creates a price quote without charging but is gated the same
way; `Paid` alone charges the balance with a `full`-access key and no separate
paid scope; `Needs paid scope: x` is a read that exposes balance or price data;
`Billed while kept` means free for an initial window, then metered; `free` is
everything else.

<!-- tool-reference:start -->

### Account
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `get_account` | Get account info (user ID, email, balance, VAT rate) | none | free |
| `get_profile` | Get user profile details (name, address, company) | `account:read` | free |

### Services
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `list_services` | List all active VPS services | `services:read` | free |
| `get_service` | Get detailed info for a service | `services:read` | free |
| `get_service_graphs` | Get one graph series: metric (cpu, ram, ssd, net, io, …) and period (5m … 1y) | `services:read` | free |
| `get_event` | Read an async action's state by its `event` id or `noty` UUID | `services:read` or `account:read` | free |
| `wait_for_event` | Poll an async action until completed or error (or a timeout) | `services:read` or `account:read` | free |
| `get_service_history` | Get action history for a service | `services:read` | free |

### Managed Applications
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `list_application_catalog` | List published applications compatible with a service | `applications:read` | free |
| `list_service_applications` | List installed applications and pending checkout selection | `applications:read` | free |
| `get_application_installation` | Get observed state, health, drift, endpoints, components, resource history, and thresholds | `applications:read` | free |
| `get_application_events` | Get bounded customer-safe installation events | `applications:read` | free |
| `get_application_health` | Run and poll a fresh container-health inspection | `applications:read` | free |
| `get_application_logs` | Run and poll a size-bounded recent-log inspection | `applications:read` | free |
| `list_application_restore_points` | List eligible nightly points for the exact application revision | `applications:manage` | Needs paid scope: `applications:restore` |
| `quote_application_data_restore` | Freeze the exact selective-restore balance charge without payment | `applications:manage` | Quote: `applications:restore` |
| `restore_application_data` | Pay and queue confirmed selective replacement of declared application data | `applications:manage` | Paid: `applications:restore` |
| `get_application_data_restore` | Poll one tenant-bound selective data restore | `applications:read` | free |
| `list_application_registry_credentials` | List non-secret private registry credential metadata | `applications:read` | free |
| `validate_application_recipe` | Validate customer Compose against the target worker policy | `applications:manage` | free |
| `list_application_recipes` | List customer-owned immutable recipe projects | `applications:read` | free |
| `list_application_recipe_revisions` | List immutable revisions for a customer recipe | `applications:read` | free |
| `create_application_recipe` | Validate and save a new customer recipe without installing it | `applications:manage` | free |
| `create_application_recipe_revision` | Validate and save a later immutable customer recipe revision | `applications:manage` | free |
| `export_application_recipe` | Export only a customer-owned recipe without secret values | `applications:read` | free |
| `install_application_recipe` | Install an exact validated customer recipe revision | `applications:manage` | free |
| `discover_service_containers` | Discover bounded read-only container metadata | `applications:read` | free |
| `prepare_application_compose_adoption` | Prepare and poll a scrubbed candidate for one discovered Compose project | `applications:manage` | free |
| `get_application_compose_adoption` | Poll one tenant-bound Compose adoption candidate | `applications:read` | free |
| `confirm_application_compose_adoption` | Confirm the exact source takeover after explicit approval | `applications:manage` | free |
| `install_application` | Queue a confirmed, version-pinned managed installation | `applications:manage` | free |
| `configure_application_access` | Queue a confirmed platform-hostname, private, public-IP, managed-HTTPS, or customer-managed external-HTTPS access change | `applications:manage` | free |
| `configure_application_resource_thresholds` | Replace confirmed non-enforcing application resource thresholds and reached/recovered email preference | `applications:manage` | free |
| `manage_application` | Queue a confirmed lifecycle action, including an eligible immutable update; uninstall also requires explicit data-loss acknowledgement | `applications:manage` | free |
| `cancel_application_action` | Cancel the exact latest queued action only while the backend advertises it as cancellable | `applications:manage` | free |

### Service Actions
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `start_service` | Start a stopped VPS | `services:manage` | free |
| `stop_service` | Stop a running VPS | `services:manage` | free |
| `restart_service` | Restart a VPS | `services:manage` | free |
| `console_service` | Request an out-of-band console session for a running VPS | `services:manage` | free |
| `suspend_service` | Suspend a running Cloud VPS | `services:manage` | free |
| `resume_service` | Resume a suspended Cloud VPS | `services:manage` | free |

### Service Settings
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `get_hostname` | Get current and automatic service hostname state | `services:read` | free |
| `change_hostname` | Change VPS hostname | `services:manage` | free |
| `reset_hostname` | Restore the VPSnet-managed automatic hostname | `services:manage` | free |
| `change_root_password` | Change VPS root password | `services:manage` | free |
| `get_rdns` | Get current rDNS records | `services:read` | free |
| `change_rdns` | Change reverse DNS (PTR) record | `services:manage` | free |
| `clear_rdns` | Clear a PTR override and restore the automatic value | `services:manage` | free |
| `flush_iptables` | Flush iptables rules (useful when locked out) | `services:manage` | free |
| `get_title` | Get the current service display title | `services:read` | free |
| `change_title` | Change service display title | `services:manage` | free |
| `toggle_ipv6` | Enable or disable IPv6 | `services:manage` | free |
| `toggle_extra_settings` | Toggle ppp, fuse, tuntap, or nfs | `services:manage` | free |
| `deploy_ssh_key` | Deploy an SSH key to a VPS | `services:manage` | free |

### OS Reinstall
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `get_os_options` | Get available OS templates | `services:read` | free |
| `reinstall_os` | Reinstall VPS OS (destroys existing data). Cloud/Firecracker VPS also delete existing snapshots and require explicit `confirmSnapshotDelete` when snapshots exist; those snapshots cannot provide rollback after reinstall. Returns a `noty` acceptance event; follow service history for completion. | `services:manage` | free |

### Plan Changes (free)
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `get_plan_options` | Get available plans for upgrade/downgrade; KVM/Firecracker targets that would shrink disk are unavailable | `services:read` | free |
| `get_plan_resources` | Get configurable resources for a plan | `services:read` | free |
| `calculate_plan_change` | Preview a plan change: no payment, the remaining value is converted, so an upgrade moves the expiry earlier | `services:read` | free |
| `change_plan` | Change VPS plan | `services:manage` | free |

### Renewal & Billing
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `get_period_options` | Get billing period and auto-renewal options | `services:read` | free |
| `set_auto_renew` | Enable or disable auto-renewal | `services:manage` | Paid (future renewals) |
| `renew_service` | Manually renew a service | `services:manage` | Paid |
| `list_invoices` | List invoices | `payments:read` | free |
| `get_invoice` | Get a specific invoice | `payments:read` | free |
| `list_payments` | List payment history | `payments:read` | free |
| `get_usage_statements` | List itemized metered-usage statements separately from invoices | `payments:read` | free |

### Ordering
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `get_order_plans` | Get available plans for an explicitly selected service product | none | free |
| `get_order_options` | Get configurable options for a plan | none | free |
| `order_service` | Order a new VPS (optionally attached to one of your private networks with `privateNetworkId`) | none | Paid: `vps:order`, `vds:order`, `ds:order` or `fc:order` (by product) |

### Backups
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `get_backup_status` | Get backup status and configuration | `services:read` | free |
| `get_backup_history` | Get backup history | `services:read` | free |
| `create_backup` | Create a new backup (paid) | `services:manage` | Paid |

### Restore
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `get_restore_status` | Get retention, restore price, and any restore in progress | `services:read` | Needs paid scope: `services:restore` |
| `list_restore_points` | List whole-service restore points | `services:read` | free |
| `request_restore` | **Paid and destructive:** restore the whole service disk from a point | `services:read` | Paid: `services:restore` |
| `list_restore_file_points` | List browsable backup points and whether folder search is available (free) | `services:read` | free |
| `browse_restore_files` | Queue a listing of one directory inside a backup (free, read-only) | `services:read` | free |
| `get_restore_file_browse` | Poll a queued backup directory listing (free, read-only) | `services:read` | free |

### SSH Keys
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `list_ssh_keys` | List all SSH keys | `account:read` | free |
| `get_ssh_key` | Get a specific SSH key | `account:read` | free |
| `create_ssh_key` | Add a new SSH key | `account:manage` | free |
| `delete_ssh_key` | Delete an SSH key | `account:manage` | free |

### API Keys
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `list_api_keys` | Show the API key authenticating this MCP connection | none | free |
| `get_api_key` | Get one active key's non-secret metadata | none | free |
| `get_api_key_activity` | Get the calling key's bounded retained request activity and recorded totals | none | free |
| `get_api_key_inference_usage` | Get the calling inference key's exact paid VPSnet AI usage and cap state | none | free |

API-key creation, changes, and revocation require a browser/session login. They
cannot be performed by an MCP connection authenticated with an API key.

### Free TLS certificates
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `get_free_certificate_eligibility` | Check account eligibility, quota, key modes, and currently ready public CAs | `certificates:read` | free |
| `preflight_free_certificate` | Plan exact names, validation, delivery, custody, and CA without issuing | `certificates:read` | free |
| `list_free_certificates` | List owned no-cost certificate requests and lifecycle state | `certificates:read` | free |
| `get_free_certificate` | Get one owned request, renewal schedule, and safe timeline | `certificates:read` | free |
| `get_free_certificate_instruction` | Read automatic-DNS status or every required external-DNS CNAME | `certificates:read` | free |
| `create_free_certificate` | Create one explicitly approved, idempotent no-cost DV request | `certificates:manage` | free |
| `download_free_certificate` | Retrieve only the issued public leaf and chain, never a private key | `certificates:read` | free |
| `manage_free_certificate` | Renew, revoke, recheck, or cancel an eligible request | `certificates:manage` | free |

For portable API or assistant installation, use `customer_csr` and retain the
private key where the CSR was generated. A managed request can renew unattended,
but MCP cannot export its private key. Issuance is asynchronous and quota-bound:
poll `get_free_certificate`, follow `get_free_certificate_instruction`, and do
not treat a queued request as issued.

### Automatic SSL subscriptions
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `list_automatic_ssl_subscriptions` | List customer-owned Automatic SSL subscriptions without exposing ACME credentials | `certificates:read` | free |
| `get_automatic_ssl_subscription` | Get one owned subscription, its domain set, renewal state, and readiness | `certificates:read` | free |
| `quote_automatic_ssl_subscription` | Quote an exact domain set in EUR without charging | `certificates:read` | Quote: `certificates:order` |
| `order_automatic_ssl_subscription` | Confirm and pay for the explicitly approved subscription quote | `certificates:read` | Paid: `certificates:order` |
| `list_automatic_ssl_actions` | List customer-visible subscription and DNS-name changes | `certificates:read` | free |
| `refresh_automatic_ssl_subscription` | Schedule an authoritative read-only status refresh | `certificates:manage` | free |
| `quote_automatic_ssl_domain` | Quote one additional DNS name in EUR without charging | `certificates:read` | Quote: `certificates:order` |
| `order_automatic_ssl_domain` | Confirm and pay for the explicitly approved DNS-name quote | `certificates:read` | Paid: `certificates:order` |
| `quote_automatic_ssl_renewal` | Quote the next eligible subscription term in EUR | `certificates:read` | Quote: `certificates:order` |
| `order_automatic_ssl_renewal` | Prepay the explicitly approved next term from account balance | `certificates:read` | Paid: `certificates:order` |
| `manage_automatic_ssl_subscription` | Cancel, remove a name, or correct an eligible name idempotently | `certificates:manage` | free |

Automatic SSL is a portable paid ACME subscription. It works with a compatible
client on VPSnet or another provider; it is not limited to managed
applications. The private ACME server URL and EAB credentials are revealed only
in the two-factor-protected customer portal. They are intentionally not an MCP
tool or API-key response, so an assistant cannot copy them into model context.

### Paid TLS certificates
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `list_certificate_catalog` | List published DV/OV/EV products and final customer offers in EUR | `certificates:read` | free |
| `get_certificate_catalog_product` | Get one published product, its capabilities, and current offers | `certificates:read` | free |
| `list_certificates` | List customer-owned paid certificate orders and issuance state | `certificates:read` | free |
| `get_certificate` | Get one owned paid certificate order | `certificates:read` | free |
| `quote_certificate` | Quote an exact certificate or renewal without charging | `certificates:read` | Quote: `certificates:order` |
| `order_certificate` | Confirm and pay for an explicitly approved certificate quote | `certificates:read` | Paid: `certificates:order` |
| `get_certificate_validation` | Read per-name validation state and an owner-visible pending challenge | `certificates:read` | free |
| `download_certificate` | Download the issued public leaf and chain; private keys are never returned | `certificates:read` | free |
| `list_certificate_actions` | List durable customer-visible management actions | `certificates:read` | free |
| `refresh_certificate` | Schedule a read-only certificate-authority status reconciliation | `certificates:manage` | free |
| `manage_certificate` | Queue an idempotent cancellation, validation, or same-name reissue action | `certificates:manage` | free |

Paid certificates are portable account products: customers may install them on
Nginx, Apache, lighttpd, OpenLiteSpeed, HAProxy, Caddy, mail, API, load-balancer,
or other TLS endpoints. They are separate from automatic HTTPS attached to a
VPSnet-managed application. The MCP accepts only a public PKCS#10 CSR; the
private key must remain under customer control and must never enter a tool
argument or model context. Quote responses contain the final customer price in
EUR, and ordering requires explicit approval plus the same idempotency key and
short-lived quote token.

### Domains
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `list_domains` | List domains owned by the account | `domains:read` | free |
| `get_domain` | Get one owned domain and its pending action | `domains:read` | free |
| `list_domain_tlds` | List TLDs currently enabled for ordering | `domains:read` | free |
| `check_domain_availability` | Check domain availability without ordering | `domains:read` | free |
| `get_domain_ordering_status` | Get non-secret domain-ordering readiness | `domains:read` | free |
| `set_domain_nameservers` | Queue a nameserver change for an owned domain | `domains:manage` | free |
| `list_domain_glue_records` | List same-domain nameserver address records | `domains:read` | free |
| `create_domain_glue_record` | Queue creation or update of a nameserver address record | `domains:manage` | free |
| `delete_domain_glue_record` | Queue deletion of a nameserver address record | `domains:manage` | free |
| `get_domain_parent_ds` | List parent-zone DNSSEC DS records | `domains:read` | free |
| `add_domain_parent_ds` | Queue addition of parent-zone DS records | `domains:manage` | free |
| `delete_domain_parent_ds` | Queue deletion of parent-zone DS records | `domains:manage` | free |
| `list_domain_contacts` | List domain contacts owned by the account | `domains:read` | free |
| `create_domain_contact` | Create a domain contact | `domains:manage` | free |
| `update_domain_contact` | Update an existing domain contact | `domains:manage` | free |
| `delete_domain_contact` | Delete an unused domain contact | `domains:manage` | free |
| `quote_domain_register` | Quote a domain registration without charging | `domains:read` | Quote: `domains:order` |
| `confirm_domain_register` | Confirm and pay for an exact registration quote | `domains:manage` | Paid: `domains:order` |
| `quote_domain_transfer` | Quote a domain transfer without charging | `domains:read` | Quote: `domains:transfer` |
| `confirm_domain_transfer` | Confirm and pay for an exact transfer quote | `domains:manage` | Paid: `domains:transfer` |
| `quote_domain_renew` | Quote renewal of an owned domain without charging | `domains:read` | Quote: `domains:renew` |
| `confirm_domain_renew` | Confirm and pay for an exact renewal quote | `domains:manage` | Paid: `domains:renew` |
| `quote_domain_restore` | Quote restoration of a domain in redemption without charging | `domains:read` | Quote: `domains:renew` |
| `confirm_domain_restore` | Confirm and pay for an exact restoration quote | `domains:manage` | Paid: `domains:renew` |
| `set_domain_auto_renew` | Enable or disable automatic renewal for an owned domain | `domains:manage` | Paid (future renewals) |
| `get_registrar_lock` | Get registrar transfer-lock state; changes remain panel-only | `domains:read` | free |

### DNS
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `list_service_dns_options` | List owned zones and service addresses available for DNS attachment | `dns:read` | free |
| `attach_service_dns_record` | Point an owned-zone name at one service address | `dns:write` | free |
| `list_dns_zones` | List forward DNS zones owned by the account | `dns:read` | free |
| `create_dns_zone` | Create a native or secondary forward DNS zone | `dns:write` | free |
| `get_dns_zone` | Get one DNS zone and its desired records | `dns:read` | free |
| `get_dns_zone_diagnostics` | Inspect delegation, SOA, DNSSEC, and record hygiene | `dns:read` | free |
| `export_dns_zone` | Export a native zone as a BIND-style zone file | `dns:read` | free |
| `import_dns_zone` | Import bounded BIND-style records into a native zone | `dns:write` | free |
| `list_dns_templates` | List backend-defined DNS record templates | `dns:read` | free |
| `apply_dns_template` | Preview or apply one DNS record template | `dns:write` | free |
| `delete_dns_zone` | Delete a forward DNS zone | `dns:write` | free |
| `verify_dns_zone` | Verify ownership (TXT publicly or at the previous provider) and publish a pending zone | `dns:write` | free |
| `reissue_dns_zone_verification` | Replace a lost ownership TXT value for a pending zone | `dns:write` | free |
| `get_dnssec` | Get DNSSEC state and public DNSKEY/DS material | `dns:read` | free |
| `set_dnssec` | Enable or safely disable DNSSEC signing | `dnssec:manage` | free |
| `upsert_dns_record` | Create or replace a forward DNS desired-state record | `dns:write` | free |
| `update_dns_record` | Update one existing non-system DNS record | `dns:write` | free |
| `delete_dns_record` | Delete one forward DNS desired-state record | `dns:write` | free |
| `get_dns_service_status` | Get managed DNS cluster status and published endpoints | `dns:read` | free |
| `get_dns_zone_history` | Get recent zone and record change history | `dns:read` | free |
| `list_ddns_tokens` | List non-secret DDNS and ACME token metadata | `dns:read` | free |
| `create_ddns_token` | Create a narrow DDNS or ACME updater token | `dns:write` | free |
| `revoke_ddns_token` | Revoke a DDNS or ACME updater token | `dns:write` | free |

### Snapshots
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `list_snapshots` | List Cloud VPS disk snapshots and billing policy | `services:read` | free |
| `create_snapshot` | Create a Cloud VPS disk snapshot | `services:manage` | Billed while kept |
| `rollback_snapshot` | Destructively roll a Cloud VPS back to a snapshot | `services:manage` | free |
| `delete_snapshot` | Delete a Cloud VPS disk snapshot and stop its keep billing | `services:manage` | free |
| `list_firecracker_snapshots` | List temporary Firecracker VPS snapshots and expiry | `services:read` | free |
| `create_firecracker_snapshot` | Create a temporary Firecracker VPS snapshot | `services:manage` | Billed while kept |
| `rollback_firecracker_snapshot` | Destructively roll a Firecracker VPS back to a snapshot | `services:manage` | free |
| `delete_firecracker_snapshot` | Delete a Firecracker VPS snapshot and stop its keep billing | `services:manage` | free |

### Service Rescue
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `get_service_rescue` | Get rescue capability and current durable rescue session | `services:read` | free |
| `enter_service_rescue` | Restart an eligible service into an advertised rescue image | `services:rescue` | free |
| `exit_service_rescue` | Restore the exact pre-rescue boot configuration and state | `services:rescue` | free |

### Firecracker Functions
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `list_functions` | List usage-billed Firecracker Functions | `services:read` | free |
| `get_function` | Get one function, including integrity state and protected values when readable | `services:read` | free |
| `create_function` | Create a Firecracker Function | `services:manage` | free |
| `update_function` | Update a function; unreadable protected values require explicit replacement approval | `services:manage` | free |
| `delete_function` | Delete a Firecracker Function | `services:manage` | free |
| `invoke_function` | Invoke a function with metered CPU and memory usage; one stable Idempotency-Key prevents exact retries from running or billing twice | `services:manage` | Paid: `fn:invoke` |
| `list_function_invocations` | List a function's invocations, status, duration, and cost | `services:read` | free |
| `get_function_invocation` | Get one invocation's output, logs, and usage cost | `services:read` | free |

### On-demand servers
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `get_temp_vm_options` | Get launch state, profiles, compatibility pricing inputs, and exact storage/network policy | `services:read` | free |
| `quote_temp_vm` | Inspect the disabled quote operation and its coming-soon response | `services:manage` | Disabled (coming soon) |
| `list_temp_vms` | List the account's on-demand server sessions and current options | `services:read` | free |
| `create_temp_vm` | Inspect the disabled create operation; no payment or allocation occurs while the product is coming soon | `services:manage` | Disabled (coming soon) |
| `get_temp_vm` | Get one tenant-owned on-demand server session | `services:read` | free |
| `delete_temp_vm` | Permanently delete an on-demand server after explicit data-loss acknowledgement; no customer refund is initiated | `services:manage` | free |

Customer ordering is disabled while the on-demand server lifecycle is being
validated. Current options disclose that automatic backups and snapshots are
not included and outbound connections to mail-delivery TCP ports 25, 2525,
465, and 587 are restricted. Existing internal test sessions remain available
through list/get/delete for cleanup. Fixed-TTL and prepaid fields in the
disabled compatibility schema are not a launch promise; the flexible duration
and metered-billing contract must be published consistently before ordering is
enabled.

### Guest Agent
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `get_guest_agent_status` | Check QEMU guest-agent availability on a Cloud VPS | `services:read` | free |

### History
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `get_login_history` | Get account login history | `account:read` | free |
| `get_management_history` | Get management/activity history | `account:read` | free |

### Public
| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `get_pricing` | Get public pricing | none | free |
| `get_system_status` | Get VPSnet.com system status | none | free |
| `get_faq` | Get frequently asked questions | none | free |

### SDN networking

Networking permissions must be granted explicitly: `networking:read` or
`networking:manage`; the ordinary full/read defaults do not include them.
Start with capabilities, then read the exact owned resource and its generation.
The backend enforces tenant ownership, availability and server 2FA locks.
Accepted, paid, and ready are separate states; poll the matching operation or
resource. DNS changes are polled through the network's `settings.dns_change`.

New private/public load balancers, VPNs and public addresses use an explicit
quote → common checkout → order-status flow. Quote tools always send
`prepare_after_payment=true`: no provisioning happens before payment.
Show the quote's exact EUR `gross_amount`, obtain approval, and pass the same
`idempotencyKey`, `quote_id` and `quoteToken` to `order_network_product`.
API keys additionally need full access, enabled paid operations,
`networking:order`, and spend limits. Read `get_network_payment_methods` and
select `system=balance`; non-balance checkout is refused for API keys.
If confirmation is uncertain, recover by the original quote ID and key.
For an SDN order with `status=paid_pending`, `billing_state=captured` and
`reason_code=network_product_ip_inventory_wait`, payment is retained while
public IP inventory is unavailable. Poll `get_network_product_order` with
the same order ID; the backend resumes automatically when inventory returns.
Do not create another order, charge again or submit a manual retry.
`manual_review` or `network_product_stock_reconciliation_required` instead
requires operator review; it does not authorize an automatic retry.

Ordinary VPS orders expose this wait through
`get_service.stateProcess.waitingReason=public_ip_inventory` (also mirrored
in the legacy `stateProccess` field). Poll the same service without reordering.
`stateProcess.attention=true` requires operator attention. A successful
payment or accepted create does not establish that the server is ready.

Public load balancer tiers `alb_proxy_3`/`alb_proxy_5` use request kind
`proxy_lb`; private tier `nlb` uses `private_lb`. Availability and prices come
from the live product catalog. A legacy unpaid appliance-create endpoint is
not an alternative to checkout.

Device configuration pickup is a one-time **management** action, even though
its HTTP method is GET. Generate the reveal key pair outside MCP, submit only
the X25519 public key, save the returned sealed ciphertext, and decrypt it
outside the conversation. Neither private keys nor plaintext WireGuard
configuration are requested or decrypted by these tools. Never automatically
repeat a pickup after an uncertain response.

The current backend has no customer network rename, existing-port fixed-IP
edit, appliance retry, or native site-to-site API in this release. Fixed DHCP
addresses are selected at attach; removing/recreating an attachment requires
separate approval and is not represented as an in-place edit. Legacy unpaid
LB/VPN create routes, legacy stock-before-payment purchases and enabling
automatic renewal via API keys are deliberately not exposed. Existing public
binding management remains available; new public addresses use account
ownership and common checkout. A tool being listed does not enable a backend
feature gate.

| Tool | Description | Scope | Paid |
|------|-------------|-------|------|
| `get_network_payment_methods` | Read payment-method metadata without starting payment | none | free |
| `get_networking_capabilities` | Read account networking availability, quota, creation options and eligible order-time attachments | `networking:read` | free |
| `get_networking_features` | Read current networking feature gates, DNS options and supported contract extensions. | `networking:read` | free |
| `get_networking_overview` | Read owned networks, quota and operation snapshot | `networking:read` | free |
| `get_networking_topology` | Read the account topology with network-scoped identities | `networking:read` | free |
| `list_networking_operations` | Read recent network operations and operations_has_more | `networking:read` | free |
| `get_networking_operation` | Read an accepted network or port operation | `networking:read` | free |
| `list_private_networks` | List owned private networks, including deletion awaiting verified cleanup. | `networking:read` | free |
| `get_private_network` | Read one owned network including DHCP reservations, DNS change progress, generation and project_id. | `networking:read` | free |
| `create_private_network` | Create a private network intent | `networking:manage` | free |
| `delete_private_network` | Request deletion of an empty network | `networking:manage` | free |
| `retry_private_network` | Retry the failed current network operation only; preserve its current generation | `networking:manage` | free |
| `set_private_network_dns` | Change DHCP DNS servers in place | `networking:manage` | free |
| `set_private_network_names` | Replace the complete internal DNS zone label and alias list | `networking:manage` | free |
| `list_private_network_ports` | Read owned network ports, their fixed DHCP addresses, generations and attachment states | `networking:read` | free |
| `list_service_private_ports` | Read private ports and order attachment recovery state for one owned service order number. | `networking:read` | free |
| `list_network_attachment_candidates` | Read attachable services and each attachment_mode | `networking:read` | free |
| `attach_private_network_port` | Attach an owned service; omit ipv4 for automatic allocation or pass a fixed usable address | `networking:manage` | free |
| `detach_private_network_port` | Detach the owned server port | `networking:manage` | free |
| `retry_private_network_port` | Retry the failed current port operation with the PORT generation and any required restart approval. | `networking:manage` | free |
| `get_network_vpn_summary` | Read the network's VPN summary, including truthful absence | `networking:read` | free |
| `get_network_routed_egress` | Read this network's NAT/internet access, public address and qualification state. | `networking:read` | free |
| `set_network_routed_egress` | Request the currently supported NAT transition for an owned network; the backend may refuse mode changes | `networking:manage` | free |
| `get_security_group_capabilities` | Read security-group availability and whether the network default policy can be changed. | `networking:read` | free |
| `list_network_security_groups` | List groups in the owned project | `networking:read` | free |
| `create_network_security_group` | Create a named allow-rule set | `networking:manage` | free |
| `update_network_security_group` | Replace the complete group name and rule list at its expected revision | `networking:manage` | free |
| `delete_network_security_group` | Delete an unreferenced customer group at its expected revision; referenced groups are refused. | `networking:manage` | free |
| `clone_network_security_group` | Clone an owned group into a new name; use the source group's current revision. | `networking:manage` | free |
| `get_network_security_policy` | Read default policy, assigned groups and policy application state | `networking:read` | free |
| `set_network_default_security_policy` | Change accept/deny for servers without custom groups | `networking:manage` | free |
| `set_private_port_security_groups` | Replace the port's complete customer-group list | `networking:manage` | free |
| `retry_network_security_policy` | Retry the failed network security policy using its current desired state. | `networking:manage` | free |
| `retire_network_security_policy` | Retire the policy only after its server ports are gone | `networking:manage` | free |
| `get_network_appliance_capabilities` | Read available load balancer providers/tiers, public qualification, VPN capabilities and quota | `networking:read` | free |
| `list_network_appliances` | Read owned load balancers and VPN gateways with one stream cursor. | `networking:read` | free |
| `get_network_appliance_billing` | Read current customer-visible recurring appliance lines and currency. | `networking:read` | free |
| `get_network_appliance_operation` | Poll an accepted appliance operation | `networking:read` | free |
| `list_network_load_balancers` | List private and public load balancers and customer-safe health/qualification state. | `networking:read` | free |
| `get_network_load_balancer` | Read one owned load balancer, listeners, members, generation and health | `networking:read` | free |
| `estimate_network_load_balancer` | Read a technical load balancer estimate for this exact configuration | `networking:read` | free |
| `delete_network_load_balancer` | Request appliance teardown at its current generation; this is not a refund or paid-period cancellation | `networking:manage` | free |
| `add_network_load_balancer_member` | Add an attached private server address to the selected listener; backend validates membership in this network. | `networking:manage` | free |
| `remove_network_load_balancer_member` | Remove a member from rotation using the load balancer generation. | `networking:manage` | free |
| `add_network_load_balancer_listener` | Add a listener and optional initial members using currently offered protocol capabilities | `networking:manage` | free |
| `remove_network_load_balancer_listener` | Remove a listener and its members; deleting the last listener is refused. | `networking:manage` | free |
| `list_network_vpn_gateways` | List owned VPN gateways, their device peers and safe status | `networking:read` | free |
| `get_network_vpn_gateway` | Read one owned VPN gateway, current generation, device peers, grant candidates and attachment capability. | `networking:read` | free |
| `delete_network_vpn_gateway` | Request teardown of an owned VPN gateway; all devices lose connectivity | `networking:manage` | free |
| `attach_network_vpn_gateway` | Attach or move an account VPN to an owned network only when standalone attachment is advertised | `networking:manage` | free |
| `detach_network_vpn_gateway` | Detach an account VPN from its network when supported; it keeps its paid period and devices but recreates the gateway | `networking:manage` | free |
| `set_vpn_server_access` | Choose accept or groups_only for the VPN's access to attached servers when this capability is available | `networking:manage` | free |
| `create_network_vpn_peer` | Add a device with an externally generated one-time PUBLIC reveal key | `networking:manage` | free |
| `take_network_vpn_peer_config` | Consume the device's sealed configuration ONCE | `networking:manage` | free |
| `revoke_network_vpn_peer` | Revoke one device using the VPN GATEWAY generation | `networking:manage` | free |
| `set_network_vpn_peer_grants` | Replace the device's complete reachable-server list when standalone VPN is available | `networking:manage` | free |
| `get_network_vpn_egress_options` | Read supported VPN Internet exits and qualification | `networking:read` | free |
| `set_network_vpn_peer_egress` | Set a device's private-only, inherited NAT, or advertised chosen exit policy | `networking:manage` | free |
| `list_network_products` | Read current paid products, live tier names, prices and purchase capability; public proxy load balancer 3/5-node offerings must come from this catalog. | `networking:read` | free |
| `list_network_product_periods` | Read owned product periods, renewal availability and lifecycle facts. | `networking:read` | free |
| `quote_network_product` | Create the network product's exact paid quote for COMMON CHECKOUT | `networking:manage` | Quote: `networking:order` |
| `quote_account_vpn` | Create an account VPN quote for common checkout when vpn_account_order is advertised | `networking:manage` | Quote: `networking:order` |
| `order_network_product` | Confirm a common-checkout purchase from an approved exact quote | `networking:manage` | Paid: `networking:order` |
| `get_network_product_order` | Read an owned common-checkout order's payment and fulfilment state | `networking:read` | free |
| `find_network_product_order` | Recover an uncertain checkout by the ORIGINAL quote_id; order=null means no order was found, not proof to use a new payment key. | `networking:read` | free |
| `quote_network_product_renewal` | Quote one next paid month for a network product; no charge | `networking:manage` | Quote: `networking:order` |
| `renew_network_product` | Pay the exact previously disclosed renewal from account balance | `networking:manage` | Paid: `networking:order` |
| `disable_network_product_auto_renew` | Disable automatic renewal | `networking:manage` | free |
| `quote_vpn_period_renewal` | Quote the VPN's next month on its actual paid scope; no charge | `networking:manage` | Quote: `networking:order` |
| `renew_vpn_period` | Pay the VPN's approved next-month renewal from account balance using the exact quote and original key. | `networking:manage` | Paid: `networking:order` |
| `disable_vpn_auto_renew` | Disable the VPN's automatic renewal; the current paid period remains | `networking:manage` | free |
| `list_network_public_addresses` | Read owned paid public addresses, account limits, target support and purchase availability. | `networking:read` | free |
| `get_network_public_address` | Read one owned public address, attachment and paid-period state. | `networking:read` | free |
| `quote_network_public_address` | Quote a new paid public address for common checkout; no charge | `networking:manage` | Quote: `networking:order` |
| `attach_public_address_to_network` | Attach or move an already-paid address to an owned network's NAT | `networking:manage` | free |
| `attach_public_address_to_server` | Attach or move an owned paid public address to an eligible zero-public-IP server's private port | `networking:manage` | free |
| `detach_network_public_address` | Detach an owned public address from its current target; it stays owned for the paid period | `networking:manage` | free |
| `quote_public_address_renewal` | Quote the address's next month without charging; use the returned quote and this key for confirmation. | `networking:manage` | Quote: `networking:order` |
| `renew_network_public_address` | Pay the approved address renewal from balance with its exact quote ID/token and original key. | `networking:manage` | Paid: `networking:order` |
| `disable_public_address_auto_renew` | Disable address automatic renewal; ownership lasts until paid_until | `networking:manage` | free |
| `get_network_public_binding` | Read one existing owned public binding's generation, state and assigned address | `networking:read` | free |
| `bind_network_public_ip` | Bind an already reserved floating public binding to an owned private port when supported | `networking:manage` | free |
| `move_network_public_ip` | Move a prepared floating public binding to another owned private port; confirm interruption to the old target. | `networking:manage` | free |
| `configure_network_public_forwarding` | Configure an existing reserved forwarding binding's TCP/UDP listeners | `networking:manage` | free |
| `delete_network_public_binding` | Request deletion of an existing binding using its generation | `networking:manage` | free |

<!-- tool-reference:end -->

## Worked examples

Each example is a request to your assistant and the tools it calls.

### Order a VPS (quote, then confirm)

> Order the cheapest Cloud VPS with Debian and my SSH key, paid from balance.

1. `get_order_plans` for the product, then `get_order_options` for the chosen plan
   (OS, period, resource IDs) and `list_ssh_keys` for the key ID.
2. `order_service` with `plan`, `os`, `period`, `resources`, `sshKey` (or
   `rootPassword`, not both), `payment: { payment: 1, successUrl: '', cancelUrl: '' }`
   and a stable `idempotencyKey`. With an API key it first requests the server
   quote and then confirms with the returned `quoteToken` in one call, so the key
   needs `vps:order` (or `vds:order`, `ds:order`, `fc:order`) and spend caps.
3. Poll `get_service` for the returned order number; payment accepted is not
   server ready.

### Networking (quote, then order)

> Add a private load balancer to my network and pay from balance.

1. `get_networking_capabilities`, `list_network_products` and
   `get_network_payment_methods` (pick the `system=balance` method).
2. `quote_network_product` with `kind` (`private_lb`, `proxy_lb` or `vpn_gateway`),
   `tier` and an `idempotencyKey`; show the quote's EUR `gross_amount`.
3. After approval, `order_network_product` with the same `idempotencyKey`,
   `quote_id`, `quoteToken`, the balance `payment` and `acknowledge_charge: true`.
   If the result is uncertain, `find_network_product_order` by the original
   `quote_id`, then poll `get_network_product_order`. Never buy a second copy.

### DNS record upsert

> Point www.example.com at 203.0.113.10 with a 5 minute TTL.

1. `list_dns_zones` to find the `zone_id` (needs `dns:read`).
2. `upsert_dns_record` with `zone_id`, `name: "www"`, `type: "A"`,
   `content: "203.0.113.10"`, `ttl: 300` (needs `dns:write`). It creates the
   record or replaces the existing one.
3. `get_dns_zone` to read the desired records back, or `get_dns_zone_history` to
   see the change.

### Order a paid certificate

> Buy a one-year DV certificate for example.com; I generated the CSR myself.

1. `list_certificate_catalog` and `get_certificate_catalog_product` to choose a
   product and read its current EUR offer.
2. `quote_certificate` with `product_id`, `offer_id`, `offer_generation`,
   `common_name` (plus any `alternative_names`), the public PKCS#10 `csr`, the
   owned contact IDs and an `idempotencyKey` (needs `certificates:order`, paid operations and caps).
   Never send a private key.
3. After the user approves the exact total, `order_certificate` with the same
   request, the same `idempotencyKey`, the `quote_token`, the `payment` and
   `acknowledge_exact_quote_and_payment: true`.
4. `get_certificate_validation` (publish the challenge, for example through
   `upsert_dns_record`), then `download_certificate` once it is issued.

## Getting an API key

1. Log in at [vpsnet.com](https://www.vpsnet.com)
2. Go to **Account** > **API Keys**
3. Click **Create API Key**
4. Give it a name and copy the key

The key is shown only once — store it securely.

## Troubleshooting

### MCP tools not appearing in Claude Code VS Code extension

1. Install Claude Code CLI: `npm install -g @anthropic-ai/claude-code`
2. Verify: `claude --version` should show a version number
3. Add server via CLI: `claude mcp add vpsnet -- npx -y vpsnet-mcp`
4. **Completely restart VS Code** (not just reload window)
5. Check `~/.claude.json` for correct configuration

### `claude: command not found`

Install the Claude Code CLI globally:

```bash
npm install -g @anthropic-ai/claude-code
```

Verify your PATH includes npm global packages. On Windows, restart your terminal after installing.

### Environment variables not working

For Claude Code extension, environment variables **must** be in the `env` object within `.claude.json`, NOT system environment variables:

```json
"vpsnet": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "vpsnet-mcp"],
    "env": {
        "VPSNET_API_KEY": "your_actual_key_here"
    }
}
```

### API key errors

This server needs a **management** API key. Every failure below is reported by
the tools with an `auth_problem` object containing the cause and the fix, so
read that rather than guessing from the HTTP status.

Tool failures carry `isError: true` while preserving the API error details and
recovery guidance. Unknown mutation outcomes must be checked before another
attempt. Service order numbers must be copied from `list_services`; ASCII
letters, digits, and hyphens are supported, including multi-order suffixes.
Malformed or oversized URL identifiers are rejected before an API request.

| What you see | What it means | Fix |
|---|---|---|
| `aiScopedApiKeyCannotManageAccount` (403) | The key is an **AI-scoped key**. Those are issued only for VPSnet AI assistant inference and are deliberately refused on the entire account API. Granting scopes cannot change this — the restriction is on the key type. | Create a separate key with scope `full` (or `read` for GET-only use) and use that here. Keep the AI-scoped key for inference. |
| `apiKeyRejected` (401) | The key failed authentication outright. The API returns one identical 401 for every cause, so it is one of: unknown, revoked, expired, malformed, or your source IP is not on the key's IP allowlist. | Check the key is active and copied whole, and that any IP allowlist includes the address this server calls from. |
| `readOnlyApiKeyCannotWrite` (401) | A read-scoped key was used for a write; read keys are limited to GET. | Use a full-scope key, or stay on read-only tools. |
| `apiKeyScopeMissing` (403) | The key authenticated but lacks the granular scope named in `requiredScope`. | Add that scope in Account > API Keys. |
| `apiKeyForbidden` (403) | The endpoint refuses API keys entirely. API keys never grant admin access. | Use the panel with a signed-in session. |

- Verify the key is correct (starts with `vpsnet_` followed by 43 characters)
- Keys are shown only once at creation — if lost, create a new one
- Check that the key hasn't expired (Account > API Keys)

### `deploy_ssh_key` succeeded but SSH still fails

- All VPSnet.com servers use `root` as the SSH username
- Key deployment is async — wait 15-30 seconds after deploying before attempting SSH

### `fetch is not defined` or unexpected errors

This server requires **Node.js 20+**. If your default `node` is older (common with nvm setups), either:

- Set Node 20+ as default: `nvm alias default 20`
- Or use the nvm wrapper shown in the [Codex](#codex) section

## License

[MIT](LICENSE)
