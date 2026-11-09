import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest, formatJson } from "./api.js";
import { unboundedInteger } from "./tool-schema.js";

// Customer routes only. The account comes from X-API-KEY; caller-supplied
// tenant IDs, worker IDs and internal endpoints never enter this registry.
const uuid = z.string().length(36).regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/)
  .describe("Exact lowercase UUID returned by an owned networking resource");
const generation = z.number().int().safe().min(1);
const policyGeneration = z.number().int().safe().min(0);
const ipv4 = z.ipv4();
// Preserve v3 IP syntax for the existing max-64-character source allowlist.
// In particular, scoped link-local IPv6 remains subject to backend eligibility.
const sourceIpv6 = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
const port = z.number().int().min(1).max(65535);
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{15,189}$(?![\s\S])/)
  .describe("Stable Idempotency-Key for this exact intent; reuse unchanged on recovery, never generate a new key for an uncertain result");
const quoteToken = z.string().min(1).regex(/^[^\s\x00-\x1f\x7f]+$/)
  .describe("Exact quote_token returned by the quote; sent only as X-Quote-Token");
const periodMonths = z.number().int().min(1).max(120)
  .describe("Paid term in months from the current list_network_products catalog; omit for one month. The 1-120 bound is not an offer list. Disclose this term and the exact quoted total before confirmation.");
const name = z.string().min(1).max(80).regex(/^[^\x00-\x1f\x7f]+$/);
const dnsLabel = z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/);
const dnsAlias = z.object({ name: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/), ipv4 }).strict();
const dnsMode = z.enum(["provider", "custom", "none"]);
const internetAccess = z.union([z.boolean(), z.enum(["none", "dedicated_single"])]);
const serviceId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,95}$(?![\s\S])/);
const restart = z.literal(true).optional().describe("Only after the user authorizes a required restart from attachment-candidates; omit otherwise");
const settings = z.object({
  gateway: z.union([z.enum(["auto", "none"]), ipv4]).optional(),
  dhcp_enabled: z.literal(true).optional(),
  dhcp_range: z.object({ start: ipv4, end: ipv4 }).strict().optional(),
  dns_mode: dnsMode.optional(), dns_servers: z.array(ipv4).min(1).max(3).optional(),
  ipv6_mode: z.literal("off").optional(), dhcp_gateway: z.boolean().optional(),
  dns_resolvers: z.array(ipv4).max(2).optional(), dns_records: z.array(z.object({ service: dnsAlias.shape.name, ipv4 }).strict()).max(64).optional(),
  dns_zone: dnsLabel.optional(), dns_service: z.boolean().optional(), internet_access: internetAccess.optional(),
}).strict().describe("Use only choices currently advertised by get_networking_capabilities. Custom addresses require an explicit subnet; DHCP is currently always enabled.");
const rule = z.object({
  id: uuid.optional(), direction: z.enum(["ingress", "egress"]), ether_type: z.literal("IPv4"),
  protocol: z.enum(["any", "tcp", "udp", "sctp", "icmp"]),
  port_min: port.optional(), port_max: port.optional(),
  icmp_type: z.number().int().min(0).max(255).optional(), icmp_code: z.number().int().min(0).max(255).optional(),
  remote_cidr: z.string().regex(/^\d{1,3}(?:\.\d{1,3}){3}\/(?:[0-9]|[12][0-9]|3[0-2])$/).optional(),
  remote_group_id: uuid.optional(),
}).strict().superRefine((r, ctx) => {
  if ((r.remote_cidr === undefined) === (r.remote_group_id === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose exactly one remote_cidr or remote_group_id" });
  }
  const ports = r.port_min !== undefined || r.port_max !== undefined;
  const icmp = r.icmp_type !== undefined || r.icmp_code !== undefined;
  if ((r.protocol === "any" && (ports || icmp))
      || (["tcp", "udp", "sctp"].includes(r.protocol) && (icmp || (ports && (r.port_min === undefined || r.port_max === undefined || r.port_min > r.port_max))))
      || (r.protocol === "icmp" && (ports || (r.icmp_code !== undefined && r.icmp_type === undefined)))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Fields must match the selected protocol; port ranges need both bounds" });
  }
});
const member = z.object({ address: ipv4, port, weight: z.number().int().min(1).max(256).optional() }).strict();
const portForward = z.object({
  protocol: z.enum(["tcp", "udp"]),
  external_port: port.refine(value => ![25, 465, 587, 2525].includes(value), "SMTP forwarding is unavailable"),
  private_port_id: uuid,
  internal_port: port.refine(value => ![25, 465, 587, 2525].includes(value), "SMTP forwarding is unavailable"),
}).strict();
const publicFirewallRule = z.object({
  id: uuid.optional(), direction: z.enum(["ingress", "egress"]), ether_type: z.literal("IPv4"),
  protocol: z.enum(["any", "tcp", "udp", "sctp", "icmp"]),
  port_min: port.optional(), port_max: port.optional(),
  remote_cidr: z.string().regex(/^\d{1,3}(?:\.\d{1,3}){3}\/(?:[0-9]|[12][0-9]|3[0-2])$/),
}).strict().refine(value => rule.safeParse(value).success, "Rule fields must match the selected protocol");
const managedTlsHostname = z.string().max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$(?![\s\S])/)
  .refine(value => !ipv4.safeParse(value).success, "Use an exact canonical lowercase ASCII DNS hostname, not an IP address");
const protocol = z.enum(["tcp", "udp", "http", "https"]);
const loadBalancerSpec = {
  name, network_id: uuid, provider: z.enum(["ovn_nlb", "amphora_alb"]),
  listener: z.object({ protocol, port, tls_termination: z.boolean().optional(), routing_rules: z.boolean().optional(), cookie_persistence: z.boolean().optional() }).strict(),
  pool: z.object({ algorithm: z.enum(["connection_hash", "source_affinity", "least_connections", "weighted"]), member_weight: z.boolean().optional(), members: z.array(member).max(64).optional() }).strict(),
  health_monitor: z.object({ kind: z.enum(["tcp", "udp", "http"]) }).strict(),
  placement: z.object({ high_availability: z.boolean().optional() }).strict().optional(), public_vip: z.boolean().optional(),
};
const egressPolicy = z.object({
  mode: z.enum(["private_only", "inherit_network_nat", "chosen_exit"]),
  exit_id: uuid.nullable().optional(), destinations: z.array(z.string()).max(64).optional(),
  dns: z.array(ipv4).max(8).optional(), client_route_opt_in: z.boolean().optional(),
}).strict();
const sitePeer = z.object({
  remote_prefixes: z.array(z.string().regex(/^\d{1,3}(?:\.\d{1,3}){3}\/(?:[0-9]|[12][0-9]|3[0-2])$/)).min(1).max(16)
    .describe("The office's PRIVATE IPv4 networks (10/8, 172.16/12, 192.168/16 or 100.64/10), canonical and disjoint"),
  endpoint: z.string().regex(/^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/).nullable().optional()
    .describe("The office router's fixed public IPv4:port; omit or null to learn a roaming endpoint"),
  persistent_keepalive_seconds: z.number().int().min(0).max(600).optional(),
  router_model: z.enum(["mikrotik", "pfsense", "opnsense", "unifi", "linux", "other"]).optional(),
}).strict();
const ipsecVendor = z.enum(["fortigate", "mikrotik", "pfsense", "opnsense", "cisco_ios_xe", "cisco_asa", "unifi", "junos_srx", "panos", "generic_strongswan", "generic_libreswan"])
  .describe("Router recipe vendor ID from the current get_network_appliance_capabilities VPN ipsec_vendors catalog");
const ipsecTuning = z.object({
  nat_traversal: z.enum(["auto", "off", "forced"]).optional(),
  ke_groups: z.array(z.union([z.literal(19), z.literal(20), z.literal(21), z.literal(31), z.literal(15), z.literal(16), z.literal(14)])).nullable().optional(),
  suites: z.array(z.enum(["aes256gcm", "chacha20poly1305", "aes128gcm", "aes256-sha512", "aes256-sha384", "aes256-sha256", "aes128-sha512", "aes128-sha384", "aes128-sha256"])).nullable().optional(),
  pfs: z.enum(["auto", "on", "off"]).optional(),
  ike_lifetime_seconds: z.number().int().min(900).max(172800).nullable().optional(),
  esp_lifetime_seconds: z.number().int().min(300).max(86400).nullable().optional(),
}).strict().nullable();
const createBgp = z.object({
  peer_asn: z.number().int().min(1).max(4294967294).optional(),
  local_asn: z.number().int().min(1).max(4294967294).optional(),
  accept: z.enum(["listed", "any_private"]).optional(), inner: ipv4.nullable().optional(),
  keepalive_seconds: z.number().int().min(3).max(60).optional(),
  hold_seconds: z.number().int().min(9).max(180).optional(),
}).strict().superRefine((bgp, ctx) => {
  if ((bgp.peer_asn ?? 65000) === (bgp.local_asn ?? 64512)) ctx.addIssue({code: z.ZodIssueCode.custom, message: "BGP ASNs must differ"});
  if ((bgp.hold_seconds ?? 30) < 3 * (bgp.keepalive_seconds ?? 10)) ctx.addIssue({code: z.ZodIssueCode.custom, message: "BGP hold time must be at least three times keepalive"});
});
const ipsecSitePeer = z.object({
  remote_prefixes: z.array(sitePeer.shape.remote_prefixes.element).max(16).optional(),
  bgp: createBgp.nullable().optional(), tuning: ipsecTuning.optional(),
  remote_address: ipv4.nullable().optional().describe("The site's canonical public IPv4 address; omit or null for a dynamic address. No port. The backend validates address and prefix eligibility."),
  vendor: ipsecVendor.optional().describe("Advertised router recipe vendor; omitted uses generic_strongswan"),
  pqc: z.boolean().optional().describe("Request only when the gateway advertises pqc in ipsec_profiles; cannot be true together with legacy_compat. Requested PQC is not proof of negotiated post_quantum."),
  legacy_compat: z.boolean().optional().describe("Request only when the gateway advertises legacy_compat in ipsec_profiles; cannot be true together with pqc"),
}).strict().superRefine((site, ctx) => {
  if (site.pqc && site.legacy_compat) ctx.addIssue({code: z.ZodIssueCode.custom, message: "pqc and legacy_compat cannot both be true"});
  if (!site.remote_prefixes?.length && site.bgp?.accept !== "any_private") ctx.addIssue({code: z.ZodIssueCode.custom, message: "Static and listed BGP sites require remote_prefixes"});
  if ((site.pqc || site.legacy_compat) && site.tuning && (site.tuning.ke_groups?.length || site.tuning.suites?.length || site.tuning.pfs && site.tuning.pfs !== "auto"))
    ctx.addIssue({code: z.ZodIssueCode.custom, message: "Pinned crypto conflicts with PQC or legacy compatibility"});
});
const grantScope = z.enum(["servers", "network"])
  .describe("servers (default) chooses individual grants; network grants this device or site every eligible current and future server of this network, subject to network security policy. Network scope requires empty grants.");
const publicKey = z.string().regex(/^[A-Za-z0-9+/]{43}=$/)
  .refine(value => Buffer.from(value, "base64").length === 32 && Buffer.from(value, "base64").toString("base64") === value)
  .describe("Customer-generated one-time X25519 PUBLIC key only. Keep its private key outside MCP; needed to decrypt the sealed configuration.");
const webhookUrl = z.string().min(1).max(2048).refine(value => {
  if (!value.startsWith("https://") || /[\x00-\x20\x7f\\?#]/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
      && (parsed.port === "" || parsed.port === "443")
      && parsed.hostname.length <= 253
      && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(parsed.hostname)
      && value.slice(8).split("/")[0].toLowerCase() === value.slice(8).split("/")[0];
  } catch { return false; }
}, "Use a public HTTPS DNS endpoint on port 443 without credentials, query or fragment; the backend verifies public DNS addresses.");
const reach = z.object({ load_balancers: z.boolean(), floating_ips: z.boolean() }).strict();
const publicAccessServices = z.array(z.object({
  service: z.enum(["wireguard", "ipsec"]),
  allow_from: z.array(z.string().max(64).refine(value => {
    const [address, prefix, extra] = value.split("/");
    if (extra !== undefined || !(ipv4.safeParse(address).success || sourceIpv6.test(address))) return false;
    return prefix === undefined || (/^[0-9]{1,3}$/.test(prefix) && Number(prefix) >= 1 && Number(prefix) <= (address.includes(":") ? 128 : 32));
  }, "Use an IPv4/IPv6 address or canonical CIDR; backend validates eligible sources and host bits")).max(64),
}).strict()).max(2).refine(items => new Set(items.map(item => item.service)).size === items.length,
  "Each VPN service may appear only once");
const routerInputs = z.record(z.string(), z.union([z.string().max(256), z.number().int().safe()]))
  .refine(values => Object.keys(values).length <= 32 && Object.keys(values).every(k => /^[a-z][a-z0-9_]{1,31}$/.test(k) && !/(?:secret|password|private|psk|token|key)/i.test(k)),
    "Router inputs must contain only nonsecret catalogue fields");
const recipeInputs = z.record(z.string(), z.union([z.string().max(256), z.number().int().safe()]))
  .refine(values => JSON.stringify(values).length <= 2048 && Object.keys(values).every(k =>
    /^(?:line2\.)?[a-z][a-z0-9_]{1,31}$/.test(k) && !/(?:secret|password|private|psk|token|key)/i.test(k)),
    "Recipe preview accepts only nonsecret backend catalogue fields, including line2 fields");
const bgpFields = {
  expected_generation: generation,
  enabled: z.literal(false).optional(),
  remote_prefixes: sitePeer.shape.remote_prefixes.optional(),
  peer_asn: z.number().int().min(1).max(4294967294).optional(),
  local_asn: z.number().int().min(1).max(4294967294).optional(),
  accept: z.enum(["listed", "any_private"]).optional(),
  inner: ipv4.optional(),
  keepalive_seconds: z.number().int().min(3).max(60).optional(),
  hold_seconds: z.number().int().min(9).max(180).optional(),
};
function validateBgp(input: Record<string, unknown>): void {
  if (input.enabled === false && Object.keys(input).some(key => !["enabled", "remote_prefixes", "expected_generation", "gateway_id", "peer_id"].includes(key)))
    throw new Error("Disabling BGP accepts only enabled=false, expected_generation and optional remote_prefixes.");
  if (input.enabled !== false && input.peer_asn !== undefined && input.local_asn !== undefined && input.peer_asn === input.local_asn)
    throw new Error("BGP peer and local ASN must differ.");
  if (input.enabled !== false && input.keepalive_seconds !== undefined && input.hold_seconds !== undefined
      && Number(input.hold_seconds) < 3 * Number(input.keepalive_seconds))
    throw new Error("BGP hold_seconds must be at least three times keepalive_seconds.");
}

type Fields = Record<string, z.ZodType>;
type Options = {
  idempotent?: boolean; paid?: boolean; quote?: boolean; readOnly?: boolean;
  query?: string[]; fixedQuery?: Record<string, string>; fixedBody?: Record<string, unknown>; destructive?: boolean;
  validate?: (input: Record<string, unknown>) => void; bodyless?: boolean;
};
export type NetworkingTool = {
  name: string; method: string; path: string; description: string;
  schema: z.ZodObject<Fields, z.core.$strict>; pathFields: string[]; options: Options;
};
const N = "/account/networking";
const A = `${N}/appliances`;
const networks = `${N}/networks/{network_id}`;
const lb = `${A}/load-balancers/{load_balancer_id}`;
const vpn = `${A}/vpn-gateways/{gateway_id}`;
const peer = `${vpn}/peers/{peer_id}`;
const project = `${N}/projects/{project_id}`;
const sg = `${project}/security-groups`;
const policy = `${project}/networks/{network_id}/security-policy`;
const address = `${N}/public-addresses/{address_id}`;
const binding = `${N}/public-bindings/{binding_id}`;
const publicFirewall = `${N}/services/{service_id}/public-firewall`;
const scope = "Requires explicit networking:read for reads or networking:manage for changes; full/read defaults do not grant networking. The backend enforces ownership, feature availability and service 2FA locks.";
const writes = "Read current capabilities and owned resource state first; obtain approval for the exact change. An accepted operation is pending, not proof of connectivity. Poll the returned operation/resource on its in_progress flag, waiting next_check_seconds between reads: while in_progress is true its reason_code is what is awaited (reason_kind waiting, e.g. a queued or pending reason, or a control plane that has not answered yet), never an error; only in_progress false with reason_kind failure is a failure. Preserve reason_code. On transport uncertainty inspect state and reuse only the original key and unchanged request; never automatically retry.";
const resourceWrites = "Read current capabilities and owned resource state first; obtain approval for the exact intent. A saved request is not proof of runtime application. Poll this tool's documented resource using its state, applied-generation or fresh-proof fields and preserve reason_code. On transport uncertainty inspect that resource; where the route accepts an idempotency key, retain the original key and unchanged request. Never automatically retry.";
const paid = "Requires full API access, networking:manage, enabled paid operations, networking:order and spend caps. Choose a supported live catalog tier and its documented request kind; preserve the exact quote; disclose its gross_amount in EUR before user approval. The same Idempotency-Key is required for quote and confirmation. API-key checkout supports the advertised account-balance payment method only. Payment acceptance is not resource readiness.";
// Keep the strict object for discovery, then check relationships in the shared
// request builder before either hosted or stdio calls reach the API. Preserve
// omitted defaults so existing retry keys keep their original request bodies.
function validateVpnPeerCreation(input: Record<string, unknown>): void {
  const site = input.kind === "site_to_site";
  if (!site && (input.site !== undefined || input.site_down_alert !== undefined || input.site_reach !== undefined)) {
    throw new Error("Devices must omit site, site_down_alert and site_reach.");
  }
  if (input.grant_scope === "network" && (!Array.isArray(input.grants) || input.grants.length !== 0)) {
    throw new Error("Network-wide access requires grants: [].");
  }
  if (site) {
    (input.protocol === "ipsec_ikev2" ? ipsecSitePeer : sitePeer).parse(input.site);
  }
}

function validateVpnPeerGrants(input: Record<string, unknown>): void {
  if (input.grant_scope === "network") {
    if (input.grants !== undefined && (!Array.isArray(input.grants) || input.grants.length !== 0)) {
      throw new Error("Network-wide access requires omitted or empty grants; the network supplies its servers.");
    }
  } else if (input.grants === undefined) {
    throw new Error("Individual-server access requires the complete grants list; omitted grant_scope means servers.");
  }
}

function tool(name: string, method: string, path: string, description: string, fields: Fields = {}, options: Options = {}): NetworkingTool {
  const pathFields = [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
  const shape: Fields = Object.fromEntries(pathFields.map(field => [field, field === "service_id" ? serviceId : uuid]));
  Object.assign(shape, fields);
  if (options.quote || options.paid) shape.idempotencyKey = key;
  else if (options.idempotent) {
    const pattern = path === publicFirewall ? /^[\x20-\x7e]{8,200}$(?![\s\S])/
      : path === `${publicFirewall}/groups` ? /^[A-Za-z0-9._-]{8,128}$(?![\s\S])/
      : path.endsWith("/port-forwards") ? /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$(?![\s\S])/
      : path.includes("/projects/") ? /^[A-Za-z0-9._-]{8,128}$(?![\s\S])/
      : path.includes("/public-bindings/") ? /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$(?![\s\S])/ : /^[A-Za-z0-9._:-]{8,128}$(?![\s\S])/;
    shape.idempotencyKey = z.string().regex(pattern).describe("Idempotency-Key for this exact change; preserve it and the unchanged body on uncertain recovery");
  }
  if (options.paid) {
    shape.quoteToken = quoteToken;
    shape.acknowledge_charge = z.literal(true).describe("Set only after the user approves the exact quoted EUR total and intended purchase/renewal");
  }
  const readOnly = options.readOnly ?? method === "GET";
  return { name, method, path, pathFields, options: { ...options, readOnly }, schema: z.object(shape).strict(),
    description: [description, path.startsWith(N) ? scope : "", !readOnly ? (path.includes("/public-firewall") || path.endsWith("/port-forwards") || path.includes("/load-balancers/") && path.endsWith("/listeners") ? resourceWrites : writes) : "", options.paid || options.quote ? paid : ""].filter(Boolean).join(" ") };
}

export const networkingTools: NetworkingTool[] = [
  tool("get_network_payment_methods", "POST", "/public/macroPay/methods", "Read payment-method metadata without starting payment. Choose the exact value of an item with system=balance for API-key network purchases; other methods are refused for API keys. This public catalog needs no networking scope.", { country: z.string().regex(/^[A-Za-z]{2}$/).optional() }, { readOnly: true, fixedBody: { includeBalanceMethod: true, includePreinvoiceMethod: false } }),
  tool("get_networking_capabilities", "GET", `${N}/capabilities`, "Read account networking availability, quota, creation options and new-server order eligibility. private_network.available/reason_code and order_availability describe selecting an already applied network during a NEW server order; when no such network exists they can be false without denying private-network creation or attachment of existing services. For existing servers, list or create a network and use list_network_attachment_candidates for each service. A refusal from the create, candidate or attach endpoint remains authoritative. Never infer support from tool presence."),
  tool("get_networking_features", "GET", `${N}/features`, "Read current networking feature gates, DNS options and supported contract extensions."),
  tool("get_networking_overview", "GET", `${N}/overview`, "Read owned networks, quota and operation snapshot. operations_has_more signals a bounded backend feed."),
  tool("get_networking_topology", "GET", `${N}/topology`, "Read the account topology with network-scoped identities. Optional metrics=current requests measured traffic.", { metrics: z.literal("current").optional() }, { query: ["metrics"] }),
  tool("list_networking_operations", "GET", `${N}/operations`, "Read recent network operations and operations_has_more. This endpoint has no pagination parameter."),
  tool("get_networking_operation", "GET", `${N}/operations/{operation_id}`, "Read an accepted network or port operation only. Poll on in_progress (true until succeeded, failed or cancelled) and wait next_check_seconds between reads; reason_kind says what reason_code is: waiting (progress, including queued, pending and control-plane-not-yet-answered reasons - not an error), failure or outcome. A port reserve (the operation an attach returns) names its activation_operation_id once the activation that finishes the attachment exists; the completed history line names both ids. A successful network_graph_created operation permits checking network.port_intent_ready for the first attachment; it does not prove guest connectivity. Security-policy, appliance and public-binding operation IDs belong to different stores. Poll security policies with get_network_security_policy, appliances with get_network_appliance_operation, public bindings with get_network_public_binding, and DNS changes through get_private_network.settings.dns_change."),
  tool("list_private_networks", "GET", `${N}/networks`, "List owned private networks, including deletion awaiting verified cleanup. An empty list is a starting state for creating an approved network, not evidence that existing servers cannot use private networking."),
  tool("get_private_network", "GET", networks, "Read one owned network including DHCP reservations, DNS change progress, generation and project_id."),
  tool("create_private_network", "POST", `${N}/networks`, "Create an approved private network for existing services when no suitable owned network exists. A false new-order private_network.available or order_availability result alone does not block this route; honor this endpoint's own quota and feature refusal. Every subnet is unique on the whole platform and comes from 100.64.0.0/10. Omit subnet and the platform allocates a free block of subnet_prefix_length (28..24, default 26 = 64 addresses; capabilities.private_network.subnet_sizes lists each size with its server count and suggested block); or name an aligned /28 through /24 inside 100.64.0.0/10 that no network holds (409 subnet_in_use), never both. Creation is asynchronous: poll its operation and get_private_network until network.port_intent_ready is true, then check attachment candidates. A successful network_graph_created operation and provisioning_status=configured describe the graph stage; the first guest has not yet qualified connectivity. Never wait for applied_generation to equal generation before the first attachment. Creation does not itself attach a server or buy a public address.", { name, subnet: z.object({ cidr: z.string().regex(/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}\/(?:2[4-8])$/) }).strict().optional(), subnet_prefix_length: z.union([z.literal(24), z.literal(25), z.literal(26), z.literal(27), z.literal(28)]).optional().describe("Size of the allocated subnet when subnet is omitted; default 26"), settings: settings.optional(), default_policy: z.enum(["accept", "deny", "ingress_rules"]).optional().describe("Advertised creation policy; omission preserves the backend default. ingress_rules allows IPv4 egress while ingress follows rules/platform exceptions.") }, { idempotent: true }),
  tool("delete_private_network", "DELETE", networks, "Request deletion of an empty network. Referenced appliances/ports may prevent deletion; quota is released only after verified cleanup.", { expected_generation: generation }, { idempotent: true, destructive: true }),
  tool("retry_private_network", "POST", `${networks}/retry`, "Retry the failed current network operation only; preserve its current generation. It may resume a failed deletion or settings change, so inspect the failed operation before retrying.", { expected_generation: generation }, { idempotent: true, destructive: true }),
  tool("set_private_network_dns", "POST", `${networks}/dns`, "Replace the network's DHCP DNS mode and resolver addresses; changing or disabling them can interrupt name resolution for attached guests. Use dns_servers only for custom mode. Poll get_private_network.settings.dns_change; its DNS update UUID is not in the network operations feed.", { dns_mode: dnsMode, dns_servers: z.array(ipv4).min(1).max(3).optional() }, { idempotent: true, destructive: true }),
  tool("set_private_network_names", "PUT", `${networks}/names`, "Replace the complete internal DNS zone label and alias list. Server names are automatic; these names resolve only inside this network. Omitted aliases are removed and may stop resolving.", { zone_label: dnsLabel, aliases: z.array(dnsAlias).max(64) }, { destructive: true }),
  tool("list_private_network_ports", "GET", `${networks}/ports`, "Read owned network ports, their fixed DHCP addresses, generations and attachment states. Reserved is not connected."),
  tool("list_service_private_ports", "GET", `${N}/services/{service_id}/ports`, "Read private ports and order attachment recovery state for one owned service order number."),
  tool("list_network_attachment_candidates", "GET", `${networks}/attachment-candidates`, "For a network with port_intent_ready=true, check each existing service's attachment eligibility and attachment_mode; service_id selects one owned service. Follow next_cursor using after while candidates_has_more is true. Use this per-service result and its reason_code for existing-VM attachment, not new-server order_availability. Do not attach a service the backend marks ineligible.", { after: z.string().optional(), service_id: serviceId.optional() }, { query: ["after", "service_id"] }),
  tool("attach_private_network_port", "POST", `${networks}/ports`, "Attach an eligible existing owned service to a private network with port_intent_ready=true; omit ipv4 for automatic allocation or pass a fixed usable address. Check list_network_attachment_candidates for this network and service first, including pagination and attachment_mode. Set restart=true only after the user approves a required restart. An accepted attach is pending: it returns the port's reserve operation (queued with private_port_apply_pending; reserve, activate and detach take 13-81 s through the host) - poll it with get_networking_operation on in_progress, read its activation_operation_id once the activation that finishes the attachment exists, and verify the final port and service attachment state. Honor this endpoint's own refusal and reason_code.", { service_id: serviceId, ipv4: ipv4.optional(), restart }, { idempotent: true }),
  tool("detach_private_network_port", "DELETE", `${networks}/ports/{port_id}`, "Detach the owned server port. Use the PORT generation and confirm any required restart.", { expected_generation: generation, restart }, { idempotent: true, destructive: true }),
  tool("retry_private_network_port", "POST", `${networks}/ports/{port_id}/retry`, "Retry the failed current port operation with the PORT generation and any required restart approval. Inspect the failed operation: a detach retry can remove the server's private connectivity.", { expected_generation: generation, restart }, { idempotent: true, destructive: true }),
  tool("get_network_vpn_summary", "GET", `${networks}/vpn`, "Read the network's VPN summary, including truthful absence. Connected locations (site-to-site) are managed on the VPN gateway: create_network_vpn_peer with kind=site_to_site, set_network_vpn_site_options, set_network_vpn_site_alert and set_network_site_route_mode."),
  tool("get_network_routed_egress", "GET", `${networks}/routed-egress`, "Read this network's NAT/internet access, public address and qualification state."),
  tool("set_network_routed_egress", "POST", `${networks}/routed-egress`, "Request the currently supported NAT transition for an owned network; the backend may refuse mode changes. This can replace the network's Internet route. public_address_id attaches an already-owned paid address and may remove it from a server. This never purchases an address.", { internet_access: internetAccess, expected_generation: generation, public_address_id: uuid.optional() }, { destructive: true }),
  tool("get_security_group_capabilities", "GET", `${N}/security-groups/capabilities`, "Read security-group availability and whether the network default policy can be changed."),
  tool("list_network_security_groups", "GET", sg, "List groups in the owned project. Copy project_id from the network; do not invent an account identifier."),
  tool("create_network_security_group", "POST", sg, "Create a named allow-rule set. When capabilities advertise egress_policy, rules_only preserves exactly the supplied rules and allow adds unrestricted IPv4 egress. Omit egress_policy for legacy behavior: the backend adds egress-any only if no egress rule was supplied. Updates and clones preserve exact rules. Optional network_id scopes the group to that network; otherwise it belongs to the project. IPv6 rules are unavailable.", { name, rules: z.array(rule).max(256), network_id: uuid.optional(), egress_policy: z.enum(["allow", "rules_only"]).optional() }, { idempotent: true }),
  tool("update_network_security_group", "PUT", `${sg}/{group_id}`, "Replace the complete group name and rule list at its expected revision. Bound private and public interfaces and existing sessions may be affected. Read current public_edit_impact from list_network_security_groups, the private policy groups or get_service_public_firewall groups. Any actual rules change with current/held public consumers requires explicit impact approval and the exact public_impact_ack token for this revision/consumer snapshot. A changed token with the same accepted key conflicts; a fresh failed precondition writes nothing. Empty rules deny traffic allowed only by this group. Poll get_network_security_policy for each affected network (policies[].network_id); these receipts are not generic network operation IDs.", { name, rules: z.array(rule).max(256), expected_revision: generation, public_impact_ack: z.string().regex(/^[a-f0-9]{64}$/).optional().describe("Exact public_edit_impact.token read for this group/revision and current public consumers; send only after explicit approval of that shared impact. Preserve unchanged with the original key on uncertain recovery.") }, { idempotent: true, destructive: true }),
  tool("delete_network_security_group", "DELETE", `${sg}/{group_id}`, "Delete an unreferenced customer group at its expected revision; referenced groups are refused.", { expected_revision: generation }, { idempotent: true, destructive: true }),
  tool("clone_network_security_group", "POST", `${sg}/{group_id}/clone`, "Clone an owned group into a new name; use the source group's current revision.", { name, expected_revision: generation }, { idempotent: true }),
  tool("get_network_security_policy", "GET", policy, "Read default_policy, assigned group rules and desired/applied policy generations. Policy generation differs from network and port generations. effective_policy.default_ingress/default_egress describe implicit deny fallthrough after allow rules; they do not override default_policy=accept or mean every packet is denied. Custom group rules replace the network default on their assigned ports."),
  tool("set_network_default_security_policy", "PUT", policy, "Change the policy for servers without custom groups using an advertised default_policy_values value: accept, deny, or ingress_rules (allow unrestricted IPv4 egress while ingress follows rules/platform exceptions). Explicit custom groups remain restrictive. Use policy generation and default-group revision from get_network_security_policy. Poll get_network_security_policy for each affected network (policies[].network_id); these receipts are not generic network operation IDs.", { default_policy: z.enum(["accept", "deny", "ingress_rules"]), expected_generation: policyGeneration, expected_default_revision: generation }, { idempotent: true, destructive: true }),
  tool("set_private_port_security_groups", "PUT", `${project}/networks/{network_id}/ports/{port_id}/security-groups`, "Replace the port's complete customer-group list. Empty list selects the network default; at most seven customer groups fit alongside platform DNS. Use policy and port generations separately. Poll get_network_security_policy for each affected network (policies[].network_id); these receipts are not generic network operation IDs.", { group_ids: z.array(uuid).max(7), expected_generation: policyGeneration, expected_port_generation: generation }, { idempotent: true, destructive: true }),
  tool("retry_network_security_policy", "POST", `${policy}/retry`, "Retry the failed network security policy using its current desired state. The pending policy may replace firewall rules and remove network access; inspect its desired state first. Poll get_network_security_policy for each affected network (policies[].network_id); these receipts are not generic network operation IDs.", {}, { idempotent: true, destructive: true }),
  tool("retire_network_security_policy", "DELETE", policy, "Retire the policy only after its server ports are gone. Removing firewall policy requires explicit user approval. Poll get_network_security_policy for each affected network (policies[].network_id); these receipts are not generic network operation IDs.", { expected_generation: generation }, { idempotent: true, destructive: true }),
  tool("get_service_public_firewall", "GET", publicFirewall, "Read the owned service's public IPv4 firewall capability, explicit policy and returned public_eligible project-wide custom groups. Group scope eligibility does not guarantee that its rules support public IPv4 enforcement. Private-network group assignments never automatically protect the public interface. A saved generation is intent; only a fresh policy.protected=true is backend-qualified kernel evidence. Missing, stale or failed observations are not protection. Backend resolves project, node, interface and addresses; never supply those authorities."),
  tool("set_service_public_firewall", "PUT", publicFirewall, "Replace the service's complete public-interface group assignment at its expected policy generation. Read returned groups and their rules first. desired_state=present with group_ids=[] or no selected ingress rules denies customer inbound traffic except platform controls and requires acknowledge_no_inbound=true after deliberate approval. Applying no-ingress or egress-only groups can interrupt existing inbound-origin SSH sessions; platform controls provide no SSH bypass. Any ingress rule does not establish SSH reachability. desired_state=absent requires group_ids=[] and acknowledge_removal=true after explicit approval to remove protection. Read capability first; IPv6, remote groups and typed ICMP are unsupported. Re-enabling a retired binding uses its retired generation for compare-and-swap; backend creates a fresh binding epoch whose generation starts at 1. Retain the exact key/body after uncertainty, then poll get_service_public_firewall until fresh applied evidence; no generic operation ID is promised.", { expected_generation: policyGeneration, group_ids: z.array(uuid).max(8).refine(ids => new Set(ids).size === ids.length, "Group IDs must be unique"), desired_state: z.enum(["present", "absent"]), acknowledge_no_inbound: z.literal(true).optional(), acknowledge_removal: z.literal(true).optional() }, { idempotent: true, destructive: true, validate: input => { if (input.desired_state === "absent" && ((input.group_ids as string[]).length !== 0 || input.acknowledge_removal !== true)) throw new Error("Removal requires no groups and explicit acknowledge_removal=true."); if (input.desired_state === "present" && (input.group_ids as string[]).length === 0 && input.acknowledge_no_inbound !== true) throw new Error("No-inbound assignment requires acknowledge_no_inbound=true."); if (input.desired_state === "present" && input.acknowledge_removal !== undefined) throw new Error("acknowledge_removal is only for removing protection."); } }),
  tool("retry_service_public_firewall", "POST", `${publicFirewall}/retry`, "Retry the exact saved public-firewall generation or refresh its kernel observation, without changing rules, target identity or generation. Inspect and approve the saved intent first: an absent intent removes protection. This route has no idempotency key or generation input. Poll get_service_public_firewall; a retry receipt alone is not protection.", {}, { destructive: true }),
  tool("create_service_public_firewall_group", "POST", `${publicFirewall}/groups`, "Explicitly create an unbound account security group for this owned service. This can bootstrap its implicit project without creating a private network or enrolling the public firewall. Read capability.groups_manage first. Only IPv4 CIDR rules without remote groups or typed ICMP are supported. egress_policy=rules_only preserves exact rules; allow adds outgoing-any; omission retains legacy create behavior. Saving a group never assigns it: select its returned ID through a separately approved set_service_public_firewall call. Shared group edits use update_network_security_group and affect all bound interfaces.", { name, rules: z.array(publicFirewallRule).max(256), egress_policy: z.enum(["allow", "rules_only"]).optional() }, { idempotent: true }),
  tool("get_network_appliance_capabilities", "GET", `${A}/capabilities`, "Read available load balancer providers/tiers, public qualification, VPN capabilities (including technologies and ipsec_vendors) and quota. Tier availability and prices are returned by the backend, never hardcoded."),
  tool("list_network_appliances", "GET", A, "Read owned load balancers and VPN gateways with one stream cursor."),
  tool("get_network_appliance_billing", "GET", `${A}/billing`, "Read current customer-visible recurring appliance lines and currency."),
  tool("get_network_appliance_operation", "GET", `${A}/operations/{operation_id}`, "Poll an accepted appliance operation on in_progress (true until terminal), waiting next_check_seconds between reads when supplied; that interval is a poll suggestion, not a completion estimate. A fresh change is queued with appliance_dispatch_pending and then waiting_dependency while the control plane answers; reason_kind waiting marks every such reason as progress, not an error. For VPN operations, started_at is immutable acceptance time; last_progress_at is durable action progress; last_observed_at is a changed agent heartbeat at the action generation; progress_stale describes age of action progress, not heartbeat or tunnel health. stage labels progress, while outcome and finished_at are non-null only at a terminal state. An API receipt, observed heartbeat, selected FRR route or terminal success does not prove connectivity. Check resource state and health separately."),
  tool("list_network_load_balancers", "GET", `${A}/load-balancers`, "List private and public load balancers and customer-safe health/qualification state."),
  tool("get_network_load_balancer", "GET", lb, "Read one owned load balancer, listeners, members, generation and health. managed_tls.available/reason_code is first-listener intake eligibility and becomes unavailable after registration; existing listener.tls remains the certificate lifecycle authority; legacy provider tls_termination is separate. Listener tls status and fingerprint describe certificate adoption/renewal, not end-to-end traffic health. A pending or unqualified public endpoint is not ready."),
  tool("estimate_network_load_balancer", "POST", `${A}/load-balancers/quote`, "Read a technical load balancer estimate for this exact configuration. This does not issue a paid purchase token; buy through quote_network_product and order_network_product. Legacy POST /appliances/load-balancers refuses unpaid creation.", loadBalancerSpec, { readOnly: true }),
  tool("delete_network_load_balancer", "DELETE", lb, "Request appliance teardown at its current generation; this is not a refund or paid-period cancellation. Addresses are released only after verified cleanup.", { expected_generation: generation }, { idempotent: true, destructive: true }),
  tool("add_network_load_balancer_member", "POST", `${lb}/members`, "Add an attached private server address to the selected listener; backend validates membership in this network.", { listener_id: uuid, address: ipv4, port }, { idempotent: true }),
  tool("remove_network_load_balancer_member", "DELETE", `${lb}/members/{member_id}`, "Remove a member from rotation using the load balancer generation.", { expected_generation: generation }, { idempotent: true, destructive: true }),
  tool("add_network_load_balancer_listener", "POST", `${lb}/listeners`, "Add a listener and optional initial members using current capabilities. Optional tls={hostname} requests managed TLS only for an existing qualified alb_proxy_3/5 load balancer's first/sole HTTPS listener. Read its managed_tls capability first; the legacy provider tls_termination flag is not managed-TLS eligibility. Approve the exact hostname and automatic managed-DNS Let's Encrypt issuance/renewal first; ordinary free-certificate eligibility and quotas apply, without a new paid subscription. Backends use HTTP. Never supply a certificate private key or request reference. tls_request receipt may already be succeeded while listener.tls.status is pending; poll get_network_load_balancer. ready means certificate adopted, while traffic still depends on LB provisioning and member health. SMTP ports may be refused.", { protocol, port, members: z.array(member).max(64).optional(), tls: z.object({ hostname: managedTlsHostname }).strict().optional() }, { idempotent: true, validate: input => { if (input.tls !== undefined && input.protocol !== "https") throw new Error("Managed TLS requires protocol=https."); } }),
  tool("remove_network_load_balancer_listener", "DELETE", `${lb}/listeners/{listener_id}`, "Remove a listener and its members using the current resource generation and this exact intent's idempotency key. The backend permits cancelling a sole managed HTTPS listener before any certificate adoption or runtime configuration publication; other last-listener requests follow the backend's current refusal and durable replacement rules. Certificate status alone does not prove guest TLS suspension. Registration and this cancellation advance resource generation without publishing a runtime intent. Poll get_network_load_balancer to confirm cancellation and current managed_tls intake eligibility before a separately approved corrected first-listener add with a fresh key. Preserve each original add/cancel key and unchanged body on uncertainty; backend eligibility and refusal facts remain authoritative.", { expected_generation: generation }, { idempotent: true, destructive: true }),
  tool("list_network_vpn_gateways", "GET", `${A}/vpn-gateways`, "List owned VPN gateways, their device peers and safe status. No private keys or one-time configurations are retrieved."),
  tool("get_network_vpn_gateway", "GET", vpn, "Read one owned VPN gateway, current generation, peers, grant candidates and attachment capability. recent_operation is the latest gateway action summary, with durable progress and generation-matched observation timestamps; it is not a connectivity test. image.update.public_release is optional operator-reviewed channel and notes for a qualified selected target when update status is current or available; it does not describe the installed build or promise an automatic update. Read capabilities.site_ipsec and ipsec_profiles before requesting an IPsec site; availability depends on this gateway's advertised capabilities. capabilities.site_ipsec_bgp_lines reports available/reason_code when the current backend can support two-line BGP; it is absent on older backends. Peer grant_scope distinguishes individual servers from network-wide access to current and future eligible servers. WireGuard peers carry rx_bytes / tx_bytes, last_handshake_at and current_endpoint (the outer address:port last observed; live only, null until learned). IPsec sites report SA/liveness and crypto facts: an old CHILD-SA rekey time is not a failed WireGuard handshake, and requested pqc is not observed post_quantum. For two-line sites, site.lines[n].bgp and site.lines[n].active belong to that exact line; site.bgp is legacy line-1 data. A line's active is local route ownership, not a BGP bestpath. When present, route_visibility is VPSnet gateway FRR evidence scoped to that line: accepted and selected are bounded neighbor routes, advertised is after-policy output, and installed.observed proves only exact local kernel routes. Unknown or stale evidence is not an empty route assertion; no customer-router reachability is measured. site_options shows hub_and_spoke, hub_and_spoke_applied and route_mode while site-to-site is enabled. For traffic over time use get_network_vpn_peer_history."),
  tool("rename_network_vpn_gateway", "PUT", `${vpn}/name`, "Rename an owned VPN's customer label. The backend checks label uniqueness; this does not change the tunnel or guest generation.", { name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,79}$/) }),
  tool("delete_network_vpn_gateway", "DELETE", vpn, "Request teardown of an owned VPN gateway; all devices lose connectivity. Paid time is not refunded by this operation.", { expected_generation: generation }, { idempotent: true, destructive: true }),
  tool("attach_network_vpn_gateway", "POST", `${vpn}/attach`, "Attach or move an account VPN to an owned network only when standalone attachment is advertised. This recreates the gateway and interrupts connections; confirm the interruption.", { network_id: uuid }, { idempotent: true, destructive: true }),
  tool("detach_network_vpn_gateway", "POST", `${vpn}/detach`, "Detach an account VPN from its network when supported; it keeps its paid period and devices but recreates the gateway. Confirm the interruption.", {}, { idempotent: true, destructive: true }),
  tool("set_vpn_server_access", "POST", `${vpn}/server-access`, "Choose accept or groups_only for the VPN's access to attached servers when this capability is available. The setting operation can already be succeeded while security-policy application is pending. Read the gateway network with get_private_network, then get_network_security_policy using its project_id and network_id; do not treat the setting operation as proof of firewall delivery.", { mode: z.enum(["accept", "groups_only"]) }, { idempotent: true, destructive: true }),
  tool("restart_network_vpn_gateway", "POST", `${vpn}/restart`, "Restart the owned VPN VM in place. Connections are interrupted; inspect the returned operation and gateway. Backend spacing and busy refusals are authoritative.", {}, { idempotent: true, destructive: true }),
  tool("rebuild_network_vpn_gateway", "POST", `${vpn}/rebuild`, "Rebuild the owned VPN VM with its existing address and devices. This interrupts connections for roughly one to two minutes; inspect the operation and gateway.", {}, { idempotent: true, destructive: true }),
  tool("update_network_vpn_gateway_image", "POST", `${vpn}/image-update`, "Apply the backend-qualified reviewed VPN image in place. Read get_network_vpn_gateway image.update first and approve the reboot interruption. Poll the operation and gateway; acceptance does not prove the new boot or connectivity. No caller-selected image or release is accepted.", {}, { idempotent: true, destructive: true }),
  tool("check_network_vpn_public_access", "POST", `${vpn}/public-access/check`, "Preview the complete VPN public-source lists without applying them. Read get_network_vpn_gateway public_access first. The backend reports affected connected clients; its own-address check sees the MCP gateway's API source, not the customer's computer. Omitted services and empty lists clear customer restrictions for that service; automatic fixed-site restrictions still apply.", { services: publicAccessServices }, { readOnly: true }),
  tool("set_network_vpn_public_access", "PUT", `${vpn}/public-access`, "Replace the complete WireGuard/IPsec public-source lists at the VPN gateway generation. Preview the same services with check_network_vpn_public_access first. Omitted services and empty lists remove customer restrictions, potentially expanding access. Only set acknowledge_disconnect=true after approval to disconnect affected clients. Poll gateway public_access for actual applied evidence.", { services: publicAccessServices, expected_generation: generation, acknowledge_disconnect: z.literal(true).optional() }, { idempotent: true, destructive: true }),
  tool("set_network_vpn_internet_exit", "PUT", `${vpn}/internet-exit`, "Choose none, the VPN's own IPv4, or its attached network NAT as Internet exit. The backend qualifies each mode and returns applying/applied state. Reusing the same idempotency key with the same mode is safe after uncertainty.", { mode: z.enum(["none", "own_ipv4", "network_nat"]) }, { idempotent: true, destructive: true }),
  tool("create_network_vpn_peer", "POST", `${vpn}/peers`, "Add a device or, with kind=site_to_site, a connected location using a customer-generated one-time X25519 PUBLIC reveal key. Protocol defaults to wireguard; ipsec_ikev2 also supports built-in operating-system device clients when gateway capabilities.device_ikev2 advertises availability. Devices must omit site, site_down_alert and site_reach. Pass 0-16 explicit server grants, or grant_scope=network with grants=[] for all eligible current and future servers; approve broader access. Empty explicit grants gives no network-server access; backend checks whether anything remains reachable. Sites require protocol-specific site settings: WireGuard prefixes/endpoint/keepalive/router_model; IPsec remote_address/vendor, optional bgp/tuning and mutually exclusive pqc/legacy_compat. IPsec prefixes may be empty or omitted only with bgp.accept=any_private. Optional site_reach overrides the VPN default (null inherits). Read current gateway and appliance capabilities before choosing supported protocols, crypto and vendors. Keep the matching reveal private key entirely outside MCP. Wait for config_available and consume the sealed configuration once; decrypt only outside MCP. IPsec device passwords and site PSKs must never enter MCP. Router recipes contain placeholders only.", { name: name.max(64), grants: z.array(ipv4).max(16), reveal_public_key: publicKey, kind: z.enum(["road_warrior", "site_to_site"]).optional(), protocol: z.enum(["wireguard", "ipsec_ikev2"]).optional(), grant_scope: grantScope.optional(), site: z.union([sitePeer, ipsecSitePeer]).optional(), site_reach: reach.nullable().optional(), site_down_alert: z.boolean().optional() }, { idempotent: true, validate: validateVpnPeerCreation }),
  tool("take_network_vpn_peer_config", "GET", `${peer}/config`, "Consume a device's or site's sealed configuration ONCE. For IPsec primary-key rotation pass line=1 explicitly: without it, a pending second-line envelope can be returned after the primary was consumed. This is a management mutation despite GET. The ciphertext is decryptable only by the customer's matching external reveal private key; this tool never creates, requests or decrypts private keys or a raw PSK. A second pickup is 410. Never retry automatically after an uncertain transport result.", { acknowledge_one_time_pickup: z.literal(true), line: z.literal(1).optional() }, { readOnly: false, destructive: true, query: ["line"] }),
  tool("take_network_vpn_site_line_config", "GET", `${peer}/config`, "Consume the second IPsec line's sealed key exactly once with line=2. Decrypt only outside MCP with the private key matching add_network_vpn_site_line's public reveal key. A second pickup is 410; never retry after an uncertain response.", { acknowledge_one_time_pickup: z.literal(true) }, { readOnly: false, destructive: true, fixedQuery: { line: "2" } }),
  tool("rotate_network_vpn_ipsec_key", "POST", `${peer}/rotate-key`, "Rotate an IPsec site's pre-shared key. Supply a fresh customer-generated X25519 public reveal key, keep its private half outside MCP, then consume the new sealed material once with take_network_vpn_peer_config line=1. The old key stops authenticating new sessions after apply; inspect the operation. WireGuard peers are refused.", { reveal_public_key: publicKey }, { idempotent: true, destructive: true }),
  tool("revoke_network_vpn_peer", "DELETE", peer, "Revoke one device using the VPN GATEWAY generation. Its tunnel access ends after the next applied configuration.", { expected_generation: generation }, { idempotent: true, destructive: true }),
  tool("set_network_vpn_peer_grants", "PUT", `${peer}/grants`, "Replace the peer's complete server-access choice using the gateway generation. Read the gateway and current grant_scope first. Omitted grant_scope means servers: supply the full 0-16 address list; this also disables a device's previous network-wide access to future servers, even if today's list is unchanged. Empty grants removes this peer's server access. Devices and sites support grant_scope=network: omit grants or send [] to allow every eligible current and future server of the network, subject to network security policy. Confirm that scope and its effects. Check routes_update for required customer router/client changes.", { expected_generation: generation, grants: z.array(ipv4).max(16).optional(), grant_scope: grantScope.optional() }, { idempotent: true, destructive: true, validate: validateVpnPeerGrants }),
  tool("get_network_vpn_peer_history", "GET", `${peer}/history`, "Read one device's or site's traffic and connection history, oldest point first: range 24h = raw 30-second samples (kept 24 h), 7d = 10-minute points and 30d = hourly points (from per-minute rows kept 30 days), 13m = daily UTC points (from hourly rows kept 13 months). rx = bytes the VPN received from the peer, tx = bytes sent to it. For WireGuard, connected means a handshake at most 180 s old in the step. For IPsec, connected means the SA was up at the sample; its CHILD-SA rekey timestamp is not the WireGuard liveness timer. A period the VPN did not observe has no point (unknown, never 0). The endpoint IP is live only on get_network_vpn_gateway and never part of the history.", { range: z.enum(["24h", "7d", "30d", "13m"]) }, { query: ["range"] }),
  tool("list_network_vpn_site_health_webhooks", "GET", `${peer}/health-webhooks`, "List this owned site's signed health subscriptions and last delivery outcomes. Destination URLs are shown as public HTTPS hosts only; stored paths and signing material are never returned. Health is the VPN-side observation, not a test from the customer's LAN."),
  tool("create_network_vpn_site_health_webhook", "POST", `${peer}/health-webhooks`, "Create a signed site health subscription. Supply a public HTTPS DNS endpoint on port 443 and a caller-generated X25519 PUBLIC reveal key; keep the private half outside MCP. The immediate 201 response contains the subscription and a one-time sealed_secret envelope, not a raw signing secret. Decrypt it outside MCP to configure the receiver. Verify timestamp, exact-body HMAC and event-ID deduplication at the receiver. After an uncertain outcome, list subscriptions before deciding whether to create another; this route has no idempotency key or operation ID.", { url: webhookUrl, reveal_public_key: publicKey }, {}),
  tool("delete_network_vpn_site_health_webhook", "DELETE", `${peer}/health-webhooks/{subscription_id}`, "Remove this owned site's subscription and cancel pending deliveries. The immediate 200 result is {removed:true}; a missing subscription returns 404. Check the list after an uncertain outcome; this route has no operation ID.", {}, { destructive: true, bodyless: true }),
  tool("get_network_vpn_peer_recipe", "GET", `${peer}/recipe`, "Read backend-sourced router setup instructions for one owned IPsec IKEv2 site. Optional vendor, language, line selection and version/inputs preview use the backend recipe catalogue. The recipe contains a literal {{PSK}} placeholder, never the secret. Unsupported router/BGP/line combinations are refused, not replaced by a static recipe.", { vendor: ipsecVendor.optional(), lang: z.enum(["en", "lt"]).optional(), lines: z.enum(["all", "2"]).optional(), version: z.string().max(64).optional(), inputs: recipeInputs.optional() }, { query: ["vendor", "lang", "lines", "version", "inputs"] }),
  tool("save_network_vpn_router_setup", "PUT", `${peer}/router-setup`, "Save nonsecret backend-catalogue router version and local interface/zone fields for an IPsec site, optionally line 2. This changes saved setup guidance, not the tunnel. The backend validates vendor, version and fields.", { vendor: ipsecVendor, line: z.union([z.literal(1), z.literal(2)]).optional(), version: z.string().max(64).nullable().optional(), inputs: routerInputs.optional() }),
  tool("set_network_vpn_site_bgp", "PUT", `${peer}/bgp`, "Enable or change BGP over an eligible IPsec site using the gateway generation. For two lines, the backend requires listed prefixes and a qualified route-based line 2 with current agent capability; preserve its typed 409 vpn_ipsec_lines_bgp if unavailable. Set enabled=false to turn BGP off; when switching from any_private, supply remote_prefixes for static routing. Follow each line's bgp and active facts separately; no operation ID is promised.", bgpFields, { destructive: true, validate: validateBgp }),
  tool("add_network_vpn_site_line", "POST", `${peer}/lines`, "Add line 2 to an IPsec site using the gateway generation and an external X25519 public reveal key. Keep its private key outside MCP; after config_available, take_network_vpn_site_line_config returns its sealed key exactly once. For two-line BGP, supply a supported route-based vendor and let the backend infer independent setup; no independent_setup request field exists. Preserve the backend's typed 409 vpn_ipsec_lines_bgp when the current capability is unavailable.", { expected_generation: generation, reveal_public_key: publicKey, remote_address: ipv4.nullable().optional(), vendor: ipsecVendor.nullable().optional(), dpd_seconds: z.number().int().min(10).max(300).optional() }, { idempotent: true, destructive: true }),
  tool("set_network_vpn_site_main_line", "PUT", `${peer}/lines/main`, "Choose line 1 or 2 as the main IPsec line using the gateway generation; optional DPD applies to both. Confirm routing interruption and inspect the returned peer/operation.", { line: z.union([z.literal(1), z.literal(2)]), expected_generation: generation, dpd_seconds: z.number().int().min(10).max(300).nullable().optional() }, { idempotent: true, destructive: true }),
  tool("remove_network_vpn_site_second_line", "DELETE", `${peer}/lines/2`, "Remove line 2 using the gateway generation. The backend refuses removal while it is main; move main to line 1 first. Inspect the returned operation and peer.", { expected_generation: generation }, { idempotent: true, destructive: true }),
  tool("set_network_vpn_ipsec_tuning", "PUT", `${peer}/ipsec-tuning`, "Replace an IPsec site's advanced tunnel choices using the gateway generation. Read gateway ipsec_tuning for currently offered values and the site's crypto profile; pinned crypto conflicts with PQC or legacy compatibility. tuning=null restores automatic defaults; omitted members also become automatic. Changes can interrupt negotiation. Poll the operation and gateway until tuning_applied is true; never supply a PSK or private key.", { expected_generation: generation, tuning: ipsecTuning }, { idempotent: true, destructive: true }),
  tool("start_network_vpn_tunnel_test", "POST", `${peer}/tests`, "Start a backend tunnel test for a site or supported WireGuard peer; optional line selects 1 or 2. A running test may be returned instead of a new probe. Read the returned test ID with get_network_vpn_tunnel_test; rate and capability refusals are authoritative.", { line: z.union([z.literal(1), z.literal(2)]).optional() }, { idempotent: true }),
  tool("get_network_vpn_tunnel_test", "GET", `${peer}/tests/{test_id}`, "Read one owned tunnel test by its returned ID; while running, poll no faster than the backend's one-second guidance."),
  tool("set_network_vpn_site_reach", "PUT", `${peer}/site-reach`, "Set this site's load-balancer/floating-IP reach choice, or null to follow its VPN default. This can expand access to services behind those addresses; the backend checks ownership and service locks. Inspect site_reach.state and reason_code.", { reach: reach.nullable() }, { destructive: true }),
  tool("set_network_vpn_site_options", "PUT", `${vpn}/site-options`, "Set one or more VPN options: hub_and_spoke joins offices, site_reach sets the default load-balancer/floating-IP reach for sites, and device_mesh lets devices reach each other. Each can expand connectivity. The backend checks attached service locks and reports applied state; read get_network_vpn_gateway until it settles. 503 vpn_site_routing_unavailable while site routing is disabled.", { hub_and_spoke: z.boolean().optional(), site_reach: reach.optional(), device_mesh: z.boolean().optional() }, { destructive: true, validate: input => { if (!["hub_and_spoke", "site_reach", "device_mesh"].some(field => input[field] !== undefined)) throw new Error("Set at least one VPN site option."); } }),
  tool("set_network_vpn_site_alert", "PUT", `${peer}/site-alert`, "Switch the office-down e-mail of one connected location: enabled=true sends one e-mail to the account when the location's router has not reached the VPN for 5 minutes and one more when it is back. The first observation after switching it on only records the state (state null until then). Devices are refused (404 vpn_peer_not_found). 503 vpn_site_routing_unavailable while site-to-site is not enabled.", { enabled: z.boolean() }, {}),
  tool("set_network_site_route_mode", "PUT", `${A}/networks/{network_id}/site-route-mode`, "Choose how the servers of a network reach its VPN's connected locations: dhcp (default) = DHCP classless static routes, picked up at the next lease renewal (about 30 minutes) or a DHCP renew/restart, never by servers with a fixed address; router = an internal network router (no NAT, no external address, no price) carries the routes at once. Has no effect on a network with a NAT gateway. Every VPN of the network moves to a new route line at once. 409 while a server of the network is suspended for abuse.", { route_mode: z.enum(["dhcp", "router"]) }, { destructive: true }),
  tool("get_network_vpn_egress_options", "GET", `${vpn}/egress-options`, "Read supported VPN Internet exits and qualification. Ordinary VMs and remote connectors are not implied to be supported."),
  tool("set_network_vpn_peer_egress", "PUT", `${peer}/egress-policy`, "Set a device's private-only, inherited NAT, or advertised chosen exit policy. Read egress options first; Internet routing requires explicit client-route opt-in and applied qualification.", { expected_generation: generation, policy: egressPolicy }, { idempotent: true, destructive: true }),
  tool("list_network_products", "GET", `${N}/products`, "Read current paid products, prices, order periods, distinct renew_periods and purchase capability. VPN is one canonical product; deprecated VPN alias rows are omitted from this sellable catalogue while owned/legacy quote evidence remains unchanged. Load-balancer tier names and prices remain backend-defined; public proxy load balancer 3/5-node offerings must come from this catalog. Pass an owned network_id to include that target's purchase eligibility and refusal reasons.", { network_id: uuid.optional() }, { query: ["network_id"] }),
  tool("list_network_product_periods", "GET", `${N}/product-periods`, "Read owned product periods, renewal availability and lifecycle facts."),
  tool("quote_network_product", "POST", `${networks}/product-quotes`, "Create the network product's exact paid quote for COMMON CHECKOUT. No charge or stock preparation occurs here. prepare_after_payment=true is always sent. Catalog product load_balancer maps to request kind private_lb for tier nlb or proxy_lb for tiers alb_proxy_3/alb_proxy_5; vpn_gateway maps directly. Only use currently supported catalog codes; VPN has one product, and its tier code is not a feature/plan choice. Prefer quote_account_vpn with omitted tier for a new VPN quote; preserve original codes for legacy recovery. Create with order_network_product after disclosure and approval.", { kind: z.enum(["private_lb", "proxy_lb", "vpn_gateway"]), tier: z.string().regex(/^[a-z][a-z0-9_]*$/), period_months: periodMonths.optional() }, { quote: true, fixedBody: { prepare_after_payment: true } }),
  tool("quote_account_vpn", "POST", `${N}/vpn/product-quotes`, "Quote the one canonical VPN product based on the current Firecracker plan for common checkout when vpn_account_order is advertised. Omit tier for a new request; standard/full_exit are backend compatibility/proof codes, not sellable VPN plan choices. Additional traffic is purchased separately with quote_network_vpn_traffic_pack. Internet exit is a gateway setting. Pass an owned attachment network when required; no provisioning or charge occurs before payment. Uses prepare_after_payment=true.", { tier: z.string().regex(/^[a-z][a-z0-9_]*$/).optional().describe("Compatibility code only: omit for the one current VPN product. Preserve an existing legacy request code only when recovering that unchanged quote intent; this is not a VPN plan choice."), network_id: uuid.optional(), period_months: periodMonths.optional() }, { quote: true, fixedBody: { prepare_after_payment: true } }),
  tool("order_network_product", "POST", `${N}/product-orders`, "Confirm a common-checkout purchase from an approved exact quote. Use its quote_id, quote_token and ORIGINAL idempotency key. payment.payment is the account-balance method ID from get_network_payment_methods; do not guess it. Optional target attaches an address to a network after settlement. After any uncertain result call find_network_product_order with the quote ID, then poll get_network_product_order; never buy a second copy.", { quote_id: uuid, payment: z.object({ payment: unboundedInteger().positive(), paymentid: unboundedInteger().positive().optional() }).strict(), target: z.object({ network_id: uuid, expected_generation: generation }).strict().optional() }, { paid: true }),
  tool("get_network_product_order", "GET", `${N}/product-orders/{order_id}`, "Read an owned common-checkout order's payment and fulfilment state. paid_pending with billing_state=captured and reason_code=network_product_ip_inventory_wait means this paid order awaits public IP inventory and resumes automatically when available; keep polling this order without another purchase, payment or manual retry. paid_pending is not ready. manual_review or network_product_stock_reconciliation_required needs operator review, not an automatic inventory retry. fulfilled may include a separate attachment status."),
  tool("find_network_product_order", "GET", `${N}/product-orders`, "Recover an uncertain checkout by the ORIGINAL quote_id; order=null means no order was found, not proof to use a new payment key.", { quote_id: uuid }, { query: ["quote_id"] }),
  tool("quote_network_product_renewal", "POST", `${networks}/product-periods/{resource_id}/quote`, "Quote the selected paid term (one month when omitted) for a network product; no charge. Preserve the returned quote and this idempotency key for renewal.", { period_months: periodMonths.optional() }, { quote: true }),
  tool("renew_network_product", "POST", `${networks}/product-periods/{resource_id}/renew`, "Pay the exact previously disclosed renewal from account balance. The quote binds resource, paid term and price; use the same key and token.", { quote_id: uuid }, { paid: true }),
  tool("disable_network_product_auto_renew", "POST", `${networks}/product-periods/{resource_id}/auto-renew`, "Disable automatic renewal. The paid product continues to its paid-until time; API keys cannot enable automatic renewal.", {}, { fixedBody: { state: false } }),
  tool("quote_vpn_period_renewal", "POST", `${vpn}/period/quote`, "Quote the VPN's selected term (one month when omitted) on its actual paid scope; no charge. Availability follows the owned gateway's current capability.", { period_months: periodMonths.optional() }, { quote: true }),
  tool("quote_network_vpn_traffic_pack", "POST", `${vpn}/traffic-packs/quote`, "Quote separately purchased additional traffic for this owned VPN using an offered pack code from get_network_vpn_gateway traffic; this does not buy or change a VPN plan. No charge occurs. Packs apply to the current UTC month; read the live quote terms and amount. Confirm only through order_network_product with the exact returned quote, token and ORIGINAL idempotency key after approval.", { tier: z.string().regex(/^[a-z0-9][a-z0-9_]*$/) }, { quote: true }),
  tool("renew_vpn_period", "POST", `${vpn}/period/renew`, "Pay the VPN's approved quoted renewal term from account balance using the exact quote and original key.", { quote_id: uuid }, { paid: true }),
  tool("disable_vpn_auto_renew", "POST", `${vpn}/auto-renew`, "Disable the VPN's automatic renewal; the current paid period remains. API keys cannot enable it.", {}, { fixedBody: { state: false } }),
  tool("list_network_public_addresses", "GET", `${N}/public-addresses`, "Read owned paid public addresses, account limits, target support and purchase availability."),
  tool("list_public_address_server_targets", "GET", `${N}/public-addresses/server-targets`, "Read paginated owned server candidates for a public address on an existing public interface. Inspect eligible/reason and current server_public_target_enabled capability before attaching; a candidate is not readiness proof. Preserve the returned opaque next_cursor.", { search: z.string().max(128).optional(), cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(100).optional(), service_id: serviceId.optional() }, { query: ["search", "cursor", "limit", "service_id"] }),
  tool("get_network_public_address", "GET", address, "Read one owned public address, attachment and paid-period state."),
  tool("quote_network_public_address", "POST", `${N}/public-addresses/quote`, "Quote a new paid public address for common checkout; no charge. Optional network_id preflights attachment limits before payment. Always prepare_after_payment=true; confirm through order_network_product with matching target if attaching.", { network_id: uuid.optional(), period_months: periodMonths.optional() }, { quote: true, fixedBody: { prepare_after_payment: true } }),
  tool("attach_public_address_to_network", "POST", `${address}/attach`, "Attach an already-paid address to an owned network's NAT using the NETWORK generation. Pass move=true only after approving removal from its previous target; omitted move preserves backend refusal of implicit movement. No purchase occurs.", { network_id: uuid, expected_generation: generation, move: z.boolean().optional() }, { destructive: true }),
  tool("attach_public_address_to_server", "POST", `${address}/attach`, "Attach an owned paid public address to exactly one target: private_port_id for an eligible zero-public-IP server's private port, or service_id for a qualified server's existing public interface. Read server_target_enabled for private ports or server_public_target_enabled for existing public interfaces, and the relevant candidates first. Pass move=true only after approving interruption of the previous target. The backend enforces ownership and service locks; inspect reach/applied state after acceptance.", { private_port_id: uuid.optional(), service_id: serviceId.optional(), move: z.boolean().optional() }, { destructive: true, validate: input => { if ((input.private_port_id === undefined) === (input.service_id === undefined)) throw new Error("Choose exactly one private_port_id or service_id."); } }),
  tool("check_network_public_address_reach", "POST", `${address}/reach-check`, "Queue another platform-side reach and reply-route check for this owned public address. It may repair reply routing; it does not move the attachment and is a management action. Poll get_network_public_address reach until the check finishes; a queued check is not connectivity proof."),
  tool("detach_network_public_address", "POST", `${address}/detach`, "Detach an owned public address from its current target; it stays owned for the paid period. This can remove Internet connectivity.", {}, { destructive: true }),
  tool("quote_public_address_renewal", "POST", `${address}/renewal-quote`, "Quote the address's selected term (one month when omitted) without charging; use the returned quote and this key for confirmation.", { period_months: periodMonths.optional() }, { quote: true }),
  tool("renew_network_public_address", "POST", `${address}/renew`, "Pay the approved address renewal from balance with its exact quote ID/token and original key.", { quote_id: uuid }, { paid: true }),
  tool("disable_public_address_auto_renew", "POST", `${address}/auto-renew`, "Disable address automatic renewal; ownership lasts until paid_until. There is no early paid-address cancellation route. API keys cannot enable automatic renewal.", {}, { fixedBody: { state: false } }),
  tool("get_network_public_binding", "GET", binding, "Read one existing owned public binding's generation, state and assigned address. Poll this resource after bind, move or delete; public-binding operation IDs are not accepted by get_networking_operation or get_network_appliance_operation. Existing bindings are distinct from purchasing an account public address."),
  tool("bind_network_public_ip", "POST", `${binding}/bind`, "Bind an already reserved floating public binding to an owned private port when supported. Does not purchase an address.", { expected_generation: policyGeneration, private_port_id: uuid }, { idempotent: true, destructive: true }),
  tool("move_network_public_ip", "POST", `${binding}/move`, "Move a prepared floating public binding to another owned private port; confirm interruption to the old target.", { expected_generation: generation, private_port_id: uuid }, { idempotent: true, destructive: true }),
  tool("delete_network_public_binding", "DELETE", binding, "Request deletion of an existing binding using its generation. Account address ownership/paid renewal is managed separately; do not claim a refund.", { expected_generation: policyGeneration }, { idempotent: true, destructive: true }),
  tool("get_network_port_forwards", "GET", `${networks}/port-forwards`, "Read the owned network NAT's complete TCP/UDP forwarding set, ROUTER generation, applied_generation, state, current capability and owned targets with eligible/unavailable_reason_code. Choose only an eligible returned private_port_id; a generic private_primary port flag does not qualify KVM. This generation differs from the network generation. Tool presence does not imply runtime-qualified availability; security groups still apply."),
  tool("set_network_port_forwards", "PUT", `${networks}/port-forwards`, "Replace the owned network NAT's complete TCP/UDP port-forward set at the ROUTER generation returned by get_network_port_forwards. rules=[] removes every forward. Maximum and target qualification come from capability; choose eligible private_port_id values from get_network_port_forwards targets; initially only eligible private-primary zero-public-IP Firecracker targets are supported. One target per protocol/external port; SMTP ports are refused. This exposes target services through the NAT address without bypassing security groups. Approve exact rules, retain the key/body and poll get_network_port_forwards until applied; never use generic network operation polling for this receipt. On a confirmed failed state, an explicitly approved retry must use the exact current desired rules and current router generation with a new key; changed rules are refused until that generation is observed. Transport uncertainty still requires the original key and unchanged request, never a new key.", { expected_generation: generation, rules: z.array(portForward).max(64) }, { idempotent: true, destructive: true, validate: input => { const rules = input.rules as Array<{protocol: string; external_port: number}>; if (new Set(rules.map(rule => `${rule.protocol}:${rule.external_port}`)).size !== rules.length) throw new Error("Only one forwarding target per protocol and external port is allowed."); } }),
];

export function networkingRequest(definition: NetworkingTool, args: Record<string, unknown>) {
  const input = definition.schema.parse(args);
  definition.options.validate?.(input);
  let path = definition.path;
  for (const field of definition.pathFields) path = path.replace(`{${field}}`, encodeURIComponent(String(input[field])));
  const query = new URLSearchParams();
  for (const field of definition.options.query ?? []) {
    if (input[field] !== undefined) query.set(field, typeof input[field] === "object" ? JSON.stringify(input[field]) : String(input[field]));
  }
  for (const [field, value] of Object.entries(definition.options.fixedQuery ?? {})) query.set(field, value);
  if (query.size) path += `?${query}`;
  const headers: Record<string, string> = {};
  if (input.idempotencyKey !== undefined) headers["Idempotency-Key"] = String(input.idempotencyKey);
  if (input.quoteToken !== undefined) headers["X-Quote-Token"] = String(input.quoteToken);
  const excluded = new Set([...definition.pathFields, ...(definition.options.query ?? []), "idempotencyKey", "quoteToken", "acknowledge_charge", "acknowledge_one_time_pickup", "acknowledge_removal", "acknowledge_no_inbound"]);
  const body = definition.method === "GET" || definition.options.bodyless ? undefined : {
    ...Object.fromEntries(Object.entries(input).filter(([field, value]) => !excluded.has(field) && value !== undefined)),
    ...(definition.options.fixedBody ?? {}),
  };
  return { method: definition.method, path, body, headers, readOnly: definition.options.readOnly === true };
}

type FollowUpRead = { tool: string; arguments: Record<string, string> };

/**
 * One line a client can act on without knowing the reason vocabulary (PROD QA 2026-10-14: an AI client read the
 * waiting reason of a fresh operation as an error and stopped). Reads the operation of a receipt or of an
 * operation read; null when the result carries no operation with a progress label.
 */
export function networkingProgressHint(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const value = data as Record<string, any>;
  const operation = value.operation && typeof value.operation === "object" ? value.operation
    : typeof value.in_progress === "boolean" ? value : null;
  if (!operation || typeof operation.in_progress !== "boolean") return null;
  const reason = typeof operation.reason_code === "string" && operation.reason_code !== "" ? operation.reason_code : "none";
  const vpnTelemetry = typeof operation.kind === "string" && operation.kind.startsWith("vpn_") && typeof operation.started_at === "string"
    ? " VPN telemetry: started_at is immutable acceptance time; last_progress_at is durable action progress; last_observed_at, when present, is a changed agent heartbeat at this action's generation; progress_stale is age of action progress, not tunnel health. stage labels progress; outcome and finished_at mark a terminal result. Receipt, observation, FRR selection and terminal success do not prove connectivity."
    : "";
  if (operation.in_progress) {
    const wait = Number.isInteger(operation.next_check_seconds) && operation.next_check_seconds > 0
      ? `in ${operation.next_check_seconds} s` : "after an interval";
    return `Operation ${operation.id ?? ""} in progress (state=${operation.state}, reason_code=${reason}, reason_kind=${operation.reason_kind ?? "waiting"}): this is progress, not an error. Poll the follow-up read again ${wait}; do not repeat the change.${vpnTelemetry}`;
  }
  if (operation.reason_kind === "failure") {
    return `Operation ${operation.id ?? ""} failed (state=${operation.state}, reason_code=${reason}). Do not retry automatically; report the reason_code.${vpnTelemetry}`;
  }
  return `Operation ${operation.id ?? ""} finished (state=${operation.state}, reason_code=${reason}).${vpnTelemetry}`;
}

// VPN responses may carry one-time setup material. Keep ciphertext in its
// reviewed envelope, but never hand plaintext keys or arbitrary error text to
// an AI client, including when the backend adds a nested field in the future.
export function safeVpnPayload(data: unknown, status: number): unknown {
  if (status >= 400) {
    const value = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
    const safe: Record<string, unknown> = { http_status: status };
    for (const field of ["reason_code", "code", "error", "field"]) {
      if (typeof value[field] === "string" && /^[a-z][a-z0-9_.-]{0,127}$/.test(value[field])) safe[field] = value[field];
    }
    if (status === 423 && value.code === "serviceTwoFactorLocked") {
      safe.code = "serviceTwoFactorLocked";
      safe.serviceTwoFactorLocked = true;
      if (["locked", "apiKeyNotAllowed", "assistantNotAllowed", "impersonationNotAllowed", "adminNeedsCustomerUnlock", "transferNeedsLockOff"].includes(String(value.reason))) safe.reason = value.reason;
      if (typeof value.unlockAvailable === "boolean") safe.unlockAvailable = value.unlockAvailable;
      if (serviceId.safeParse(value.orderNo).success) safe.orderNo = value.orderNo;
    }
    if (Number.isInteger(value.retry_after) && Number(value.retry_after) > 0) safe.retry_after = value.retry_after;
    if (value.non_api_response === true) safe.non_api_response = true;
    if (value.outcome_unknown === true) {
      safe.outcome_unknown = true;
      safe.message = "The request outcome is unknown. Inspect state before retrying with the same key and unchanged input.";
    }
    return safe;
  }
  const project = (value: unknown, depth: number): unknown => {
    if (depth > 24) return "[omitted]";
    if (Array.isArray(value)) return value.map(item => project(item, depth + 1));
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [field, item] of Object.entries(record)) {
        const normalized = field.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
        if (field === "sealed") {
          if (!item || typeof item !== "object" || Array.isArray(item)) { out.sealed = "[invalid sealed material]"; continue; }
          const sealed = item as Record<string, unknown>;
          const names = Object.keys(sealed).sort();
          if (JSON.stringify(names) !== JSON.stringify(["ciphertext", "ephemeral_public_key", "nonce"])
              || names.some(name => typeof sealed[name] !== "string")) { out.sealed = "[invalid sealed material]"; continue; }
          out.sealed = { ephemeral_public_key: sealed.ephemeral_public_key, nonce: sealed.nonce, ciphertext: sealed.ciphertext };
        } else if (field === "public_edit_impact") {
          const impact = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
          // This public snapshot digest is an approval challenge, not a credential.
          out.public_edit_impact = Number.isSafeInteger(impact.service_count) && Number(impact.service_count) >= 0
            && typeof impact.token === "string" && /^[a-f0-9]{64}$/.test(impact.token)
            ? { service_count: impact.service_count, token: impact.token } : { unavailable: true };
        } else if (field === "sealed_secret") {
          if (!item || typeof item !== "object" || Array.isArray(item)) { out.sealed_secret = "[invalid sealed material]"; continue; }
          const sealed = item as Record<string, unknown>;
          const names = Object.keys(sealed).sort();
          const valid = (value: unknown, bytes: number) => {
            if (typeof value !== "string" || value.length !== 4 * Math.ceil(bytes / 3)) return false;
            const decoded = Buffer.from(value, "base64");
            return decoded.length === bytes && decoded.toString("base64") === value;
          };
          // Backend seals {"secret":"<64 hex chars>"}: 77 JSON bytes plus the 16-byte NaCl box MAC.
          const ciphertextBytes = 93;
          if (JSON.stringify(names) !== JSON.stringify(["ciphertext", "ephemeral_public_key", "nonce"])
              || !valid(sealed.ephemeral_public_key, 32) || !valid(sealed.nonce, 24)
              || !valid(sealed.ciphertext, ciphertextBytes)) {
            out.sealed_secret = "[invalid sealed material]"; continue;
          }
          out.sealed_secret = { ephemeral_public_key: sealed.ephemeral_public_key, nonce: sealed.nonce, ciphertext: sealed.ciphertext };
        } else if (normalized !== "psk_lost_hint" && normalized !== "psk_placeholder" && normalized !== "quote_token"
            && (/^(?:psk|pre_shared_key|private_key|secret|password|credential|token)(?:_|$)/.test(normalized)
              || /_(?:psk|pre_shared_key|private_key|secret|password|credential|token)$/.test(normalized)
              || /^(?:config|configuration|ciphertext|raw_material)$/.test(normalized))) {
          out[field] = "[redacted]";
        } else out[field] = project(item, depth + 1);
      }
      return out;
    }
    if (typeof value === "string") return value
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[redacted]")
      .replace(/\b(?:psk|pre[-_ ]?shared[-_ ]?key|private[-_ ]?key|password|secret)\s*[:=]\s*([^\s,;]+)/gi,
        (match, material: string) => material === "{{PSK}}" ? match : "[redacted]");
    return value;
  };
  return project(data, 0);
}

/** Keep only the backend's public destination host, even if a future response adds a path. */
export function safeVpnWebhookPayload(data: unknown, status: number): unknown {
  const safe = safeVpnPayload(data, status);
  if (status >= 400 || !safe || typeof safe !== "object" || Array.isArray(safe)) return safe;
  const record = safe as Record<string, unknown>;
  const pick = (source: Record<string, unknown>, fields: string[]) => Object.fromEntries(fields
    .filter(field => source[field] !== undefined).map(field => [field, source[field]]));
  const display = (subscription: unknown): Record<string, unknown> => {
    if (!subscription || typeof subscription !== "object" || Array.isArray(subscription)) return {};
    const item = subscription as Record<string, unknown>;
    const shown = pick(item, ["id", "enabled", "created_at"]);
    if (item.last_delivery === null) shown.last_delivery = null;
    else if (item.last_delivery && typeof item.last_delivery === "object" && !Array.isArray(item.last_delivery)) {
      shown.last_delivery = pick(item.last_delivery as Record<string, unknown>,
        ["event_id", "transition", "occurred_at", "status", "http_status", "attempts", "next_attempt_at", "delivered_at"]);
    }
    try {
      const url = new URL(typeof item.url === "string" ? item.url : "");
      const host = url.hostname;
      shown.url = url.protocol === "https:" && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(host)
        ? `https://${host}` : "https://invalid.invalid";
    } catch { shown.url = "https://invalid.invalid"; }
    return shown;
  };
  if (Array.isArray(record.subscriptions)) return { subscriptions: record.subscriptions.map(display) };
  if (record.subscription !== undefined) return { subscription: display(record.subscription),
    ...(record.sealed_secret !== undefined ? { sealed_secret: record.sealed_secret } : {}) };
  if (typeof record.removed === "boolean") return { removed: record.removed };
  return {};
}

/** Read-only recovery targets. IDs are copied from validated inputs or owned API results, never guessed. */
export function networkingFollowUpReads(definition: NetworkingTool, args: Record<string, unknown>, data: unknown): FollowUpRead[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const value = data as Record<string, any>;
  if (value.success === false || value.error) return [];
  const reads: FollowUpRead[] = [];
  const add = (tool: string, fields: Record<string, unknown>) => {
    if (!Object.values(fields).every(id => uuid.safeParse(id).success)) return;
    const read = { tool, arguments: fields as Record<string, string> };
    if (!reads.some(existing => JSON.stringify(existing) === JSON.stringify(read))) reads.push(read);
  };
  if (definition.name === "get_private_network") {
    if (value.network?.port_intent_ready === true) {
      add("list_network_attachment_candidates", { network_id: value.network.id ?? args.network_id });
    }
    return reads;
  }
  if (definition.name === "set_network_port_forwards") {
    // The receipt is a router outbox operation, not the generic network operation store.
    add("get_network_port_forwards", { network_id: args.network_id });
    return reads;
  }
  if (definition.path.startsWith(`${N}/services/`) && definition.path.includes("/public-firewall")) {
    if (definition.method !== "GET") {
      // Service order numbers are intentionally not UUIDs and are never replaced with a caller project/node ID.
      if (serviceId.safeParse(args.service_id).success) reads.push({ tool: "get_service_public_firewall", arguments: { service_id: String(args.service_id) } });
    }
    return reads;
  }
  if (definition.method === "GET") return reads;
  if (definition.path.includes("/projects/")) {
    const project = args.project_id ?? value.policy?.project_id;
    if (args.network_id) add("get_network_security_policy", { project_id: project, network_id: args.network_id });
    if (value.policy?.network_id) add("get_network_security_policy", { project_id: project, network_id: value.policy.network_id });
    for (const policy of Array.isArray(value.policies) ? value.policies : []) {
      add("get_network_security_policy", { project_id: project, network_id: policy?.network_id });
    }
  } else if (definition.path.includes("/public-bindings/")) {
    add("get_network_public_binding", { binding_id: args.binding_id ?? value.resource_id });
  } else if (definition.path.includes("/appliances/")) {
    add("get_network_appliance_operation", { operation_id: value.operation?.id });
    if ((definition.name === "add_network_load_balancer_listener" && args.tls !== undefined) || definition.name === "remove_network_load_balancer_listener") {
      add("get_network_load_balancer", { load_balancer_id: args.load_balancer_id });
    }
    if (definition.name === "set_network_vpn_site_options" || definition.name === "set_network_vpn_site_alert") {
      add("get_network_vpn_gateway", { gateway_id: args.gateway_id });
    }
    if (definition.name === "set_vpn_server_access") {
      // The setting's operation can be succeeded while its separate network policy is pending.
      const network = value.vpn_gateway?.network_id;
      const project = value.vpn_gateway?.project_id;
      if (project) add("get_network_security_policy", { project_id: project, network_id: network });
      else add("get_private_network", { network_id: network });
    }
  } else if (definition.path.includes("/public-addresses/")) {
    add("get_network_public_address", { address_id: args.address_id ?? value.public_address?.id });
    if (args.network_id) add("get_network_routed_egress", { network_id: args.network_id });
  } else if (definition.path.includes("/networks")) {
    add("get_networking_operation", { operation_id: value.operation?.id ?? value.operation_id });
    if (definition.name === "set_network_routed_egress") {
      add("get_network_routed_egress", { network_id: args.network_id });
    } else if (["set_private_network_dns", "set_private_network_names", "create_private_network"].includes(definition.name)) {
      add("get_private_network", { network_id: args.network_id ?? value.network?.id });
    } else if (definition.path.endsWith("/ports") || definition.path.includes("/ports/")) {
      add("list_private_network_ports", { network_id: args.network_id });
    }
  }
  return reads;
}

export function registerNetworkingTools(server: McpServer): void {
  for (const definition of networkingTools) {
    server.registerTool(definition.name, {
      description: definition.description,
      inputSchema: definition.schema,
      annotations: {
        readOnlyHint: definition.options.readOnly === true,
        destructiveHint: definition.options.destructive === true,
        idempotentHint: definition.options.readOnly === true || definition.options.idempotent === true,
        openWorldHint: true,
      },
    }, async args => {
      const request = networkingRequest(definition, args);
      if (definition.name === "set_service_public_firewall" && args.desired_state === "present") {
        // Confirm the currently returned scope/rules before an inbound-denying change.
        // This is a customer read only; caller project/node/address authority is never accepted.
        const current = await apiRequest("GET", request.path, undefined, {}, { readOnly: true });
        if (current.status >= 400) return { isError: true, content: [{ type: "text" as const, text: formatJson(safeVpnPayload(current.data, current.status)) }] };
        const groups = current.data && typeof current.data === "object" ? (current.data as Record<string, unknown>).groups : undefined;
        if (!Array.isArray(groups)) throw new Error("Public group eligibility is unavailable; read get_service_public_firewall again.");
        const selected = (args.group_ids as string[]).map(id => groups.find(group => group && typeof group === "object" && group.id === id));
        if (selected.some(group => !group || group.public_eligible !== true || !Array.isArray(group.rules))) throw new Error("A selected group is not currently public-eligible with known rules; refresh get_service_public_firewall.");
        if (!selected.some(group => group.rules.some((rule: unknown) => rule && typeof rule === "object" && (rule as Record<string, unknown>).direction === "ingress")) && args.acknowledge_no_inbound !== true) throw new Error("Selected groups have no inbound rules; explicit acknowledge_no_inbound=true is required.");
      }
      const result = await apiRequest(request.method, request.path, request.body, request.headers, { readOnly: request.readOnly });
      const responseData = definition.name === "list_network_products" && result.status < 400 && result.data && typeof result.data === "object" && !Array.isArray(result.data)
        && Array.isArray((result.data as Record<string, unknown>).products)
        ? { ...(result.data as Record<string, unknown>), products: ((result.data as Record<string, unknown>).products as unknown[]).filter(row => !(row && typeof row === "object" && (row as Record<string, unknown>).product === "vpn_gateway" && (row as Record<string, unknown>).deprecated_alias === true)) }
        : result.data;
      const safeData = definition.path.includes("/health-webhooks") ? safeVpnWebhookPayload(responseData, result.status)
        : definition.path.includes("/vpn-gateways") || definition.path.includes("/public-firewall") || definition.path.includes("/load-balancers") ? safeVpnPayload(responseData, result.status) : responseData;
      const reads = result.status < 400 ? networkingFollowUpReads(definition, args, safeData) : [];
      const progress = result.status < 400 ? networkingProgressHint(safeData) : null;
      return { content: [
        { type: "text" as const, text: formatJson(safeData) },
        ...(progress ? [{ type: "text" as const, text: progress }] : []),
        ...(reads.length ? [{ type: "text" as const, text: `Follow-up reads (do not repeat the change): ${JSON.stringify(reads)}` }] : []),
      ], ...(result.status >= 400 ? { isError: true } : {}) };
    });
  }
}
