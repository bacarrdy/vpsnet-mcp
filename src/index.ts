#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isIP } from "node:net";
import { z } from "zod";
import { apiRequest, formatJson } from "./api.js";

const server = new McpServer(
  { name: "vpsnet", version: "1.2.0" },
  {
    instructions: [
      "This MCP server controls VPSnet.com services, including VPS service management, DNS zones, domain registration, domain contacts, API keys, billing, and related paid actions.",
      "Use the tool descriptions and API-key scopes to choose the correct surface; do not assume this server is limited to VPS-only operations.",
      "Auth: every request authenticates with the X-API-KEY header (your VPSNet API key). Requests are rate-limited — on HTTP 429, back off and retry after a short delay rather than hammering the endpoint.",
      "",
      "## Ordering a new VPS",
      "Flow: get_order_plans → get_order_options(plan) → order_service.",
      "Payment object format: { payment: <numeric_id>, successUrl: '', cancelUrl: '' }.",
      "For balance payment use payment ID 1: { payment: 1, successUrl: '', cancelUrl: '' }.",
      "Paid API-key order tools require paid_operations_enabled, the matching paid scope (vps:order/vds:order/ds:order/fc:order), configured daily/monthly spend caps, and an idempotencyKey; order_service performs quote → confirm with a server quoteToken.",
      "Resources is an array of numeric resource value IDs from get_order_options, e.g. [901, 907].",
      "rootPassword rules: 6-40 chars, alphanumeric only, MUST contain uppercase + lowercase + digit. Example: 'MyPass123'.",
      "sshKey and rootPassword are mutually exclusive — provide one or the other (or neither for auto-generated password).",
      "After placing an order, wait 10-30 seconds before attempting SSH — the VPS needs time to boot and start SSH daemon.",
      "deploy_ssh_key is also async — wait 15-30 seconds after deploying a key before attempting SSH to any VPS (not just new ones).",
      "",
      "## Managed applications and manual SSH deployments",
      "For a requested application, call list_application_catalog for the target service first. If the application is listed, use the managed application tools instead of recreating its installation through SSH.",
      "Managed applications are upstream software delivered in containers. VPSnet provides the reviewed blueprint, orchestration, lifecycle controls, and support boundary; VPSnet does not claim authorship of the upstream application.",
      "Managed application reads require applications:read. Install and lifecycle changes require applications:manage plus an idempotencyKey; they are NOT paid API-key operations.",
      "Uninstall permanently deletes the managed containers, configuration, saved credentials, and application data. Existing server backups are retained. Set acknowledge_data_loss=true only after the user explicitly confirms that loss.",
      "install_application and manage_application are asynchronous. A queued response is not proof that the application is healthy; poll get_application_installation and inspect get_application_events.",
      "Update, application backup, and application restore are intentionally unavailable. Do not emulate them through SSH or another generic tool as a managed-catalog operation.",
      "Never repeat application variable values in summaries or approval text. Refer only to variable names, especially for passwords, tokens, and secrets.",
      "Use manual SSH deployment only when the application is absent from the managed catalog or the user explicitly requests a custom installation.",
      "",
      "### When the user asks for a manual or custom deployment INSIDE a VPS:",
      "Deploy YOUR OWN SSH key first, then connect directly via SSH.",
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
      "",
      "## DNS management",
      "DNS tools require granular API key scopes: dns:read for reads, dns:write for writes, and dnssec:manage for DNSSEC state changes.",
      "Zones can be native (records managed in VPSNet) or secondary (AXFR from public primary servers; records and DNSSEC stay read-only here). Secondary zones require TSIG; generate a Base64 secret with openssl rand -base64 32 and configure the same key on the primary.",
      "Zone import/export uses BIND-style zone files for forward DNS desired-state records. Import skips/rejects system-managed reverse/PTR/SOA/DNSSEC wire/apex-NS records; PTR remains in the existing service rDNS flow.",
      "PTR / reverse DNS is NOT managed through DNS zones here. Use change_rdns for service reverse DNS.",
      "To point a domain/hostname at a VPSNet service, prefer list_service_dns_options → attach_service_dns_record (validates the IP belongs to the service and defaults A/AAAA to the service IP). Use upsert_dns_record only for arbitrary record content.",
      "",
      "## Snapshots, restore and Firecracker Functions",
      "VPS product selection: 'firecracker' is the modern VPS (Firecracker microVMs) — fast Linux hosting with VM-level isolation, low overhead, and quick provisioning. It handles real production Linux workloads (websites, APIs, applications, workers, CI/CD, automation, test environments), not just small tasks. Recommend it as the default for most general-purpose Linux VPS requests. 'vds' is Cloud VPS (KVM) with High Availability and replicated Ceph NVMe storage (3x replica) — choose it for stable/production systems that need HA, or when the customer needs Windows Server, BSD, or custom kernel control. 'ds' is a dedicated single-tenant server. 'vps' is a container-based Linux VPS. Snapshot tools: Cloud VPS uses list/create/rollback/delete_snapshot; Firecracker VPS uses the *_firecracker_snapshot tools (temporary: free window, then billed per GB while kept, auto-expire). NOTE: Firecracker Functions is a SEPARATE service with its own tools (create_function/update_function/invoke_function/list_functions) and its own usage-based billing — it is not part of ordering or managing a VPS/Cloud VPS/Dedicated service.",
      "Snapshot-first is a default habit ON SERVICES THAT SUPPORT SNAPSHOTS — only Cloud VPS (vds) and Firecracker VPS have snapshots; Container VPS (vps) and Dedicated (ds) do NOT. Where supported, take a snapshot before any risky, destructive, or automated change (reinstall, rollback, bulk edits, unattended scripts) — it's free for an initial window, so it's cheap insurance you can roll back to. DELETE the snapshot once the change succeeds and you no longer need it — after the free window it is billed per GB while kept (Cloud VPS snapshots do NOT auto-expire), so never leave snapshots lying around. For Container VPS and Dedicated (no snapshots), be extra careful with destructive actions since there is no rollback safety net.",
      "Snapshot rollback is DESTRUCTIVE (disk state after the snapshot is lost) — always confirm with the user first.",
      "Cloud VPS and Firecracker VPS have automatic daily off-node backups. Restoring is PAID: get_restore_status shows the price, list_restore_points shows points, request_restore charges the account balance immediately and overwrites the service disk — confirm point and price with the user first.",
      "Firecracker Functions run code in isolated microVMs and are usage-billed per invocation. create_function needs name, runtime_os_id and code; invoke_function with wait=true returns the result synchronously. Webhook-enabled functions get a public webhook URL for external triggers.",
      "The DNS API rejects PTR, *.in-addr.arpa, *.ip6.arpa, LUA, SOA/DNSSEC wire records, apex NS, and apex DS.",
      "Dynamic DNS updater tokens are narrow credentials for one hostname/pattern inside a verified customer-owned zone. purpose=ddns allows A/AAAA updates; purpose=acme allows TXT only under _acme-challenge for DNS-01. They only operate inside verified customer-owned zones and can be restricted to source IP/CIDR ranges with allow_from.",
      "",
      "## Domain registration",
      "Domain tools cover supported TLDs, availability checks, contacts, VPSNet-priced register/transfer/renewal quotes, and paid confirmations.",
      "Use list_domains to discover owned domain IDs before quote_domain_renew.",
      "Flow: quote_domain_register/quote_domain_transfer/quote_domain_renew/quote_domain_restore → confirm_domain_register/confirm_domain_transfer/confirm_domain_renew/confirm_domain_restore with the returned quoteToken, the same idempotencyKey, and a payment object. The domain action is queued only after VPSNet confirms the payment.",
      "Domain registration, transfer, renewal, restore, and assignment payments are non-refundable once confirmed. Verify spelling, period, contacts, nameservers, and auth code before calling a confirm tool.",
      "Customers choose only the domain and action. VPSNet returns the final price before payment; renew and restore use the price attached to that existing domain. Domain read tools require domains:read; contact writes require domains:manage; paid domain calls require an idempotencyKey and, for API keys, paid_operations_enabled plus domains:order, domains:transfer, or domains:renew with spend caps.",
      "set_domain_nameservers changes delegation for an owned domain asynchronously; nameservers are hostnames only. It does not create same-domain nameserver IP records, DNS records, or PTR/reverse DNS.",
      "Same-domain nameserver IP records are separate host/IP records such as ns1.customer.com -> 203.0.113.10. The hostname must be below the owned domain, and addresses must be public routable IPs. These tools do not change DNS records or PTR/reverse DNS.",
      "Domain parent-DS tools manage DNSSEC DS records in the parent zone for an owned domain. They are separate from DNS zone records and never manage PTR/reverse DNS.",
      "Transfer-away auth/EPP-code reveal is intentionally portal-only with 2FA/PIN step-up. The MCP uses X-API-KEY only and must not request or expose transfer-away credentials.",
      "Use get_domain_ordering_status before paid domain tests to see whether domain search and ordering are currently available.",
    ].join("\n"),
  }
);

// Helper to build service settings path
const svc = (orderNo: string, action: string) =>
  `/account/services/${orderNo}/${action}`;

const idempotencyKeySchema = z.string().min(16).max(190);

const applicationOrderNoSchema = z
  .string()
  .regex(/^[A-Z]{2}[0-9]+$/)
  .describe("Tenant-owned service order number, e.g. VP88146");

const applicationInstallationIdSchema = z
  .string()
  .uuid()
  .describe("Managed application installation UUID");

const applicationSlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,95}$/)
  .describe("Published application slug from list_application_catalog");

const applicationVariablesSchema = z
  .record(
    z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
    z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null()])
  )
  .refine((variables) => Object.keys(variables).length <= 64, {
    message: "At most 64 application variables may be submitted",
  })
  .optional()
  .describe(
    "Configuration values keyed by the public variable names in the catalog. Values are submitted to VPSnet but never returned by this tool."
  );

const applicationActionSchema = z
  .enum(["reconcile", "repair", "restart", "start", "stop", "uninstall"])
  .describe(
    "Supported lifecycle action. update, backup, and restore are intentionally unavailable."
  );

function applicationPath(orderNo: string, suffix: string): string {
  return `/account/services/${encodeURIComponent(orderNo)}/applications/${suffix}`;
}

function safeApplicationMutationResult(status: number, data: unknown): string {
  if (status < 200 || status >= 300 || typeof data !== "object" || data === null) {
    const errorCodes =
      typeof data === "object" && data !== null
        ? Object.entries(data)
            .filter(([, value]) => value === true)
            .map(([key]) => key)
            .filter((key) => /^[A-Za-z][A-Za-z0-9_]{0,100}$/.test(key))
            .slice(0, 20)
        : [];

    return formatJson({
      success: false,
      status,
      error_codes: errorCodes,
    });
  }

  const payload = data as Record<string, unknown>;
  const installation =
    typeof payload.installation === "object" && payload.installation !== null
      ? (payload.installation as Record<string, unknown>)
      : {};
  const action =
    typeof payload.action === "object" && payload.action !== null
      ? (payload.action as Record<string, unknown>)
      : {};

  return formatJson({
    success: payload.success === true,
    replayed: payload.replayed === true,
    installation: {
      id: installation.id,
      state: installation.state,
      application: installation.application,
      release_channel: installation.release_channel,
      upstream_version: installation.upstream_version,
    },
    action: {
      id: action.id,
      type: action.type,
      state: action.state,
    },
  });
}

const nameserverHostnameSchema = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase().replace(/\.$/, ""))
  .refine((value) => !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) && !value.includes(":"), "Nameserver must be a hostname, not an IP address")
  .refine((value) => value.length <= 253 && value.includes("."), "Nameserver must be a fully qualified hostname")
  .refine(
    (value) =>
      value
        .split(".")
        .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)),
    "Nameserver hostname is invalid"
  );

const whoisPrivacySchema = z
  .boolean()
  .optional()
  .describe("Hide public WHOIS contact details where supported. Defaults to the TLD setting.");

const isPublicIp = (value: string): boolean => {
  const version = isIP(value);
  if (version === 4) {
    const octets = value.split(".").map((part) => Number.parseInt(part, 10));
    if (octets.length !== 4 || octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
      return false;
    }
    const [a, b, c] = octets;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (version === 6) {
    const lower = value.toLowerCase();
    return !(
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80") ||
      lower.startsWith("ff") ||
      lower.startsWith("2001:db8")
    );
  }
  return false;
};

const glueHostnameSchema = nameserverHostnameSchema.describe("Nameserver hostname below the owned domain, e.g. ns1.example.com. IP addresses are not accepted as hostnames.");
const gluePublicIpSchema = z
  .string()
  .trim()
  .refine((value) => isIP(value) !== 0, "Nameserver address must be an IPv4 or IPv6 address")
  .refine(isPublicIp, "Nameserver address must be public and routable");

const dnsRecordTypeSchema = z.enum([
  "A",
  "AAAA",
  "ALIAS",
  "CAA",
  "CNAME",
  "DNAME",
  "DS",
  "HINFO",
  "HTTPS",
  "IPSECKEY",
  "LOC",
  "MX",
  "NAPTR",
  "NS",
  "OPENPGPKEY",
  "RP",
  "SMIMEA",
  "SRV",
  "SSHFP",
  "SVCB",
  "TLSA",
  "TXT",
  "URI",
]);

const dnsZoneKindSchema = z.enum(["native", "secondary"]);

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

// --- Managed Applications ---

server.registerTool(
  "list_application_catalog",
  {
    description:
      "List publication-gated upstream applications compatible with one owned VPSnet service. Use this before a generic SSH installation. The response identifies the upstream publisher, container runtime, configuration definitions, and target compatibility. Requires applications:read.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
    },
    annotations: {
      title: "List compatible managed applications",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "GET",
      applicationPath(orderNo, "catalog")
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "list_service_applications",
  {
    description:
      "List managed application installations and any pending checkout selection for one owned service. A queued state is not proof of health. Requires applications:read.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
    },
    annotations: {
      title: "List service applications",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "GET",
      applicationPath(orderNo, "installations")
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_application_installation",
  {
    description:
      "Get customer-safe observed state, health, drift, endpoints, components, and latest action for one owned managed application. Requires applications:read.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      installation_id: applicationInstallationIdSchema,
    },
    annotations: {
      title: "Get managed application state",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orderNo, installation_id }) => {
    const { data } = await apiRequest(
      "GET",
      applicationPath(
        orderNo,
        `installations/${encodeURIComponent(installation_id)}`
      )
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_application_events",
  {
    description:
      "Get the latest customer-safe audit events for one owned managed application. Use this with get_application_installation to verify asynchronous changes. Requires applications:read.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      installation_id: applicationInstallationIdSchema,
    },
    annotations: {
      title: "Get managed application events",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orderNo, installation_id }) => {
    const { data } = await apiRequest(
      "GET",
      applicationPath(
        orderNo,
        `installations/${encodeURIComponent(installation_id)}/events`
      )
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "install_application",
  {
    description:
      "Queue installation of a published upstream application using the VPSnet-managed, version-pinned container blueprint. Confirm the service, application, release channel, and configuration variable NAMES with the user first; never repeat variable values in confirmation text. This is asynchronous and not a paid API-key operation. Requires applications:manage.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      application: applicationSlugSchema,
      release_channel: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,31}$/)
        .default("stable")
        .describe("Published release channel, normally stable"),
      variables: applicationVariablesSchema,
      idempotencyKey: idempotencyKeySchema.describe(
        "Unique key reused only when replaying this exact installation request"
      ),
      confirmed: z
        .literal(true)
        .describe("True only after the user confirmed this installation"),
    },
    annotations: {
      title: "Install managed application",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({
    orderNo,
    application,
    release_channel,
    variables,
    idempotencyKey,
  }) => {
    const { status, data } = await apiRequest(
      "POST",
      applicationPath(orderNo, "installations"),
      {
        application,
        releaseChannel: release_channel,
        variables: variables || {},
      },
      { "Idempotency-Key": idempotencyKey }
    );
    return {
      content: [
        { type: "text", text: safeApplicationMutationResult(status, data) },
      ],
    };
  }
);

server.registerTool(
  "manage_application",
  {
    description:
      "Queue one supported lifecycle action for an owned managed application. Confirm the exact action with the user first. Stop interrupts service. Uninstall permanently deletes the managed containers, configuration, saved credentials, and application data; existing server backups are retained. Uninstall requires acknowledge_data_loss=true after explicit user confirmation. A queued response must be verified with get_application_installation and get_application_events. Update, backup, and restore are intentionally unavailable. Requires applications:manage and is not a paid API-key operation.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      installation_id: applicationInstallationIdSchema,
      action: applicationActionSchema,
      idempotencyKey: idempotencyKeySchema.describe(
        "Unique key reused only when replaying this exact lifecycle request"
      ),
      confirmed: z
        .literal(true)
        .describe("True only after the user confirmed this lifecycle action"),
      acknowledge_data_loss: z
        .literal(true)
        .optional()
        .describe(
          "Required for uninstall only. Set true after the user explicitly confirms permanent deletion of managed configuration, credentials, and application data."
        ),
    },
    annotations: {
      title: "Manage application lifecycle",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  async ({
    orderNo,
    installation_id,
    action,
    idempotencyKey,
    acknowledge_data_loss,
  }) => {
    if (action === "uninstall" && acknowledge_data_loss !== true) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: formatJson({
              success: false,
              error_codes: ["applicationUninstallConfirmationRequired"],
            }),
          },
        ],
      };
    }

    const { status, data } = await apiRequest(
      "POST",
      applicationPath(
        orderNo,
        `installations/${encodeURIComponent(installation_id)}/actions`
      ),
      {
        action,
        acknowledgeDataLoss: acknowledge_data_loss === true,
      },
      { "Idempotency-Key": idempotencyKey }
    );
    return {
      content: [
        { type: "text", text: safeApplicationMutationResult(status, data) },
      ],
    };
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

server.registerTool(
  "console_service",
  {
    description:
      "Open VNC console access to a running VPS. Read-ish: it requests a console session and returns the tracking event ID (a console URL/token is delivered out-of-band). The service must be running.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest("POST", svc(orderNo, "console"));
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "suspend_service",
  {
    description:
      "Suspend a running Cloud VPS (KVM/VDS) service. Changes service state to suspended. Returns a tracking event ID. VDS/Cloud VPS only; the service must be running.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest("POST", svc(orderNo, "suspend"));
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "resume_service",
  {
    description:
      "Resume a suspended Cloud VPS (KVM/VDS) service. Changes service state back to running. Returns a tracking event ID. VDS/Cloud VPS only; the service must be suspended.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest("POST", svc(orderNo, "resume"));
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
      "Change reverse DNS record for a service IP. PTR value rules: min 3 chars, max 10 dot-separated labels, each label 1-30 chars (alphanumeric + hyphen, no leading/trailing hyphens). Reserved system labels are blocked. Use get_rdns first to see available IPs.",
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
          "New rDNS value (hostname). Valid FQDN, e.g. 'mail.example.com'. Labels: 1-30 chars, alphanumeric+hyphen, no leading/trailing hyphens. Reserved system labels are blocked."
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
      "Reinstall OS on VPS. WARNING: destroys all data! If the service supports snapshots (Cloud VPS or Firecracker VPS), take one first — it's free for an initial window, so it's cheap insurance you can roll back to; then DELETE it once the reinstall succeeds, because after the free window it is billed per GB while kept (Cloud VPS snapshots do NOT auto-expire) — never leave snapshots lying around. Container VPS and Dedicated have no snapshots, so there is no rollback safety net — confirm with the user before reinstalling. Returns noty UUID. Password rules: 6-40 chars, alphanumeric, must contain uppercase + lowercase + digit.",
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
    description: "Enable or disable auto-renewal for a service. Note: enabling auto-renewal will automatically charge the account balance at each renewal (creating an invoice) without further confirmation.",
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
      "Manually renew a service for a specific period. COST WARNING: this charges the account balance / creates an invoice immediately, and renewal payments are NON-REFUNDABLE once confirmed. Verify the service and period with the user before calling. Payment object: { payment: 1, successUrl: '', cancelUrl: '' } for balance payment.",
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
    description:
      "Get available plans for ordering a new service. Types: 'firecracker' — the modern VPS (Firecracker microVM): fast Linux hosting with VM-level isolation, low overhead, and quick provisioning; handles real production workloads. Recommended for most Linux VPS orders. 'vds' — Cloud VPS (KVM) with High Availability and replicated Ceph NVMe (3x replica); choose for stable/production systems, or when Windows Server, BSD, or custom kernel control is needed. 'ds' — dedicated single-tenant server. 'vps' — container-based Linux VPS. For a general-purpose Linux VPS, prefer 'firecracker'. (Firecracker Functions is a separate, usage-billed service — see create_function/invoke_function — not a plan you order here.)",
    inputSchema: {
      type: z
        .enum(["vps", "vds", "ds", "firecracker"])
        .default("firecracker")
        .describe("Service type. Prefer 'firecracker' (modern VPS) for general Linux use; 'vds' (Cloud VPS) for HA / Windows / BSD / custom kernels; 'ds' dedicated; 'vps' container-based."),
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
      "API-key orders first call the server quote endpoint, then confirm with the returned quoteToken. The API key must have paid scope/caps enabled.",
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
      idempotencyKey: idempotencyKeySchema.describe(
        "Required for paid API-key orders. Stable unique key for this exact order attempt, e.g. UUID."
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
  async ({ plan, os, rootPassword, sshKey, period, resources, idempotencyKey, payment }) => {
    const body: Record<string, unknown> = { plan, payment, idempotencyKey };
    if (os !== undefined) body.os = os;
    if (rootPassword) body.rootPassword = rootPassword;
    if (sshKey !== undefined) body.sshKey = sshKey;
    if (period !== undefined) body.period = period;
    if (resources) body.resources = resources;
    const { data: quoteData } = await apiRequest(
      "POST",
      "/order/configuration/quote",
      body,
      { "Idempotency-Key": idempotencyKey }
    );
    const quoteToken = (quoteData as { quoteToken?: string }).quoteToken;
    if (!quoteToken) {
      throw new Error("Order quote did not return quoteToken");
    }
    body.quoteToken = quoteToken;
    const { data } = await apiRequest(
      "POST",
      "/order/configuration/confirm",
      body,
      { "Idempotency-Key": idempotencyKey, "X-Quote-Token": quoteToken }
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
      scope: z
        .enum(["full", "read"])
        .optional()
        .describe("Binary compatibility scope: full or read"),
      scopes: z
        .union([z.array(z.string()), z.string()])
        .optional()
        .describe("Granular scopes, e.g. dns:read,dns:write"),
      paid_operations_enabled: z
        .boolean()
        .optional()
        .describe("Enable paid API-key operations. Requires paid_scopes and daily/monthly spend limits."),
      paid_scopes: z
        .union([z.array(z.string()), z.string()])
        .optional()
        .describe("Paid scopes. Include only the scopes this key should use, e.g. vps:order,domains:order,domains:renew,domains:transfer"),
      daily_spend_limit_eur: z
        .number()
        .optional()
        .describe("Daily spend cap in EUR, required when paid operations are enabled"),
      monthly_spend_limit_eur: z
        .number()
        .optional()
        .describe("Monthly spend cap in EUR, required when paid operations are enabled"),
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
  async ({ name, scope, scopes, paid_operations_enabled, paid_scopes, daily_spend_limit_eur, monthly_spend_limit_eur, allowed_ips, expires_at }) => {
    const body: Record<string, unknown> = { name };
    if (scope) body.scope = scope;
    if (scopes) body.scopes = scopes;
    if (paid_operations_enabled !== undefined) body.paid_operations_enabled = paid_operations_enabled;
    if (paid_scopes) body.paid_scopes = paid_scopes;
    if (daily_spend_limit_eur !== undefined) body.daily_spend_limit_eur = daily_spend_limit_eur;
    if (monthly_spend_limit_eur !== undefined) body.monthly_spend_limit_eur = monthly_spend_limit_eur;
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
      scope: z
        .enum(["full", "read"])
        .optional()
        .describe("Binary compatibility scope: full or read"),
      scopes: z
        .union([z.array(z.string()), z.string()])
        .optional()
        .describe("Granular scopes, e.g. dns:read,dns:write"),
      paid_operations_enabled: z
        .boolean()
        .optional()
        .describe("Enable paid API-key operations. Requires paid_scopes and daily/monthly spend limits."),
      paid_scopes: z
        .union([z.array(z.string()), z.string()])
        .optional()
        .describe("Paid scopes. Include only the scopes this key should use, e.g. vps:order,domains:order,domains:renew,domains:transfer"),
      daily_spend_limit_eur: z
        .number()
        .optional()
        .describe("Daily spend cap in EUR, required when paid operations are enabled"),
      monthly_spend_limit_eur: z
        .number()
        .optional()
        .describe("Monthly spend cap in EUR, required when paid operations are enabled"),
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
  async ({ id, name, scope, scopes, paid_operations_enabled, paid_scopes, daily_spend_limit_eur, monthly_spend_limit_eur, allowed_ips, expires_at }) => {
    const body: Record<string, unknown> = { name };
    if (scope) body.scope = scope;
    if (scopes) body.scopes = scopes;
    if (paid_operations_enabled !== undefined) body.paid_operations_enabled = paid_operations_enabled;
    if (paid_scopes) body.paid_scopes = paid_scopes;
    if (daily_spend_limit_eur !== undefined) body.daily_spend_limit_eur = daily_spend_limit_eur;
    if (monthly_spend_limit_eur !== undefined) body.monthly_spend_limit_eur = monthly_spend_limit_eur;
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

// --- DNS ---

server.registerTool(
  "list_domains",
  {
    description: "List domains owned by the account, including status, expiry, nameservers, DNS zone link, and renewal settings. Requires domains:read when using an API key.",
    inputSchema: {},
  },
  async () => {
    const { data } = await apiRequest("GET", "/account/domains");
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_domain",
  {
    description: "Get one owned domain with current nameservers and any pending domain action. Requires domains:read when using an API key.",
    inputSchema: {
      domain_id: z.number().describe("Owned domain ID from list_domains"),
    },
  },
  async ({ domain_id }) => {
    const { data } = await apiRequest("GET", `/account/domains/${domain_id}`);
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "list_domain_tlds",
  {
    description: "List TLDs currently enabled for the VPSNet domain catalog. Requires domains:read when using an API key.",
    inputSchema: {},
  },
  async () => {
    const { data } = await apiRequest("GET", "/account/domains/tlds");
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "set_domain_nameservers",
  {
    description:
      "Queue an asynchronous nameserver change for an owned domain. Nameservers must be hostnames, not IP addresses; same-domain nameserver IP records are managed separately. This does not manage DNS records or PTR. Requires domains:manage when using an API key.",
    inputSchema: {
      domain_id: z.number().describe("Owned domain ID from list_domains"),
      nameservers: z.array(nameserverHostnameSchema).min(2).max(13).describe("2-13 nameserver hostnames, e.g. ns1.vpsnet.com, ns2.vpsnet.com. IP addresses are not accepted."),
      idempotencyKey: idempotencyKeySchema.optional().describe("Optional idempotency key for the queued domain action"),
    },
  },
  async ({ domain_id, nameservers, idempotencyKey }) => {
    const headers = idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined;
    const { data } = await apiRequest(
      "POST",
      `/account/domains/${domain_id}/nameservers`,
      {
        nameservers,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      },
      headers
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "list_domain_glue_records",
  {
    description:
      "List same-domain nameserver IP records for an owned domain, e.g. ns1.example.com -> 203.0.113.10. Requires domains:read when using an API key.",
    inputSchema: {
      domain_id: z.number().describe("Owned domain ID from list_domains"),
    },
  },
  async ({ domain_id }) => {
    const { data } = await apiRequest("GET", `/account/domains/${domain_id}/glue`);
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "create_domain_glue_record",
  {
    description:
      "Queue creating or updating a same-domain nameserver IP record for an owned domain. Hostname must be below the domain, addresses must be public IPs, and this does not create DNS A/AAAA records or PTR. Requires domains:manage when using an API key.",
    inputSchema: {
      domain_id: z.number().describe("Owned domain ID from list_domains"),
      hostname: glueHostnameSchema,
      addresses: z.array(gluePublicIpSchema).min(1).max(13).describe("Public IPv4/IPv6 addresses for this nameserver host"),
      idempotencyKey: idempotencyKeySchema.describe("Unique key for this queued domain action; sent as Idempotency-Key"),
    },
  },
  async ({ domain_id, hostname, addresses, idempotencyKey }) => {
    const { data } = await apiRequest(
      "POST",
      `/account/domains/${domain_id}/glue`,
      { hostname, addresses, idempotencyKey },
      { "Idempotency-Key": idempotencyKey }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "delete_domain_glue_record",
  {
    description:
      "Queue deleting a same-domain nameserver IP record for an owned domain. Remove or change domain nameserver delegation first if the hostname is still delegated. Requires domains:manage when using an API key.",
    inputSchema: {
      domain_id: z.number().describe("Owned domain ID from list_domains"),
      record_id: z.number().describe("Record ID from list_domain_glue_records"),
      idempotencyKey: idempotencyKeySchema.describe("Unique key for this queued domain action; sent as Idempotency-Key"),
    },
  },
  async ({ domain_id, record_id, idempotencyKey }) => {
    const { data } = await apiRequest(
      "DELETE",
      `/account/domains/${domain_id}/glue/${record_id}`,
      { idempotencyKey },
      { "Idempotency-Key": idempotencyKey }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_domain_parent_ds",
  {
    description:
      "List parent-zone DNSSEC DS records for an owned domain. Requires domains:read when using an API key.",
    inputSchema: {
      domain_id: z.number().describe("Owned domain ID from list_domains"),
    },
  },
  async ({ domain_id }) => {
    const { data } = await apiRequest("GET", `/account/domains/${domain_id}/dnssec-ds`);
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "add_domain_parent_ds",
  {
    description:
      "Queue adding DNSSEC DS records at the parent zone for an owned domain. Requires domains:manage when using an API key.",
    inputSchema: {
      domain_id: z.number().describe("Owned domain ID from list_domains"),
      ds: z
        .string()
        .min(8)
        .describe("One or more DS records, one per line. Accepted forms include '12345 13 2 ABCDEF...' or full BIND-style DS lines."),
      idempotencyKey: idempotencyKeySchema.describe("Unique key for this queued domain action; sent as Idempotency-Key"),
    },
  },
  async ({ domain_id, ds, idempotencyKey }) => {
    const { data } = await apiRequest(
      "POST",
      `/account/domains/${domain_id}/dnssec-ds`,
      { ds, idempotencyKey },
      { "Idempotency-Key": idempotencyKey }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "delete_domain_parent_ds",
  {
    description:
      "Queue deleting DNSSEC DS records at the parent zone for an owned domain. Requires domains:manage when using an API key.",
    inputSchema: {
      domain_id: z.number().describe("Owned domain ID from list_domains"),
      ds: z
        .string()
        .min(8)
        .describe("One or more DS records to remove, one per line. Accepted forms include '12345 13 2 ABCDEF...' or full BIND-style DS lines."),
      idempotencyKey: idempotencyKeySchema.describe("Unique key for this queued domain action; sent as Idempotency-Key"),
    },
  },
  async ({ domain_id, ds, idempotencyKey }) => {
    const { data } = await apiRequest(
      "DELETE",
      `/account/domains/${domain_id}/dnssec-ds`,
      { ds, idempotencyKey },
      { "Idempotency-Key": idempotencyKey }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "check_domain_availability",
  {
    description: "Check read-only domain availability. Requires domains:read when using an API key.",
    inputSchema: {
      domain: z.string().describe("Domain to check, e.g. example.lt or example.com"),
    },
  },
  async ({ domain }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/domains/check?domain=${encodeURIComponent(domain)}`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

const getDomainOrderingStatus = async () => {
  const { data } = await apiRequest("GET", "/account/domains/status");
  return { content: [{ type: "text" as const, text: formatJson(data) }] };
};

server.registerTool(
  "get_domain_ordering_status",
  {
    description:
      "Show non-secret domain ordering readiness. Requires domains:read when using an API key.",
    inputSchema: {},
  },
  getDomainOrderingStatus
);

server.registerTool(
  "list_domain_contacts",
  {
    description: "List domain registrant/admin/tech/billing contacts owned by the account. Requires domains:read when using an API key.",
    inputSchema: {},
  },
  async () => {
    const { data } = await apiRequest("GET", "/account/domains/contacts");
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

const domainContactInputSchema = {
  kind: z.enum(["individual", "business"]).describe("Contact kind"),
  is_default: z.boolean().optional().describe("Make this the default domain contact"),
  first_name: z.string().optional().describe("Required for individual contacts"),
  last_name: z.string().optional().describe("Required for individual contacts"),
  organization: z.string().optional().describe("Required for business contacts"),
  organization_code: z.string().optional().describe("Company/legal entity code required for business contacts"),
  email: z.string().email().describe("Contact email"),
  phone: z.string().optional().describe("Phone number, preferably E.164"),
  address1: z.string().optional().describe("Street address"),
  address2: z.string().optional().describe("Street address line 2"),
  city: z.string().optional().describe("City"),
  state: z.string().optional().describe("State/province"),
  postal_code: z.string().optional().describe("Postal code"),
  country_code: z.string().length(2).describe("ISO-3166 alpha-2 country code"),
  vat_code: z.string().optional().describe("VAT code when relevant"),
};

server.registerTool(
  "create_domain_contact",
  {
    description: "Create a domain contact for future domain registration/transfer. Requires domains:manage when using an API key.",
    inputSchema: domainContactInputSchema,
  },
  async (input) => {
    const { data } = await apiRequest("POST", "/account/domains/contacts", input);
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "update_domain_contact",
  {
    description: "Update an existing domain contact. Requires domains:manage when using an API key.",
    inputSchema: {
      id: z.number().describe("Domain contact ID"),
      ...domainContactInputSchema,
    },
  },
  async ({ id, ...input }) => {
    const { data } = await apiRequest("POST", `/account/domains/contacts/${id}`, input);
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "delete_domain_contact",
  {
    description: "Delete an unused domain contact. Contacts referenced by domains are rejected. Requires domains:manage when using an API key.",
    inputSchema: {
      id: z.number().describe("Domain contact ID"),
    },
  },
  async ({ id }) => {
    const { data } = await apiRequest("DELETE", `/account/domains/contacts/${id}`);
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "quote_domain_register",
  {
    description: "Create a VPSNet-priced domain registration quote. Returns quoteToken; does not submit the domain action. Requires domains:read plus paid domains:order scope/caps for API keys.",
    inputSchema: {
      domain: z.string().describe("Domain to register, e.g. example.lt"),
      years: z.number().optional().describe("Registration period in years"),
      registrant_contact_id: z.number().optional().describe("Registrant contact ID; defaults to account default contact"),
      admin_contact_id: z.number().optional().describe("Admin contact ID"),
      tech_contact_id: z.number().optional().describe("Technical contact ID"),
      billing_contact_id: z.number().optional().describe("Billing contact ID"),
      nameservers: z.array(nameserverHostnameSchema).optional().describe("2-13 nameserver hostnames; defaults to ns1/ns2.vpsnet.com. IP addresses are not accepted."),
      whois_privacy: whoisPrivacySchema,
      idempotencyKey: idempotencyKeySchema.describe("Unique key for this quote; sent as Idempotency-Key"),
    },
  },
  async ({ idempotencyKey, ...input }) => {
    const body = { ...input, idempotencyKey };
    const { data } = await apiRequest(
      "POST",
      "/account/domains/register/quote",
      body,
      { "Idempotency-Key": idempotencyKey }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "quote_domain_transfer",
  {
    description: "Create a VPSNet-priced domain transfer quote. Auth code is hashed into the quote payload and not returned. Returns quoteToken; does not submit the domain action. Requires domains:read plus paid domains:transfer scope/caps for API keys.",
    inputSchema: {
      domain: z.string().describe("Domain to transfer"),
      authCode: z.string().describe("Transfer auth/EPP code"),
      registrant_contact_id: z.number().optional().describe("Registrant contact ID; defaults to account default contact"),
      admin_contact_id: z.number().optional().describe("Admin contact ID"),
      tech_contact_id: z.number().optional().describe("Technical contact ID"),
      billing_contact_id: z.number().optional().describe("Billing contact ID"),
      nameservers: z.array(nameserverHostnameSchema).optional().describe("2-13 nameserver hostnames; defaults to ns1/ns2.vpsnet.com. IP addresses are not accepted."),
      whois_privacy: whoisPrivacySchema,
      idempotencyKey: idempotencyKeySchema.describe("Unique key for this quote; sent as Idempotency-Key"),
    },
  },
  async ({ idempotencyKey, authCode, ...input }) => {
    const body = { ...input, auth_code: authCode, idempotencyKey };
    const { data } = await apiRequest(
      "POST",
      "/account/domains/transfer/quote",
      body,
      { "Idempotency-Key": idempotencyKey }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

const domainPaymentSchema = z
  .object({
    payment: z.number().describe("Payment method ID. Use 1 for balance payment"),
    successUrl: z.string().describe("Redirect URL on success (use empty string '')"),
    cancelUrl: z.string().describe("Redirect URL on cancel (use empty string '')"),
  })
  .passthrough()
  .describe("Payment object. For balance: { payment: 1, successUrl: '', cancelUrl: '' }");

server.registerTool(
  "confirm_domain_register",
  {
    description: "Confirm a quoted domain registration and pay from the VPSNet account. Domain payments are non-refundable once confirmed and the domain action is queued only after payment succeeds. Requires the same idempotencyKey and quoteToken from quote_domain_register.",
    inputSchema: {
      domain: z.string().describe("Domain to register, exactly as quoted"),
      years: z.number().optional().describe("Registration period in years, exactly as quoted"),
      registrant_contact_id: z.number().optional().describe("Registrant contact ID used in quote"),
      admin_contact_id: z.number().optional().describe("Admin contact ID used in quote"),
      tech_contact_id: z.number().optional().describe("Technical contact ID used in quote"),
      billing_contact_id: z.number().optional().describe("Billing contact ID used in quote"),
      nameservers: z.array(nameserverHostnameSchema).optional().describe("Nameserver hostnames used in quote"),
      whois_privacy: whoisPrivacySchema,
      idempotencyKey: idempotencyKeySchema.describe("Same idempotencyKey used for quote"),
      quoteToken: z.string().min(32).describe("quoteToken returned by quote_domain_register"),
      payment: domainPaymentSchema,
    },
  },
  async ({ idempotencyKey, quoteToken, ...input }) => {
    const body = { ...input, idempotencyKey, quoteToken };
    const { data } = await apiRequest(
      "POST",
      "/account/domains/register/confirm",
      body,
      { "Idempotency-Key": idempotencyKey, "X-Quote-Token": quoteToken }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "confirm_domain_transfer",
  {
    description: "Confirm a quoted domain transfer and pay from the VPSNet account. Domain payments are non-refundable once confirmed and the transfer is queued only after payment succeeds. Requires the same idempotencyKey, quoteToken, and authCode used for quote.",
    inputSchema: {
      domain: z.string().describe("Domain to transfer, exactly as quoted"),
      authCode: z.string().describe("Transfer auth/EPP code used in quote; stored encrypted server-side after confirm"),
      registrant_contact_id: z.number().optional().describe("Registrant contact ID used in quote"),
      admin_contact_id: z.number().optional().describe("Admin contact ID used in quote"),
      tech_contact_id: z.number().optional().describe("Technical contact ID used in quote"),
      billing_contact_id: z.number().optional().describe("Billing contact ID used in quote"),
      nameservers: z.array(nameserverHostnameSchema).optional().describe("Nameserver hostnames used in quote"),
      whois_privacy: whoisPrivacySchema,
      idempotencyKey: idempotencyKeySchema.describe("Same idempotencyKey used for quote"),
      quoteToken: z.string().min(32).describe("quoteToken returned by quote_domain_transfer"),
      payment: domainPaymentSchema,
    },
  },
  async ({ idempotencyKey, quoteToken, authCode, ...input }) => {
    const body = { ...input, auth_code: authCode, idempotencyKey, quoteToken };
    const { data } = await apiRequest(
      "POST",
      "/account/domains/transfer/confirm",
      body,
      { "Idempotency-Key": idempotencyKey, "X-Quote-Token": quoteToken }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "quote_domain_renew",
  {
    description: "Create a VPSNet-priced renewal quote for an owned domain. Renewal pricing follows the existing domain record. Requires paid domains:renew scope/caps for API keys.",
    inputSchema: {
      domain_id: z.number().optional().describe("Owned domain ID"),
      domain: z.string().optional().describe("Owned domain name if domain_id is not used"),
      years: z.number().optional().describe("Renewal period in years"),
      idempotencyKey: idempotencyKeySchema.describe("Unique key for this quote; sent as Idempotency-Key"),
    },
  },
  async ({ idempotencyKey, ...input }) => {
    const body = { ...input, idempotencyKey };
    const { data } = await apiRequest(
      "POST",
      "/account/domains/renew/quote",
      body,
      { "Idempotency-Key": idempotencyKey }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "confirm_domain_renew",
  {
    description: "Confirm a quoted domain renewal and pay from the VPSNet account. Domain renewal payments are non-refundable once confirmed and the renewal is queued only after payment succeeds. Requires the same idempotencyKey and quoteToken from quote_domain_renew.",
    inputSchema: {
      domain_id: z.number().optional().describe("Owned domain ID used in quote"),
      domain: z.string().optional().describe("Owned domain name used in quote"),
      years: z.number().optional().describe("Renewal period used in quote"),
      idempotencyKey: idempotencyKeySchema.describe("Same idempotencyKey used for quote"),
      quoteToken: z.string().min(32).describe("quoteToken returned by quote_domain_renew"),
      payment: domainPaymentSchema,
    },
  },
  async ({ idempotencyKey, quoteToken, ...input }) => {
    const body = { ...input, idempotencyKey, quoteToken };
    const { data } = await apiRequest(
      "POST",
      "/account/domains/renew/confirm",
      body,
      { "Idempotency-Key": idempotencyKey, "X-Quote-Token": quoteToken }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "quote_domain_restore",
  {
    description: "Create a restore quote for an owned domain in redemption. The final price is returned before payment. Requires paid domains:renew scope/caps for API keys.",
    inputSchema: {
      domain_id: z.number().optional().describe("Owned domain ID"),
      domain: z.string().optional().describe("Owned domain name if domain_id is not used"),
      idempotencyKey: idempotencyKeySchema.describe("Unique key for this quote; sent as Idempotency-Key"),
    },
  },
  async ({ idempotencyKey, ...input }) => {
    const body = { ...input, idempotencyKey };
    const { data } = await apiRequest(
      "POST",
      "/account/domains/restore/quote",
      body,
      { "Idempotency-Key": idempotencyKey }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "confirm_domain_restore",
  {
    description: "Confirm a quoted domain restore and pay from the VPSNet account. Domain restore payments are non-refundable once confirmed and the restore is queued only after payment succeeds. Requires the same idempotencyKey and quoteToken from quote_domain_restore.",
    inputSchema: {
      domain_id: z.number().optional().describe("Owned domain ID used in quote"),
      domain: z.string().optional().describe("Owned domain name used in quote"),
      idempotencyKey: idempotencyKeySchema.describe("Same idempotencyKey used for quote"),
      quoteToken: z.string().min(32).describe("quoteToken returned by quote_domain_restore"),
      payment: domainPaymentSchema,
    },
  },
  async ({ idempotencyKey, quoteToken, ...input }) => {
    const body = { ...input, idempotencyKey, quoteToken };
    const { data } = await apiRequest(
      "POST",
      "/account/domains/restore/confirm",
      body,
      { "Idempotency-Key": idempotencyKey, "X-Quote-Token": quoteToken }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "set_domain_auto_renew",
  {
    description: "Enable or disable automatic renewal for an owned domain. Auto-renew charges the VPSNet account; automatic domain renewal payments are non-refundable once confirmed.",
    inputSchema: {
      domain_id: z.number().describe("Owned domain ID from list_domains"),
      enabled: z.boolean().describe("Whether automatic renewal should be enabled"),
      renewal_period_years: z.number().min(1).max(10).optional().describe("Renewal period in years; defaults to the current domain setting"),
    },
  },
  async ({ domain_id, enabled, renewal_period_years }) => {
    const { data } = await apiRequest(
      "POST",
      `/account/domains/${domain_id}/auto-renew`,
      {
        enabled,
        ...(renewal_period_years ? { renewal_period_years } : {}),
      }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_registrar_lock",
  {
    description:
      "Get the registrar transfer-lock status for an owned domain (locked / unlocked / unsupported). A locked domain cannot be transferred away until unlocked. Changing the lock is intentionally not available via API key (use the control panel). Requires domains:read when using an API key.",
    inputSchema: {
      domain_id: z.number().describe("Owned domain ID from list_domains"),
    },
  },
  async ({ domain_id }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/domains/${domain_id}/registrar-lock`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "list_service_dns_options",
  {
    description:
      "List the DNS attach options for a service: its public IPv4/IPv6 addresses, the account's editable forward DNS zones, and DNS records already pointing at the service. Use before attach_service_dns_record. Requires dns:read when using an API key.",
    inputSchema: {
      orderNo: z.string().describe("Order number, e.g. VP57068"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/services/${orderNo}/domains`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "attach_service_dns_record",
  {
    description:
      "Point a DNS name at a service in one call: creates an A/AAAA/CNAME record in an owned forward DNS zone using the service's own IP (A/AAAA default to the service IP when ip is omitted; the ip, when given, must belong to the service). Not for secondary/suspended zones. For arbitrary record content use upsert_dns_record instead. Requires dns:write when using an API key.",
    inputSchema: {
      orderNo: z.string().describe("Order number of the service, e.g. VP57068"),
      zone_id: z.number().describe("Owned forward DNS zone ID from list_dns_zones"),
      name: z
        .string()
        .describe("Record name inside the zone, e.g. 'www' or '@' for the apex"),
      type: z.enum(["A", "AAAA", "CNAME"]).describe("Record type"),
      ip: z
        .string()
        .optional()
        .describe("Optional service IP for A/AAAA; defaults to the service's first matching IP"),
      target: z
        .string()
        .optional()
        .describe("CNAME target hostname (required when type=CNAME)"),
      ttl: z.number().optional().describe("TTL in seconds (default 120)"),
    },
  },
  async ({ orderNo, zone_id, name, type, ip, target, ttl }) => {
    const body: Record<string, unknown> = { zone_id, name, type };
    if (ip !== undefined) body.ip = ip;
    if (target !== undefined) body.target = target;
    if (ttl !== undefined) body.ttl = ttl;
    const { data } = await apiRequest(
      "POST",
      `/account/services/${orderNo}/domains`,
      body
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "list_snapshots",
  {
    description:
      "List disk snapshots for a Cloud VPS (KVM/VDS) service, with the snapshot billing policy (free window, then billed per GB while kept) and a usage summary. Firecracker VPS uses list_firecracker_snapshots instead.",
    inputSchema: {
      orderNo: z.string().describe("Order number, e.g. VD12345"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/services/${orderNo}/snapshots`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "create_snapshot",
  {
    description:
      "Create a disk snapshot of a Cloud VPS (KVM/VDS) service. Free for a short window, then billed per GB while kept (see list_snapshots policy). Take a snapshot before any risky or automated change — it's free for an initial window, so it's cheap insurance you can roll back to. DELETE the snapshot once the change succeeds and you no longer need it — after the free window it is billed per GB while kept (Cloud VPS snapshots do NOT auto-expire), so never leave snapshots lying around. Only one snapshot action can run at a time; snapshot count is limited per service.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      description: z.string().optional().describe("Optional snapshot description"),
    },
  },
  async ({ orderNo, description }) => {
    const body: Record<string, unknown> = {};
    if (description !== undefined) body.description = description;
    const { data } = await apiRequest(
      "POST",
      `/account/services/${orderNo}/snapshots`,
      body
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "rollback_snapshot",
  {
    description:
      "Roll a Cloud VPS (KVM/VDS) service back to a disk snapshot. DESTRUCTIVE: disk state after the snapshot is lost. Confirm with the user before calling. Tip: take a snapshot before any risky or automated change — it's free for an initial window, so it's cheap insurance you can roll back to. DELETE the snapshot once the change succeeds and you no longer need it — after the free window it is billed per GB while kept (Cloud VPS snapshots do NOT auto-expire), so never leave snapshots lying around.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      snapname: z.string().describe("Snapshot name from list_snapshots"),
    },
  },
  async ({ orderNo, snapname }) => {
    const { data } = await apiRequest(
      "POST",
      `/account/services/${orderNo}/snapshots/${encodeURIComponent(snapname)}/rollback`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "delete_snapshot",
  {
    description: "Delete a Cloud VPS (KVM/VDS) disk snapshot.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      snapname: z.string().describe("Snapshot name from list_snapshots"),
    },
  },
  async ({ orderNo, snapname }) => {
    const { data } = await apiRequest(
      "DELETE",
      `/account/services/${orderNo}/snapshots/${encodeURIComponent(snapname)}`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "list_firecracker_snapshots",
  {
    description:
      "List temporary snapshots for a Firecracker VPS service, including billing state (free window, then a per-GB keep rate) and expiry.",
    inputSchema: {
      orderNo: z.string().describe("Order number, e.g. VP57068"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/services/${orderNo}/firecracker/snapshots`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "create_firecracker_snapshot",
  {
    description:
      "Create a temporary snapshot of a Firecracker VPS. Free for a short window, then billed per GB while kept; snapshots expire automatically. Take a snapshot before any risky or automated change — it's free for an initial window, so it's cheap insurance you can roll back to. DELETE the snapshot once the change succeeds and you no longer need it — after the free window it is billed per GB while kept (Cloud VPS snapshots do NOT auto-expire), so never leave snapshots lying around. Check list_firecracker_snapshots for the policy fields.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      description: z
        .string()
        .optional()
        .describe("Optional note/label for the snapshot (helps identify what it was taken before)"),
    },
  },
  async ({ orderNo, description }) => {
    const body: Record<string, unknown> = {};
    if (description !== undefined) body.description = description;
    const { data } = await apiRequest(
      "POST",
      `/account/services/${orderNo}/firecracker/snapshots`,
      body
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "rollback_firecracker_snapshot",
  {
    description:
      "Roll a Firecracker VPS back to a temporary snapshot. DESTRUCTIVE: disk state after the snapshot is lost. Confirm with the user before calling. Tip: take a snapshot before any risky or automated change — it's free for an initial window, so it's cheap insurance you can roll back to. DELETE the snapshot once the change succeeds and you no longer need it — after the free window it is billed per GB while kept (Cloud VPS snapshots do NOT auto-expire), so never leave snapshots lying around.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      snapshot_id: z.number().describe("Snapshot ID from list_firecracker_snapshots"),
    },
  },
  async ({ orderNo, snapshot_id }) => {
    const { data } = await apiRequest(
      "POST",
      `/account/services/${orderNo}/firecracker/snapshots/${snapshot_id}/rollback`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "delete_firecracker_snapshot",
  {
    description: "Delete a Firecracker VPS temporary snapshot (stops its keep billing).",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      snapshot_id: z.number().describe("Snapshot ID from list_firecracker_snapshots"),
    },
  },
  async ({ orderNo, snapshot_id }) => {
    const { data } = await apiRequest(
      "DELETE",
      `/account/services/${orderNo}/firecracker/snapshots/${snapshot_id}`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_restore_status",
  {
    description:
      "Get the unified restore state for a service: retention days, restore price, and any restore request in progress. Cloud VPS and Firecracker VPS have automatic daily off-node backups restored through this flow.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/services/${orderNo}/restore/status`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "list_restore_points",
  {
    description:
      "List available backup restore points for a service (automatic off-node backups). Use a point id with request_restore.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/services/${orderNo}/restore/points`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "request_restore",
  {
    description:
      "PAID: restore a service from a backup point. Charges the restore price (+VAT) from the ACCOUNT BALANCE immediately and overwrites the service disk with the backup content. DESTRUCTIVE and billed — always confirm the point and price (get_restore_status) with the user first.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      backup_point_id: z.number().describe("Restore point ID from list_restore_points"),
    },
  },
  async ({ orderNo, backup_point_id }) => {
    const { data } = await apiRequest(
      "POST",
      `/account/services/${orderNo}/restore/requests`,
      { backup_point_id }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_guest_agent_status",
  {
    description:
      "Check whether the QEMU guest agent is running inside a Cloud VPS (KVM/VDS). Useful before OS-level operations that depend on the agent.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/services/${orderNo}/guest-agent`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

const functionBodyFromInput = (input: Record<string, unknown>) => {
  const body: Record<string, unknown> = {};
  for (const key of [
    "name",
    "runtime_os_id",
    "entrypoint",
    "description",
    "code",
    "environment",
    "timeout_seconds",
    "vcpus",
    "memory_mb",
    "enabled",
    "webhook_enabled",
    "rotate_webhook_secret",
  ]) {
    if (input[key] !== undefined) body[key] = input[key];
  }
  return body;
};

const functionFieldsSchema = {
  name: z.string().optional().describe("Function name"),
  runtime_os_id: z.number().optional().describe("Runtime OS ID (see list_functions response for available runtimes)"),
  entrypoint: z.string().optional().describe("Entrypoint command/handler"),
  description: z.string().optional().describe("Description (max 2000 chars)"),
  code: z.string().optional().describe("Function source code"),
  environment: z.string().optional().describe("Environment variables as JSON object string"),
  timeout_seconds: z.number().optional().describe("1-300 seconds, default 30"),
  vcpus: z.number().optional().describe("1-8 vCPUs, default 1"),
  memory_mb: z.number().optional().describe("64-8192 MB, default 256"),
  enabled: z.boolean().optional().describe("Whether the function can be invoked"),
  webhook_enabled: z.boolean().optional().describe("Expose a public webhook URL for this function"),
  rotate_webhook_secret: z.boolean().optional().describe("Rotate the webhook secret"),
};

server.registerTool(
  "list_functions",
  {
    description:
      "List Firecracker Functions (serverless-style code execution in microVMs) with runtimes, webhook URLs, and usage. Usage-billed from the account.",
    inputSchema: {},
  },
  async () => {
    const { data } = await apiRequest("GET", "/account/firecracker/functions");
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_function",
  {
    description: "Get one Firecracker Function with code, config, and webhook details.",
    inputSchema: {
      function_id: z.number().describe("Function ID from list_functions"),
    },
  },
  async ({ function_id }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/firecracker/functions/${function_id}`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "create_function",
  {
    description:
      "Create a Firecracker Function. Requires name, runtime_os_id, and code. Invocations are usage-billed (CPU + memory seconds) from the account balance.",
    inputSchema: functionFieldsSchema,
  },
  async (input) => {
    const { data } = await apiRequest(
      "POST",
      "/account/firecracker/functions",
      functionBodyFromInput(input as Record<string, unknown>)
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "update_function",
  {
    description: "Update a Firecracker Function's code or configuration.",
    inputSchema: {
      function_id: z.number().describe("Function ID from list_functions"),
      ...functionFieldsSchema,
    },
  },
  async ({ function_id, ...input }) => {
    const { data } = await apiRequest(
      "POST",
      `/account/firecracker/functions/${function_id}`,
      functionBodyFromInput(input as Record<string, unknown>)
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "delete_function",
  {
    description: "Delete a Firecracker Function.",
    inputSchema: {
      function_id: z.number().describe("Function ID from list_functions"),
    },
  },
  async ({ function_id }) => {
    const { data } = await apiRequest(
      "DELETE",
      `/account/firecracker/functions/${function_id}`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "invoke_function",
  {
    description:
      "Invoke a Firecracker Function. PAID per invocation (CPU/memory usage billed from account). With wait=true the call blocks and returns the result; otherwise poll list_function_invocations.",
    inputSchema: {
      function_id: z.number().describe("Function ID from list_functions"),
      input: z.string().optional().describe("Input payload passed to the function"),
      wait: z.boolean().optional().describe("Wait synchronously for the result"),
    },
  },
  async ({ function_id, input, wait }) => {
    const body: Record<string, unknown> = {};
    if (input !== undefined) body.input = input;
    if (wait !== undefined) body.wait = wait;
    const { data } = await apiRequest(
      "POST",
      `/account/firecracker/functions/${function_id}/invoke`,
      body
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "list_function_invocations",
  {
    description: "List invocations of a Firecracker Function with status, duration, and cost.",
    inputSchema: {
      function_id: z.number().describe("Function ID from list_functions"),
    },
  },
  async ({ function_id }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/firecracker/functions/${function_id}/invocations`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_function_invocation",
  {
    description: "Get one invocation of a Firecracker Function including output/logs and usage cost.",
    inputSchema: {
      function_id: z.number().describe("Function ID from list_functions"),
      invocation_id: z.string().describe("Invocation ID from list_function_invocations"),
    },
  },
  async ({ function_id, invocation_id }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/firecracker/functions/${function_id}/invocations/${encodeURIComponent(invocation_id)}`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "list_dns_zones",
  {
    description: "List forward DNS zones on the account. Requires dns:read when using an API key.",
    inputSchema: {},
  },
  async () => {
    const { data } = await apiRequest("GET", "/account/dns/zones");
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "create_dns_zone",
  {
    description:
      "Create a forward DNS zone in pending verification state. Native zones are managed here; secondary zones AXFR from public primary DNS servers and require TSIG. Returns a one-time TXT verification value. Requires dns:write when using an API key.",
    inputSchema: {
      zone: z.string().describe("Zone name, e.g. example.com"),
      kind: dnsZoneKindSchema
        .optional()
        .describe("Zone kind. Defaults to native. Use secondary for AXFR-backed zones."),
      secondary_masters: z
        .array(z.string())
        .optional()
        .describe("Public primary DNS server IPs for a secondary zone. Non-public IPs are rejected by the API."),
      secondary_tsig_key_name: z
        .string()
        .optional()
        .describe("Required for secondary zones. TSIG key name configured on the primary DNS server."),
      secondary_tsig_algorithm: z
        .enum(["hmac-sha256", "hmac-sha384", "hmac-sha512", "hmac-sha224", "hmac-sha1", "hmac-md5"])
        .optional()
        .describe("TSIG algorithm. Defaults to hmac-sha256."),
      secondary_tsig_secret: z
        .string()
        .optional()
        .describe("Required for secondary zones. Base64 TSIG secret, 32-64 decoded bytes, e.g. openssl rand -base64 32. It is encrypted and never returned."),
    },
  },
  async ({ zone, kind, secondary_masters, secondary_tsig_key_name, secondary_tsig_algorithm, secondary_tsig_secret }) => {
    const body: Record<string, unknown> = {
      zone_name: zone,
    };
    if (kind) body.kind = kind;
    if (secondary_masters) body.secondary_masters = secondary_masters;
    if (secondary_tsig_key_name) body.secondary_tsig_key_name = secondary_tsig_key_name;
    if (secondary_tsig_algorithm) body.secondary_tsig_algorithm = secondary_tsig_algorithm;
    if (secondary_tsig_secret) body.secondary_tsig_secret = secondary_tsig_secret;
    const { data } = await apiRequest("POST", "/account/dns/zones", body);
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_dns_zone",
  {
    description: "Get a DNS zone and desired records. Requires dns:read when using an API key.",
    inputSchema: {
      zone_id: z.number().describe("DNS zone ID"),
    },
  },
  async ({ zone_id }) => {
    const { data } = await apiRequest("GET", `/account/dns/zones/${zone_id}`);
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_dns_zone_diagnostics",
  {
    description:
      "Run customer-facing DNS health diagnostics for a zone: delegation, public SOA, DNSSEC signal, and common record hygiene checks. Requires dns:read when using an API key.",
    inputSchema: {
      zone_id: z.number().describe("DNS zone ID"),
    },
  },
  async ({ zone_id }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/dns/zones/${zone_id}/diagnostics`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "export_dns_zone",
  {
    description:
      "Export a native forward DNS zone's desired-state records as a BIND-style zone file. System-managed SOA/apex NS/DNSSEC wire records and PTR/reverse DNS are not exported here. Requires dns:read when using an API key.",
    inputSchema: {
      zone_id: z.number().describe("DNS zone ID"),
    },
  },
  async ({ zone_id }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/dns/zones/${zone_id}/export`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "import_dns_zone",
  {
    description:
      "Import BIND-style forward DNS records into a native zone. Set replace=true to replace non-system desired-state records; false upserts imported records. PTR/reverse DNS, SOA, DNSSEC wire records, apex NS, and LUA are skipped or rejected by the API. Requires dns:write when using an API key.",
    inputSchema: {
      zone_id: z.number().describe("DNS zone ID"),
      zonefile: z
        .string()
        .min(1)
        .max(262144)
        .describe("BIND-style zone file contents to import"),
      replace: z
        .boolean()
        .optional()
        .describe("If true, delete existing non-system desired-state records before importing. Defaults to false."),
    },
  },
  async ({ zone_id, zonefile, replace }) => {
    const { data } = await apiRequest(
      "POST",
      `/account/dns/zones/${zone_id}/import`,
      {
        zonefile,
        ...(replace !== undefined ? { replace } : {}),
      }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "list_dns_templates",
  {
    description:
      "List backend-defined DNS record templates for a native forward zone, such as web service, Google Workspace, Microsoft 365, mail security, Null MX and CAA lockdown. Requires dns:read when using an API key.",
    inputSchema: {
      zone_id: z.number().describe("DNS zone ID"),
    },
  },
  async ({ zone_id }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/dns/zones/${zone_id}/templates`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "apply_dns_template",
  {
    description:
      "Apply a backend-defined DNS template to a native forward zone. Records still pass the same API validation, quotas and conflict rules as manual record writes. Requires dns:write when using an API key.",
    inputSchema: {
      zone_id: z.number().describe("DNS zone ID"),
      template: z
        .string()
        .describe("Template ID returned by list_dns_templates, e.g. web_service, null_mx, google_workspace, microsoft_365, mail_security, caa_letsencrypt"),
      parameters: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe("Template parameters, e.g. { ipv4, ipv6, www, mx_target, ttl } depending on the template"),
    },
  },
  async ({ zone_id, template, parameters }) => {
    const { data } = await apiRequest(
      "POST",
      `/account/dns/zones/${zone_id}/templates/${encodeURIComponent(template)}`,
      {
        ...(parameters !== undefined ? { parameters } : {}),
      }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "delete_dns_zone",
  {
    description:
      "Delete a forward DNS zone. Published zones are queued for removal from the managed DNS platform. Requires dns:write when using an API key.",
    inputSchema: {
      zone_id: z.number().describe("DNS zone ID"),
    },
  },
  async ({ zone_id }) => {
    const { data } = await apiRequest("DELETE", `/account/dns/zones/${zone_id}`);
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "verify_dns_zone",
  {
    description:
      "Check the zone ownership TXT record and publish the zone if it matches. Requires dns:write when using an API key.",
    inputSchema: {
      zone_id: z.number().describe("DNS zone ID"),
    },
  },
  async ({ zone_id }) => {
    const { data } = await apiRequest("POST", `/account/dns/zones/${zone_id}/verify`);
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_dnssec",
  {
    description:
      "Get DNSSEC state and public DNSKEY/DS material for a native DNS zone. Requires dns:read when using an API key.",
    inputSchema: {
      zone_id: z.number().describe("DNS zone ID"),
    },
  },
  async ({ zone_id }) => {
    const { data } = await apiRequest("GET", `/account/dns/zones/${zone_id}/dnssec`);
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "set_dnssec",
  {
    description:
      "Enable or disable DNSSEC signing for a native DNS zone. If parent DS records still exist outside VPSNet, remove them first and set parent_ds_removed=true before disabling signing. Secondary-zone DNSSEC is controlled on the primary server. Requires dnssec:manage when using an API key.",
    inputSchema: {
      zone_id: z.number().describe("DNS zone ID"),
      enabled: z.boolean().describe("true to enable/sign the zone, false to disable/remove signing"),
      parent_ds_removed: z
        .boolean()
        .optional()
        .describe("When disabling DNSSEC for a zone whose parent DS is managed outside VPSNet, set true only after removing the parent DS records."),
    },
  },
  async ({ zone_id, enabled, parent_ds_removed }) => {
    const { data } = await apiRequest("POST", `/account/dns/zones/${zone_id}/dnssec`, {
      enabled,
      parent_ds_removed,
    });
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "upsert_dns_record",
  {
    description:
      "Create or replace a forward DNS record in desired state for a native zone. PTR and *.arpa are rejected; use change_rdns for reverse DNS. Requires dns:write when using an API key.",
    inputSchema: {
      zone_id: z.number().describe("DNS zone ID"),
      name: z
        .string()
        .describe("Record name. Use @ for apex, or a relative name inside the zone."),
      type: dnsRecordTypeSchema.describe("DNS record type. PTR is intentionally not supported here."),
      content: z.string().describe("DNS record value for the selected type"),
      ttl: z
        .number()
        .optional()
        .describe("TTL in seconds, allowed range 60-604800. Defaults to 120."),
      comment: z
        .string()
        .max(255)
        .optional()
        .describe("Optional note about this record, max 255 chars."),
    },
  },
  async ({ zone_id, name, type, content, ttl, comment }) => {
    const body: Record<string, unknown> = { name, type, content };
    if (ttl !== undefined) body.ttl = ttl;
    if (comment !== undefined) body.comment = comment;
    const { data } = await apiRequest(
      "POST",
      `/account/dns/zones/${zone_id}/records`,
      body
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "update_dns_record",
  {
    description:
      "Edit an existing forward DNS record by its ID (PUT) — change value, TTL, or comment without replacing it. System-managed records cannot be edited. Requires dns:write when using an API key.",
    inputSchema: {
      zone_id: z.number().describe("DNS zone ID"),
      record_id: z.number().describe("DNS record ID to update"),
      name: z
        .string()
        .describe("Record name. Use @ for apex, or a relative name inside the zone."),
      type: dnsRecordTypeSchema.describe("DNS record type. PTR is intentionally not supported here."),
      content: z.string().describe("DNS record value for the selected type"),
      ttl: z
        .number()
        .optional()
        .describe("TTL in seconds, allowed range 60-604800. Defaults to 120."),
      comment: z
        .string()
        .max(255)
        .optional()
        .describe("Optional note about this record, max 255 chars."),
    },
  },
  async ({ zone_id, record_id, name, type, content, ttl, comment }) => {
    const body: Record<string, unknown> = { name, type, content };
    if (ttl !== undefined) body.ttl = ttl;
    if (comment !== undefined) body.comment = comment;
    const { data } = await apiRequest(
      "PUT",
      `/account/dns/zones/${zone_id}/records/${record_id}`,
      body
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "delete_dns_record",
  {
    description:
      "Delete a forward DNS record from desired state. Requires dns:write when using an API key.",
    inputSchema: {
      zone_id: z.number().describe("DNS zone ID"),
      record_id: z.number().describe("DNS record ID"),
    },
  },
  async ({ zone_id, record_id }) => {
    const { data } = await apiRequest(
      "DELETE",
      `/account/dns/zones/${zone_id}/records/${record_id}`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_dns_service_status",
  {
    description:
      "Get the VPSNet DNS cluster status: whether the anycast DNS service is operational, healthy node count, the public nameservers to delegate domains to, and the recursive resolver IPs to use on VPSNet servers. Requires dns:read when using an API key.",
    inputSchema: {},
  },
  async () => {
    const { data } = await apiRequest("GET", "/account/dns/service-status");
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_dns_zone_history",
  {
    description:
      "Get the recent change history for a DNS zone and its records (action, record, who, when). Useful for auditing what changed. Requires dns:read when using an API key.",
    inputSchema: {
      zone_id: z.number().describe("DNS zone ID"),
    },
  },
  async ({ zone_id }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/dns/zones/${zone_id}/history`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "list_ddns_tokens",
  {
    description: "List DNS updater tokens for a DNS zone (DDNS A/AAAA and ACME DNS-01 TXT). Returned data never includes the full token value. Requires dns:read when using an API key.",
    inputSchema: {
      zone_id: z.number().describe("DNS zone ID"),
    },
  },
  async ({ zone_id }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/dns/zones/${zone_id}/ddns-tokens`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "create_ddns_token",
  {
    description:
      "Create a narrow DNS updater token for one hostname/pattern inside a verified customer-owned zone. purpose=ddns allows A/AAAA updater use; purpose=acme allows TXT only under _acme-challenge for DNS-01. Set allow_from to restrict updater source IPs/CIDRs. The full token is returned once. Requires dns:write when using an API key.",
    inputSchema: {
      zone_id: z.number().describe("DNS zone ID"),
      purpose: z
        .enum(["ddns", "acme"])
        .optional()
        .describe("Token purpose. ddns allows A/AAAA updates; acme allows TXT-only DNS-01 updates under _acme-challenge. Defaults to ddns."),
      name_pattern: z
        .string()
        .describe("Allowed hostname or wildcard pattern. For purpose=acme this must be _acme-challenge.<zone> or _acme-challenge.<host>.<zone>."),
      record_types: z
        .string()
        .optional()
        .describe("Allowed record types. For purpose=ddns: A, AAAA, or A,AAAA. For purpose=acme: TXT only."),
      allow_from: z
        .string()
        .optional()
        .describe("Optional comma-separated source IP/CIDR allowlist for updater requests, e.g. 203.0.113.10,2001:db8::/64."),
      rate_limit_per_minute: z
        .number()
        .optional()
        .describe("Per-token update limit, 1-120/min. Defaults to 10."),
      expires_at: z
        .string()
        .optional()
        .describe("Optional expiry date (YYYY-MM-DD or datetime)."),
    },
  },
  async ({ zone_id, purpose, name_pattern, record_types, allow_from, rate_limit_per_minute, expires_at }) => {
    const body: Record<string, unknown> = { name_pattern };
    if (purpose) body.purpose = purpose;
    if (record_types) body.record_types = record_types;
    if (allow_from) body.allow_from = allow_from;
    if (rate_limit_per_minute !== undefined) body.rate_limit_per_minute = rate_limit_per_minute;
    if (expires_at) body.expires_at = expires_at;
    const { data } = await apiRequest(
      "POST",
      `/account/dns/zones/${zone_id}/ddns-tokens`,
      body
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "revoke_ddns_token",
  {
    description: "Revoke a DNS updater token (DDNS or ACME). Requires dns:write when using an API key.",
    inputSchema: {
      zone_id: z.number().describe("DNS zone ID"),
      token_id: z.number().describe("DDNS token ID"),
    },
  },
  async ({ zone_id, token_id }) => {
    const { data } = await apiRequest(
      "DELETE",
      `/account/dns/zones/${zone_id}/ddns-tokens/${token_id}`
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

server.registerTool(
  "get_usage_statements",
  {
    description:
      "Get itemized usage-billing statements for the account (per-period totals by family, e.g. Firecracker Functions usage, VDS snapshots, AI premium). This is where metered/usage-based charges show up, separate from invoices. Paginated.",
    inputSchema: {
      page: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Page number for pagination (default 1)"),
    },
  },
  async ({ page }) => {
    const query = page !== undefined ? `?page=${page}` : "";
    const { data } = await apiRequest(
      "GET",
      `/account/history/usage-statements${query}`
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
        .enum(["vps", "vds", "ds", "firecracker"])
        .describe("Service type: vps, vds, ds, or firecracker"),
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
