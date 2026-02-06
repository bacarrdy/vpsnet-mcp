# vpsnet-mcp

[Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for managing [VPSnet.com](https://www.vpsnet.com) virtual private servers. Gives AI assistants full control over your VPS infrastructure — order servers, manage plans, deploy SSH keys, and directly access your servers via SSH for software installation and configuration.

## Features

- **49 tools** covering the entire VPSnet.com API
- Account & profile management
- VPS lifecycle (start, stop, restart, reinstall OS)
- Plan changes (free upgrades/downgrades)
- DNS (rDNS/PTR records)
- SSH key management — deploy keys and gain direct server access
- API key management
- Backups, billing, invoices
- Ordering new VPS instances
- System status & pricing

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

## Requirements

- Node.js 18 or newer
- A [VPSnet.com](https://www.vpsnet.com) account with an API key

## Getting started

The standard config works across most MCP clients:

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

<details>
<summary>Claude Code</summary>

```bash
claude mcp add vpsnet -- npx -y vpsnet-mcp
```

Set the environment variable before running:

```bash
export VPSNET_API_KEY="your_api_key_here"
```

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
codex mcp add vpsnet npx "vpsnet-mcp"
```

Or edit `~/.codex/config.toml`:

```toml
[mcp_servers.vpsnet]
command = "npx"
args = ["vpsnet-mcp"]
```

Set `VPSNET_API_KEY` in your shell environment before running Codex.

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
<summary>VS Code (Copilot)</summary>

Install using the VS Code CLI:

```bash
code --add-mcp '{"name":"vpsnet","command":"npx","args":["-y","vpsnet-mcp"],"env":{"VPSNET_API_KEY":"your_api_key_here"}}'
```

Or add to your VS Code MCP config manually using the standard config above.

</details>

<details>
<summary>Windsurf</summary>

Follow the [Windsurf MCP documentation](https://docs.windsurf.com/windsurf/mcp). Use the standard config above.

</details>

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
| `get_plan_options` | Get available plans for upgrade/downgrade |
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
4. Set the scope to match your needs and copy the key

The key is shown only once — store it securely.

## License

[MIT](LICENSE)
