import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest, formatJson } from "./api.js";

// Customer routes only. The account comes from X-API-KEY; caller-supplied
// tenant IDs, worker IDs and internal endpoints never enter this registry.
const uuid = z.string().length(36).regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/)
  .describe("Exact lowercase UUID returned by an owned networking resource");
const generation = z.number().int().safe().min(1);
const policyGeneration = z.number().int().safe().min(0);
const ipv4 = z.string().ip({ version: "v4" });
const port = z.number().int().min(1).max(65535);
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{15,189}$(?![\s\S])/)
  .describe("Stable Idempotency-Key for this exact intent; reuse unchanged on recovery, never generate a new key for an uncertain result");
const quoteToken = z.string().min(1).regex(/^[^\s\x00-\x1f\x7f]+$/)
  .describe("Exact quote_token returned by the quote; sent only as X-Quote-Token");
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
const publicKey = z.string().regex(/^[A-Za-z0-9+/]{43}=$/)
  .refine(value => Buffer.from(value, "base64").length === 32)
  .describe("Customer-generated one-time X25519 PUBLIC key only. Keep its private key outside MCP; needed to decrypt the sealed configuration.");

type Fields = z.ZodRawShape;
type Options = {
  idempotent?: boolean; paid?: boolean; quote?: boolean; readOnly?: boolean;
  query?: string[]; fixedBody?: Record<string, unknown>; destructive?: boolean;
};
export type NetworkingTool = {
  name: string; method: string; path: string; description: string;
  schema: z.ZodObject<Fields, "strict">; pathFields: string[]; options: Options;
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
const scope = "Requires explicit networking:read for reads or networking:manage for changes; full/read defaults do not grant networking. The backend enforces ownership, feature availability and service 2FA locks.";
const writes = "Read current capabilities and owned resource state first; obtain approval for the exact change. An accepted operation is pending, not proof of connectivity. Preserve reason_code and poll the returned operation/resource. On transport uncertainty inspect state and reuse only the original key and unchanged request; never automatically retry.";
const paid = "Requires full API access, networking:manage, enabled paid operations, networking:order and spend caps. Choose a supported live catalog tier and its documented request kind; preserve the exact quote; disclose its gross_amount in EUR before user approval. The same Idempotency-Key is required for quote and confirmation. API-key checkout supports the advertised account-balance payment method only. Payment acceptance is not resource readiness.";
function tool(name: string, method: string, path: string, description: string, fields: Fields = {}, options: Options = {}): NetworkingTool {
  const pathFields = [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
  const shape: Fields = Object.fromEntries(pathFields.map(field => [field, field === "service_id" ? serviceId : uuid]));
  Object.assign(shape, fields);
  if (options.quote || options.paid) shape.idempotencyKey = key;
  else if (options.idempotent) {
    const pattern = path.includes("/projects/") ? /^[A-Za-z0-9._-]{8,128}$(?![\s\S])/
      : path.includes("/public-bindings/") ? /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$(?![\s\S])/ : /^[A-Za-z0-9._:-]{8,128}$(?![\s\S])/;
    shape.idempotencyKey = z.string().regex(pattern).describe("Idempotency-Key for this exact change; preserve it and the unchanged body on uncertain recovery");
  }
  if (options.paid) {
    shape.quoteToken = quoteToken;
    shape.acknowledge_charge = z.literal(true).describe("Set only after the user approves the exact quoted EUR total and intended purchase/renewal");
  }
  const readOnly = options.readOnly ?? method === "GET";
  return { name, method, path, pathFields, options: { ...options, readOnly }, schema: z.object(shape).strict(),
    description: [description, path.startsWith(N) ? scope : "", !readOnly ? writes : "", options.paid || options.quote ? paid : ""].filter(Boolean).join(" ") };
}

export const networkingTools: NetworkingTool[] = [
  tool("get_network_payment_methods", "POST", "/public/macroPay/methods", "Read payment-method metadata without starting payment. Choose the exact value of an item with system=balance for API-key network purchases; other methods are refused for API keys. This public catalog needs no networking scope.", { country: z.string().regex(/^[A-Za-z]{2}$/).optional() }, { readOnly: true, fixedBody: { includeBalanceMethod: true, includePreinvoiceMethod: false } }),
  tool("get_networking_capabilities", "GET", `${N}/capabilities`, "Read account networking availability, quota, creation options and eligible order-time attachments. Never infer support from tool presence."),
  tool("get_networking_features", "GET", `${N}/features`, "Read current networking feature gates, DNS options and supported contract extensions."),
  tool("get_networking_overview", "GET", `${N}/overview`, "Read owned networks, quota and operation snapshot. operations_has_more signals a bounded backend feed."),
  tool("get_networking_topology", "GET", `${N}/topology`, "Read the account topology with network-scoped identities. Optional metrics=current requests measured traffic.", { metrics: z.literal("current").optional() }, { query: ["metrics"] }),
  tool("list_networking_operations", "GET", `${N}/operations`, "Read recent network operations and operations_has_more. This endpoint has no pagination parameter."),
  tool("get_networking_operation", "GET", `${N}/operations/{operation_id}`, "Read an accepted network or port operation. DNS updates are instead read from the network settings.dns_change."),
  tool("list_private_networks", "GET", `${N}/networks`, "List owned private networks, including deletion awaiting verified cleanup."),
  tool("get_private_network", "GET", networks, "Read one owned network including DHCP reservations, DNS change progress, generation and project_id."),
  tool("create_private_network", "POST", `${N}/networks`, "Create a private network intent. Omit subnet for an allocated /24; explicit aligned RFC1918 /16 through /28 is accepted subject to current capabilities. Creation does not itself attach a server or buy a public address.", { name, subnet: z.object({ cidr: z.string().regex(/^\d{1,3}(?:\.\d{1,3}){3}\/(?:1[6-9]|2[0-8])$/) }).strict().optional(), settings: settings.optional(), default_policy: z.enum(["accept", "deny"]).optional() }, { idempotent: true }),
  tool("delete_private_network", "DELETE", networks, "Request deletion of an empty network. Referenced appliances/ports may prevent deletion; quota is released only after verified cleanup.", { expected_generation: generation }, { idempotent: true, destructive: true }),
  tool("retry_private_network", "POST", `${networks}/retry`, "Retry the failed current network operation only; preserve its current generation. This is not a new create.", { expected_generation: generation }, { idempotent: true }),
  tool("set_private_network_dns", "POST", `${networks}/dns`, "Change DHCP DNS servers in place. Use dns_servers only for custom mode. Poll get_private_network.settings.dns_change; its DNS update UUID is not in the network operations feed.", { dns_mode: dnsMode, dns_servers: z.array(ipv4).min(1).max(3).optional() }, { idempotent: true }),
  tool("set_private_network_names", "PUT", `${networks}/names`, "Replace the complete internal DNS zone label and alias list. Server names are automatic; these names resolve only inside this network. Omitted aliases are not preserved.", { zone_label: dnsLabel, aliases: z.array(dnsAlias).max(64) }),
  tool("list_private_network_ports", "GET", `${networks}/ports`, "Read owned network ports, their fixed DHCP addresses, generations and attachment states. Reserved is not connected."),
  tool("list_service_private_ports", "GET", `${N}/services/{service_id}/ports`, "Read private ports and order attachment recovery state for one owned service order number."),
  tool("list_network_attachment_candidates", "GET", `${networks}/attachment-candidates`, "Read attachable services and each attachment_mode. Follow next_cursor using after when candidates_has_more is true; service_id selects an owned service.", { after: z.string().optional(), service_id: serviceId.optional() }, { query: ["after", "service_id"] }),
  tool("attach_private_network_port", "POST", `${networks}/ports`, "Attach an owned service; omit ipv4 for automatic allocation or pass a fixed usable address. Check attachment-candidates first; restart=true is explicit permission for a required restart.", { service_id: serviceId, ipv4: ipv4.optional(), restart }, { idempotent: true }),
  tool("detach_private_network_port", "DELETE", `${networks}/ports/{port_id}`, "Detach the owned server port. Use the PORT generation and confirm any required restart.", { expected_generation: generation, restart }, { idempotent: true, destructive: true }),
  tool("retry_private_network_port", "POST", `${networks}/ports/{port_id}/retry`, "Retry the failed current port operation with the PORT generation and any required restart approval.", { expected_generation: generation, restart }, { idempotent: true }),
  tool("get_network_vpn_summary", "GET", `${networks}/vpn`, "Read the network's VPN summary, including truthful absence. Native site-to-site is not supported by this tool set."),
  tool("get_network_routed_egress", "GET", `${networks}/routed-egress`, "Read this network's NAT/internet access, public address and qualification state."),
  tool("set_network_routed_egress", "POST", `${networks}/routed-egress`, "Request the currently supported NAT transition for an owned network; the backend may refuse mode changes. public_address_id attaches an already-owned paid address and may move it from a server. This never purchases an address.", { internet_access: internetAccess, expected_generation: generation, public_address_id: uuid.optional() }),
  tool("get_security_group_capabilities", "GET", `${N}/security-groups/capabilities`, "Read security-group availability and whether the network default policy can be changed."),
  tool("list_network_security_groups", "GET", sg, "List groups in the owned project. Copy project_id from the network; do not invent an account identifier."),
  tool("create_network_security_group", "POST", sg, "Create a named allow-rule set. Optional network_id scopes it to that network; otherwise it belongs to the project. IPv6 rules are unavailable.", { name, rules: z.array(rule).max(256), network_id: uuid.optional() }, { idempotent: true }),
  tool("update_network_security_group", "PUT", `${sg}/{group_id}`, "Replace the complete group name and rule list at its expected revision. Bound servers may be affected; empty rules deny traffic allowed only by this group.", { name, rules: z.array(rule).max(256), expected_revision: generation }, { idempotent: true, destructive: true }),
  tool("delete_network_security_group", "DELETE", `${sg}/{group_id}`, "Delete an unreferenced customer group at its expected revision; referenced groups are refused.", { expected_revision: generation }, { idempotent: true, destructive: true }),
  tool("clone_network_security_group", "POST", `${sg}/{group_id}/clone`, "Clone an owned group into a new name; use the source group's current revision.", { name, expected_revision: generation }, { idempotent: true }),
  tool("get_network_security_policy", "GET", policy, "Read default policy, assigned groups and policy application state. Policy generation differs from network and port generations."),
  tool("set_network_default_security_policy", "PUT", policy, "Change accept/deny for servers without custom groups. Explicit custom groups remain restrictive. Use policy generation and default-group revision from get_network_security_policy.", { default_policy: z.enum(["accept", "deny"]), expected_generation: policyGeneration, expected_default_revision: generation }, { idempotent: true, destructive: true }),
  tool("set_private_port_security_groups", "PUT", `${project}/networks/{network_id}/ports/{port_id}/security-groups`, "Replace the port's complete customer-group list. Empty list selects the network default; at most seven customer groups fit alongside platform DNS. Use policy and port generations separately.", { group_ids: z.array(uuid).max(7), expected_generation: policyGeneration, expected_port_generation: generation }, { idempotent: true, destructive: true }),
  tool("retry_network_security_policy", "POST", `${policy}/retry`, "Retry the failed network security policy using its current desired state." , {}, { idempotent: true }),
  tool("retire_network_security_policy", "DELETE", policy, "Retire the policy only after its server ports are gone. Removing firewall policy requires explicit user approval.", { expected_generation: generation }, { idempotent: true, destructive: true }),
  tool("get_network_appliance_capabilities", "GET", `${A}/capabilities`, "Read available load balancer providers/tiers, public qualification, VPN capabilities and quota. Tier availability and prices are returned by the backend, never hardcoded."),
  tool("list_network_appliances", "GET", A, "Read owned load balancers and VPN gateways with one stream cursor."),
  tool("get_network_appliance_billing", "GET", `${A}/billing`, "Read current customer-visible recurring appliance lines and currency."),
  tool("get_network_appliance_operation", "GET", `${A}/operations/{operation_id}`, "Poll an accepted appliance operation. Creation succeeds only when its actual resource state and health confirm readiness."),
  tool("list_network_load_balancers", "GET", `${A}/load-balancers`, "List private and public load balancers and customer-safe health/qualification state."),
  tool("get_network_load_balancer", "GET", lb, "Read one owned load balancer, listeners, members, generation and health. A pending or unqualified public endpoint is not ready."),
  tool("estimate_network_load_balancer", "POST", `${A}/load-balancers/quote`, "Read a technical load balancer estimate for this exact configuration. This does not issue a paid purchase token; buy through quote_network_product and order_network_product. Legacy POST /appliances/load-balancers refuses unpaid creation.", loadBalancerSpec, { readOnly: true }),
  tool("delete_network_load_balancer", "DELETE", lb, "Request appliance teardown at its current generation; this is not a refund or paid-period cancellation. Addresses are released only after verified cleanup.", { expected_generation: generation }, { idempotent: true, destructive: true }),
  tool("add_network_load_balancer_member", "POST", `${lb}/members`, "Add an attached private server address to the selected listener; backend validates membership in this network.", { listener_id: uuid, address: ipv4, port }, { idempotent: true }),
  tool("remove_network_load_balancer_member", "DELETE", `${lb}/members/{member_id}`, "Remove a member from rotation using the load balancer generation.", { expected_generation: generation }, { idempotent: true, destructive: true }),
  tool("add_network_load_balancer_listener", "POST", `${lb}/listeners`, "Add a listener and optional initial members using currently offered protocol capabilities. SMTP ports may be refused.", { protocol, port, members: z.array(member).max(64).optional() }, { idempotent: true }),
  tool("remove_network_load_balancer_listener", "DELETE", `${lb}/listeners/{listener_id}`, "Remove a listener and its members; deleting the last listener is refused.", { expected_generation: generation }, { idempotent: true, destructive: true }),
  tool("list_network_vpn_gateways", "GET", `${A}/vpn-gateways`, "List owned VPN gateways, their device peers and safe status. No private keys or one-time configurations are retrieved."),
  tool("get_network_vpn_gateway", "GET", vpn, "Read one owned VPN gateway, current generation, device peers, grant candidates and attachment capability."),
  tool("delete_network_vpn_gateway", "DELETE", vpn, "Request teardown of an owned VPN gateway; all devices lose connectivity. Paid time is not refunded by this operation.", { expected_generation: generation }, { idempotent: true, destructive: true }),
  tool("attach_network_vpn_gateway", "POST", `${vpn}/attach`, "Attach or move an account VPN to an owned network only when standalone attachment is advertised. This recreates the gateway and interrupts connections; confirm the interruption.", { network_id: uuid }, { idempotent: true, destructive: true }),
  tool("detach_network_vpn_gateway", "POST", `${vpn}/detach`, "Detach an account VPN from its network when supported; it keeps its paid period and devices but recreates the gateway. Confirm the interruption.", {}, { idempotent: true, destructive: true }),
  tool("set_vpn_server_access", "POST", `${vpn}/server-access`, "Choose accept or groups_only for the VPN's access to attached servers when this capability is available. Security-policy application is asynchronous.", { mode: z.enum(["accept", "groups_only"]) }, { idempotent: true, destructive: true }),
  tool("create_network_vpn_peer", "POST", `${vpn}/peers`, "Add a device with an externally generated one-time PUBLIC reveal key. Pass 0-16 owned grant-candidate IPv4 addresses: split-tunnel VPNs require at least one; full-tunnel VPNs may use an empty list. Keep the matching private key entirely outside MCP. The gateway generates the WireGuard key; wait for config_available before consuming its sealed configuration.", { name: name.max(64), grants: z.array(ipv4).max(16), reveal_public_key: publicKey }, { idempotent: true }),
  tool("take_network_vpn_peer_config", "GET", `${peer}/config`, "Consume the device's sealed configuration ONCE. This is a management mutation despite GET. The ciphertext is decryptable only by the customer's matching external reveal private key; this tool never creates, requests or decrypts private keys. Save the returned sealed payload externally; a second pickup is 410. Never retry automatically after an uncertain transport result.", { acknowledge_one_time_pickup: z.literal(true) }, { readOnly: false, destructive: true }),
  tool("revoke_network_vpn_peer", "DELETE", peer, "Revoke one device using the VPN GATEWAY generation. Its tunnel access ends after the next applied configuration.", { expected_generation: generation }, { idempotent: true, destructive: true }),
  tool("set_network_vpn_peer_grants", "PUT", `${peer}/grants`, "Replace the device's complete reachable-server list when standalone VPN is available. Empty list removes server grants; use gateway generation. Check routes_update on the resulting peer for changes the customer must make to AllowedIPs.", { expected_generation: generation, grants: z.array(ipv4).max(16) }, { idempotent: true, destructive: true }),
  tool("get_network_vpn_egress_options", "GET", `${vpn}/egress-options`, "Read supported VPN Internet exits and qualification. Ordinary VMs and remote connectors are not implied to be supported."),
  tool("set_network_vpn_peer_egress", "PUT", `${peer}/egress-policy`, "Set a device's private-only, inherited NAT, or advertised chosen exit policy. Read egress options first; Internet routing requires explicit client-route opt-in and applied qualification.", { expected_generation: generation, policy: egressPolicy }, { idempotent: true, destructive: true }),
  tool("list_network_products", "GET", `${N}/products`, "Read current paid products, live tier names, prices and purchase capability; public proxy load balancer 3/5-node offerings must come from this catalog."),
  tool("list_network_product_periods", "GET", `${N}/product-periods`, "Read owned product periods, renewal availability and lifecycle facts."),
  tool("quote_network_product", "POST", `${networks}/product-quotes`, "Create the network product's exact paid quote for COMMON CHECKOUT. No charge or stock preparation occurs here. prepare_after_payment=true is always sent. Catalog product load_balancer maps to request kind private_lb for tier nlb or proxy_lb for tiers alb_proxy_3/alb_proxy_5; vpn_gateway maps directly. Only use currently supported catalog tiers. Create with order_network_product after disclosure and approval.", { kind: z.enum(["private_lb", "proxy_lb", "vpn_gateway"]), tier: z.string().regex(/^[a-z][a-z0-9_]*$/) }, { quote: true, fixedBody: { prepare_after_payment: true } }),
  tool("quote_account_vpn", "POST", `${N}/vpn/product-quotes`, "Create an account VPN quote for common checkout when vpn_account_order is advertised. Pass its owned attachment network when required; no provisioning or charge occurs before payment. Uses prepare_after_payment=true.", { tier: z.string().regex(/^[a-z][a-z0-9_]*$/), network_id: uuid.optional() }, { quote: true, fixedBody: { prepare_after_payment: true } }),
  tool("order_network_product", "POST", `${N}/product-orders`, "Confirm a common-checkout purchase from an approved exact quote. Use its quote_id, quote_token and ORIGINAL idempotency key. payment.payment is the account-balance method ID from get_network_payment_methods; do not guess it. Optional target attaches an address to a network after settlement. After any uncertain result call find_network_product_order with the quote ID, then poll get_network_product_order; never buy a second copy.", { quote_id: uuid, payment: z.object({ payment: z.number().int().positive(), paymentid: z.number().int().positive().optional() }).strict(), target: z.object({ network_id: uuid, expected_generation: generation }).strict().optional() }, { paid: true }),
  tool("get_network_product_order", "GET", `${N}/product-orders/{order_id}`, "Read an owned common-checkout order's payment and fulfilment state. paid_pending is not ready; fulfilled may include a separate attachment status."),
  tool("find_network_product_order", "GET", `${N}/product-orders`, "Recover an uncertain checkout by the ORIGINAL quote_id; order=null means no order was found, not proof to use a new payment key.", { quote_id: uuid }, { query: ["quote_id"] }),
  tool("quote_network_product_renewal", "POST", `${networks}/product-periods/{resource_id}/quote`, "Quote one next paid month for a network product; no charge. Preserve the returned quote and this idempotency key for renewal.", {}, { quote: true }),
  tool("renew_network_product", "POST", `${networks}/product-periods/{resource_id}/renew`, "Pay the exact previously disclosed renewal from account balance. The quote binds resource, paid term and price; use the same key and token.", { quote_id: uuid }, { paid: true }),
  tool("disable_network_product_auto_renew", "POST", `${networks}/product-periods/{resource_id}/auto-renew`, "Disable automatic renewal. The paid product continues to its paid-until time; API keys cannot enable automatic renewal.", {}, { fixedBody: { state: false } }),
  tool("quote_vpn_period_renewal", "POST", `${vpn}/period/quote`, "Quote the VPN's next month on its actual paid scope; no charge. Availability follows the owned gateway's current capability.", {}, { quote: true }),
  tool("renew_vpn_period", "POST", `${vpn}/period/renew`, "Pay the VPN's approved next-month renewal from account balance using the exact quote and original key.", { quote_id: uuid }, { paid: true }),
  tool("disable_vpn_auto_renew", "POST", `${vpn}/auto-renew`, "Disable the VPN's automatic renewal; the current paid period remains. API keys cannot enable it.", {}, { fixedBody: { state: false } }),
  tool("list_network_public_addresses", "GET", `${N}/public-addresses`, "Read owned paid public addresses, account limits, target support and purchase availability."),
  tool("get_network_public_address", "GET", address, "Read one owned public address, attachment and paid-period state."),
  tool("quote_network_public_address", "POST", `${N}/public-addresses/quote`, "Quote a new paid public address for common checkout; no charge. Optional network_id preflights attachment limits before payment. Always prepare_after_payment=true; confirm through order_network_product with matching target if attaching.", { network_id: uuid.optional() }, { quote: true, fixedBody: { prepare_after_payment: true } }),
  tool("attach_public_address_to_network", "POST", `${address}/attach`, "Attach or move an already-paid address to an owned network's NAT. Uses NETWORK generation; moving it removes the prior target's use of this address. No purchase occurs.", { network_id: uuid, expected_generation: generation }, { destructive: true }),
  tool("attach_public_address_to_server", "POST", `${address}/attach`, "Attach or move an owned paid public address to an eligible zero-public-IP server's private port. Read server_target_enabled and candidate state; movement affects the previous target.", { private_port_id: uuid }, { destructive: true }),
  tool("detach_network_public_address", "POST", `${address}/detach`, "Detach an owned public address from its current target; it stays owned for the paid period. This can remove Internet connectivity.", {}, { destructive: true }),
  tool("quote_public_address_renewal", "POST", `${address}/renewal-quote`, "Quote the address's next month without charging; use the returned quote and this key for confirmation.", {}, { quote: true }),
  tool("renew_network_public_address", "POST", `${address}/renew`, "Pay the approved address renewal from balance with its exact quote ID/token and original key.", { quote_id: uuid }, { paid: true }),
  tool("disable_public_address_auto_renew", "POST", `${address}/auto-renew`, "Disable address automatic renewal; ownership lasts until paid_until. There is no early paid-address cancellation route. API keys cannot enable automatic renewal.", {}, { fixedBody: { state: false } }),
  tool("get_network_public_binding", "GET", binding, "Read one existing owned public binding's generation, state and assigned address. Existing bindings are distinct from purchasing an account public address."),
  tool("bind_network_public_ip", "POST", `${binding}/bind`, "Bind an already reserved floating public binding to an owned private port when supported. Does not purchase an address.", { expected_generation: policyGeneration, private_port_id: uuid }, { idempotent: true, destructive: true }),
  tool("move_network_public_ip", "POST", `${binding}/move`, "Move a prepared floating public binding to another owned private port; confirm interruption to the old target.", { expected_generation: generation, private_port_id: uuid }, { idempotent: true, destructive: true }),
  tool("configure_network_public_forwarding", "POST", `${binding}/forward`, "Configure an existing reserved forwarding binding's TCP/UDP listeners. Forwarding uses one backend per listener; proxy load balancers use their own appliance authority and are refused here.", { expected_generation: policyGeneration, listeners: z.array(z.object({ protocol: z.enum(["tcp", "udp"]), port, backends: z.array(z.object({ private_port_id: uuid, port }).strict()).min(1).max(64) }).strict()).min(1).max(64) }, { idempotent: true, destructive: true }),
  tool("delete_network_public_binding", "DELETE", binding, "Request deletion of an existing binding using its generation. Account address ownership/paid renewal is managed separately; do not claim a refund.", { expected_generation: policyGeneration }, { idempotent: true, destructive: true }),
];

export function networkingRequest(definition: NetworkingTool, args: Record<string, unknown>) {
  const input = definition.schema.parse(args);
  let path = definition.path;
  for (const field of definition.pathFields) path = path.replace(`{${field}}`, encodeURIComponent(String(input[field])));
  const query = new URLSearchParams();
  for (const field of definition.options.query ?? []) {
    if (input[field] !== undefined) query.set(field, String(input[field]));
  }
  if (query.size) path += `?${query}`;
  const headers: Record<string, string> = {};
  if (input.idempotencyKey !== undefined) headers["Idempotency-Key"] = String(input.idempotencyKey);
  if (input.quoteToken !== undefined) headers["X-Quote-Token"] = String(input.quoteToken);
  const excluded = new Set([...definition.pathFields, ...(definition.options.query ?? []), "idempotencyKey", "quoteToken", "acknowledge_charge", "acknowledge_one_time_pickup"]);
  const body = definition.method === "GET" ? undefined : {
    ...Object.fromEntries(Object.entries(input).filter(([field, value]) => !excluded.has(field) && value !== undefined)),
    ...(definition.options.fixedBody ?? {}),
  };
  return { method: definition.method, path, body, headers, readOnly: definition.options.readOnly === true };
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
      const result = await apiRequest(request.method, request.path, request.body, request.headers, { readOnly: request.readOnly });
      return { content: [{ type: "text" as const, text: formatJson(result.data) }], ...(result.status >= 400 ? { isError: true } : {}) };
    });
  }
}
