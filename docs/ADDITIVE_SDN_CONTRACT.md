# Additive SDN MCP contract

This source is based on main `8218f0020c823b61ec27077e9c33c0f1f1957e7e` and preserves its dependency and Zod 4 compatibility fixes. It is separate from the prepared VPN/dependency release. Tool presence does not establish backend availability or runtime qualification.

| Family | MCP coverage | Backend contract |
| --- | --- | --- |
| Security groups | Existing network creation/default policy adds `ingress_rules`; group creation adds optional `egress_policy`. Omission preserves legacy behavior. | `3b1b2ba25ecddbf95fb141fa3a6cdf26bebfca6d` |
| Public IP | Paginated public-interface server targets, `service_id` alternative, explicit optional `move`, existing management reach check. | API `9667838f7a87632a81dd805f7100d400de8cc74f`; release must include safety follow-up `9a8c81cb78744a290c72a6fcd143e6b3a7ff76d2` |
| NAT forwarding | Complete TCP/UDP rule replacement, router generation, authoritative eligible targets, direct resource polling. Confirmed failed-generation retry keeps exact desired rules with a new key; transport uncertainty retains the original key. | `9b91271e9092f1fa0d173fb7a22e2c50c05516e7` |
| Public firewall | Four customer operations: read, assignment/removal, exact retry, unbound group creation. Networking read/manage scopes. Backend resolves project/node/address authority. | API `804094845a077d931ad26831400b1ff5a939236c`; mutation/lifecycle `811f61f2ea2dd30a2c6e0ceed4bafa6b283c779d`; includes the final public-group eligibility read contract |
| Managed LB TLS | Existing listener POST gains only `tls.hostname`. No new issuance endpoint, key upload, hostname editing or generation parameter. Backend HTTP members; managed DNS Let's Encrypt uses existing free-certificate eligibility/quotas. | `6ef808425f94317901b39d59e5ef7bb3148dee47`; matching worker/writer TLS delivery and runtime qualification are separate gates |

Public-firewall policy PUT sends exactly `expected_generation`, `group_ids`, `desired_state` and its original idempotency header. MCP-only `acknowledge_removal` and `acknowledge_no_inbound` are never sent to the backend. Before a present assignment MCP reads current returned `public_eligible` groups and rules. Unknown/ineligible groups are refused. No-ingress assignments require deliberate acknowledgement and can interrupt existing inbound-origin SSH. Any ingress rule is not proof of SSH reachability. Retry has no idempotency header or mutation arguments beyond the service ID. Group bootstrap creates an unbound project-wide group without NIC enrollment.

Public-firewall protection requires fresh backend `protected` evidence. Managed TLS `managed_tls` is first-listener intake eligibility and becomes unavailable after registration; listener TLS state governs certificate adoption/renewal. A terminal `tls_request` operation does not mean the certificate is ready, and certificate readiness does not establish traffic health. Poll the load balancer itself.

Responses use the reviewed secret projection for VPN, public firewall and load balancers. Private keys and PSKs are never accepted for these new interfaces. Typed 423 service-lock codes/reasons and safe unlock metadata remain available while arbitrary error detail is withheld.

No endpoint, customer mutation, fleet admission, staging change or deployment is executed by this MCP implementation. The additive runtime must remain blocked until root selects a backend batch containing all matching APIs, migrations and read contracts; the prepared VPN/dependency artifact has no such additive dependency.
