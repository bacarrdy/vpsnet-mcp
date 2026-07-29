# vpsnet-mcp

[Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for managing [VPSnet.com](https://www.vpsnet.com) services. Gives AI assistants access to VPS lifecycle operations, managed applications, DNS zones, domain registration and contacts, billing, API keys, SSH-key provisioning, and related account tooling through the VPSNet API.

## Features

- **125+ tools** covering VPSNet service management, managed applications, DNS, domains, billing, API keys, and account operations
- Account & profile management
- VPS lifecycle (start, stop, restart, reinstall OS)
- Plan changes (free upgrades/downgrades; KVM/Firecracker disks cannot shrink)
- Service reverse DNS (rDNS/PTR records)
- Forward DNS zones, records, DNSSEC, templates, import/export, and DDNS tokens
- Domain availability, contacts, register/transfer/renew/restore quotes, and paid confirmations
- Publication-gated managed applications with install, health, events, and typed lifecycle actions
- SSH key management — deploy keys and gain direct server access
- API key management
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

## Managed applications

For software that is present in the VPSnet application catalog, use
`list_application_catalog` and the managed application tools before considering
a generic SSH installation. Catalog applications run as Docker containers in
the customer's server and use the typed installation and lifecycle tools.

Application reads require `applications:read`. Installation and lifecycle
changes require `applications:manage` and an idempotency key; they are not paid
API-key operations. CPU, RAM, and disk figures are sizing recommendations, not
installation gates: a supported application remains selectable during ordering
and installable below those figures. Product, OS, architecture, and runtime
compatibility remain hard requirements. Changes are asynchronous, so verify them
with `get_application_installation` and `get_application_events`. Use
`get_application_health` for a fresh container-health inspection and
`get_application_logs` for recent size-bounded troubleshooting logs. Log
inspections accept at most 500 lines and 131,072 bytes. These two read-scoped
inspections create short-lived inspection jobs, so the API key must permit POST
requests.

Use `configure_application_access` to change how an installed application is
reached. Read the installation first and pass its current revision with a new
idempotency key. `platform_https` allocates an opaque VPSnet hostname with
automatic DNS and HTTPS, `private` has no public listener, `public_http` uses
the server's public IP over HTTP, and `managed_https` uses an eligible
VPSnet-managed DNS zone. `external_https` records an existing customer-managed
HTTPS address; VPSnet does not configure or validate its DNS, TLS certificate,
or reverse proxy.

`list_application_registry_credentials` exposes only Docker Hub/GHCR credential
metadata. Registry token creation and rotation are intentionally not MCP tools:
use the VPSnet panel or direct REST API so a token never enters a model prompt or
tool argument.

An immutable update is available only when `get_application_installation`
returns an `available_actions` entry with `type: "update"`. After explicit user
confirmation, call `manage_application` with `action: "update"`, the exact
advertised `expected_blueprint_version` and `expected_upstream_version`, and a
new idempotency key. Keys are client-global: reuse a key only to replay the
exact same request, never for another service or operation. The
backend selects and freezes the eligible published release; the caller does not
submit an image, tag, or target version. Application-scoped backup and restore
are not exposed in this release; whole-service backup and restore remain
separate service operations.
Uninstall permanently deletes the managed containers, configuration, saved
credentials, and application data; existing server backups are retained. The
`manage_application` call requires `acknowledge_data_loss=true` for uninstall,
and it must only be set after explicit user confirmation.

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
| `VPSNET_API_URL` | No | API base URL (defaults to `https://api.vpsnet.com`) |

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
| `get_service_graphs` | Get performance graphs (CPU, RAM, disk, network) |
| `get_service_history` | Get action history for a service |

### Managed Applications
| Tool | Description |
|------|-------------|
| `list_application_catalog` | List published applications compatible with a service |
| `list_service_applications` | List installed applications and pending checkout selection |
| `get_application_installation` | Get observed state, health, drift, endpoints, and components |
| `get_application_events` | Get bounded customer-safe installation events |
| `get_application_health` | Run and poll a fresh container-health inspection |
| `get_application_logs` | Run and poll a size-bounded recent-log inspection |
| `list_application_registry_credentials` | List non-secret Docker Hub/GHCR credential metadata |
| `install_application` | Queue a confirmed, version-pinned managed installation |
| `configure_application_access` | Queue a confirmed platform-hostname, private, public-IP, managed-HTTPS, or customer-managed external-HTTPS access change |
| `manage_application` | Queue a confirmed lifecycle action, including an eligible immutable update; uninstall also requires explicit data-loss acknowledgement |
| `cancel_application_action` | Cancel the exact latest queued action only while the backend advertises it as cancellable |

### Service Actions
| Tool | Description |
|------|-------------|
| `start_service` | Start a stopped VPS |
| `stop_service` | Stop a running VPS |
| `restart_service` | Restart a VPS |

### Service Settings
| Tool | Description |
|------|-------------|
| `change_hostname` | Change VPS hostname |
| `change_root_password` | Change VPS root password |
| `get_rdns` | Get current rDNS records |
| `change_rdns` | Change reverse DNS (PTR) record |
| `flush_iptables` | Flush iptables rules (useful when locked out) |
| `change_title` | Change service display title |
| `toggle_ipv6` | Enable or disable IPv6 |
| `toggle_extra_settings` | Toggle ppp, fuse, tuntap, or nfs |
| `deploy_ssh_key` | Deploy an SSH key to a VPS |

### OS Reinstall
| Tool | Description |
|------|-------------|
| `get_os_options` | Get available OS templates |
| `reinstall_os` | Reinstall OS (destroys all data) |

### Plan Changes (free)
| Tool | Description |
|------|-------------|
| `get_plan_options` | Get available plans for upgrade/downgrade; KVM/Firecracker targets that would shrink disk are unavailable |
| `get_plan_resources` | Get configurable resources for a plan |
| `calculate_plan_change` | Preview plan change cost and new expiry |
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

### Ordering
| Tool | Description |
|------|-------------|
| `get_order_plans` | Get available plans for new VPS |
| `get_order_options` | Get configurable options for a plan |
| `order_service` | Order a new VPS |

### Backups
| Tool | Description |
|------|-------------|
| `get_backup_status` | Get backup status and configuration |
| `get_backup_history` | Get backup history |
| `create_backup` | Create a new backup (paid) |

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
| `list_api_keys` | List all API keys |
| `create_api_key` | Create a new API key |
| `update_api_key` | Update an existing API key |
| `revoke_api_key` | Revoke (delete) an API key |

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

- Verify the key is correct (starts with `vpsnet_`)
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
