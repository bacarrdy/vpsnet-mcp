# vpsnet-mcp

[Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for managing [VPSnet.com](https://www.vpsnet.com) services. Gives AI assistants access to VPS lifecycle operations, managed applications, DNS zones, domain registration and contacts, billing, API-key metadata, SSH-key provisioning, and related account tooling through the VPSNet API.

## Features

- **190+ tools** covering VPSNet service management, managed applications, free and paid TLS certificates, Automatic SSL subscriptions, DNS, domains, billing, API keys, and account operations
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

## Tools

### Account
| Tool | Description |
|------|-------------|
| `get_account` | Get account info (user ID, email, balance, VAT rate) |
| `get_profile` | Get user profile details (name, address, company) |

### Services
| Tool | Description |
|------|-------------|
| `list_services` | List all active VPS services |
| `get_service` | Get detailed info for a service |
| `get_service_graphs` | Get one graph series: metric (cpu, ram, ssd, net, io, …) and period (5m … 1y) |
| `get_event` | Read an async action's state by its `event` id or `noty` UUID |
| `wait_for_event` | Poll an async action until completed or error (or a timeout) |
| `get_service_history` | Get action history for a service |

### Managed Applications
| Tool | Description |
|------|-------------|
| `list_application_catalog` | List published applications compatible with a service |
| `list_service_applications` | List installed applications and pending checkout selection |
| `get_application_installation` | Get observed state, health, drift, endpoints, components, resource history, and thresholds |
| `get_application_events` | Get bounded customer-safe installation events |
| `get_application_health` | Run and poll a fresh container-health inspection |
| `get_application_logs` | Run and poll a size-bounded recent-log inspection |
| `list_application_restore_points` | List eligible nightly points for the exact application revision |
| `quote_application_data_restore` | Freeze the exact selective-restore balance charge without payment |
| `restore_application_data` | Pay and queue confirmed selective replacement of declared application data |
| `get_application_data_restore` | Poll one tenant-bound selective data restore |
| `list_application_registry_credentials` | List non-secret private registry credential metadata |
| `validate_application_recipe` | Validate customer Compose against the target worker policy |
| `list_application_recipes` | List customer-owned immutable recipe projects |
| `list_application_recipe_revisions` | List immutable revisions for a customer recipe |
| `create_application_recipe` | Validate and save a new customer recipe without installing it |
| `create_application_recipe_revision` | Validate and save a later immutable customer recipe revision |
| `export_application_recipe` | Export only a customer-owned recipe without secret values |
| `install_application_recipe` | Install an exact validated customer recipe revision |
| `discover_service_containers` | Discover bounded read-only container metadata |
| `prepare_application_compose_adoption` | Prepare and poll a scrubbed candidate for one discovered Compose project |
| `get_application_compose_adoption` | Poll one tenant-bound Compose adoption candidate |
| `confirm_application_compose_adoption` | Confirm the exact source takeover after explicit approval |
| `install_application` | Queue a confirmed, version-pinned managed installation |
| `configure_application_access` | Queue a confirmed platform-hostname, private, public-IP, managed-HTTPS, or customer-managed external-HTTPS access change |
| `configure_application_resource_thresholds` | Replace confirmed non-enforcing application resource thresholds and reached/recovered email preference |
| `manage_application` | Queue a confirmed lifecycle action, including an eligible immutable update; uninstall also requires explicit data-loss acknowledgement |
| `cancel_application_action` | Cancel the exact latest queued action only while the backend advertises it as cancellable |

### Service Actions
| Tool | Description |
|------|-------------|
| `start_service` | Start a stopped VPS |
| `stop_service` | Stop a running VPS |
| `restart_service` | Restart a VPS |
| `console_service` | Request an out-of-band console session for a running VPS |
| `suspend_service` | Suspend a running Cloud VPS |
| `resume_service` | Resume a suspended Cloud VPS |

### Service Settings
| Tool | Description |
|------|-------------|
| `get_hostname` | Get current and automatic service hostname state |
| `change_hostname` | Change VPS hostname |
| `reset_hostname` | Restore the VPSnet-managed automatic hostname |
| `change_root_password` | Change VPS root password |
| `get_rdns` | Get current rDNS records |
| `change_rdns` | Change reverse DNS (PTR) record |
| `clear_rdns` | Clear a PTR override and restore the automatic value |
| `flush_iptables` | Flush iptables rules (useful when locked out) |
| `get_title` | Get the current service display title |
| `change_title` | Change service display title |
| `toggle_ipv6` | Enable or disable IPv6 |
| `toggle_extra_settings` | Toggle ppp, fuse, tuntap, or nfs |
| `deploy_ssh_key` | Deploy an SSH key to a VPS |

### OS Reinstall
| Tool | Description |
|------|-------------|
| `get_os_options` | Get available OS templates |
| `reinstall_os` | Reinstall VPS OS (destroys existing data). Cloud/Firecracker VPS also delete existing snapshots and require explicit `confirmSnapshotDelete` when snapshots exist; those snapshots cannot provide rollback after reinstall. Returns a `noty` acceptance event; follow service history for completion. |

### Plan Changes (free)
| Tool | Description |
|------|-------------|
| `get_plan_options` | Get available plans for upgrade/downgrade; KVM/Firecracker targets that would shrink disk are unavailable |
| `get_plan_resources` | Get configurable resources for a plan |
| `calculate_plan_change` | Preview a plan change: no payment, the remaining value is converted, so an upgrade moves the expiry earlier |
| `change_plan` | Change VPS plan |

### Renewal & Billing
| Tool | Description |
|------|-------------|
| `get_period_options` | Get billing period and auto-renewal options |
| `set_auto_renew` | Enable or disable auto-renewal |
| `renew_service` | Manually renew a service |
| `list_invoices` | List invoices |
| `get_invoice` | Get a specific invoice |
| `list_payments` | List payment history |
| `get_usage_statements` | List itemized metered-usage statements separately from invoices |

### Ordering
| Tool | Description |
|------|-------------|
| `get_order_plans` | Get available plans for an explicitly selected service product |
| `get_order_options` | Get configurable options for a plan |
| `order_service` | Order a new VPS (optionally attached to one of your private networks with `privateNetworkId`) |

### Backups
| Tool | Description |
|------|-------------|
| `get_backup_status` | Get backup status and configuration |
| `get_backup_history` | Get backup history |
| `create_backup` | Create a new backup (paid) |

### Restore
| Tool | Description |
|------|-------------|
| `get_restore_status` | Get retention, restore price, and any restore in progress |
| `list_restore_points` | List whole-service restore points |
| `request_restore` | **Paid and destructive:** restore the whole service disk from a point |
| `list_restore_file_points` | List browsable backup points and whether folder search is available (free) |
| `browse_restore_files` | Queue a listing of one directory inside a backup (free, read-only) |
| `get_restore_file_browse` | Poll a queued backup directory listing (free, read-only) |

### SSH Keys
| Tool | Description |
|------|-------------|
| `list_ssh_keys` | List all SSH keys |
| `get_ssh_key` | Get a specific SSH key |
| `create_ssh_key` | Add a new SSH key |
| `delete_ssh_key` | Delete an SSH key |

### API Keys
| Tool | Description |
|------|-------------|
| `list_api_keys` | Show the API key authenticating this MCP connection |
| `get_api_key` | Get one active key's non-secret metadata |
| `get_api_key_activity` | Get the calling key's bounded retained request activity and recorded totals |
| `get_api_key_inference_usage` | Get the calling inference key's exact paid VPSnet AI usage and cap state |

API-key creation, changes, and revocation require a browser/session login. They
cannot be performed by an MCP connection authenticated with an API key.

### Free TLS certificates
| Tool | Description |
|------|-------------|
| `get_free_certificate_eligibility` | Check account eligibility, quota, key modes, and currently ready public CAs |
| `preflight_free_certificate` | Plan exact names, validation, delivery, custody, and CA without issuing |
| `list_free_certificates` | List owned no-cost certificate requests and lifecycle state |
| `get_free_certificate` | Get one owned request, renewal schedule, and safe timeline |
| `get_free_certificate_instruction` | Read automatic-DNS status or every required external-DNS CNAME |
| `create_free_certificate` | Create one explicitly approved, idempotent no-cost DV request |
| `download_free_certificate` | Retrieve only the issued public leaf and chain, never a private key |
| `manage_free_certificate` | Renew, revoke, recheck, or cancel an eligible request |

For portable API or assistant installation, use `customer_csr` and retain the
private key where the CSR was generated. A managed request can renew unattended,
but MCP cannot export its private key. Issuance is asynchronous and quota-bound:
poll `get_free_certificate`, follow `get_free_certificate_instruction`, and do
not treat a queued request as issued.

### Automatic SSL subscriptions
| Tool | Description |
|------|-------------|
| `list_automatic_ssl_subscriptions` | List customer-owned Automatic SSL subscriptions without exposing ACME credentials |
| `get_automatic_ssl_subscription` | Get one owned subscription, its domain set, renewal state, and readiness |
| `quote_automatic_ssl_subscription` | Quote an exact domain set in EUR without charging |
| `order_automatic_ssl_subscription` | Confirm and pay for the explicitly approved subscription quote |
| `list_automatic_ssl_actions` | List customer-visible subscription and DNS-name changes |
| `refresh_automatic_ssl_subscription` | Schedule an authoritative read-only status refresh |
| `quote_automatic_ssl_domain` | Quote one additional DNS name in EUR without charging |
| `order_automatic_ssl_domain` | Confirm and pay for the explicitly approved DNS-name quote |
| `quote_automatic_ssl_renewal` | Quote the next eligible subscription term in EUR |
| `order_automatic_ssl_renewal` | Prepay the explicitly approved next term from account balance |
| `manage_automatic_ssl_subscription` | Cancel, remove a name, or correct an eligible name idempotently |

Automatic SSL is a portable paid ACME subscription. It works with a compatible
client on VPSnet or another provider; it is not limited to managed
applications. The private ACME server URL and EAB credentials are revealed only
in the two-factor-protected customer portal. They are intentionally not an MCP
tool or API-key response, so an assistant cannot copy them into model context.

### Paid TLS certificates
| Tool | Description |
|------|-------------|
| `list_certificate_catalog` | List published DV/OV/EV products and final customer offers in EUR |
| `get_certificate_catalog_product` | Get one published product, its capabilities, and current offers |
| `list_certificates` | List customer-owned paid certificate orders and issuance state |
| `get_certificate` | Get one owned paid certificate order |
| `quote_certificate` | Quote an exact certificate or renewal without charging |
| `order_certificate` | Confirm and pay for an explicitly approved certificate quote |
| `get_certificate_validation` | Read per-name validation state and an owner-visible pending challenge |
| `download_certificate` | Download the issued public leaf and chain; private keys are never returned |
| `list_certificate_actions` | List durable customer-visible management actions |
| `refresh_certificate` | Schedule a read-only certificate-authority status reconciliation |
| `manage_certificate` | Queue an idempotent cancellation, validation, or same-name reissue action |

Paid certificates are portable account products: customers may install them on
Nginx, Apache, lighttpd, OpenLiteSpeed, HAProxy, Caddy, mail, API, load-balancer,
or other TLS endpoints. They are separate from automatic HTTPS attached to a
VPSnet-managed application. The MCP accepts only a public PKCS#10 CSR; the
private key must remain under customer control and must never enter a tool
argument or model context. Quote responses contain the final customer price in
EUR, and ordering requires explicit approval plus the same idempotency key and
short-lived quote token.

### Domains
| Tool | Description |
|------|-------------|
| `list_domains` | List domains owned by the account |
| `get_domain` | Get one owned domain and its pending action |
| `list_domain_tlds` | List TLDs currently enabled for ordering |
| `check_domain_availability` | Check domain availability without ordering |
| `get_domain_ordering_status` | Get non-secret domain-ordering readiness |
| `set_domain_nameservers` | Queue a nameserver change for an owned domain |
| `list_domain_glue_records` | List same-domain nameserver address records |
| `create_domain_glue_record` | Queue creation or update of a nameserver address record |
| `delete_domain_glue_record` | Queue deletion of a nameserver address record |
| `get_domain_parent_ds` | List parent-zone DNSSEC DS records |
| `add_domain_parent_ds` | Queue addition of parent-zone DS records |
| `delete_domain_parent_ds` | Queue deletion of parent-zone DS records |
| `list_domain_contacts` | List domain contacts owned by the account |
| `create_domain_contact` | Create a domain contact |
| `update_domain_contact` | Update an existing domain contact |
| `delete_domain_contact` | Delete an unused domain contact |
| `quote_domain_register` | Quote a domain registration without charging |
| `confirm_domain_register` | Confirm and pay for an exact registration quote |
| `quote_domain_transfer` | Quote a domain transfer without charging |
| `confirm_domain_transfer` | Confirm and pay for an exact transfer quote |
| `quote_domain_renew` | Quote renewal of an owned domain without charging |
| `confirm_domain_renew` | Confirm and pay for an exact renewal quote |
| `quote_domain_restore` | Quote restoration of a domain in redemption without charging |
| `confirm_domain_restore` | Confirm and pay for an exact restoration quote |
| `set_domain_auto_renew` | Enable or disable automatic renewal for an owned domain |
| `get_registrar_lock` | Get registrar transfer-lock state; changes remain panel-only |

### DNS
| Tool | Description |
|------|-------------|
| `list_service_dns_options` | List owned zones and service addresses available for DNS attachment |
| `attach_service_dns_record` | Point an owned-zone name at one service address |
| `list_dns_zones` | List forward DNS zones owned by the account |
| `create_dns_zone` | Create a native or secondary forward DNS zone |
| `get_dns_zone` | Get one DNS zone and its desired records |
| `get_dns_zone_diagnostics` | Inspect delegation, SOA, DNSSEC, and record hygiene |
| `export_dns_zone` | Export a native zone as a BIND-style zone file |
| `import_dns_zone` | Import bounded BIND-style records into a native zone |
| `list_dns_templates` | List backend-defined DNS record templates |
| `apply_dns_template` | Preview or apply one DNS record template |
| `delete_dns_zone` | Delete a forward DNS zone |
| `verify_dns_zone` | Verify ownership (TXT publicly or at the previous provider) and publish a pending zone |
| `reissue_dns_zone_verification` | Replace a lost ownership TXT value for a pending zone |
| `get_dnssec` | Get DNSSEC state and public DNSKEY/DS material |
| `set_dnssec` | Enable or safely disable DNSSEC signing |
| `upsert_dns_record` | Create or replace a forward DNS desired-state record |
| `update_dns_record` | Update one existing non-system DNS record |
| `delete_dns_record` | Delete one forward DNS desired-state record |
| `get_dns_service_status` | Get managed DNS cluster status and published endpoints |
| `get_dns_zone_history` | Get recent zone and record change history |
| `list_ddns_tokens` | List non-secret DDNS and ACME token metadata |
| `create_ddns_token` | Create a narrow DDNS or ACME updater token |
| `revoke_ddns_token` | Revoke a DDNS or ACME updater token |

### Snapshots
| Tool | Description |
|------|-------------|
| `list_snapshots` | List Cloud VPS disk snapshots and billing policy |
| `create_snapshot` | Create a Cloud VPS disk snapshot |
| `rollback_snapshot` | Destructively roll a Cloud VPS back to a snapshot |
| `delete_snapshot` | Delete a Cloud VPS disk snapshot and stop its keep billing |
| `list_firecracker_snapshots` | List temporary Firecracker VPS snapshots and expiry |
| `create_firecracker_snapshot` | Create a temporary Firecracker VPS snapshot |
| `rollback_firecracker_snapshot` | Destructively roll a Firecracker VPS back to a snapshot |
| `delete_firecracker_snapshot` | Delete a Firecracker VPS snapshot and stop its keep billing |

### Service Rescue
| Tool | Description |
|------|-------------|
| `get_service_rescue` | Get rescue capability and current durable rescue session |
| `enter_service_rescue` | Restart an eligible service into an advertised rescue image |
| `exit_service_rescue` | Restore the exact pre-rescue boot configuration and state |

### Firecracker Functions
| Tool | Description |
|------|-------------|
| `list_functions` | List usage-billed Firecracker Functions |
| `get_function` | Get one function, including integrity state and protected values when readable |
| `create_function` | Create a Firecracker Function |
| `update_function` | Update a function; unreadable protected values require explicit replacement approval |
| `delete_function` | Delete a Firecracker Function |
| `invoke_function` | Invoke a function with metered CPU and memory usage; one stable Idempotency-Key prevents exact retries from running or billing twice |
| `list_function_invocations` | List a function's invocations, status, duration, and cost |
| `get_function_invocation` | Get one invocation's output, logs, and usage cost |

### On-demand servers
| Tool | Description |
|------|-------------|
| `get_temp_vm_options` | Get launch state, profiles, compatibility pricing inputs, and exact storage/network policy |
| `quote_temp_vm` | Inspect the disabled quote operation and its coming-soon response |
| `list_temp_vms` | List the account's on-demand server sessions and current options |
| `create_temp_vm` | Inspect the disabled create operation; no payment or allocation occurs while the product is coming soon |
| `get_temp_vm` | Get one tenant-owned on-demand server session |
| `delete_temp_vm` | Permanently delete an on-demand server after explicit data-loss acknowledgement; no customer refund is initiated |

Customer ordering is disabled while the on-demand server lifecycle is being
validated. Current options disclose that automatic backups and snapshots are
not included and outbound connections to mail-delivery TCP ports 25, 2525,
465, and 587 are restricted. Existing internal test sessions remain available
through list/get/delete for cleanup. Fixed-TTL and prepaid fields in the
disabled compatibility schema are not a launch promise; the flexible duration
and metered-billing contract must be published consistently before ordering is
enabled.

### Guest Agent
| Tool | Description |
|------|-------------|
| `get_guest_agent_status` | Check QEMU guest-agent availability on a Cloud VPS |

### History
| Tool | Description |
|------|-------------|
| `get_login_history` | Get account login history |
| `get_management_history` | Get management/activity history |

### Public
| Tool | Description |
|------|-------------|
| `get_pricing` | Get public pricing |
| `get_system_status` | Get VPSnet.com system status |
| `get_faq` | Get frequently asked questions |

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

| Tool | Description |
|------|-------------|
| `get_network_payment_methods` | Read payment-method metadata without starting payment |
| `get_networking_capabilities` | Read account networking availability, quota, creation options and eligible order-time attachments |
| `get_networking_features` | Read current networking feature gates, DNS options and supported contract extensions. |
| `get_networking_overview` | Read owned networks, quota and operation snapshot |
| `get_networking_topology` | Read the account topology with network-scoped identities |
| `list_networking_operations` | Read recent network operations and operations_has_more |
| `get_networking_operation` | Read an accepted network or port operation |
| `list_private_networks` | List owned private networks, including deletion awaiting verified cleanup. |
| `get_private_network` | Read one owned network including DHCP reservations, DNS change progress, generation and project_id. |
| `create_private_network` | Create a private network intent |
| `delete_private_network` | Request deletion of an empty network |
| `retry_private_network` | Retry the failed current network operation only; preserve its current generation |
| `set_private_network_dns` | Change DHCP DNS servers in place |
| `set_private_network_names` | Replace the complete internal DNS zone label and alias list |
| `list_private_network_ports` | Read owned network ports, their fixed DHCP addresses, generations and attachment states |
| `list_service_private_ports` | Read private ports and order attachment recovery state for one owned service order number. |
| `list_network_attachment_candidates` | Read attachable services and each attachment_mode |
| `attach_private_network_port` | Attach an owned service; omit ipv4 for automatic allocation or pass a fixed usable address |
| `detach_private_network_port` | Detach the owned server port |
| `retry_private_network_port` | Retry the failed current port operation with the PORT generation and any required restart approval. |
| `get_network_vpn_summary` | Read the network's VPN summary, including truthful absence |
| `get_network_routed_egress` | Read this network's NAT/internet access, public address and qualification state. |
| `set_network_routed_egress` | Request the currently supported NAT transition for an owned network; the backend may refuse mode changes |
| `get_security_group_capabilities` | Read security-group availability and whether the network default policy can be changed. |
| `list_network_security_groups` | List groups in the owned project |
| `create_network_security_group` | Create a named allow-rule set |
| `update_network_security_group` | Replace the complete group name and rule list at its expected revision |
| `delete_network_security_group` | Delete an unreferenced customer group at its expected revision; referenced groups are refused. |
| `clone_network_security_group` | Clone an owned group into a new name; use the source group's current revision. |
| `get_network_security_policy` | Read default policy, assigned groups and policy application state |
| `set_network_default_security_policy` | Change accept/deny for servers without custom groups |
| `set_private_port_security_groups` | Replace the port's complete customer-group list |
| `retry_network_security_policy` | Retry the failed network security policy using its current desired state. |
| `retire_network_security_policy` | Retire the policy only after its server ports are gone |
| `get_network_appliance_capabilities` | Read available load balancer providers/tiers, public qualification, VPN capabilities and quota |
| `list_network_appliances` | Read owned load balancers and VPN gateways with one stream cursor. |
| `get_network_appliance_billing` | Read current customer-visible recurring appliance lines and currency. |
| `get_network_appliance_operation` | Poll an accepted appliance operation |
| `list_network_load_balancers` | List private and public load balancers and customer-safe health/qualification state. |
| `get_network_load_balancer` | Read one owned load balancer, listeners, members, generation and health |
| `estimate_network_load_balancer` | Read a technical load balancer estimate for this exact configuration |
| `delete_network_load_balancer` | Request appliance teardown at its current generation; this is not a refund or paid-period cancellation |
| `add_network_load_balancer_member` | Add an attached private server address to the selected listener; backend validates membership in this network. |
| `remove_network_load_balancer_member` | Remove a member from rotation using the load balancer generation. |
| `add_network_load_balancer_listener` | Add a listener and optional initial members using currently offered protocol capabilities |
| `remove_network_load_balancer_listener` | Remove a listener and its members; deleting the last listener is refused. |
| `list_network_vpn_gateways` | List owned VPN gateways, their device peers and safe status |
| `get_network_vpn_gateway` | Read one owned VPN gateway, current generation, device peers, grant candidates and attachment capability. |
| `delete_network_vpn_gateway` | Request teardown of an owned VPN gateway; all devices lose connectivity |
| `attach_network_vpn_gateway` | Attach or move an account VPN to an owned network only when standalone attachment is advertised |
| `detach_network_vpn_gateway` | Detach an account VPN from its network when supported; it keeps its paid period and devices but recreates the gateway |
| `set_vpn_server_access` | Choose accept or groups_only for the VPN's access to attached servers when this capability is available |
| `create_network_vpn_peer` | Add a device with an externally generated one-time PUBLIC reveal key |
| `take_network_vpn_peer_config` | Consume the device's sealed configuration ONCE |
| `revoke_network_vpn_peer` | Revoke one device using the VPN GATEWAY generation |
| `set_network_vpn_peer_grants` | Replace the device's complete reachable-server list when standalone VPN is available |
| `get_network_vpn_egress_options` | Read supported VPN Internet exits and qualification |
| `set_network_vpn_peer_egress` | Set a device's private-only, inherited NAT, or advertised chosen exit policy |
| `list_network_products` | Read current paid products, live tier names, prices and purchase capability; public proxy load balancer 3/5-node offerings must come from this catalog. |
| `list_network_product_periods` | Read owned product periods, renewal availability and lifecycle facts. |
| `quote_network_product` | Create the network product's exact paid quote for COMMON CHECKOUT |
| `quote_account_vpn` | Create an account VPN quote for common checkout when vpn_account_order is advertised |
| `order_network_product` | Confirm a common-checkout purchase from an approved exact quote |
| `get_network_product_order` | Read an owned common-checkout order's payment and fulfilment state |
| `find_network_product_order` | Recover an uncertain checkout by the ORIGINAL quote_id; order=null means no order was found, not proof to use a new payment key. |
| `quote_network_product_renewal` | Quote one next paid month for a network product; no charge |
| `renew_network_product` | Pay the exact previously disclosed renewal from account balance |
| `disable_network_product_auto_renew` | Disable automatic renewal |
| `quote_vpn_period_renewal` | Quote the VPN's next month on its actual paid scope; no charge |
| `renew_vpn_period` | Pay the VPN's approved next-month renewal from account balance using the exact quote and original key. |
| `disable_vpn_auto_renew` | Disable the VPN's automatic renewal; the current paid period remains |
| `list_network_public_addresses` | Read owned paid public addresses, account limits, target support and purchase availability. |
| `get_network_public_address` | Read one owned public address, attachment and paid-period state. |
| `quote_network_public_address` | Quote a new paid public address for common checkout; no charge |
| `attach_public_address_to_network` | Attach or move an already-paid address to an owned network's NAT |
| `attach_public_address_to_server` | Attach or move an owned paid public address to an eligible zero-public-IP server's private port |
| `detach_network_public_address` | Detach an owned public address from its current target; it stays owned for the paid period |
| `quote_public_address_renewal` | Quote the address's next month without charging; use the returned quote and this key for confirmation. |
| `renew_network_public_address` | Pay the approved address renewal from balance with its exact quote ID/token and original key. |
| `disable_public_address_auto_renew` | Disable address automatic renewal; ownership lasts until paid_until |
| `get_network_public_binding` | Read one existing owned public binding's generation, state and assigned address |
| `bind_network_public_ip` | Bind an already reserved floating public binding to an owned private port when supported |
| `move_network_public_ip` | Move a prepared floating public binding to another owned private port; confirm interruption to the old target. |
| `configure_network_public_forwarding` | Configure an existing reserved forwarding binding's TCP/UDP listeners |
| `delete_network_public_binding` | Request deletion of an existing binding using its generation |

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
