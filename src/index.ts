#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { apiRequest, formatJson } from "./api.js";
import {
  applicationAccessConfigurationRequestBody,
  applicationAccessSchema,
  applicationSingleAccessSchema,
  applicationActionCancellationIsAdvertised,
  applicationActionCancellationRequestBody,
  applicationActionIdSchema,
  applicationActionSchema,
  applicationDataRestoreIdSchema,
  applicationDataRestorePointIdSchema,
  applicationDataRestoreQuoteRequestBody,
  applicationDataRestoreQuoteTokenSchema,
  applicationDataRestoreRequestBody,
  applicationExpectedVersionSchema,
  applicationInstallRequestBody,
  applicationLifecycleRequestBody,
  applicationLogMaxBytesSchema,
  applicationLogServiceSchema,
  applicationLogTailLinesSchema,
  applicationRevisionSchema,
  applicationResourceCpuPercentSchema,
  applicationResourceEmailEnabledSchema,
  applicationResourceMemoryMiBSchema,
  applicationResourceNetworkMiBPerMinuteSchema,
  applicationResourceRestartDeltaSchema,
  applicationResourceThresholdRequestBody,
  applicationUpdateCandidateMatches,
  safeApplicationInspectionPayload,
  safeApplicationDataRestorePayload,
  safeApplicationDataRestorePointsPayload,
  safeApplicationDataRestoreQuotePayload,
  safeApplicationMutationPayload,
  safeApplicationRegistryCredentialPayload,
} from "./application-contract.js";
import {
  composeAdoptionIdSchema,
  composeProjectLabelSchema,
  customProjectComposeSchema,
  customProjectDefinitionRequestBody,
  customProjectEnvironmentSchema,
  customProjectIdSchema,
  customProjectNameSchema,
  customProjectRegistryCredentialIdsSchema,
  customProjectRevisionSchema,
  customProjectSecretNamesSchema,
  customProjectSecretsSchema,
  safeComposeAdoptionConfirmationPayload,
  safeComposeAdoptionPayload,
  safeContainerDiscoveryPayload,
  safeCustomProjectInstallPayload,
  safeCustomProjectPayload,
  safeCustomProjectReceiptPayload,
  safeCustomProjectValidationPayload,
} from "./custom-project-contract.js";
import {
  certificateActionRequestBody,
  certificateActionRequestSchema,
  certificateOfferGenerationSchema,
  certificateOfferIdSchema,
  certificateOrderIdSchema,
  certificateOrderInputShape,
  certificateProductIdSchema,
  safeCertificatePayload,
} from "./certificate-contract.js";
import {
  fileBrowseDirectoryEntryIdSchema,
  fileBrowseFilterSchema,
  fileBrowseIdSchema,
  fileBrowseOffsetSchema,
  fileBrowsePointIdSchema,
  fileBrowseRequestBody,
  fileBrowseRequestRejection,
  readSearchAvailable,
  safeFileBrowsePayload,
  safeFileBrowsePointsPayload,
} from "./file-restore-contract.js";
import {
  parseServiceRescueStatus,
  safeServiceRescuePayload,
  serviceRescueEnterRequestBody,
  serviceRescueImageIdSchema,
} from "./service-rescue-contract.js";
import {
  safeTempVmPayload,
  tempVmIdempotencyKeySchema,
  tempVmIdSchema,
  tempVmOsIdSchema,
  tempVmProfileSchema,
  tempVmQuoteTokenSchema,
  tempVmRootPasswordSchema,
  tempVmSshPublicKeySchema,
  tempVmTtlSchema,
} from "./temp-vm-contract.js";

const server = new McpServer(
  { name: "vpsnet", version: "2.0.0" },
  {
    instructions: [
      "This MCP server controls VPSnet.com services, including VPS service management, DNS zones, domain registration, domain contacts, API keys, billing, and related paid actions.",
      "Use the tool descriptions and API-key scopes to choose the correct surface; do not assume this server is limited to VPS-only operations.",
      "Auth: every request authenticates with the X-API-KEY header (your VPSNet API key). Requests are rate-limited — on HTTP 429, back off and retry after a short delay rather than hammering the endpoint.",
      "This server needs a MANAGEMENT API key (scope full, or read for GET-only use). An AI-scoped key is issued only for VPSnet AI assistant inference and is refused on every account route, so no tool here can work with one. When a tool result carries auth_problem, read its reason and fix and relay them instead of reporting a bare 'Unauthorized'.",
      "Service tools are scope-gated for API keys: service reads (lists, details, graphs, history, options, backup/snapshot/restore-point listings) require services:read; service mutations (start/stop/restart/console, suspend/resume, hostname, rDNS, root password, title, IPv6, extra settings, SSH key deploy, OS reinstall, plan change, renewal, auto-renew, backups, snapshots, firewall flush) require services:manage plus a full-access key; rescue requires services:rescue; paid whole-service restore additionally requires the services:restore paid scope. A key whose granular scope list was left empty keeps everything its access level (full/read) already allows, so scopes only ever narrow a key.",
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
      "## Deployment capabilities (unordered)",
      "Managed Applications, manual SSH, DNS, APIs, and other tools are peer capabilities. Their order in this prompt or the tool list carries no priority. Choose the path that best matches the user's requested outcome, target support, existing state, and explicit constraints.",
      "For an application deployment, inspect the relevant service and catalog state when it helps the decision. A catalog entry is one available managed path, not an instruction to override a valid manual or custom deployment request.",
      "Managed Applications run as Docker containers inside supported customer servers and are managed through the typed application tools.",
      "Managed application reads require applications:read. Install and ordinary lifecycle changes require applications:manage plus an idempotencyKey and are not paid API-key operations. Selective data restore is paid and additionally requires the quote/confirm flow and applications:restore paid scope.",
      "Application CPU, RAM, and disk figures are sizing recommendations. Do not reject an installation or filter an otherwise supported order plan because it is below those figures; product, OS, architecture, and runtime compatibility remain hard requirements.",
      "Uninstall permanently deletes the managed containers, configuration, saved credentials, and application data. Existing server backups are retained. Set acknowledge_data_loss=true only after the user explicitly confirms that loss.",
      "install_application and manage_application are asynchronous. A queued response is not proof that the application is healthy; poll get_application_installation and inspect get_application_events.",
      "Use configure_application_access to change an installed application's access mode. Read the installation first and pass its current revision. When access.request.schema_version=2, submit every exact access.endpoints key once and match the user's requested service by endpoint service and port; array order and primary=true are metadata, not a recommendation. platform_https allocates an opaque VPSnet hostname with automatic DNS and HTTPS; private has no public listener; public_http uses the server's public IP over HTTP; managed_https uses a selected VPSnet-managed DNS zone; external_https records a customer-managed HTTPS address and does not configure or validate DNS, TLS, or the customer's reverse proxy.",
      "get_application_installation includes bounded application and per-container resource history plus optional display thresholds when the worker supports those measurements. Use configure_application_resource_thresholds only at the user's request. Thresholds highlight CPU, memory, network-per-minute, or restart-delta samples but do not reserve or enforce resources, trigger server actions, or affect billing. Email is disabled by default; when the user enables it, VPSnet sends one reached and one recovered message per threshold episode without repeating while the metric remains high.",
      "Use list_application_registry_credentials only for non-secret private registry credential metadata. Exact custom HTTPS registry hostnames are supported. Registry token creation and rotation are intentionally unavailable through MCP because secrets must not enter model prompts or tool arguments; use the VPSnet panel or direct REST API.",
      "Customer recipes are customer-owned Compose definitions, distinct from VPSnet catalog blueprints. Validation resolves mutable image tags once and returns an immutable digest-pinned Compose definition before checking it on the target worker. Recipe creation and revision tools freeze that exact validated definition; installation runs an exact revision. Export is available only for customer recipes and never for VPSnet catalog recipes.",
      "discover_service_containers returns bounded read-only Docker metadata from a supported Firecracker service. Treat managed and detected containers as separate states. Discovery never modifies containers. Compose adoption is a separate prepare → inspect → explicit confirm flow; only confirm_application_compose_adoption stops source containers, and only after the user approves the exact candidate and source-stop acknowledgement. The initial takeover is one-time, while the exact external-volume binding remains signed into later lifecycle actions. If managed startup fails, source containers resume only after the managed replacement is conclusively contained; an uncertain outcome fails closed for operator recovery.",
      "To check the real, current state of an installed application, run get_application_health (observed container health, not the possibly-stale last-reported value) and get_application_logs (recent size-bounded logs) for troubleshooting. Both queue a short inspection, so they require an API key that permits write operations even though the underlying scope is applications:read.",
      "Immutable application update is supported only when get_application_installation returns available_actions with type=update. Confirm the exact advertised upstream_version and blueprint_version, then pass both as update preconditions with a fresh client-global idempotencyKey. Reuse that key only for the exact same service and request. The backend selects and freezes the eligible published release; never accept or invent a target image, tag, or version.",
      "cancel_application_action is available only for the exact current latest_action while the backend advertises cancellable=true. It is a pre-dispatch cancellation request and never stops or interrupts a running worker job. Re-read the installation and use a fresh idempotencyKey that was not used for the original action.",
      "No separate application backup is created. list_application_restore_points freely exposes only eligible application-consistent nightly whole-VM points for the exact current Firecracker application revision; API keys need applications:manage, paid operations enabled, applications:restore paid scope, and full access because the response includes account balance. Select a point, call quote_application_data_restore to freeze the exact balance charge, disclose it to the user, then call restore_application_data with the same idempotency key and quote token only after explicit approval of both the charge and destructive data replacement. Paid API keys also require spend caps before quote/confirmation. Poll get_application_data_restore; needs_attention is not success and keeps mutations locked. Never ask for or invent PBS credentials, archive IDs, devices, or filesystem paths.",
      "Installation list and detail responses carry a capabilities block for the service's platform: data_restore, console, compose_adoption, custom_projects, and log_service_filter. Treat it as the authority on what is possible for that installation. Do not offer selective data restore when data_restore is false, do not offer Compose adoption or customer recipes when their flags are false, and do not pass a per-service log filter when log_service_filter is false. A separate access.capabilities.can_configure flag governs whether the access mode may be changed.",
      "Never repeat application variable values in summaries or approval text. Refer only to variable names, especially for passwords, tokens, and secrets.",
      "Use manual SSH deployment when it best matches the requested result or the user explicitly requests a custom installation. Do not present a manual deployment as a VPSnet-managed catalog installation.",
      "Service rescue is a separate recovery path for Firecracker VPS and Cloud VPS. Always call get_service_rescue first. Entering rescue restarts the service; call enter_service_rescue only after the user explicitly approves the restart and exact image returned by the capability response. Firecracker exposes the customer filesystem at /mnt/customer; Cloud VPS uses the operator recovery ISO and noVNC. Exit restores the exact original boot and running/stopped state. If exit returns needs_attention, retry exit_service_rescue with the same idempotency key. Never ask for or invent provider nodes, VM IDs, ISO paths, operation nonces, or rollback configuration.",
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
      "KVM/Cloud VPS and Firecracker disks cannot be shrunk. A lower plan may reduce CPU or RAM only when its effective disk remains unchanged or grows; get_plan_options/get_plan_resources and backend validation reject smaller target disks.",
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
      "PTR / reverse DNS is NOT managed through DNS zones here. Use get_rdns, change_rdns, or clear_rdns for service reverse DNS.",
      "To point a domain/hostname at a VPSNet service, prefer list_service_dns_options → attach_service_dns_record (validates the IP belongs to the service and defaults A/AAAA to the service IP). Use upsert_dns_record only for arbitrary record content.",
      "",
      "## Snapshots, restore and Firecracker Functions",
      "VPS product facts (unordered): 'firecracker' is VPS using Firecracker microVMs for Linux workloads; 'vds' is Cloud VPS (KVM) with High Availability, replicated Ceph NVMe storage, and Linux/Windows/BSD support; 'vps' is Container VPS using container virtualization; 'ds' is a dedicated single-tenant server. Match the user's requirements and returned plan capabilities; list position is not a recommendation. Snapshot tools: Cloud VPS uses list/create/rollback/delete_snapshot; Firecracker VPS uses the *_firecracker_snapshot tools (temporary: free window, then billed per GB while kept, auto-expire). Firecracker Functions is a separate usage-billed service with create/update/invoke/list tools, not part of ordering or managing a VPS, Cloud VPS, or Dedicated service.",
      "Snapshot-first is a default habit ON SERVICES THAT SUPPORT SNAPSHOTS — only Cloud VPS (vds) and Firecracker VPS have snapshots; Container VPS (vps) and Dedicated (ds) do NOT. Where supported, take a snapshot before any risky, destructive, or automated change (reinstall, rollback, bulk edits, unattended scripts) — it's free for an initial window, so it's cheap insurance you can roll back to. DELETE the snapshot once the change succeeds and you no longer need it — after the free window it is billed per GB while kept (Cloud VPS snapshots do NOT auto-expire), so never leave snapshots lying around. For Container VPS and Dedicated (no snapshots), be extra careful with destructive actions since there is no rollback safety net.",
      "Snapshot rollback is DESTRUCTIVE (disk state after the snapshot is lost) — always confirm with the user first.",
      "Cloud VPS and Firecracker VPS have automatic daily off-node backups. Restoring is PAID: get_restore_status shows the price, list_restore_points shows points, request_restore charges the account balance immediately and overwrites the service disk — confirm point and price with the user first. request_restore performs the server quote → confirm flow itself with one Idempotency-Key; API keys need services:read, full access, paid operations enabled, the services:restore paid scope, and spend caps.",
      "Looking INSIDE a backup is free and completely separate from paying to restore. list_restore_file_points, browse_restore_files, and get_restore_file_browse only read a backup's directory listing: they never charge the account, never overwrite the disk, and never restore a file. Browsing is asynchronous — poll get_restore_file_browse until state is succeeded. The server selects pages of 200 or 1,000 entries: keep paging with offset=result.nextOffset while nextOffset is non-null, use result.pageSize rather than assuming 200 when moving backwards, and say so when you are showing one page of a larger directory. Branch on result.listingStatus rather than on truncated alone — truncated=true with nextOffset=null is a legitimate capped scan (listingStatus 'partial'): that listing is a bounded slice that cannot be paged further, so present it as a lower bound instead of retrying. Folder search (the filter argument) needs a node capability that older workers lack; check searchAvailable from list_restore_file_points first. If search is unavailable the tool returns an error rather than an unfiltered listing — never present unfiltered entries as search results. Restoring selected files back onto the server is a paid operation that is not exposed here; direct the user to the VPSnet panel for it.",
      "Firecracker Functions run code in isolated microVMs and are usage-billed per invocation. create_function needs name, runtime_os_id and code; invoke_function with wait=true returns the result synchronously. Webhook-enabled functions get a public webhook URL for external triggers.",
      "On-demand servers are a coming-soon Firecracker compute service with full root SSH access. Customer quote/create operations are disabled and return tempVmComingSoon before payment or allocation. Use get_temp_vm_options to inspect the launch state; read and delete operations remain available for discovery and cleanup of existing test sessions.",
      "To select a non-default on-demand server OS, use the selected profile's plan_id with get_order_options and pass an enabled non-runtime Firecracker guest OS ID. Omit os_id when there is no specific OS requirement; never invent an ID or use a Functions runtime image.",
      "Before update_function, call get_function. If integrity.unreadable_fields names code or environment, do not update until the user explicitly approves replacing every unavailable value from a trusted copy. Only then pass acknowledge_unreadable_replacement=true. The backend rejects an unacknowledged replacement; never set the flag for an ordinary update.",
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
      "",
      "## Paid TLS certificates",
      "Paid TLS certificates are portable account products, not managed-application-only features. They can be installed on customer Nginx, Apache, lighttpd, OpenLiteSpeed, HAProxy, Caddy, mail, API, load-balancer, or other TLS endpoints.",
      "Automatic HTTPS for VPSnet-managed applications is a separate integrated feature. Do not place a paid certificate order merely because an application already has automatic platform HTTPS.",
      "Flow: list_certificate_catalog → quote_certificate → order_certificate. The quote returns the final customer price in EUR including VAT, a short-lived quote token, and the exact public-key type derived from the CSR. Disclose the exact total and obtain explicit approval before ordering.",
      "The customer creates and retains the private key. Certificate tools accept only a signed public PKCS#10 CSR. Never ask for, accept, store, repeat, or place a private key in a tool argument or model context.",
      "Use the same client-global idempotencyKey and exact unchanged order fields for quote_certificate and order_certificate. API keys require certificates:read for reads, certificates:manage for management, and paid operations plus certificates:order and spend caps for quote/order.",
      "Certificate renewal is a separately paid successor order. Set renewal_of only for the exact eligible active certificate returned by list_certificates during its renewal window; never invent an earlier certificate identity.",
      "A queued or paid order is not proof of issuance. Poll get_certificate and get_certificate_validation. attention_required is not success. download_certificate returns only the public leaf and chain and explicitly never returns a private key.",
      "Management actions are durable and idempotent. Reuse an idempotency key only for an exact retry of the same action. If an outcome is reconciliation_required or outcome_ambiguous, use refresh_certificate and read state; do not submit the mutation again with a new key.",
    ].join("\n"),
  }
);

// Helper to build service settings path
const svc = (orderNo: string, action: string) =>
  `/account/services/${orderNo}/${action}`;

const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(190)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,189}$/);

const paidIdempotencyKeySchema = idempotencyKeySchema
  .min(16)
  .describe(
    "Client-global unique key of at least 16 characters for one exact paid operation."
  );

const serviceOrderNoSchema = z
  .string()
  .min(1)
  .max(64)
  .describe("Tenant-owned service order number, e.g. VP88318");

const serviceHostnameSchema = z
  .string()
  .min(3)
  .max(154)
  .refine((hostname) => {
    const labels = hostname.split(".");
    return (
      labels.length <= 5 &&
      labels.every((label) =>
        /^(?!-)[A-Za-z0-9-]{1,30}(?<!-)$/u.test(label)
      )
    );
  }, "Hostname must contain at most five 1-30 character DNS labels")
  .describe(
    "Customer hostname: 3-154 ASCII characters, at most five labels, each 1-30 alphanumeric/hyphen characters without a leading or trailing hyphen"
  );

const serviceIpSchema = z
  .string()
  .refine((value) => isIP(value) !== 0, "A valid IPv4 or IPv6 address is required")
  .describe("Assigned IPv4 or IPv6 address returned by get_rdns");

const servicePtrSchema = z
  .string()
  .refine((value) => {
    const canonical = value.trim().replace(/\.+$/u, "").toLowerCase();
    return (
      canonical.length >= 3 &&
      canonical.length <= 253 &&
      canonical.includes("vpsnet") === false &&
      canonical.split(".").every((label) =>
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)
      )
    );
  }, "PTR must be a 3-253 character hostname with 1-63 character labels and no reserved VPSnet name")
  .describe(
    "PTR hostname. Canonical length 3-253, labels 1-63 ASCII alphanumeric/hyphen characters, no leading/trailing hyphen; an optional trailing dot is removed"
  );

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

function applicationPath(orderNo: string, suffix: string): string {
  return `/account/services/${encodeURIComponent(orderNo)}/applications/${suffix}`;
}

function safeApplicationMutationResult(
  status: number,
  data: unknown,
  orderNo: string
): string {
  return formatJson(
    safeApplicationMutationPayload(
      status,
      data,
      `/management/service/${encodeURIComponent(orderNo)}/applications`
    )
  );
}

function safeApplicationInspectionResult(
  status: number,
  data: unknown,
  kind: "health" | "logs"
): string {
  return formatJson(safeApplicationInspectionPayload(status, data, kind));
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
      "List all active VPS services with state, plan, IPs, and expiry Requires services:read when called with an API key.",
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
    description:
      "Get detailed info for a service by order number. Resource-usage rows include available; false means the numeric zero is a compatibility placeholder, not a measurement. Requires services:read when called with an API key.",
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
    description: "Get performance graphs (CPU, RAM, disk, network) Requires services:read when called with an API key.",
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
    description: "Get action history for a service Requires services:read when called with an API key.",
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

server.registerTool(
  "get_service_rescue",
  {
    description:
      "Get operator rescue capability and the current durable rescue session for one owned Firecracker VPS or Cloud VPS. Requires services:read. Provider identifiers, ISO paths, nonces, and rollback state are never returned.",
    inputSchema: {
      orderNo: serviceOrderNoSchema,
    },
    annotations: {
      title: "Get service rescue status",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orderNo }) => {
    const { status, data } = await apiRequest(
      "GET",
      svc(encodeURIComponent(orderNo), "rescue")
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeServiceRescuePayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "enter_service_rescue",
  {
    description:
      "Restart one owned active Firecracker VPS or Cloud VPS into an operator-owned rescue system. Read get_service_rescue first and use an exact advertised image ID. This interrupts every running service. Call only after the user explicitly confirms the target service, rescue image, and reboot. Requires services:rescue, full API-key access, and a fresh idempotencyKey.",
    inputSchema: {
      orderNo: serviceOrderNoSchema,
      image: serviceRescueImageIdSchema,
      acknowledge_reboot: z
        .literal(true)
        .describe("Explicit user approval that rescue entry restarts the service"),
      idempotencyKey: idempotencyKeySchema.describe(
        "Fresh stable key for this exact rescue-entry request"
      ),
    },
    annotations: {
      title: "Enter service rescue mode",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  async ({ orderNo, image, acknowledge_reboot, idempotencyKey }) => {
    if (acknowledge_reboot !== true) {
      throw new Error("Explicit reboot acknowledgement is required.");
    }

    const current = await apiRequest(
      "GET",
      svc(encodeURIComponent(orderNo), "rescue")
    );
    const statusPayload = parseServiceRescueStatus(current.data);
    const advertised = statusPayload?.rescue.capability.images.some(
      (candidate) => candidate.id === image
    );
    if (
      current.status < 200 ||
      current.status >= 300 ||
      statusPayload?.rescue.capability.enabled !== true ||
      advertised !== true
    ) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: formatJson({
            success: false,
            error_codes: ["serviceRescueImageNotAdvertised"],
          }),
        }],
      };
    }

    const { status, data } = await apiRequest(
      "POST",
      svc(encodeURIComponent(orderNo), "rescue"),
      serviceRescueEnterRequestBody(image),
      { "Idempotency-Key": idempotencyKey }
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeServiceRescuePayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "exit_service_rescue",
  {
    description:
      "Restore the exact pre-rescue boot configuration and original running or stopped state for one owned service. Read get_service_rescue first and pass its exact session UUID. This may restart the service. Call only after explicit user confirmation. Requires services:rescue, full API-key access, and a stable idempotencyKey. If the same exit reaches needs_attention, retry this tool with the same key.",
    inputSchema: {
      orderNo: serviceOrderNoSchema,
      rescue_session_id: z
        .string()
        .uuid()
        .describe("Exact current session UUID from get_service_rescue"),
      acknowledge_restart: z
        .literal(true)
        .describe("Explicit user approval to restore normal boot state"),
      idempotencyKey: idempotencyKeySchema.describe(
        "Stable key for this exact rescue exit; reuse it for a needs_attention retry"
      ),
    },
    annotations: {
      title: "Exit service rescue mode",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  async ({
    orderNo,
    rescue_session_id,
    acknowledge_restart,
    idempotencyKey,
  }) => {
    if (acknowledge_restart !== true) {
      throw new Error("Explicit restart acknowledgement is required.");
    }

    const current = await apiRequest(
      "GET",
      svc(encodeURIComponent(orderNo), "rescue")
    );
    const statusPayload = parseServiceRescueStatus(current.data);
    const currentSession = statusPayload?.rescue.session;
    if (
      current.status < 200 ||
      current.status >= 300 ||
      !currentSession ||
      currentSession.id !== rescue_session_id ||
      !["active", "needs_attention"].includes(currentSession.state)
    ) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: formatJson({
            success: false,
            error_codes: ["serviceRescueSessionNotCurrent"],
          }),
        }],
      };
    }

    const { status, data } = await apiRequest(
      "DELETE",
      svc(encodeURIComponent(orderNo), "rescue"),
      undefined,
      { "Idempotency-Key": idempotencyKey }
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeServiceRescuePayload(status, data)),
      }],
    };
  }
);

// --- Managed Applications ---

server.registerTool(
  "list_application_catalog",
  {
    description:
      "List catalog applications compatible with one owned VPSnet service. Use this before a generic SSH installation and before install_application. The response includes application details, container runtime, configuration fields, hard product/OS/architecture/runtime compatibility, and advisory CPU/RAM/disk sizing warnings. Resource guidance alone must not block installation. Two blocks state what an install needs before you attempt it: target.install_requirements.runtime_restart_consent says whether this server still needs explicit restart consent, and each entry's secret_delivery says whether that release generates a password revealed only once and lists those credential NAMES. Those credentials often do not appear in configuration, which lists only customer-editable fields. Requires applications:read.",
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
  "list_application_registry_credentials",
  {
    description:
      "List non-secret private registry credential metadata for one owned service, including Docker Hub, GHCR, and exact custom HTTPS registry hostnames. Token values, encrypted envelopes, fingerprints, and key versions are never returned. Registry token creation and rotation are intentionally unavailable through MCP; use the VPSnet panel or direct REST API so the token does not enter model context. Requires applications:read.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
    },
    annotations: {
      title: "List application registry credentials",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orderNo }) => {
    const { status, data } = await apiRequest(
      "GET",
      applicationPath(orderNo, "registry-credentials")
    );
    return {
      content: [{
        type: "text",
        text: formatJson(
          safeApplicationRegistryCredentialPayload(status, data)
        ),
      }],
    };
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
      "Get customer-safe observed state, health, drift, endpoints, components, bounded application/container resource history, optional display thresholds, and latest action for one owned managed application. Container samples expose only Compose service and ordinal; Docker identities and internal generation digests are withheld. Requires applications:read.",
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
  "configure_application_resource_thresholds",
  {
    description:
      "Replace the complete optional resource-threshold set and email preference for one owned managed application. Read get_application_installation first. Omitted or null numeric fields disable that threshold; omitted email_enabled is false; omitting all four thresholds clears the preferences and disables email. Thresholds highlight measured CPU, memory, combined network-per-minute, and restart-delta samples. When email is enabled, VPSnet sends one account email when a configured threshold is reached and one when it recovers, without repeating while it remains high. Thresholds do not reserve or enforce resources, restart containers, or affect billing. Confirm the exact thresholds and email preference with the user first. Requires applications:manage and is not a paid API-key operation.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      installation_id: applicationInstallationIdSchema,
      cpu_percent: applicationResourceCpuPercentSchema,
      email_enabled: applicationResourceEmailEnabledSchema,
      memory_mib: applicationResourceMemoryMiBSchema,
      network_mib_per_minute: applicationResourceNetworkMiBPerMinuteSchema,
      restart_delta: applicationResourceRestartDeltaSchema,
      confirmed: z
        .literal(true)
        .describe("True only after the user confirmed the complete threshold set"),
    },
    annotations: {
      title: "Configure application resource thresholds",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({
    orderNo,
    installation_id,
    cpu_percent,
    email_enabled,
    memory_mib,
    network_mib_per_minute,
    restart_delta,
  }) => {
    const { data } = await apiRequest(
      "PUT",
      applicationPath(
        orderNo,
        `installations/${encodeURIComponent(installation_id)}/resource-thresholds`
      ),
      applicationResourceThresholdRequestBody({
        cpuPercent: cpu_percent,
        emailEnabled: email_enabled,
        memoryMiB: memory_mib,
        networkMiBPerMinute: network_mib_per_minute,
        restartDelta: restart_delta,
      })
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

const INSPECTION_TERMINAL_STATES = new Set(["succeeded", "failed", "expired"]);

type InspectionEnvelope = { inspection?: { id?: string; state?: string } };

async function inspectionSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// Queue an on-demand health/logs inspection and poll until it reaches a
// terminal state or the poll budget (~30s) is exhausted. The backend dedupes an
// already-active inspection of the same kind, so no idempotency key is needed.
async function runApplicationInspection(
  orderNo: string,
  installationId: string,
  kind: "health" | "logs",
  body?: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  const basePath = applicationPath(
    orderNo,
    `installations/${encodeURIComponent(installationId)}/inspections`
  );
  const created = await apiRequest("POST", `${basePath}/${kind}`, body);
  if (created.status >= 400) {
    return created;
  }

  const initial = (created.data as InspectionEnvelope)?.inspection;
  const inspectionId = initial?.id;
  if (!inspectionId || INSPECTION_TERMINAL_STATES.has(String(initial?.state))) {
    return created;
  }

  let latest = created;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await inspectionSleep(2000);
    latest = await apiRequest(
      "GET",
      `${basePath}/${encodeURIComponent(inspectionId)}`
    );
    if (latest.status >= 400) {
      return latest;
    }

    const polled = (latest.data as InspectionEnvelope)?.inspection;
    if (polled && INSPECTION_TERMINAL_STATES.has(String(polled.state))) {
      break;
    }
  }

  return latest;
}

type ApplicationAsyncEnvelope = {
  id?: string;
  state?: string;
};

function applicationAsyncEnvelope(
  data: unknown,
  key: "validation" | "discovery" | "adoption"
): ApplicationAsyncEnvelope {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const value = (data as Record<string, unknown>)[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ApplicationAsyncEnvelope)
    : {};
}

async function runApplicationAsyncOperation(
  createPath: string,
  pollPath: (id: string) => string,
  key: "validation" | "discovery" | "adoption",
  body?: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  const created = await apiRequest("POST", createPath, body);
  if (created.status >= 400) return created;

  const initial = applicationAsyncEnvelope(created.data, key);
  if (
    !initial.id
    || INSPECTION_TERMINAL_STATES.has(String(initial.state))
  ) {
    return created;
  }

  let latest = created;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await inspectionSleep(2000);
    latest = await apiRequest(
      "GET",
      pollPath(encodeURIComponent(initial.id))
    );
    if (latest.status >= 400) return latest;

    const polled = applicationAsyncEnvelope(latest.data, key);
    if (INSPECTION_TERMINAL_STATES.has(String(polled.state))) break;
  }

  if (key !== "validation" || latest.status >= 400) return latest;

  const createdPayload = created.data && typeof created.data === "object"
    && !Array.isArray(created.data)
    ? created.data as Record<string, unknown>
    : {};
  const latestPayload = latest.data && typeof latest.data === "object"
    && !Array.isArray(latest.data)
    ? latest.data as Record<string, unknown>
    : {};
  const createdValidation = createdPayload.validation
    && typeof createdPayload.validation === "object"
    && !Array.isArray(createdPayload.validation)
    ? createdPayload.validation as Record<string, unknown>
    : {};
  const latestValidation = latestPayload.validation
    && typeof latestPayload.validation === "object"
    && !Array.isArray(latestPayload.validation)
    ? latestPayload.validation as Record<string, unknown>
    : {};

  return {
    status: latest.status,
    data: {
      ...latestPayload,
      replayed: createdPayload.replayed === true,
      validation: {
        ...latestValidation,
        source_compose_digest: createdValidation.source_compose_digest,
        resolved_compose_yaml: createdValidation.resolved_compose_yaml,
        image_resolutions: createdValidation.image_resolutions,
      },
    },
  };
}

function applicationRecipeValidationPassed(data: unknown): boolean {
  const validation = applicationAsyncEnvelope(data, "validation");
  if (validation.state !== "succeeded") return false;
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const value = (data as Record<string, unknown>).validation;
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as Record<string, unknown>).valid === true
  );
}

function applicationRecipeResolvedCompose(data: unknown): string | null {
  if (!applicationRecipeValidationPassed(data)) return null;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const value = (data as Record<string, unknown>).validation;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const compose = (value as Record<string, unknown>).resolved_compose_yaml;
  return typeof compose === "string" && compose.length > 0
    && compose.length <= 262144
    ? compose
    : null;
}

server.registerTool(
  "get_application_health",
  {
    description:
      "Run an on-demand health inspection of one owned managed application and return the observed container/service health. Use this instead of trusting the last-reported health, which can be stale. This queues an inspection (a POST), so it needs an API key that permits write operations; a read-only key is rejected. Requires applications:read.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      installation_id: applicationInstallationIdSchema,
    },
    annotations: {
      title: "Inspect managed application health",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orderNo, installation_id }) => {
    const { status, data } = await runApplicationInspection(
      orderNo,
      installation_id,
      "health"
    );
    return {
      content: [{ type: "text", text: safeApplicationInspectionResult(status, data, "health") }],
    };
  }
);

server.registerTool(
  "get_application_logs",
  {
    description:
      "Run an on-demand logs inspection of one owned managed application and return recent, size-bounded container logs for troubleshooting. Optionally select one exact Compose service; omit it to inspect all services. This queues an inspection (a POST), so it needs an API key that permits write operations; a read-only key is rejected. Requires applications:read.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      installation_id: applicationInstallationIdSchema,
      tail_lines: applicationLogTailLinesSchema,
      max_bytes: applicationLogMaxBytesSchema,
      service: applicationLogServiceSchema,
    },
    annotations: {
      title: "Inspect managed application logs",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orderNo, installation_id, tail_lines, max_bytes, service }) => {
    const body: Record<string, unknown> = {};
    if (typeof tail_lines === "number") {
      body.tailLines = tail_lines;
    }

    if (typeof max_bytes === "number") {
      body.maxBytes = max_bytes;
    }

    if (typeof service === "string") {
      body.service = service;
    }

    const { status, data } = await runApplicationInspection(
      orderNo,
      installation_id,
      "logs",
      Object.keys(body).length > 0 ? body : undefined
    );
    return {
      content: [{ type: "text", text: safeApplicationInspectionResult(status, data, "logs") }],
    };
  }
);

server.registerTool(
  "list_application_restore_points",
  {
    description:
      "Freely list opaque, unexpired nightly whole-VM backup points eligible to restore the exact current revision of one managed application, plus the current non-binding price and account-balance estimate. This does not create a backup, reserve funds, charge the account, or return PBS repository, archive, key, device, or filesystem-path details. It also returns the active restore after a client reload. Initially supported only on Firecracker services. API keys require applications:manage, paid operations enabled, applications:restore paid scope, and full access because account balance is included.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      installation_id: applicationInstallationIdSchema,
    },
    annotations: {
      title: "List application restore points",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orderNo, installation_id }) => {
    const { status, data } = await apiRequest(
      "GET",
      applicationPath(
        orderNo,
        `installations/${encodeURIComponent(installation_id)}/restore-points`
      )
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeApplicationDataRestorePointsPayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "quote_application_data_restore",
  {
    description:
      "Create a short-lived quote for one exact application restore selection. This does not charge or restore anything. Read get_application_installation and list_application_restore_points first, then disclose quote.total_charged and available balance to the user. For API keys this requires paid operations enabled, applications:restore, daily/monthly spend caps, and a fresh idempotencyKey that must also be used for restore_application_data.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      installation_id: applicationInstallationIdSchema,
      backup_point_id: applicationDataRestorePointIdSchema,
      expected_revision: applicationRevisionSchema,
      idempotencyKey: paidIdempotencyKeySchema.describe(
        "Client-global unique key used for both this quote and its exact restore confirmation."
      ),
    },
    annotations: {
      title: "Quote application data restore",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({
    orderNo,
    installation_id,
    backup_point_id,
    expected_revision,
    idempotencyKey,
  }) => {
    const { status, data } = await apiRequest(
      "POST",
      applicationPath(
        orderNo,
        `installations/${encodeURIComponent(installation_id)}/restores/quote`
      ),
      applicationDataRestoreQuoteRequestBody({
        orderNo,
        backupPointId: backup_point_id,
        expectedRevision: expected_revision,
      }),
      { "Idempotency-Key": idempotencyKey }
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeApplicationDataRestoreQuotePayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "restore_application_data",
  {
    description:
      "Pay for and queue replacement of only the selected managed application's declared data from one eligible nightly server backup. First call quote_application_data_restore, disclose its exact total charge, and obtain explicit approval for both that charge and replacement of current data. Use the exact quote token and same idempotency key. The worker derives every path, excludes secrets and unrelated Docker/server data, and requires rollback capacity. Requires applications:manage; API keys additionally require paid operations, applications:restore, and spend caps.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      installation_id: applicationInstallationIdSchema,
      backup_point_id: applicationDataRestorePointIdSchema,
      expected_revision: applicationRevisionSchema,
      acknowledge_data_replacement: z
        .literal(true)
        .describe(
          "True only after the user explicitly confirms replacement of the current declared application data"
        ),
      acknowledge_restore_charge: z
        .literal(true)
        .describe(
          "True only after the user explicitly approves the exact total_charged returned by quote_application_data_restore"
        ),
      quote_token: applicationDataRestoreQuoteTokenSchema,
      idempotencyKey: paidIdempotencyKeySchema.describe(
        "Client-global unique key. Reuse it only to replay this exact restore request."
      ),
    },
    annotations: {
      title: "Restore managed application data",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  async ({
    orderNo,
    installation_id,
    backup_point_id,
    expected_revision,
    quote_token,
    idempotencyKey,
  }) => {
    const { status, data } = await apiRequest(
      "POST",
      applicationPath(
        orderNo,
        `installations/${encodeURIComponent(installation_id)}/restores`
      ),
      applicationDataRestoreRequestBody({
        orderNo,
        backupPointId: backup_point_id,
        expectedRevision: expected_revision,
        quoteToken: quote_token,
      }),
      { "Idempotency-Key": idempotencyKey }
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeApplicationDataRestorePayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "get_application_data_restore",
  {
    description:
      "Poll one tenant-bound selective application data restore. queued, running, and awaiting_reply remain active. needs_attention is not success and keeps application/service mutations locked until a signed worker result or operator verification resolves it. Requires applications:read.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      installation_id: applicationInstallationIdSchema,
      restore_id: applicationDataRestoreIdSchema,
    },
    annotations: {
      title: "Get application data restore",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orderNo, installation_id, restore_id }) => {
    const { status, data } = await apiRequest(
      "GET",
      applicationPath(
        orderNo,
        `installations/${encodeURIComponent(installation_id)}/restores/${encodeURIComponent(restore_id)}`
      )
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeApplicationDataRestorePayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "validate_application_recipe",
  {
    description:
      "Resolve image tags to immutable digests, then validate the resulting customer-owned Docker Compose document with the authoritative policy on the target Firecracker worker. The successful result includes the exact digest-pinned definition to store. This does not create, install, or modify a project or container. The queued validation is polled for about 30 seconds and may still return pending. Requires applications:manage.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      compose_yaml: customProjectComposeSchema,
      registry_credential_ids: customProjectRegistryCredentialIdsSchema,
    },
    annotations: {
      title: "Validate customer application recipe",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orderNo, compose_yaml, registry_credential_ids }) => {
    const basePath = applicationPath(orderNo, "custom-projects");
    const { status, data } = await runApplicationAsyncOperation(
      `${basePath}/validate`,
      (id) => `${basePath}/validations/${id}`,
      "validation",
      { compose_yaml, registry_credential_ids }
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeCustomProjectValidationPayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "list_application_recipes",
  {
    description:
      "List immutable customer-owned application recipe projects for one supported service. These are separate from VPSnet catalog blueprints. Requires applications:read.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
    },
    annotations: {
      title: "List customer application recipes",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orderNo }) => {
    const { status, data } = await apiRequest(
      "GET",
      applicationPath(orderNo, "custom-projects")
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeCustomProjectPayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "list_application_recipe_revisions",
  {
    description:
      "List immutable revision metadata for one customer-owned application recipe. No Compose content or secret values are returned. Requires applications:read.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      project_id: customProjectIdSchema,
    },
    annotations: {
      title: "List customer recipe revisions",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orderNo, project_id }) => {
    const { status, data } = await apiRequest(
      "GET",
      applicationPath(
        orderNo,
        `custom-projects/${encodeURIComponent(project_id)}/revisions`
      )
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeCustomProjectPayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "create_application_recipe",
  {
    description:
      "Resolve image tags, validate the resulting digest-pinned Compose definition, and freeze that exact definition as the first immutable customer-owned recipe revision. This saves a definition only and does not install or start containers. Plain environment values belong in env; secret_names contain names only. Confirm the exact service, name, Compose definition, variable names, and registry bindings first. Requires applications:manage.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      name: customProjectNameSchema,
      compose_yaml: customProjectComposeSchema,
      env: customProjectEnvironmentSchema,
      secret_names: customProjectSecretNamesSchema,
      registry_credential_ids: customProjectRegistryCredentialIdsSchema,
      idempotencyKey: idempotencyKeySchema.describe(
        "Client-global unique key. Reuse it only to replay this exact recipe creation request."
      ),
      confirmed: z.literal(true).describe(
        "True only after the user confirmed this immutable recipe definition"
      ),
    },
    annotations: {
      title: "Create customer application recipe",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({
    orderNo,
    name,
    compose_yaml,
    env,
    secret_names,
    registry_credential_ids,
    idempotencyKey,
  }) => {
    const basePath = applicationPath(orderNo, "custom-projects");
    const validation = await runApplicationAsyncOperation(
      `${basePath}/validate`,
      (id) => `${basePath}/validations/${id}`,
      "validation",
      { compose_yaml, registry_credential_ids }
    );
    if (
      validation.status >= 400
      || !applicationRecipeValidationPassed(validation.data)
    ) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: formatJson(
            safeCustomProjectValidationPayload(
              validation.status,
              validation.data
            )
          ),
        }],
      };
    }

    const resolvedCompose = applicationRecipeResolvedCompose(validation.data);
    if (resolvedCompose === null) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: formatJson(
            safeCustomProjectValidationPayload(
              validation.status,
              validation.data
            )
          ),
        }],
      };
    }

    const { status, data } = await apiRequest(
      "POST",
      basePath,
      {
        name,
        ...customProjectDefinitionRequestBody({
          compose_yaml: resolvedCompose,
          env,
          secret_names,
          registry_credential_ids,
        }),
      },
      { "Idempotency-Key": idempotencyKey }
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeCustomProjectPayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "create_application_recipe_revision",
  {
    description:
      "Resolve image tags, validate the resulting digest-pinned Compose definition, and freeze that exact definition as a later immutable customer-owned recipe revision. This does not update the running installation. In-place updates retain the existing secret names and registry bindings for rollback safety; create a separate project when those bindings must change. Requires applications:manage.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      project_id: customProjectIdSchema,
      compose_yaml: customProjectComposeSchema,
      env: customProjectEnvironmentSchema,
      secret_names: customProjectSecretNamesSchema,
      registry_credential_ids: customProjectRegistryCredentialIdsSchema,
      idempotencyKey: idempotencyKeySchema.describe(
        "Client-global unique key. Reuse it only to replay this exact immutable revision request."
      ),
      confirmed: z.literal(true).describe(
        "True only after the user confirmed this immutable recipe revision"
      ),
    },
    annotations: {
      title: "Create customer recipe revision",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({
    orderNo,
    project_id,
    compose_yaml,
    env,
    secret_names,
    registry_credential_ids,
    idempotencyKey,
  }) => {
    const basePath = applicationPath(orderNo, "custom-projects");
    const validation = await runApplicationAsyncOperation(
      `${basePath}/validate`,
      (id) => `${basePath}/validations/${id}`,
      "validation",
      { compose_yaml, registry_credential_ids }
    );
    if (
      validation.status >= 400
      || !applicationRecipeValidationPassed(validation.data)
    ) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: formatJson(
            safeCustomProjectValidationPayload(
              validation.status,
              validation.data
            )
          ),
        }],
      };
    }

    const resolvedCompose = applicationRecipeResolvedCompose(validation.data);
    if (resolvedCompose === null) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: formatJson(
            safeCustomProjectValidationPayload(
              validation.status,
              validation.data
            )
          ),
        }],
      };
    }

    const { status, data } = await apiRequest(
      "POST",
      `${basePath}/${encodeURIComponent(project_id)}/revisions`,
      customProjectDefinitionRequestBody({
        compose_yaml: resolvedCompose,
        env,
        secret_names,
        registry_credential_ids,
      }),
      { "Idempotency-Key": idempotencyKey }
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeCustomProjectPayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "export_application_recipe",
  {
    description:
      "Export one immutable customer-owned recipe revision. Secret values are never returned. VPSnet catalog recipes are not exportable through this or any other MCP tool. Requires applications:read.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      project_id: customProjectIdSchema,
      revision: customProjectRevisionSchema.optional().describe(
        "Exact revision to export; omit for the current revision"
      ),
    },
    annotations: {
      title: "Export customer application recipe",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orderNo, project_id, revision }) => {
    const query = revision === undefined
      ? ""
      : `?revision=${encodeURIComponent(String(revision))}`;
    const { status, data } = await apiRequest(
      "GET",
      `${applicationPath(
        orderNo,
        `custom-projects/${encodeURIComponent(project_id)}/export`
      )}${query}`
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeCustomProjectReceiptPayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "install_application_recipe",
  {
    description:
      "Queue installation of one exact validated customer-owned recipe revision. Confirm the service, project, revision, secret NAMES, and possible first-runtime restart first; never repeat secret values in confirmation text. The result omits secret values and hands status/reveal work to the VPSnet portal. Requires applications:manage.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      project_id: customProjectIdSchema,
      revision: customProjectRevisionSchema,
      secrets: customProjectSecretsSchema,
      acknowledge_runtime_restart: z.literal(true).optional().describe(
        "Explicit consent for a possible one-time service restart while the application runtime is prepared"
      ),
      acknowledge_recipe_risks: z.literal(true).describe(
        "Explicit acknowledgement that this is a customer-owned recipe"
      ),
      idempotencyKey: idempotencyKeySchema.describe(
        "Client-global unique key. Reuse it only to replay this exact recipe installation."
      ),
      confirmed: z.literal(true).describe(
        "True only after the user confirmed this exact installation"
      ),
    },
    annotations: {
      title: "Install customer application recipe",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({
    orderNo,
    project_id,
    revision,
    secrets,
    acknowledge_runtime_restart,
    idempotencyKey,
  }) => {
    const { status, data } = await apiRequest(
      "POST",
      applicationPath(
        orderNo,
        `custom-projects/${encodeURIComponent(project_id)}/install`
      ),
      {
        revision,
        secrets,
        acknowledgeCustomRecipeRisks: true,
        acknowledgeRuntimeRestart: acknowledge_runtime_restart === true,
      },
      { "Idempotency-Key": idempotencyKey }
    );
    return {
      content: [{
        type: "text",
        text: formatJson(
          safeCustomProjectInstallPayload(
            status,
            data,
            `/management/service/${encodeURIComponent(orderNo)}/applications`
          )
        ),
      }],
    };
  }
);

server.registerTool(
  "discover_service_containers",
  {
    description:
      "Run a bounded read-only Docker discovery on one supported Firecracker service. Returns container names, images, state, health, published ports, Compose labels, and whether each container is VPSnet-managed. It never returns environment values or mounts and does not adopt or modify containers. Requires applications:read.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
    },
    annotations: {
      title: "Discover service containers",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orderNo }) => {
    const basePath = applicationPath(orderNo, "container-discoveries");
    const { status, data } = await runApplicationAsyncOperation(
      basePath,
      (id) => `${basePath}/${id}`,
      "discovery"
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeContainerDiscoveryPayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "prepare_application_compose_adoption",
  {
    description:
      "Prepare and poll a short-lived, read-only takeover candidate for one exact unmanaged Compose project from a fresh discovery. The worker verifies container identity, immutable image identity, restart policy, Compose safety, and exclusive local named-volume ownership. Returns only a scrubbed Compose file, variable names, and bounded counts; never variable values, source paths, commands, or unrestricted labels. This tool does not stop or replace containers. Requires applications:manage.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      discovery_id: z.string().uuid().describe(
        "Fresh discovery UUID returned by discover_service_containers"
      ),
      compose_project: composeProjectLabelSchema,
    },
    annotations: {
      title: "Prepare Compose project adoption",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orderNo, discovery_id, compose_project }) => {
    const discoveryPath = applicationPath(
      orderNo,
      `container-discoveries/${encodeURIComponent(discovery_id)}`
    );
    const { status, data } = await runApplicationAsyncOperation(
      `${discoveryPath}/adoptions`,
      (id) => applicationPath(
        orderNo,
        `compose-adoptions/${id}`
      ),
      "adoption",
      { compose_project }
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeComposeAdoptionPayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "get_application_compose_adoption",
  {
    description:
      "Poll one tenant-bound Compose adoption candidate. Inspect eligibility, the reconstructed Compose file, all variable names, container count, and data-volume count before requesting destructive confirmation. Requires applications:read.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      adoption_id: composeAdoptionIdSchema,
    },
    annotations: {
      title: "Get Compose project adoption",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orderNo, adoption_id }) => {
    const { status, data } = await apiRequest(
      "GET",
      applicationPath(
        orderNo,
        `compose-adoptions/${encodeURIComponent(adoption_id)}`
      )
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeComposeAdoptionPayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "confirm_application_compose_adoption",
  {
    description:
      "Confirm the one-time takeover of an eligible unexpired Compose candidate. Re-enter every declared variable because VPSnet never reads or copies existing values. This destructive operation revalidates the exact source, stops its containers, and starts a managed replacement with the same verified local named volumes. On failure, source containers resume only after the managed replacement is conclusively contained; otherwise recovery fails closed. The exact external-volume binding remains signed into later lifecycle actions. Confirm the exact service, candidate, reconstructed recipe, variable NAMES, container/volume counts, and source-stop impact with the user first. Never repeat secret values in approval text or results. Requires applications:manage.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      adoption_id: composeAdoptionIdSchema,
      name: customProjectNameSchema,
      env: customProjectEnvironmentSchema,
      secrets: customProjectSecretsSchema,
      registry_credential_ids: customProjectRegistryCredentialIdsSchema,
      acknowledge_source_stop: z.literal(true).describe(
        "True only after the user approved stopping the exact source containers during takeover"
      ),
      acknowledge_recipe_risks: z.literal(true).describe(
        "True only after the user approved the reconstructed customer-owned recipe"
      ),
      acknowledge_runtime_restart: z.literal(true).optional().describe(
        "Explicit consent for a possible one-time service restart while the application runtime is prepared"
      ),
      idempotencyKey: idempotencyKeySchema.describe(
        "Client-global unique key. Reuse it only to replay this exact adoption confirmation."
      ),
      confirmed: z.literal(true).describe(
        "True only after the user confirmed this exact destructive takeover"
      ),
    },
    annotations: {
      title: "Confirm Compose project adoption",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  async ({
    orderNo,
    adoption_id,
    name,
    env,
    secrets,
    registry_credential_ids,
    acknowledge_runtime_restart,
    idempotencyKey,
  }) => {
    const { status, data } = await apiRequest(
      "POST",
      applicationPath(
        orderNo,
        `compose-adoptions/${encodeURIComponent(adoption_id)}/confirm`
      ),
      {
        name,
        env,
        secrets,
        registry_credential_ids,
        acknowledgeSourceStop: true,
        acknowledgeCustomRecipeRisks: true,
        acknowledgeRuntimeRestart: acknowledge_runtime_restart === true,
      },
      { "Idempotency-Key": idempotencyKey }
    );
    return {
      content: [{
        type: "text",
        text: formatJson(
          safeComposeAdoptionConfirmationPayload(
            status,
            data,
            `/management/service/${encodeURIComponent(orderNo)}/applications`
          )
        ),
      }],
    };
  }
);

server.registerTool(
  "install_application",
  {
    description:
      "Queue installation of a catalog application using its version-pinned container blueprint. Call list_application_catalog first: target.install_requirements.runtime_restart_consent.required tells you whether this server still needs restart consent, and the entry's secret_delivery.one_time_secrets tells you whether the install generates a password shown only once. Confirm the service, application, release channel, access choice, and configuration variable NAMES with the user first; never repeat variable values in confirmation text. For the first managed application on an existing server, acknowledge_runtime_restart may be true only after explicit consent to a possible one-time server restart. This tool always requests portal secret delivery: a generated password is revealed once, to the user, in the VPSnet panel. It is never returned here, and this tool must never claim on the user's behalf to have received and stored it. When the result reports secret_delivery.pending_reveal or a portal handoff, tell the user a password is waiting and send them to the panel. An install left on private access is reachable only from inside the server, not from a browser: when the user wants to open a web-UI application, request an advertised public mode (usually platform_https) in this call, and after the installation reports healthy, read the resulting public endpoint URL from get_application_installation and relay it to the user together with the panel handoff. This is asynchronous and not a paid API-key operation. Requires applications:manage.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      application: applicationSlugSchema,
      release_channel: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,31}$/)
        .optional()
        .describe(
          "Published release channel. Omit it to install the application's own published channel; most catalog applications are not published on a channel named 'stable', so never guess one."
        ),
      variables: applicationVariablesSchema,
      acknowledge_runtime_restart: z
        .literal(true)
        .optional()
        .describe(
          "Explicit consent for a possible one-time server restart while the managed runtime is prepared"
        ),
      access: applicationSingleAccessSchema
        .optional()
        .describe(
          "Exact access request using a mode and fields advertised by the selected catalog entry. Omitting it accepts the platform default: public platform_https when VPSnet platform hostnames are available, otherwise private. private keeps the application reachable only from inside the server, so for an application the user will open in a browser prefer an advertised public mode such as platform_https."
        ),
      idempotencyKey: idempotencyKeySchema.describe(
        "Client-global unique key. Reuse it only to replay this exact installation request; never reuse it for another service or request."
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
    acknowledge_runtime_restart,
    access,
    idempotencyKey,
  }) => {
    const { status, data } = await apiRequest(
      "POST",
      applicationPath(orderNo, "installations"),
      applicationInstallRequestBody({
        application,
        releaseChannel: release_channel,
        variables: variables || {},
        acknowledgeRuntimeRestart: acknowledge_runtime_restart === true,
        access,
      }),
      { "Idempotency-Key": idempotencyKey }
    );
    return {
      content: [
        {
          type: "text",
          text: safeApplicationMutationResult(status, data, orderNo),
        },
      ],
    };
  }
);

server.registerTool(
  "configure_application_access",
  {
    description:
      "Queue an access change for one owned managed application. Read get_application_installation first and pass its current revision. If access.request.schema_version=2, preserve every exact endpoint key and configure each endpoint independently; use service and port metadata to match the user's intent instead of prioritizing array order or primary=true. Private removes that route's public listener. Public HTTP exposes it through the server public IP. Managed HTTPS requires an eligible VPSnet-managed DNS zone, subdomain, and explicit DNS approval. External HTTPS only records the customer-managed URL; VPSnet does not configure or validate its DNS, TLS, or reverse proxy. Confirm the exact change with the user first. A queued response must be verified with get_application_installation and get_application_events. Requires applications:manage and is not a paid API-key operation.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      installation_id: applicationInstallationIdSchema,
      access: applicationAccessSchema.describe(
        "One access choice, or schema_version=2 with every exact endpoint key and its independent access choice"
      ),
      expected_revision: applicationRevisionSchema,
      idempotencyKey: idempotencyKeySchema.describe(
        "Client-global unique key. Reuse it only to replay this exact access request; never reuse it for another service or request."
      ),
      confirmed: z
        .literal(true)
        .describe("True only after the user confirmed this access change"),
    },
    annotations: {
      title: "Configure application access",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({
    orderNo,
    installation_id,
    access,
    expected_revision,
    idempotencyKey,
  }) => {
    const { status, data } = await apiRequest(
      "POST",
      applicationPath(
        orderNo,
        `installations/${encodeURIComponent(installation_id)}/configure-access`
      ),
      applicationAccessConfigurationRequestBody(access, expected_revision),
      { "Idempotency-Key": idempotencyKey }
    );
    return {
      content: [
        {
          type: "text",
          text: safeApplicationMutationResult(status, data, orderNo),
        },
      ],
    };
  }
);

server.registerTool(
  "manage_application",
  {
    description:
      "Queue one supported lifecycle action for an owned managed application. Confirm the exact action with the user first. For update, first read get_application_installation and copy the exact advertised blueprint_version and upstream_version as execution preconditions. The backend still selects and freezes the eligible immutable release; callers cannot choose an arbitrary target. Stop interrupts service. Uninstall permanently deletes the managed containers, configuration, saved credentials, and application data; existing server backups are retained. Uninstall requires acknowledge_data_loss=true after explicit user confirmation. A queued response must be verified with get_application_installation and get_application_events. Selective data restore is a separate operation exposed by list_application_restore_points and restore_application_data. Requires applications:manage and is not a paid API-key operation.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      installation_id: applicationInstallationIdSchema,
      action: applicationActionSchema,
      idempotencyKey: idempotencyKeySchema.describe(
        "Client-global unique key. Reuse it only to replay this exact lifecycle request; never reuse it for another service or request."
      ),
      expected_blueprint_version: applicationExpectedVersionSchema
        .optional()
        .describe(
          "Required for update: exact blueprint_version from the current available_actions update capability"
        ),
      expected_upstream_version: applicationExpectedVersionSchema
        .optional()
        .describe(
          "Required for update: exact upstream_version from the current available_actions update capability"
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
    expected_blueprint_version,
    expected_upstream_version,
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

    if (action === "update") {
      if (!expected_blueprint_version || !expected_upstream_version) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: formatJson({
              success: false,
              error_codes: ["applicationUpdateExpectationRequired"],
            }),
          }],
        };
      }

      const current = await apiRequest(
        "GET",
        applicationPath(
          orderNo,
          `installations/${encodeURIComponent(installation_id)}`
        )
      );
      if (
        current.status < 200
        || current.status >= 300
        || !applicationUpdateCandidateMatches(current.data, {
          blueprintVersion: expected_blueprint_version,
          upstreamVersion: expected_upstream_version,
        })
      ) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: formatJson({
              success: false,
              error_codes: ["applicationUpdateExpectationChanged"],
            }),
          }],
        };
      }
    } else if (expected_blueprint_version || expected_upstream_version) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: formatJson({
            success: false,
            error_codes: ["applicationUpdateExpectationUnexpected"],
          }),
        }],
      };
    }

    const { status, data } = await apiRequest(
      "POST",
      applicationPath(
        orderNo,
        `installations/${encodeURIComponent(installation_id)}/actions`
      ),
      applicationLifecycleRequestBody(
        action,
        acknowledge_data_loss === true,
        action === "update"
          ? {
              blueprintVersion: expected_blueprint_version!,
              upstreamVersion: expected_upstream_version!,
            }
          : undefined
      ),
      { "Idempotency-Key": idempotencyKey }
    );
    return {
      content: [
        {
          type: "text",
          text: safeApplicationMutationResult(status, data, orderNo),
        },
      ],
    };
  }
);

server.registerTool(
  "cancel_application_action",
  {
    description:
      "Request pre-dispatch cancellation of the exact latest action for one owned managed application. This is available only while get_application_installation advertises latest_action.cancellable=true for the same action UUID. The tool re-reads the installation immediately before submitting the cancellation and refuses stale, different, or non-cancellable actions. Cancellation never stops or interrupts a running worker job. Requires applications:manage, the exact latest_action.id UUID, and a fresh client-global idempotencyKey that was not used for the original action or another request. Reuse that key only to replay this exact cancellation request. This is not a paid API-key operation.",
    inputSchema: {
      orderNo: applicationOrderNoSchema,
      installation_id: applicationInstallationIdSchema,
      action_id: applicationActionIdSchema,
      idempotencyKey: idempotencyKeySchema.describe(
        "Fresh client-global unique key for this cancellation request. Do not reuse the original action's key or a key from another request; reuse it only to replay this exact cancellation request."
      ),
    },
    annotations: {
      title: "Cancel queued application action",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orderNo, installation_id, action_id, idempotencyKey }) => {
    const installationPath = applicationPath(
      orderNo,
      `installations/${encodeURIComponent(installation_id)}`
    );
    const current = await apiRequest("GET", installationPath);
    if (
      current.status < 200 ||
      current.status >= 300 ||
      !applicationActionCancellationIsAdvertised(current.data, action_id)
    ) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: formatJson({
              success: false,
              error_codes: ["applicationActionCancellationNotAdvertised"],
            }),
          },
        ],
      };
    }

    const { status, data } = await apiRequest(
      "POST",
      `${installationPath}/actions/${encodeURIComponent(action_id)}/cancel`,
      applicationActionCancellationRequestBody(),
      { "Idempotency-Key": idempotencyKey }
    );
    return {
      content: [
        {
          type: "text",
          text: safeApplicationMutationResult(status, data, orderNo),
        },
      ],
    };
  }
);

// --- Service Actions ---

server.registerTool(
  "start_service",
  {
    description: "Start a stopped VPS. Returns noty UUID for tracking. Requires services:manage and a full-access API key.",
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
    description: "Stop a running VPS. Returns noty UUID for tracking. Requires services:manage and a full-access API key.",
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
    description: "Restart a VPS. Returns noty UUID for tracking. Requires services:manage and a full-access API key.",
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
      "Open VNC console access to a running VPS. Read-ish: it requests a console session and returns the tracking event ID (a console URL/token is delivered out-of-band). The service must be running. Requires services:manage and a full-access API key.",
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
      "Suspend a running Cloud VPS (KVM/VDS) service. Changes service state to suspended. Returns a tracking event ID. VDS/Cloud VPS only; the service must be running. Requires services:manage and a full-access API key.",
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
      "Resume a suspended Cloud VPS (KVM/VDS) service. Changes service state back to running. Returns a tracking event ID. VDS/Cloud VPS only; the service must be suspended. Requires services:manage and a full-access API key.",
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
  "get_hostname",
  {
    description:
      "Get the current service hostname, reserved automatic hostname, and automatic/customer management mode. Read-only API keys are accepted. Requires services:read when called with an API key.",
    inputSchema: {
      orderNo: serviceOrderNoSchema,
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "GET",
      svc(orderNo, "change-hostname")
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "change_hostname",
  {
    description:
      "Queue a customer-managed hostname change for a Container VPS, VPS, or Cloud VPS. VPSnet-managed vpsnet.cloud names are reserved. The returned noty UUID tracks the asynchronous action. Requires services:manage and a full-access API key; this route is not idempotency-keyed.",
    inputSchema: {
      orderNo: serviceOrderNoSchema,
      hostname: serviceHostnameSchema,
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
  "reset_hostname",
  {
    description:
      "Restore the immutable VPSnet-managed automatic hostname for a Container VPS, VPS, or Cloud VPS. Returns noty=null when no guest change is needed. Requires services:manage and a full-access API key; this route is not idempotency-keyed.",
    inputSchema: {
      orderNo: serviceOrderNoSchema,
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "POST",
      svc(orderNo, "change-hostname/reset")
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "change_root_password",
  {
    description:
      "Change VPS root password. Rules: 6-40 chars, alphanumeric, MUST contain uppercase + lowercase + digit. Example: 'MyPass123'. Requires services:manage and a full-access API key.",
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
    description:
      "Get effective PTR records for every assigned IPv4 and enabled IPv6 address. The response identifies the automatic default and whether each value is a customer override. Read-only API keys are accepted. Requires services:read when called with an API key.",
    inputSchema: {
      orderNo: serviceOrderNoSchema,
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
      "Set a customer PTR override for an address returned by get_rdns. Canonical length is 3-253 characters; labels are 1-63 ASCII alphanumeric/hyphen characters without leading/trailing hyphens. A trailing dot is removed and reserved VPSnet names are blocked. Requires services:manage and a full-access API key; this route is not idempotency-keyed.",
    inputSchema: {
      orderNo: serviceOrderNoSchema,
      ip: serviceIpSchema,
      value: servicePtrSchema,
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
  "clear_rdns",
  {
    description:
      "Clear a customer PTR override for an address returned by get_rdns. The automatic VPSnet PTR is restored, or PTR is removed when no automatic hostname exists. Requires services:manage and a full-access API key; this route is not idempotency-keyed.",
    inputSchema: {
      orderNo: serviceOrderNoSchema,
      ip: serviceIpSchema,
    },
  },
  async ({ orderNo, ip }) => {
    const { data } = await apiRequest(
      "POST",
      svc(orderNo, "change-rdns/clear"),
      { ip }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "flush_iptables",
  {
    description: "Flush iptables rules on VPS (useful when locked out) Requires services:manage and a full-access API key.",
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
  "get_title",
  {
    description: "Get the current customer-visible service display title Requires services:read when called with an API key.",
    inputSchema: {
      orderNo: serviceOrderNoSchema,
    },
  },
  async ({ orderNo }) => {
    const { data } = await apiRequest(
      "GET",
      svc(orderNo, "change-title")
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "change_title",
  {
    description: "Change service display title Requires services:manage and a full-access API key.",
    inputSchema: {
      orderNo: serviceOrderNoSchema,
      title: z
        .string()
        .trim()
        .min(3)
        .max(25)
        .describe("New customer-visible display title, 3-25 characters"),
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
    description: "Enable or disable IPv6 on VPS Requires services:manage and a full-access API key.",
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
      "Toggle extra VPS settings: ppp, fuse, tuntap, or nfs Requires services:manage and a full-access API key.",
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
      "Deploy an SSH key to VPS. Returns noty UUID for tracking. ASYNC — wait 15-30 seconds after deploying before attempting SSH. Use list_ssh_keys to get available key IDs. To add your own key first: read ~/.ssh/id_rsa.pub from local machine, then create_ssh_key, then deploy it here. Requires services:manage and a full-access API key.",
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
    description: "Get available OS templates for reinstall Requires services:read when called with an API key.",
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
      "Reinstall OS on VPS. WARNING: destroys all data! If the service supports snapshots (Cloud VPS or Firecracker VPS), take one first — it's free for an initial window, so it's cheap insurance you can roll back to; then DELETE it once the reinstall succeeds, because after the free window it is billed per GB while kept (Cloud VPS snapshots do NOT auto-expire) — never leave snapshots lying around. Container VPS and Dedicated have no snapshots, so there is no rollback safety net — confirm with the user before reinstalling. Returns noty UUID. Password rules: 6-40 chars, alphanumeric, must contain uppercase + lowercase + digit. Requires services:manage and a full-access API key.",
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
      "Get available plans for upgrade/downgrade. Plan changes are FREE. Requires services:read when called with an API key.",
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
    description: "Get configurable resources for a specific plan Requires services:read when called with an API key.",
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
      "Preview plan change cost and new expiry. Plan changes are FREE — recalculates remaining time. Use get_plan_resources first to see available resource IDs for the target plan. Requires services:read when called with an API key.",
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
      "Change VPS plan (FREE). Recalculates expiry based on price difference. Always call calculate_plan_change first to preview. Use get_plan_resources to get resource IDs for the target plan. Requires services:manage and a full-access API key.",
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
    description: "Get billing period and auto-renewal options Requires services:read when called with an API key.",
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
    description: "Enable or disable auto-renewal for a service. Note: enabling auto-renewal will automatically charge the account balance at each renewal (creating an invoice) without further confirmation. Requires services:manage and a full-access API key.",
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
      "Manually renew a service for a specific period. COST WARNING: this charges the account balance / creates an invoice immediately, and renewal payments are NON-REFUNDABLE once confirmed. Verify the service and period with the user before calling. Payment object: { payment: 1, successUrl: '', cancelUrl: '' } for balance payment. Requires services:manage and a full-access API key.",
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
      "Get available plans for one explicitly selected service product. Product facts are unordered: 'firecracker' is VPS using Firecracker microVMs for Linux; 'vds' is Cloud VPS (KVM) with High Availability, replicated Ceph NVMe storage, and Linux/Windows/BSD support; 'vps' is Container VPS for Linux; 'ds' is a dedicated single-tenant server. Select from the user's requirements and constraints rather than list position. Firecracker Functions is a separate usage-billed product and is not an orderable service type here.",
    inputSchema: {
      type: z
        .enum(["vps", "vds", "ds", "firecracker"])
        .describe(
          "Required service product: firecracker (Linux VPS microVM), vds (Cloud VPS/KVM with Linux, Windows, or BSD), vps (Container VPS/Linux), or ds (dedicated server). Enum order is not a recommendation."
        ),
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
    description: "Get backup status and configuration for a service Requires services:read when called with an API key.",
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
    description: "Get backup history for a service Requires services:read when called with an API key.",
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
      "Create a new backup. Returns noty UUID for tracking. First call get_backup_status to see available period dates and price. Backup is a paid operation (price shown in get_backup_status). Requires services:manage and a full-access API key.",
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
    description:
      "Show the API key this request authenticated with. The backend scopes this endpoint to the calling key itself (the response sets apiKeyScopedToSelf), so other keys on the account are never listed here. Creating new keys and managing or revoking other keys is available only in the VPSnet panel.",
    inputSchema: {},
  },
  async () => {
    const { data } = await apiRequest("GET", "/account/api-keys");
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_api_key",
  {
    description:
      "Get metadata for one active API key. For API-key callers only the calling key's own ID is accessible — introspecting other keys is refused and is panel-only. The full key and stored secrets are never returned.",
    inputSchema: {
      id: z.number().int().positive().describe("API key ID from list_api_keys (the calling key's own ID)"),
    },
  },
  async ({ id }) => {
    const { data } = await apiRequest("GET", `/account/api-keys/${id}`);
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_api_key_activity",
  {
    description:
      "Get the recorded request activity for this API key: recent matched route patterns and statuses, resolved and separately labelled caller-claimed source addresses, endpoint/source totals, and retained daily history. API-key callers can inspect only the same key that authenticated the MCP connection. Key values, headers, query strings, path values, and request bodies are never returned. To protect the control plane during abusive bursts, audit writes are capped per key per minute and retained detail has a separate per-key row ceiling; totals describe recorded rows and are not a billing ledger.",
    inputSchema: {
      id: z.number().int().positive().describe("API key ID from list_api_keys (the calling key's own ID)"),
      limit: z.number().int().min(1).max(200).optional().describe("Recent request rows to return (default 50, maximum 200)"),
    },
  },
  async ({ id, limit }) => {
    const query = limit === undefined ? "" : `?limit=${encodeURIComponent(String(limit))}`;
    const { data } = await apiRequest(
      "GET",
      `/account/api-keys/${id}/activity${query}`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

server.registerTool(
  "get_api_key_inference_usage",
  {
    description:
      "Get exact paid VPSnet AI usage for this inference API key: committed and currently reserved spend for the UTC day and month, request and token totals by public VPSnet model profile, configured spend limits, remaining spend, and notification preferences. API-key callers can inspect only the same key that authenticated the MCP connection. Internal provider model names are never returned. This is read-only and does not change limits, notifications, or billing.",
    inputSchema: {
      id: z.number().int().positive().describe("Inference API key ID from list_api_keys (the calling key's own ID)"),
    },
  },
  async ({ id }) => {
    const { data } = await apiRequest(
      "GET",
      `/account/api-keys/${id}/inference-usage`
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

// --- Paid TLS certificates ---

const certificatePaymentSchema = z
  .object({
    payment: z.number().int().positive().describe("Payment method ID; use 1 for account balance"),
    successUrl: z.string().max(2048).describe("Approved VPSnet redirect URL, or an empty string"),
    cancelUrl: z.string().max(2048).describe("Approved VPSnet redirect URL, or an empty string"),
  })
  .strict()
  .describe("Payment object. For account balance use { payment: 1, successUrl: '', cancelUrl: '' }");

const certificatePath = (suffix = "") =>
  `/account/certificates${suffix}`;

server.registerTool(
  "list_certificate_catalog",
  {
    description:
      "List published paid TLS certificate products and final customer offers in EUR. Products disclose validation level, public certificate-authority brand, supported names, SAN limits, management capabilities, term, and final retail prices. Only customer-visible catalog data is returned. Paid certificates are portable and are not limited to managed applications. Requires certificates:read.",
    inputSchema: {},
    annotations: {
      title: "List paid TLS certificate catalog",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async () => {
    const { status, data } = await apiRequest("GET", certificatePath("/catalog"));
    return {
      content: [{
        type: "text",
        text: formatJson(safeCertificatePayload("catalog-list", status, data)),
      }],
    };
  }
);

server.registerTool(
  "get_certificate_catalog_product",
  {
    description:
      "Read one published paid TLS product with final EUR offers and customer-visible capabilities. Use the exact offer ID and generation from this response when quoting. Requires certificates:read.",
    inputSchema: {
      product_id: certificateProductIdSchema,
    },
    annotations: {
      title: "Get paid TLS certificate product",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ product_id }) => {
    const { status, data } = await apiRequest(
      "GET",
      certificatePath(`/catalog/${encodeURIComponent(String(product_id))}`)
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeCertificatePayload("catalog-product", status, data)),
      }],
    };
  }
);

server.registerTool(
  "list_certificates",
  {
    description:
      "List customer-owned paid TLS certificate orders, final EUR amount, validation and issuance state, renewal dates, and whether the public certificate bundle is ready. attention_required is not success. Requires certificates:read.",
    inputSchema: {},
    annotations: {
      title: "List paid TLS certificates",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async () => {
    const { status, data } = await apiRequest("GET", certificatePath());
    return {
      content: [{
        type: "text",
        text: formatJson(safeCertificatePayload("order-list", status, data)),
      }],
    };
  }
);

server.registerTool(
  "get_certificate",
  {
    description:
      "Read one customer-owned paid TLS certificate order. A paid, queued, or validating order is not issued; require state=active and download_available=true before treating the public certificate as ready. Requires certificates:read.",
    inputSchema: {
      certificate_order_id: certificateOrderIdSchema,
    },
    annotations: {
      title: "Get paid TLS certificate",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ certificate_order_id }) => {
    const { status, data } = await apiRequest(
      "GET",
      certificatePath(`/${encodeURIComponent(certificate_order_id)}`)
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeCertificatePayload("order", status, data)),
      }],
    };
  }
);

server.registerTool(
  "quote_certificate",
  {
    description:
      "Create a short-lived quote for one exact paid TLS certificate or eligible renewal. This validates the current catalog generation, identifiers, customer contacts, and the public PKCS#10 CSR without charging or ordering. The response contains the final customer total in EUR including VAT. Disclose that exact total before order_certificate. The customer private key must never be supplied. Requires paid operations, certificates:order, spend caps, and a client-global idempotencyKey that must also be used for confirmation.",
    inputSchema: {
      ...certificateOrderInputShape,
      idempotencyKey: paidIdempotencyKeySchema.describe(
        "Client-global unique key used for this quote and its exact order confirmation"
      ),
    },
    annotations: {
      title: "Quote paid TLS certificate",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ idempotencyKey, ...input }) => {
    const { status, data } = await apiRequest(
      "POST",
      certificatePath("/quote"),
      input,
      { "Idempotency-Key": idempotencyKey }
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeCertificatePayload("quote", status, data)),
      }],
    };
  }
);

server.registerTool(
  "order_certificate",
  {
    description:
      "Confirm and pay for the exact quote returned by quote_certificate. Call only after the user explicitly approves the exact final EUR total, certificate names, term, validation level, and payment method. Use the unchanged request, same idempotencyKey, and exact short-lived quote token. The private key remains customer-controlled. Paid certificate orders may become non-refundable once submitted or issued under the certificate authority's policy. Requires certificates:order and paid-operation spend controls.",
    inputSchema: {
      ...certificateOrderInputShape,
      quote_token: z
        .string()
        .min(32)
        .max(190)
        .regex(/^[A-Za-z0-9._:-]{32,190}$/)
        .describe("Exact short-lived quote_token returned by quote_certificate"),
      payment: certificatePaymentSchema,
      acknowledge_exact_quote_and_payment: z
        .literal(true)
        .describe("True only after the user approves the exact quoted EUR total, names, term, and payment"),
      idempotencyKey: paidIdempotencyKeySchema.describe(
        "Same client-global idempotency key used for quote_certificate"
      ),
    },
    annotations: {
      title: "Order paid TLS certificate",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  async ({
    quote_token,
    payment,
    acknowledge_exact_quote_and_payment,
    idempotencyKey,
    ...input
  }) => {
    if (acknowledge_exact_quote_and_payment !== true) {
      throw new Error("Explicit approval of the exact certificate quote and payment is required.");
    }
    const { status, data } = await apiRequest(
      "POST",
      certificatePath("/order"),
      { ...input, quoteToken: quote_token, payment },
      {
        "Idempotency-Key": idempotencyKey,
        "X-Quote-Token": quote_token,
      }
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeCertificatePayload("confirmation", status, data)),
      }],
    };
  }
);

server.registerTool(
  "get_certificate_validation",
  {
    description:
      "Read current per-name domain-control validation state and the owner-visible challenge while it is pending. Wildcards require DNS validation. This never submits or changes a validation method. Requires certificates:read.",
    inputSchema: {
      certificate_order_id: certificateOrderIdSchema,
    },
    annotations: {
      title: "Get certificate validation",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ certificate_order_id }) => {
    const { status, data } = await apiRequest(
      "GET",
      certificatePath(`/${encodeURIComponent(certificate_order_id)}/validation`)
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeCertificatePayload("validation", status, data)),
      }],
    };
  }
);

server.registerTool(
  "download_certificate",
  {
    description:
      "Download the issued public leaf, chain, and full chain for one owned order after download_available becomes true. The bundle is portable to Nginx, Apache, lighttpd, OpenLiteSpeed, HAProxy, Caddy, mail, API, and load-balancer endpoints. It never includes or reconstructs the customer private key. Requires certificates:read.",
    inputSchema: {
      certificate_order_id: certificateOrderIdSchema,
    },
    annotations: {
      title: "Download public TLS certificate bundle",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ certificate_order_id }) => {
    const { status, data } = await apiRequest(
      "GET",
      certificatePath(`/${encodeURIComponent(certificate_order_id)}/download`)
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeCertificatePayload("artifact", status, data)),
      }],
    };
  }
);

server.registerTool(
  "list_certificate_actions",
  {
    description:
      "List durable customer-visible management actions for one paid certificate. Raw certificate-authority responses, request bodies, internal errors, provider IDs, and credentials are never returned. Requires certificates:read.",
    inputSchema: {
      certificate_order_id: certificateOrderIdSchema,
    },
    annotations: {
      title: "List certificate actions",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ certificate_order_id }) => {
    const { status, data } = await apiRequest(
      "GET",
      certificatePath(`/${encodeURIComponent(certificate_order_id)}/actions`)
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeCertificatePayload("action-list", status, data)),
      }],
    };
  }
);

server.registerTool(
  "refresh_certificate",
  {
    description:
      "Durably schedule a read-only certificate-authority status reconciliation for one owned order. Use this for stale or ambiguous state; it never repeats an order or management mutation. Poll get_certificate and list_certificate_actions afterward. Requires certificates:manage.",
    inputSchema: {
      certificate_order_id: certificateOrderIdSchema,
    },
    annotations: {
      title: "Refresh certificate status",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ certificate_order_id }) => {
    const { status, data } = await apiRequest(
      "POST",
      certificatePath(`/${encodeURIComponent(certificate_order_id)}/refresh`)
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeCertificatePayload("refresh", status, data)),
      }],
    };
  }
);

server.registerTool(
  "manage_certificate",
  {
    description:
      "Queue one exact idempotent paid-certificate management action: cancel an eligible pending order, recheck or resend validation, change one validation method, or request a free same-name reissue with a new public CSR. Read the product capabilities, current order, validation, and actions first. Call only after explicit approval. A reissue must preserve the paid name set and never sends a private key. If the outcome becomes ambiguous, reuse the same key only for the exact retry or call refresh_certificate—never submit a new mutation key. Requires certificates:manage.",
    inputSchema: {
      certificate_order_id: certificateOrderIdSchema,
      request: certificateActionRequestSchema,
      acknowledge_certificate_action: z
        .literal(true)
        .describe("True only after the user approves this exact certificate management action"),
      idempotencyKey: paidIdempotencyKeySchema.describe(
        "Client-global key for one exact action. Reuse only for an unchanged retry."
      ),
    },
    annotations: {
      title: "Manage paid TLS certificate",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  async ({
    certificate_order_id,
    request,
    acknowledge_certificate_action,
    idempotencyKey,
  }) => {
    if (acknowledge_certificate_action !== true) {
      throw new Error("Explicit certificate-action approval is required.");
    }
    const { action, body } = certificateActionRequestBody(request);
    const { status, data } = await apiRequest(
      "POST",
      certificatePath(
        `/${encodeURIComponent(certificate_order_id)}/actions/${encodeURIComponent(action)}`
      ),
      body,
      { "Idempotency-Key": idempotencyKey }
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeCertificatePayload("action", status, data)),
      }],
    };
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
      // The API's preferred key is ds_records; bare `ds` is only a
      // compatibility fallback, so do not depend on it.
      { ds_records: ds, idempotencyKey },
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
      // The API's preferred key is ds_records; bare `ds` is only a
      // compatibility fallback, so do not depend on it.
      { ds_records: ds, idempotencyKey },
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
      "List disk snapshots for a Cloud VPS (KVM/VDS) service, with the snapshot billing policy (free window, then billed per GB while kept) and a usage summary. Firecracker VPS uses list_firecracker_snapshots instead. Requires services:read when called with an API key.",
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
      "Create a disk snapshot of a Cloud VPS (KVM/VDS) service. Free for a short window, then billed per GB while kept (see list_snapshots policy). Take a snapshot before any risky or automated change — it's free for an initial window, so it's cheap insurance you can roll back to. DELETE the snapshot once the change succeeds and you no longer need it — after the free window it is billed per GB while kept (Cloud VPS snapshots do NOT auto-expire), so never leave snapshots lying around. Only one snapshot action can run at a time; snapshot count is limited per service. Requires services:manage and a full-access API key.",
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
      "Roll a Cloud VPS (KVM/VDS) service back to a disk snapshot. DESTRUCTIVE: disk state after the snapshot is lost. Confirm with the user before calling. Tip: take a snapshot before any risky or automated change — it's free for an initial window, so it's cheap insurance you can roll back to. DELETE the snapshot once the change succeeds and you no longer need it — after the free window it is billed per GB while kept (Cloud VPS snapshots do NOT auto-expire), so never leave snapshots lying around. Requires services:manage and a full-access API key.",
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
    description: "Delete a Cloud VPS (KVM/VDS) disk snapshot. Requires services:manage and a full-access API key.",
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
      "List temporary snapshots for a Firecracker VPS service, including billing state (free window, then a per-GB keep rate) and expiry. Requires services:read when called with an API key.",
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
      "Create a temporary snapshot of a Firecracker VPS. Free for a short window, then billed per GB while kept until its automatic expiry. Take a snapshot before any risky or automated change, and delete it once the change succeeds to stop keep billing early. Check list_firecracker_snapshots for the exact policy and expiry fields. Requires services:manage and a full-access API key.",
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
      "Roll a Firecracker VPS back to a temporary snapshot. DESTRUCTIVE: disk state after the snapshot is lost. Confirm with the user before calling. Firecracker snapshots expire automatically but remain billed after the free window until deletion or expiry, so delete an unneeded snapshot to stop keep billing early. Requires services:manage and a full-access API key.",
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
    description: "Delete a Firecracker VPS temporary snapshot (stops its keep billing). Requires services:manage and a full-access API key.",
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
      "Get the unified restore state for a service: retention days, restore price, and any restore request in progress. Cloud VPS and Firecracker VPS have automatic daily off-node backups restored through this flow. Requires services:read plus the services:restore paid scope when called with an API key (the response includes account balance).",
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
      "List available backup restore points for a service (automatic off-node backups). Use a point id with request_restore. Requires services:read when called with an API key.",
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
      "PAID: restore a service from a backup point. Charges the restore price (+VAT) from the ACCOUNT BALANCE immediately and overwrites the service disk with the backup content. DESTRUCTIVE and billed — always confirm the point and price (get_restore_status) with the user first. The tool runs the backend's quote → confirm flow itself under one Idempotency-Key (generated per call unless idempotencyKey is given), so a single call is a single paid attempt. Requires services:read, a full-access API key with paid operations enabled, the services:restore paid scope, and configured spend caps.",
    inputSchema: {
      orderNo: z.string().describe("Order number"),
      backup_point_id: z.number().describe("Restore point ID from list_restore_points"),
      idempotencyKey: paidIdempotencyKeySchema
        .optional()
        .describe(
          "Optional stable key to retry or replay ONE exact earlier restore attempt without paying twice. Omit it for a new restore — a fresh key is generated for the call."
        ),
    },
  },
  async ({ orderNo, backup_point_id, idempotencyKey }) => {
    // The backend contract for API-key callers is quote → confirm with the
    // SAME Idempotency-Key plus the quoteToken minted by the quote step. A
    // bare confirm is refused (idempotencyKeyRequired / quoteTokenRequired),
    // so both steps happen here, exactly like order_service.
    const key = idempotencyKey ?? randomUUID();
    const quote = await apiRequest(
      "POST",
      `/account/services/${orderNo}/restore/requests/quote`,
      { backup_point_id },
      { "Idempotency-Key": key }
    );
    const quoteToken = (quote.data as { quoteToken?: string } | null)
      ?.quoteToken;
    if (!quoteToken) {
      const alreadyUsed = (quote.data as
        | { idempotencyKeyAlreadyUsed?: boolean }
        | null)?.idempotencyKeyAlreadyUsed === true;
      if (!alreadyUsed) {
        // Surface the quote-stage denial (scope, paid-ops, spend cap, missing
        // point, ...) directly: it names the real reason, which a follow-up
        // confirm would only mask behind quoteTokenRequired.
        return { content: [{ type: "text", text: formatJson(quote.data) }] };
      }
      // The key was already spent on an earlier attempt. Confirm without a
      // token: the backend resolves the same key to the existing restore
      // request and replays it without charging again.
      const replay = await apiRequest(
        "POST",
        `/account/services/${orderNo}/restore/requests`,
        { backup_point_id },
        { "Idempotency-Key": key }
      );
      return { content: [{ type: "text", text: formatJson(replay.data) }] };
    }
    const { data } = await apiRequest(
      "POST",
      `/account/services/${orderNo}/restore/requests`,
      { backup_point_id, quoteToken },
      { "Idempotency-Key": key, "X-Quote-Token": quoteToken }
    );
    return { content: [{ type: "text", text: formatJson(data) }] };
  }
);

// --- Backup file browsing (free, read-only) ---

server.registerTool(
  "list_restore_file_points",
  {
    description:
      "List the nightly backup points whose contents can be browsed file by file for one owned service, and report whether folder search is available on that service's node. Browsing is free and never charges the account or changes the server. Always call this before browse_restore_files: its searchAvailable flag is the only reliable signal of whether the filter argument can be used. Initially supported on Firecracker VPS. Requires services:read.",
    inputSchema: {
      orderNo: serviceOrderNoSchema,
    },
    annotations: {
      title: "List browsable backup points",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orderNo }) => {
    const { status, data } = await apiRequest(
      "GET",
      svc(encodeURIComponent(orderNo), "restore/files/points")
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeFileBrowsePointsPayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "browse_restore_files",
  {
    description:
      "Queue a free, read-only listing of one directory inside a backup point. This does NOT restore anything, does not charge the account, and does not modify the server. Start at the backup root by passing only backupPointId. To open a subdirectory, pass sourceBrowseId plus the directoryEntryId of a type=directory entry from that result; filesystem paths are never accepted. A directory can hold an enormous number of files, so the server selects pages of 200 or 1,000 entries: while result.nextOffset is non-null, call again with the same sourceBrowseId and directoryEntryId and offset set to result.nextOffset. Use result.pageSize rather than assuming 200 when moving backwards. When nextOffset is null the listing cannot be paged further even if truncated is true — that is a capped scan; check result.listingStatus: 'complete' means the folder was read end to end, 'partial' means the listing is a bounded lower-bound slice, so never present it as the whole folder. Optionally pass filter to search entry NAMES in that one directory (substring, case-insensitive, never recursive) — but only when list_restore_file_points reported searchAvailable=true, otherwise this tool refuses rather than silently returning an unfiltered listing. The call is asynchronous: it returns a browse id in a pending state, and you must poll get_restore_file_browse until state is succeeded. Requires services:read and, because it is a POST, an API key that permits write operations plus an idempotencyKey.",
    inputSchema: {
      orderNo: serviceOrderNoSchema,
      backupPointId: fileBrowsePointIdSchema,
      sourceBrowseId: fileBrowseIdSchema
        .optional()
        .describe(
          "Browse id of the succeeded listing the directory entry came from. Omit to list the backup root."
        ),
      directoryEntryId: fileBrowseDirectoryEntryIdSchema.optional(),
      offset: fileBrowseOffsetSchema
        .optional()
        .describe(
          "Copy a non-null result.nextOffset to page further through the SAME directory (a null nextOffset means the listing cannot be paged further). Must be 0 (or omitted) when starting a root listing or entering a directory."
        ),
      filter: fileBrowseFilterSchema.optional(),
      idempotencyKey: idempotencyKeySchema.describe(
        "Client-global unique key for this exact browse request; reuse it only to replay the same request."
      ),
    },
    annotations: {
      title: "Browse backup files",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({
    orderNo,
    backupPointId,
    sourceBrowseId,
    directoryEntryId,
    offset,
    filter,
    idempotencyKey,
  }) => {
    const rejection = fileBrowseRequestRejection({
      sourceBrowseId,
      directoryEntryId,
      offset,
    });
    if (rejection !== null) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: formatJson({ success: false, error: rejection }),
        }],
      };
    }

    // Folder search depends on a node capability that older workers do not
    // report. The browse POST refuses a filter it cannot serve with
    // serviceFileBrowseSearchUnavailable, so this probe is not what makes the
    // refusal safe -- it is what makes it legible: it names the reason and the
    // way forward here rather than surfacing a bare error code from a POST
    // that has already consumed the caller's idempotency key. Either way an
    // unfiltered listing is never returned in a search's place, because a
    // caller would trust a file list that silently ignored the search term.
    if (filter !== undefined) {
      const probe = await apiRequest(
        "GET",
        svc(encodeURIComponent(orderNo), "restore/files/points")
      );
      if (
        probe.status < 200
        || probe.status >= 300
        || readSearchAvailable(probe.data) !== true
      ) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: formatJson({
              success: false,
              error_codes: ["serviceFileBrowseSearchUnavailable"],
              reason:
                "Folder search is not available for this service right now, so the filter was not applied and no file list is being returned. This node's worker does not report the backup folder-search capability.",
              fix:
                "Browse the directory without filter and page through it with offset, or retry search later once the service's node reports the capability. Do not treat an unfiltered listing as a search result.",
            }),
          }],
        };
      }
    }

    const { status, data } = await apiRequest(
      "POST",
      svc(encodeURIComponent(orderNo), "restore/files/browses"),
      fileBrowseRequestBody({
        backupPointId,
        sourceBrowseId,
        directoryEntryId,
        offset,
        filter,
      }),
      { "Idempotency-Key": idempotencyKey }
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeFileBrowsePayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "get_restore_file_browse",
  {
    description:
      "Poll one queued backup file listing. Free and read-only. Keep polling while state is queued, running, or awaiting_reply; entries are present only when state is succeeded. A failed state carries an errorCode and no listing — report that rather than presenting an empty or partial directory as the real contents. Requires services:read.",
    inputSchema: {
      orderNo: serviceOrderNoSchema,
      browse_id: fileBrowseIdSchema,
    },
    annotations: {
      title: "Get backup file listing",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ orderNo, browse_id }) => {
    const { status, data } = await apiRequest(
      "GET",
      svc(
        encodeURIComponent(orderNo),
        `restore/files/browses/${encodeURIComponent(browse_id)}`
      )
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeFileBrowsePayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "get_guest_agent_status",
  {
    description:
      "Check whether the QEMU guest agent is running inside a Cloud VPS (KVM/VDS). Useful before OS-level operations that depend on the agent. Requires services:read when called with an API key.",
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
    "acknowledge_unreadable_replacement",
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
    description:
      "Update a Firecracker Function's code or configuration. Call get_function first. If integrity.unreadable_fields names code or environment, the backend refuses the update unless the user explicitly approves replacing every unavailable value from a trusted copy and acknowledge_unreadable_replacement=true is passed. Leave that flag false for ordinary updates.",
    inputSchema: {
      function_id: z.number().describe("Function ID from list_functions"),
      ...functionFieldsSchema,
      acknowledge_unreadable_replacement: z.boolean().optional().describe(
        "Explicit customer approval to replace code or environment named by integrity.unreadable_fields; default false"
      ),
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
      "Invoke a Firecracker Function. PAID per invocation (CPU/memory usage billed from account). With wait=true the call blocks and returns the result; otherwise poll list_function_invocations. One Idempotency-Key is generated per tool call unless idempotency_key is supplied; reuse an explicit key only for an exact retry so the same logical step is not double-run or double-billed (response may include replayed=true).",
    inputSchema: {
      function_id: z.number().describe("Function ID from list_functions"),
      input: z
        .string()
        .optional()
        .describe("Input payload passed to the function (string; JSON text is fine)"),
      wait: z.boolean().optional().describe("Wait synchronously for the result"),
      idempotency_key: paidIdempotencyKeySchema
        .optional()
        .describe(
          "Optional stable key for this exact logical invoke (e.g. agent step id). Exact retries with the same key return the original invocation; changed input or wait semantics are refused."
        ),
    },
    annotations: {
      title: "Invoke Firecracker Function",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ function_id, input, wait, idempotency_key }) => {
    const body: Record<string, unknown> = {};
    if (input !== undefined) body.input = input;
    if (wait !== undefined) body.wait = wait;
    const key = idempotency_key ?? randomUUID();
    const { data } = await apiRequest(
      "POST",
      `/account/firecracker/functions/${function_id}/invoke`,
      body,
      { "Idempotency-Key": key }
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

// --- On-demand server sessions (stable temp_vm API identifiers) ---

server.registerTool(
  "get_temp_vm_options",
  {
    description:
      "Get the coming-soon on-demand server preview options and authoritative orderable/availability launch state. Host placement is never returned. Requires services:read.",
    inputSchema: {},
    annotations: {
      title: "Get on-demand server options",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async () => {
    const { status, data } = await apiRequest(
      "GET",
      "/account/firecracker/temp-vms/options"
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeTempVmPayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "quote_temp_vm",
  {
    description:
      "Coming soon: customer ordering is disabled. The backend returns tempVmComingSoon before payment, host, IP, or service allocation.",
    inputSchema: {
      profile: tempVmProfileSchema.optional(),
      ttl_minutes: tempVmTtlSchema.optional(),
      idempotency_key: tempVmIdempotencyKeySchema
        .optional()
        .describe(
          "Optional new key for this quote. Omit it to generate one; the result returns the generated key."
        ),
    },
    annotations: {
      title: "Quote on-demand server session (Coming soon)",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ profile, ttl_minutes, idempotency_key }) => {
    const key = idempotency_key ?? randomUUID();
    const body: Record<string, unknown> = {};
    if (profile !== undefined) body.profile = profile;
    if (ttl_minutes !== undefined) body.ttl_minutes = ttl_minutes;

    const { status, data } = await apiRequest(
      "POST",
      "/account/firecracker/temp-vms/quote",
      body,
      { "Idempotency-Key": key }
    );
    const payload = safeTempVmPayload(status, data);
    const result = payload.success === true
      ? { ...payload, idempotency_key: key }
      : payload;
    return { content: [{ type: "text", text: formatJson(result) }] };
  }
);

server.registerTool(
  "list_temp_vms",
  {
    description:
      "List the account's on-demand server sessions and current options. Credentials and internal host placement are never returned. Requires services:read.",
    inputSchema: {},
    annotations: {
      title: "List on-demand server sessions",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async () => {
    const { status, data } = await apiRequest(
      "GET",
      "/account/firecracker/temp-vms"
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeTempVmPayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "create_temp_vm",
  {
    description:
      "Coming soon: customer ordering is disabled. The backend returns tempVmComingSoon before any paid intent, charge, host, IP, or service allocation.",
    inputSchema: {
      profile: tempVmProfileSchema.optional(),
      ttl_minutes: tempVmTtlSchema.optional(),
      os_id: tempVmOsIdSchema.optional(),
      root_password: tempVmRootPasswordSchema.optional(),
      ssh_public_key: tempVmSshPublicKeySchema.optional(),
      idempotency_key: tempVmIdempotencyKeySchema,
      quote_token: tempVmQuoteTokenSchema,
      acknowledge_price_eur: z
        .number()
        .min(0.5)
        .describe("Exact gross EUR amount disclosed by quote_temp_vm and approved by the user"),
      acknowledge_no_backups: z
        .literal(true)
        .describe(
          "Confirm the disclosed data policy: automatic backups and snapshots are not included, so required data must be stored elsewhere before server deletion"
        ),
    },
    annotations: {
      title: "Create on-demand server session (Coming soon)",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({
    profile,
    ttl_minutes,
    os_id,
    root_password,
    ssh_public_key,
    idempotency_key,
    quote_token,
    acknowledge_price_eur,
    acknowledge_no_backups,
  }) => {
    if (acknowledge_no_backups !== true || acknowledge_price_eur < 0.5) {
      throw new Error("Explicit price and data-policy acknowledgement is required.");
    }
    if (root_password !== undefined && ssh_public_key !== undefined) {
      throw new Error("Choose either root_password or ssh_public_key, not both.");
    }

    const body: Record<string, unknown> = {
      public_ip: true,
      idempotencyKey: idempotency_key,
      quoteToken: quote_token,
    };
    if (profile !== undefined) body.profile = profile;
    if (ttl_minutes !== undefined) body.ttl_minutes = ttl_minutes;
    if (os_id !== undefined) body.os_id = os_id;
    if (root_password !== undefined) body.rootPassword = root_password;
    if (ssh_public_key !== undefined) body.ssh_public_key = ssh_public_key;

    const { status, data } = await apiRequest(
      "POST",
      "/account/firecracker/temp-vms",
      body,
      {
        "Idempotency-Key": idempotency_key,
        "X-Quote-Token": quote_token,
      }
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeTempVmPayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "get_temp_vm",
  {
    description:
      "Get one tenant-owned on-demand server session. Credentials and internal host placement are never returned. Requires services:read.",
    inputSchema: { id: tempVmIdSchema },
    annotations: {
      title: "Get on-demand server session",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ id }) => {
    const { status, data } = await apiRequest(
      "GET",
      `/account/firecracker/temp-vms/${encodeURIComponent(String(id))}`
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeTempVmPayload(status, data)),
      }],
    };
  }
);

server.registerTool(
  "delete_temp_vm",
  {
    description:
      "Permanently delete a tenant-owned on-demand server before expiry. Requires services:manage. This preserves no disk or IP, has no customer-controlled refund, and is refused while payment confirmation is unresolved. Export required data first.",
    inputSchema: {
      id: tempVmIdSchema,
      acknowledge_permanent_destruction: z
        .literal(true)
        .describe(
          "Confirm that required data has been exported and permanent deletion is intended"
        ),
    },
    annotations: {
      title: "Permanently delete on-demand server",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ id, acknowledge_permanent_destruction }) => {
    if (acknowledge_permanent_destruction !== true) {
      throw new Error("Explicit permanent-destruction acknowledgement is required.");
    }
    const { status, data } = await apiRequest(
      "DELETE",
      `/account/firecracker/temp-vms/${encodeURIComponent(String(id))}`
    );
    return {
      content: [{
        type: "text",
        text: formatJson(safeTempVmPayload(status, data)),
      }],
    };
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
      "Apply a backend-defined DNS template to a native forward zone. Records still pass the same API validation, quotas and conflict rules as manual record writes. Prefer preview=true first to show the user exactly which records a template would write before changing the zone. Requires dns:write when using an API key.",
    inputSchema: {
      zone_id: z.number().describe("DNS zone ID"),
      template: z
        .string()
        .describe("Template ID returned by list_dns_templates, e.g. web_service, null_mx, google_workspace, microsoft_365, mail_security, caa_letsencrypt"),
      parameters: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe("Template parameters, e.g. { ipv4, ipv6, www, mx_target, ttl } depending on the template"),
      preview: z
        .boolean()
        .optional()
        .describe(
          "true to dry-run the template and return the records it would write without changing the zone"
        ),
      overwrite: z
        .boolean()
        .optional()
        .describe(
          "true to replace existing records that conflict with the template. Destructive: confirm the exact conflicts with the user first, ideally from a preview run."
        ),
    },
  },
  async ({ zone_id, template, parameters, preview, overwrite }) => {
    const { data } = await apiRequest(
      "POST",
      `/account/dns/zones/${zone_id}/templates/${encodeURIComponent(template)}`,
      {
        ...(parameters !== undefined ? { parameters } : {}),
        ...(preview !== undefined ? { preview } : {}),
        ...(overwrite !== undefined ? { overwrite } : {}),
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
