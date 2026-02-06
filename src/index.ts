#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { apiRequest, formatJson } from "./api.js";

const server = new McpServer(
  { name: "vpsnet", version: "1.0.0" },
  {
    instructions: [
      "This MCP server controls VPS (Virtual Private Server) services on VPSnet.com.",
      "It manages VPS servers ONLY — not VDS or Dedicated Servers.",
      "",
      "## Ordering a new VPS",
      "Flow: get_order_plans → get_order_options(plan) → order_service.",
      "Payment object format: { payment: <numeric_id>, successUrl: '', cancelUrl: '' }.",
      "For balance payment use payment ID 1: { payment: 1, successUrl: '', cancelUrl: '' }.",
      "Resources is an array of numeric resource value IDs from get_order_options, e.g. [901, 907].",
      "rootPassword rules: 6-40 chars, alphanumeric only, MUST contain uppercase + lowercase + digit. Example: 'MyPass123'.",
      "sshKey and rootPassword are mutually exclusive — provide one or the other (or neither for auto-generated password).",
      "After placing an order, wait 10-30 seconds before attempting SSH — the VPS needs time to boot and start SSH daemon.",
      "deploy_ssh_key is also async — wait 15-30 seconds after deploying a key before attempting SSH to any VPS (not just new ones).",
      "",
      "## SSH key workflow (IMPORTANT for deploying software to VPS)",
      "",
      "### When the user asks you to deploy, install, or configure something INSIDE a VPS:",
      "You MUST deploy YOUR OWN SSH key first, then connect directly via SSH.",
      "After deploying your key, you can INSTANTLY access the VPS — no extra tools needed.",
      "Most AI environments (Claude Code, Cline, Cursor, Codex) have a built-in terminal/bash tool.",
      "IMPORTANT: Grant FULL permissions/access to the AI tool — restricted/sandbox modes may block npm installs or SSH connections.",
      "Use that terminal to run: ssh -o StrictHostKeyChecking=no root@<vps_ip>",
      "",
      "### Step-by-step SSH key flow:",
      "1. Check if a local SSH public key exists: try reading ~/.ssh/id_rsa.pub, ~/.ssh/id_ed25519.pub, or ~/.ssh/id_ecdsa.pub",
      "2. If NO local key exists, you MUST generate one BEFORE proceeding:",
      "   - If mcp-server-ssh is available: use ssh_keygen(type='ecdsa', bits=256) to generate a key pair, then save the files locally",
      "   - If a terminal/bash is available: run ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519",
      "   - Then read the newly created public key file",
      "3. Upload the public key via create_ssh_key(name, public_key) — name it descriptively e.g. 'claude-code-key'",
      "4. Deploy it to the VPS via deploy_ssh_key(orderNo, ssh_key_id) OR pass sshKey when ordering a new VPS",
      "5. SSH directly using your environment's terminal: ssh -o StrictHostKeyChecking=no root@<vps_ip>",
      "6. Now you can run any commands inside the VPS (apt install, configure services, deploy apps, etc.)",
      "",
      "### Important SSH notes:",
      "- ALWAYS prefer sshKey over rootPassword — it's more secure and enables direct access.",
      "- NEVER use someone else's SSH key — always read from the local machine where you are running.",
      "- Use -o StrictHostKeyChecking=no when connecting to newly created VPS to avoid host key prompts.",
      "- order_service uses 'sshKey' (camelCase) but deploy_ssh_key uses 'ssh_key' (snake_case) — different field names!",
      "- Only fall back to rootPassword if key generation is truly impossible (no ssh-keygen, no mcp-server-ssh, no filesystem write).",
      "",
      "## Pairing with mcp-server-ssh (npm: mcp-server-ssh)",
      "If mcp-server-ssh is also installed, you get powerful SSH tools for direct VPS management:",
      "- ssh_keygen: generate SSH key pairs without needing ssh-keygen binary",
      "- ssh_connect + ssh_exec: execute commands on VPS via pure JS SSH (no native SSH client needed)",
      "- sftp_write/sftp_read: transfer files to/from VPS without scp",
      "Combined workflow: order VPS with vpsnet-mcp → generate key with ssh_keygen → upload with create_ssh_key → connect with ssh_connect → manage with ssh_exec/sftp_*",
      "Combined config for Claude Desktop:",
      '  "vpsnet": { "command": "npx", "args": ["-y", "vpsnet-mcp"], "env": { "VPSNET_API_KEY": "..." } }',
      '  "ssh": { "command": "npx", "args": ["-y", "mcp-server-ssh"] }',
      "",
      "## Plan changes",
      "Plan changes are FREE — remaining time is recalculated (upgrade = shorter expiry, downgrade = longer expiry).",
      "Flow: get_plan_options → get_plan_resources(orderNo, plan) → calculate_plan_change → change_plan.",
      "Resources must be an array of numeric resource value IDs — one ID per resource type (RAM, SSD, CPU, Traffic, Bandwidth).",
      "Get IDs from get_plan_resources: each resource type has a 'values' array, pick one value's 'id' per type.",
      "Use isDefault=1 values for plan defaults. Do NOT pass an empty array — it will fail silently.",
      "IP resources are typically disabled (managed by backend). Admin resources are auto-managed — do not include them.",
      "",
      "## Backups",
      "Creating a backup is a PAID operation. Flow: get_backup_status → create_backup.",
      "get_backup_status returns available period dates (up to 7 days in past) and price.",
      "create_backup requires: period (YYYY-MM-DD date from options), directories (e.g. '/'), and payment object.",
      "",
      "## Async operations",
      "All service actions (start/stop/restart/OS reinstall) are async — they return a noty UUID for tracking progress via WebSocket.",
      "",
      "## Renewal",
      "Payment object for renewal is the same format: { payment: 1, successUrl: '', cancelUrl: '' } for balance.",
      "Flow: get_period_options → renew_service(orderNo, period, payment).",
    ].join("\n"),
  }
);

// Helper to build service settings path
const svc = (orderNo: string, action: string) =>
  `/account/services/${orderNo}/${action}`;

// --- Account ---

server.registerTool(
  "get_account",
  {
    description: "Get account info: user ID, email, balance, VAT rate",
    inputSchema: {},
  },
  async () => {
    const { data } = await apiRequest("GET", "/account/session");
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_profile",
  {
    description: "Get user profile details (name, address, company info)",
    inputSchema: {},
  },
  async () => {
    const { data } = await apiRequest("GET", "/account/profile");
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

// --- Services ---

server.registerTool(
  "list_services",
  {
    description:
      "List all active VPS services with state, plan, IPs, and expiry",
    inputSchema: {},
  },
  async () => {
    const { data } = await apiRequest("GET", "/account/services");
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_service",
  {
    description: "Get detailed info for a service by order number",
    inputSchema: {
      orderNo: z.string().describe("Order number, e.g. VP57068"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/services/${orderNo}`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_service_graphs",
  {
    description: "Get performance graphs (CPU, RAM, disk, network)",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/services/${orderNo}/graphs`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_service_history",
  {
    description: "Get action history for a service",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/services/${orderNo}/history`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

// --- Service Actions ---

server.registerTool(
  "start_service",
  {
    description: "Start a stopped VPS. Returns noty UUID for tracking.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest("POST", svc(orderNo, "start"));
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "stop_service",
  {
    description: "Stop a running VPS. Returns noty UUID for tracking.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest("POST", svc(orderNo, "stop"));
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "restart_service",
  {
    description: "Restart a VPS. Returns noty UUID for tracking.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest("POST", svc(orderNo, "restart"));
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

// --- Service Settings ---

server.registerTool(
  "change_hostname",
  {
    description: "Change VPS hostname",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      hostname: z.string().describe("New hostname"),
    },
  },
  async ({ orderNo, hostname }) => {
    const { data } = await apiRequest(
      "POST",
      svc(orderNo, "change-hostname"),
      { hostname }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "change_root_password",
  {
    description:
      "Change VPS root password. Rules: 6-40 chars, alphanumeric, MUST contain uppercase + lowercase + digit. Example: 'MyPass123'.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      password: z
        .string()
        .describe(
          "New root password. 6-40 chars, alphanumeric, must contain uppercase + lowercase + digit"
        ),
    },
  },
  async ({ orderNo, password }) => {
    const { data } = await apiRequest(
      "POST",
      svc(orderNo, "change-root-password"),
      { password }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_rdns",
  {
    description: "Get current rDNS records for a service",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "GET",
      svc(orderNo, "change-rdns")
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "change_rdns",
  {
    description:
      "Change reverse DNS record for a service IP. PTR value rules: min 3 chars, max 10 dot-separated labels, each label 1-30 chars (alphanumeric + hyphen, no leading/trailing hyphens). Blacklisted words in any label: 'vpsnet', 'speedy'. Use get_rdns first to see available IPs.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      ip: z
        .string()
        .describe(
          "IP address to set rDNS for. Must belong to this service (check get_rdns)"
        ),
      value: z
        .string()
        .describe(
          "New rDNS value (hostname). Valid FQDN, e.g. 'mail.example.com'. Labels: 1-30 chars, alphanumeric+hyphen, no leading/trailing hyphens. Cannot contain 'vpsnet' or 'speedy'"
        ),
    },
  },
  async ({ orderNo, ip, value }) => {
    const { data } = await apiRequest(
      "POST",
      svc(orderNo, "change-rdns"),
      { ip, value }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "flush_iptables",
  {
    description: "Flush iptables rules on VPS (useful when locked out)",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "POST",
      svc(orderNo, "flush-ip-tables")
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "change_title",
  {
    description: "Change service display title",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      title: z.string().describe("New display title"),
    },
  },
  async ({ orderNo, title }) => {
    const { data } = await apiRequest(
      "POST",
      svc(orderNo, "change-title"),
      { title }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "toggle_ipv6",
  {
    description: "Enable or disable IPv6 on VPS",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      value: z.boolean().describe("true to enable, false to disable"),
    },
  },
  async ({ orderNo, value }) => {
    const { data } = await apiRequest(
      "POST",
      svc(orderNo, "ipv6-toggle"),
      { value }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "toggle_extra_settings",
  {
    description:
      "Toggle extra VPS settings: ppp, fuse, tuntap, or nfs",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      name: z
        .enum(["ppp", "fuse", "tuntap", "nfs"])
        .describe("Setting name"),
      value: z.boolean().describe("true to enable, false to disable"),
    },
  },
  async ({ orderNo, name, value }) => {
    const { data } = await apiRequest(
      "POST",
      svc(orderNo, "extra-settings-toggle"),
      { name, value }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "deploy_ssh_key",
  {
    description:
      "Deploy an SSH key to VPS. Returns noty UUID for tracking. ASYNC — wait 15-30 seconds after deploying before attempting SSH. Use list_ssh_keys to get available key IDs. To add your own key first: read ~/.ssh/id_rsa.pub from local machine, then create_ssh_key, then deploy it here.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      ssh_key: z.number().describe("SSH key ID from list_ssh_keys"),
    },
  },
  async ({ orderNo, ssh_key }) => {
    const { data } = await apiRequest(
      "POST",
      svc(orderNo, "change-ssh-key"),
      { ssh_key }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

// --- OS Reinstall ---

server.registerTool(
  "get_os_options",
  {
    description: "Get available OS templates for reinstall",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "GET",
      svc(orderNo, "change-os")
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "reinstall_os",
  {
    description:
      "Reinstall OS on VPS. WARNING: destroys all data! Returns noty UUID. Password rules: 6-40 chars, alphanumeric, must contain uppercase + lowercase + digit.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      osVersion: z
        .number()
        .describe("OS version ID from get_os_options"),
      rootPassword: z
        .string()
        .optional()
        .describe(
          "New root password (auto-generated if omitted). 6-40 chars, alphanumeric, must contain uppercase + lowercase + digit"
        ),
    },
  },
  async ({ orderNo, osVersion, rootPassword }) => {
    const body: Record<string, unknown> = { osVersion };
    if (rootPassword) body.rootPassword = rootPassword;
    const { data } = await apiRequest(
      "POST",
      svc(orderNo, "change-os"),
      body
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

// --- Plan Change (FREE) ---

server.registerTool(
  "get_plan_options",
  {
    description:
      "Get available plans for upgrade/downgrade. Plan changes are FREE.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "GET",
      svc(orderNo, "plans-options")
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_plan_resources",
  {
    description: "Get configurable resources for a specific plan",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      plan: z.number().describe("Plan ID from get_plan_options"),
    },
  },
  async ({ orderNo, plan }) => {
    const { data } = await apiRequest(
      "GET",
      svc(orderNo, `plans-options/${plan}/options`)
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "calculate_plan_change",
  {
    description:
      "Preview plan change cost and new expiry. Plan changes are FREE — recalculates remaining time. Use get_plan_resources first to see available resource IDs for the target plan.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      plan: z.number().describe("Plan ID from get_plan_options"),
      resources: z
        .array(z.number())
        .describe(
          "Array of numeric resource value IDs — one per resource type (RAM, SSD, IP, etc.). Get IDs from get_plan_resources response: each resource type has 'values' array, pick one value's 'id' per type. Use isDefault=1 values for defaults. Do NOT pass empty array."
        ),
    },
  },
  async ({ orderNo, plan, resources }) => {
    const { data } = await apiRequest(
      "POST",
      svc(orderNo, "plans-options/calculate"),
      { plan, resources }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "change_plan",
  {
    description:
      "Change VPS plan (FREE). Recalculates expiry based on price difference. Always call calculate_plan_change first to preview. Use get_plan_resources to get resource IDs for the target plan.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      plan: z.number().describe("Plan ID from get_plan_options"),
      resources: z
        .array(z.number())
        .describe(
          "Array of numeric resource value IDs — one per resource type (RAM, SSD, IP, etc.). Get IDs from get_plan_resources response: each resource type has 'values' array, pick one value's 'id' per type. Use isDefault=1 values for defaults. Do NOT pass empty array."
        ),
    },
  },
  async ({ orderNo, plan, resources }) => {
    const { data } = await apiRequest(
      "POST",
      svc(orderNo, "plans-options"),
      { plan, resources }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

// --- Period & Renewal ---

server.registerTool(
  "get_period_options",
  {
    description: "Get billing period and auto-renewal options",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "GET",
      svc(orderNo, "periods-options")
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "set_auto_renew",
  {
    description: "Enable or disable auto-renewal for a service",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      state: z.boolean().describe("true to enable, false to disable"),
      period: z
        .number()
        .optional()
        .describe("Billing period ID (required when enabling)"),
    },
  },
  async ({ orderNo, state, period }) => {
    const body: Record<string, unknown> = { state };
    if (period !== undefined) body.period = period;
    const { data } = await apiRequest(
      "POST",
      svc(orderNo, "periods-options/auto-renew"),
      body
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "renew_service",
  {
    description:
      "Manually renew a service for a specific period. Payment object: { payment: 1, successUrl: '', cancelUrl: '' } for balance payment.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      period: z.number().describe("Period ID from get_period_options"),
      payment: z
        .object({
          payment: z
            .number()
            .describe("Payment method ID. Use 1 for balance payment"),
          successUrl: z
            .string()
            .describe("Redirect URL on success (use empty string '')"),
          cancelUrl: z
            .string()
            .describe("Redirect URL on cancel (use empty string '')"),
        })
        .passthrough()
        .describe(
          "Payment object. For balance: { payment: 1, successUrl: '', cancelUrl: '' }"
        ),
    },
  },
  async ({ orderNo, period, payment }) => {
    const { data } = await apiRequest(
      "POST",
      svc(orderNo, "periods-options"),
      { period, payment }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

// --- Order New VPS ---

server.registerTool(
  "get_order_plans",
  {
    description: "Get available plans for ordering a new VPS",
    inputSchema: {
      type: z
        .enum(["vps"])
        .default("vps")
        .describe("Service type (vps)"),
    },
  },
  async ({ type }) => {
    const { data } = await apiRequest(
      "GET",
      `/order/configuration/${type}/plans`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_order_options",
  {
    description:
      "Get configurable options (OS, resources, periods) for a plan",
    inputSchema: {
      plan: z.number().describe("Plan ID from get_order_plans"),
    },
  },
  async ({ plan }) => {
    const { data } = await apiRequest(
      "GET",
      `/order/configuration/${plan}/options`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "order_service",
  {
    description: [
      "Order a new VPS. Requires sufficient account balance for balance payment.",
      "Payment object for balance: { payment: 1, successUrl: '', cancelUrl: '' }.",
      "Resources: array of numeric resource value IDs from get_order_options, e.g. [901, 907].",
      "rootPassword: 6-40 chars, alphanumeric, must contain uppercase + lowercase + digit. Example: 'MyPass123'.",
      "sshKey and rootPassword are mutually exclusive — provide one or the other.",
    ].join(" "),
    inputSchema: {
      plan: z.number().describe("Plan ID from get_order_plans"),
      os: z.number().optional().describe("OS version ID from get_order_options"),
      rootPassword: z
        .string()
        .optional()
        .describe(
          "Root password. 6-40 chars, alphanumeric, must contain uppercase + lowercase + digit. Mutually exclusive with sshKey"
        ),
      sshKey: z
        .number()
        .optional()
        .describe(
          "SSH key ID from list_ssh_keys to deploy. Mutually exclusive with rootPassword"
        ),
      period: z.number().optional().describe("Billing period ID from get_order_options"),
      resources: z
        .array(z.number())
        .optional()
        .describe(
          "Array of numeric resource value IDs from get_order_options, e.g. [901, 907, 902]"
        ),
      payment: z
        .object({
          payment: z
            .number()
            .describe("Payment method ID. Use 1 for balance payment"),
          successUrl: z
            .string()
            .describe("Redirect URL on success (use empty string '')"),
          cancelUrl: z
            .string()
            .describe("Redirect URL on cancel (use empty string '')"),
        })
        .passthrough()
        .describe(
          "Payment object. For balance: { payment: 1, successUrl: '', cancelUrl: '' }"
        ),
    },
  },
  async ({ plan, os, rootPassword, sshKey, period, resources, payment }) => {
    const body: Record<string, unknown> = { plan, payment };
    if (os !== undefined) body.os = os;
    if (rootPassword) body.rootPassword = rootPassword;
    if (sshKey !== undefined) body.sshKey = sshKey;
    if (period !== undefined) body.period = period;
    if (resources) body.resources = resources;
    const { data } = await apiRequest(
      "POST",
      "/order/configuration/confirm",
      body
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

// --- Backups ---

server.registerTool(
  "get_backup_status",
  {
    description: "Get backup status and configuration for a service",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "GET",
      svc(orderNo, "backup/status")
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_backup_history",
  {
    description: "Get backup history for a service",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "GET",
      svc(orderNo, "backup/history")
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "create_backup",
  {
    description:
      "Create a new backup. Returns noty UUID for tracking. First call get_backup_status to see available period dates and price. Backup is a paid operation (price shown in get_backup_status).",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      period: z
        .string()
        .describe(
          "Backup date in YYYY-MM-DD format. Must be one of the dates from get_backup_status options (up to 7 days in the past)"
        ),
      directories: z
        .string()
        .describe("Directories to backup, e.g. '/' for full backup"),
      payment: z
        .object({
          payment: z
            .number()
            .describe("Payment method ID. Use 1 for balance payment"),
          successUrl: z
            .string()
            .describe("Redirect URL on success (use empty string '')"),
          cancelUrl: z
            .string()
            .describe("Redirect URL on cancel (use empty string '')"),
        })
        .passthrough()
        .describe(
          "Payment object. For balance: { payment: 1, successUrl: '', cancelUrl: '' }"
        ),
    },
  },
  async ({ orderNo, period, directories, payment }) => {
    const { data } = await apiRequest("POST", svc(orderNo, "backup"), {
      period,
      directories,
      payment,
    });
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

// --- SSH Keys ---

server.registerTool(
  "list_ssh_keys",
  {
    description: "List all SSH keys on the account",
    inputSchema: {},
  },
  async () => {
    const { data } = await apiRequest("GET", "/account/ssh-keys");
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_ssh_key",
  {
    description: "Get a specific SSH key by ID",
    inputSchema: {
      id: z.number().describe("SSH key ID"),
    },
  },
  async ({ id }) => {
    const { data } = await apiRequest("GET", `/account/ssh-keys/${id}`);
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "create_ssh_key",
  {
    description:
      "Add a new SSH key to the account. To deploy software on a VPS, read the local machine's public key from ~/.ssh/id_rsa.pub or ~/.ssh/id_ed25519.pub, upload it here, then deploy_ssh_key to the VPS.",
    inputSchema: {
      name: z.string().describe("Key name/label"),
      public_key: z.string().describe("SSH public key content"),
    },
  },
  async ({ name, public_key }) => {
    const { data } = await apiRequest("POST", "/account/ssh-keys", {
      name,
      public_key,
    });
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "delete_ssh_key",
  {
    description: "Delete an SSH key from the account",
    inputSchema: {
      id: z.number().describe("SSH key ID"),
    },
  },
  async ({ id }) => {
    const { data } = await apiRequest(
      "DELETE",
      `/account/ssh-keys/${id}`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

// --- API Keys ---

server.registerTool(
  "list_api_keys",
  {
    description: "List all API keys on the account",
    inputSchema: {},
  },
  async () => {
    const { data } = await apiRequest("GET", "/account/api-keys");
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "create_api_key",
  {
    description: "Create a new API key",
    inputSchema: {
      name: z.string().describe("Key name"),
      allowed_ips: z
        .string()
        .optional()
        .describe("Comma-separated allowed IPs"),
      expires_at: z
        .string()
        .optional()
        .describe("Expiry date (YYYY-MM-DD)"),
    },
  },
  async ({ name, allowed_ips, expires_at }) => {
    const body: Record<string, unknown> = { name };
    if (allowed_ips) body.allowed_ips = allowed_ips;
    if (expires_at) body.expires_at = expires_at;
    const { data } = await apiRequest("POST", "/account/api-keys", body);
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "update_api_key",
  {
    description: "Update an existing API key",
    inputSchema: {
      id: z.number().describe("API key ID"),
      name: z.string().describe("Key name"),
      allowed_ips: z
        .string()
        .optional()
        .describe("Comma-separated allowed IPs"),
      expires_at: z
        .string()
        .optional()
        .describe("Expiry date (YYYY-MM-DD)"),
    },
  },
  async ({ id, name, allowed_ips, expires_at }) => {
    const body: Record<string, unknown> = { name };
    if (allowed_ips) body.allowed_ips = allowed_ips;
    if (expires_at) body.expires_at = expires_at;
    const { data } = await apiRequest(
      "POST",
      `/account/api-keys/${id}`,
      body
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "revoke_api_key",
  {
    description: "Revoke (delete) an API key",
    inputSchema: {
      id: z.number().describe("API key ID"),
    },
  },
  async ({ id }) => {
    const { data } = await apiRequest(
      "DELETE",
      `/account/api-keys/${id}`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

// --- Billing ---

server.registerTool(
  "list_invoices",
  {
    description: "List invoices with pagination",
    inputSchema: {
      page: z.number().optional().describe("Page number"),
    },
  },
  async ({ page }) => {
    const query = page ? `?page=${page}` : "";
    const { data } = await apiRequest(
      "GET",
      `/account/history/invoices${query}`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_invoice",
  {
    description: "Get a specific invoice by hash",
    inputSchema: {
      hash: z.string().describe("Invoice hash"),
    },
  },
  async ({ hash }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/history/invoices/${hash}`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "list_payments",
  {
    description: "List payment history with pagination",
    inputSchema: {
      page: z.number().optional().describe("Page number"),
    },
  },
  async ({ page }) => {
    const query = page ? `?page=${page}` : "";
    const { data } = await apiRequest(
      "GET",
      `/account/history/payments${query}`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

// --- History ---

server.registerTool(
  "get_login_history",
  {
    description: "Get account login history (IPs, dates)",
    inputSchema: {},
  },
  async () => {
    const { data } = await apiRequest("GET", "/account/history/login");
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_management_history",
  {
    description: "Get management/activity history (service actions, changes)",
    inputSchema: {},
  },
  async () => {
    const { data } = await apiRequest(
      "GET",
      "/account/history/management"
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

// --- Public ---

server.registerTool(
  "get_pricing",
  {
    description: "Get public pricing for a service type",
    inputSchema: {
      type: z
        .enum(["vps", "vds", "ds", "vps_storage"])
        .describe("Service type"),
    },
  },
  async ({ type }) => {
    const { data } = await apiRequest(
      "GET",
      `/public/prices/${type}/plans`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_system_status",
  {
    description: "Get VPSnet.com system status",
    inputSchema: {},
  },
  async () => {
    const { data } = await apiRequest("GET", "/public/status");
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_faq",
  {
    description: "Get frequently asked questions",
    inputSchema: {},
  },
  async () => {
    const { data } = await apiRequest("GET", "/public/faq");
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

// --- Start server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("VPSnet MCP server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
